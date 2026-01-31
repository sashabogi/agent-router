/**
 * Ollama Provider Implementation
 *
 * Implements the Provider interface for Ollama's OpenAI-compatible API.
 * Ollama provides local LLM inference with an API that mirrors OpenAI's format.
 *
 * Key characteristics:
 * - Local server running at http://localhost:11434
 * - No authentication required (local)
 * - Uses OpenAI-compatible /v1/chat/completions endpoint
 * - May not support all features (especially function calling)
 * - Server may be slower than cloud providers
 */

import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type StreamChunk,
  type Message,
  type ContentBlock,
  type Tool,
} from '../types.js';

import { BaseProvider } from './base.js';

// ============================================================================
// Ollama API Types (OpenAI-compatible format)
// ============================================================================

/**
 * Ollama message format (same as OpenAI).
 */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

/**
 * Ollama tool call format (same as OpenAI).
 */
interface OllamaToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Ollama tool/function definition (same as OpenAI).
 */
interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Ollama chat completion request body.
 */
interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  tools?: OllamaTool[] | undefined;
  stream?: boolean | undefined;
}

/**
 * Ollama chat completion response.
 */
interface OllamaResponseChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OllamaToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

interface OllamaResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OllamaResponseChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Tool call delta in a streaming chunk.
 */
interface OllamaToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * Choice delta in a streaming chunk.
 */
interface OllamaStreamChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string | null;
    tool_calls?: OllamaToolCallDelta[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

/**
 * Ollama streaming chunk.
 */
interface OllamaStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OllamaStreamChoice[];
}

/**
 * Model info in tags response.
 */
interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Ollama tags API response (for health check).
 */
interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

// ============================================================================
// Ollama Provider Implementation
// ============================================================================

/**
 * Ollama provider adapter for local LLM inference.
 *
 * Ollama provides an OpenAI-compatible API for running local models.
 * This provider translates AgentRouter requests to the Ollama format
 * and handles the specific characteristics of local inference.
 *
 * Features:
 * - No authentication required (local server)
 * - Supports streaming responses
 * - Limited function calling support (depends on model)
 * - Graceful connection error handling
 */
export class OllamaProvider extends BaseProvider {
  public readonly name = 'ollama';

  private static readonly DEFAULT_BASE_URL = 'http://localhost:11434';

  /**
   * Build headers for Ollama API requests.
   * No authentication required for local server.
   */
  protected override buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add any custom headers from config (but skip Authorization since it's local)
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  /**
   * Execute a completion request and return the full response.
   */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const baseUrl = this.getBaseUrl(OllamaProvider.DEFAULT_BASE_URL);
    const url = `${baseUrl}/v1/chat/completions`;
    const ollamaRequest = this.translateRequest(request);

    try {
      const response = await this.makeRequest<OllamaResponse>({
        method: 'POST',
        url,
        headers: this.buildHeaders(),
        body: ollamaRequest,
        timeoutMs: request.timeout_ms ?? this.defaultTimeoutMs,
      });

      return this.translateResponse(response);
    } catch (error) {
      // Provide more helpful error messages for Ollama-specific issues
      this.handleOllamaError(error);
    }
  }

  /**
   * Execute a streaming completion request.
   */
  public async *completeStream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const baseUrl = this.getBaseUrl(OllamaProvider.DEFAULT_BASE_URL);
    const url = `${baseUrl}/v1/chat/completions`;
    const ollamaRequest = this.translateRequest({ ...request, stream: true });

    let response: Response;
    try {
      response = await this.makeStreamingRequest({
        method: 'POST',
        url,
        headers: this.buildHeaders(),
        body: ollamaRequest,
        timeoutMs: request.timeout_ms ?? this.defaultTimeoutMs,
        stream: true,
      });
    } catch (error) {
      this.handleOllamaError(error);
    }

    if (!response.body) {
      throw new ProviderError('No response body for streaming request', this.name);
    }

    // Track tool calls being built across chunks
    const toolCallsInProgress = new Map<number, {
      id: string;
      name: string;
      arguments: string;
    }>();

    let hasStartedContent = false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunk = JSON.parse(jsonStr) as OllamaStreamChunk;
              const chunks = this.translateStreamChunk(
                chunk,
                toolCallsInProgress,
                hasStartedContent
              );

              for (const streamChunk of chunks) {
                // Track state for content block management
                if (
                  streamChunk.type === 'content_block_start' &&
                  streamChunk.content_block?.type === 'text'
                ) {
                  hasStartedContent = true;
                }
                yield streamChunk;
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit message_stop at the end
    yield { type: 'message_stop' };
  }

  /**
   * Check if the Ollama server is running and available.
   * Uses the native Ollama tags API to list available models.
   */
  public async healthCheck(): Promise<void> {
    const baseUrl = this.getBaseUrl(OllamaProvider.DEFAULT_BASE_URL);
    const url = `${baseUrl}/api/tags`;

    try {
      await this.makeRequest<OllamaTagsResponse>({
        method: 'GET',
        url,
        headers: this.buildHeaders(),
        timeoutMs: 10000,
      });
    } catch (error) {
      // Provide helpful error message for common Ollama issues
      if (error instanceof Error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
          throw new ProviderError(
            'Ollama server is not running. Start it with: ollama serve',
            this.name,
            undefined,
            error
          );
        }
      }
      throw error;
    }
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Handle Ollama-specific errors with helpful messages.
   */
  private handleOllamaError(error: unknown): never {
    if (error instanceof Error) {
      // Connection refused - server not running
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        throw new ProviderError(
          'Ollama server is not running. Start it with: ollama serve',
          this.name,
          undefined,
          error
        );
      }

      // Model not found
      if (error.message.includes('model') && error.message.includes('not found')) {
        throw new ProviderError(
          `Ollama model not found. Pull it with: ollama pull <model-name>`,
          this.name,
          404,
          error
        );
      }

      // Re-throw if it's already a ProviderError
      if (error instanceof ProviderError) {
        throw error;
      }

      // Wrap other errors
      throw new ProviderError(error.message, this.name, undefined, error);
    }

    throw new ProviderError(String(error), this.name);
  }

  // ==========================================================================
  // Translation Methods
  // ==========================================================================

  /**
   * Translate AgentRouter request to Ollama format.
   */
  private translateRequest(request: CompletionRequest): OllamaRequest {
    const messages = this.translateMessages(request.messages);
    const tools = request.tools ? this.translateTools(request.tools) : undefined;

    return {
      model: request.model,
      messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: request.stream,
    };
  }

  /**
   * Translate messages from AgentRouter format to Ollama format.
   *
   * Key translations:
   * - Content blocks are flattened to strings
   * - tool_use blocks become tool_calls array on assistant messages
   * - tool_result blocks become separate role: "tool" messages
   */
  private translateMessages(messages: Message[]): OllamaMessage[] {
    const ollamaMessages: OllamaMessage[] = [];

    for (const message of messages) {
      if (typeof message.content === 'string') {
        // Simple string content
        ollamaMessages.push({
          role: message.role,
          content: message.content,
        });
      } else {
        // Content blocks - need to process differently based on type
        const textParts: string[] = [];
        const toolCalls: OllamaToolCall[] = [];
        const toolResults: { tool_call_id: string; content: string }[] = [];

        for (const block of message.content) {
          switch (block.type) {
            case 'text':
              if (block.text !== undefined && block.text !== '') {
                textParts.push(block.text);
              }
              break;

            case 'tool_use':
              if (block.id !== undefined && block.id !== '' && block.name !== undefined && block.name !== '') {
                toolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input ?? {}),
                  },
                });
              }
              break;

            case 'tool_result':
              if (block.tool_use_id !== undefined && block.tool_use_id !== '' && block.content !== undefined && block.content !== '') {
                toolResults.push({
                  tool_call_id: block.tool_use_id,
                  content: block.content,
                });
              }
              break;
          }
        }

        // Handle assistant messages with tool calls
        if (message.role === 'assistant') {
          const assistantMessage: OllamaMessage = {
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('\n') : null,
          };

          if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
          }

          ollamaMessages.push(assistantMessage);
        } else {
          // User messages
          if (textParts.length > 0) {
            ollamaMessages.push({
              role: 'user',
              content: textParts.join('\n'),
            });
          }

          // Add tool results as separate messages
          for (const result of toolResults) {
            ollamaMessages.push({
              role: 'tool',
              content: result.content,
              tool_call_id: result.tool_call_id,
            });
          }
        }
      }
    }

    return ollamaMessages;
  }

  /**
   * Translate tools from AgentRouter format to Ollama format.
   */
  private translateTools(tools: Tool[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  /**
   * Translate Ollama response to AgentRouter format.
   */
  private translateResponse(response: OllamaResponse): CompletionResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new ProviderError('No choices in Ollama response', this.name);
    }

    const content: ContentBlock[] = [];

    // Add text content if present
    if (choice.message.content !== null && choice.message.content !== '') {
      content.push({
        type: 'text',
        text: choice.message.content,
      });
    }

    // Add tool calls if present
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
        });
      }
    }

    // Map finish_reason to stop_reason
    let stopReason = 'end_turn';
    switch (choice.finish_reason) {
      case 'stop':
        stopReason = 'end_turn';
        break;
      case 'length':
        stopReason = 'max_tokens';
        break;
      case 'tool_calls':
        stopReason = 'tool_use';
        break;
    }

    const result: CompletionResponse = {
      id: response.id,
      content,
      model: response.model,
      stop_reason: stopReason,
    };

    if (response.usage) {
      result.usage = {
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
      };
    }

    return result;
  }

  /**
   * Translate Ollama streaming chunk to AgentRouter StreamChunk format.
   *
   * Ollama streams deltas that need to be accumulated for tool calls.
   * Text content can be yielded immediately.
   */
  private translateStreamChunk(
    chunk: OllamaStreamChunk,
    toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }>,
    hasStartedContent: boolean
  ): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const choice = chunk.choices[0];

    if (!choice) {
      return chunks;
    }

    const delta = choice.delta;

    // Handle text content
    if (delta.content !== undefined && delta.content !== null) {
      // Emit content_block_start if this is the first content
      if (!hasStartedContent) {
        chunks.push({
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: '',
          },
        });
      }

      // Emit content delta
      chunks.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      });
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;

        // Initialize tool call tracking if new
        if (!toolCallsInProgress.has(index)) {
          toolCallsInProgress.set(index, {
            id: toolCallDelta.id ?? '',
            name: toolCallDelta.function?.name ?? '',
            arguments: '',
          });

          // Emit content_block_start for tool use
          if (toolCallDelta.id !== undefined && toolCallDelta.id !== '' && toolCallDelta.function?.name !== undefined && toolCallDelta.function.name !== '') {
            chunks.push({
              type: 'content_block_start',
              index: index + 1, // Offset by 1 since text is at index 0
              content_block: {
                type: 'tool_use',
                id: toolCallDelta.id,
                name: toolCallDelta.function.name,
                input: {},
              },
            });
          }
        }

        // Update tool call data
        const toolCall = toolCallsInProgress.get(index);
        if (toolCall) {
          if (toolCallDelta.id !== undefined && toolCallDelta.id !== '') {
            toolCall.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name !== undefined && toolCallDelta.function.name !== '') {
            toolCall.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments !== undefined && toolCallDelta.function.arguments !== '') {
            toolCall.arguments += toolCallDelta.function.arguments;

            // Emit delta for argument chunks
            chunks.push({
              type: 'content_block_delta',
              index: index + 1,
              delta: {
                type: 'input_json_delta',
                text: toolCallDelta.function.arguments,
              },
            });
          }
        }
      }
    }

    return chunks;
  }
}
