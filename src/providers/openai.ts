/**
 * OpenAI Provider Implementation
 *
 * Implements the Provider interface for OpenAI's Chat Completions API.
 * Handles message format translation between AgentRouter's internal format
 * (which uses Anthropic-style messages) and OpenAI's format.
 *
 * Key differences from Anthropic format:
 * - System prompt goes in messages array as role: "system"
 * - Tool schemas use "parameters" instead of "input_schema"
 * - Tool calls are in a separate "tool_calls" array, not content blocks
 * - Tool results use role: "tool" messages, not tool_result content blocks
 */

import { BaseProvider } from './base.js';

import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ContentBlock,
  Tool,
  ProviderConfig,
} from '../types.js';

// ============================================================================
// OpenAI API Types
// ============================================================================

/**
 * OpenAI message format.
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * OpenAI tool call format.
 */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI tool/function definition.
 */
interface OpenAITool {
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
 * OpenAI chat completion request body.
 * Note: Newer models (GPT-4o, o1, etc.) use max_completion_tokens instead of max_tokens
 */
interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  max_completion_tokens?: number | undefined;
  tools?: OpenAITool[] | undefined;
  stream?: boolean | undefined;
}

/**
 * OpenAI chat completion response.
 */
interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI streaming chunk.
 */
interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }[];
}

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

/**
 * OpenAI provider adapter.
 *
 * Translates between AgentRouter's internal message format and OpenAI's
 * Chat Completions API format. Supports both streaming and non-streaming
 * completion requests.
 */
export class OpenAIProvider extends BaseProvider {
  public readonly name: string = 'openai';

  private static readonly DEFAULT_BASE_URL = 'https://api.openai.com/v1';

  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Build headers for OpenAI API requests.
   * Adds organization header if configured.
   */
  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();

    // Add organization header if configured
    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }

    return headers;
  }

  /**
   * Execute a completion request and return the full response.
   */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.getBaseUrl(OpenAIProvider.DEFAULT_BASE_URL)}/chat/completions`;
    const openAIRequest = this.translateRequest(request);

    const response = await this.makeRequest<OpenAIResponse>({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: openAIRequest,
      timeoutMs: request.timeout_ms ?? this.defaultTimeoutMs,
    });

    return this.translateResponse(response);
  }

  /**
   * Execute a streaming completion request.
   */
  public async *completeStream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const url = `${this.getBaseUrl(OpenAIProvider.DEFAULT_BASE_URL)}/chat/completions`;
    const openAIRequest = this.translateRequest({ ...request, stream: true });

    const response = await this.makeStreamingRequest({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: openAIRequest,
      timeoutMs: request.timeout_ms ?? this.defaultTimeoutMs,
      stream: true,
    });

    if (!response.body) {
      throw new Error('No response body for streaming request');
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunk = JSON.parse(jsonStr) as OpenAIStreamChunk;
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
   * Check if the provider is available and configured correctly.
   */
  public async healthCheck(): Promise<void> {
    const url = `${this.getBaseUrl(OpenAIProvider.DEFAULT_BASE_URL)}/models`;

    await this.makeRequest<{ data: unknown[] }>({
      method: 'GET',
      url,
      headers: this.buildHeaders(),
      timeoutMs: 10000,
    });
  }

  // ==========================================================================
  // Translation Methods
  // ==========================================================================

  /**
   * Translate AgentRouter request to OpenAI format.
   *
   * Note: Newer OpenAI models (gpt-4o, gpt-4-turbo, o1, etc.) require
   * max_completion_tokens instead of max_tokens. We detect model type
   * and use the appropriate parameter.
   */
  private translateRequest(request: CompletionRequest): OpenAIRequest {
    const messages = this.translateMessages(request.messages);
    const tools = request.tools ? this.translateTools(request.tools) : undefined;

    // Newer models require max_completion_tokens instead of max_tokens
    const usesNewTokenParam = this.modelRequiresMaxCompletionTokens(request.model);

    // Debug logging
    console.log(`[OpenAI] Model: ${request.model}, usesNewTokenParam: ${usesNewTokenParam}, max_tokens: ${request.max_tokens}`);

    const result: OpenAIRequest = {
      model: request.model,
      messages,
      temperature: request.temperature,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: request.stream,
    };

    // Add the appropriate token limit parameter
    if (request.max_tokens !== undefined) {
      if (usesNewTokenParam) {
        result.max_completion_tokens = request.max_tokens;
        console.log(`[OpenAI] Using max_completion_tokens: ${request.max_tokens}`);
      } else {
        result.max_tokens = request.max_tokens;
        console.log(`[OpenAI] Using max_tokens: ${request.max_tokens}`);
      }
    }

    return result;
  }

  /**
   * Check if we're using the actual OpenAI API (not a compatible third-party API).
   * Third-party OpenAI-compatible APIs (Z.AI, DeepSeek, local LLMs, etc.) typically
   * use the standard max_tokens parameter, not max_completion_tokens.
   */
  private isActualOpenAIAPI(): boolean {
    const baseUrl = this.getBaseUrl(OpenAIProvider.DEFAULT_BASE_URL);
    // Check if the base URL is OpenAI's official API
    return baseUrl.startsWith('https://api.openai.com');
  }

  /**
   * Check if a model requires max_completion_tokens instead of max_tokens.
   * Newer OpenAI models (gpt-4o, gpt-4-turbo, gpt-5.x, o1, o3, etc.) use the new parameter.
   *
   * IMPORTANT: This only applies to the actual OpenAI API. Third-party OpenAI-compatible
   * APIs (Z.AI, DeepSeek, Ollama, etc.) use the standard max_tokens parameter.
   *
   * As of late 2024, most new OpenAI models require max_completion_tokens.
   * We default to using max_completion_tokens for any model that:
   * - Contains 'gpt-4o', 'gpt-4-turbo', 'gpt-5', 'o1', 'o3', or 'chatgpt'
   * - OR is NOT a legacy model (gpt-3.5, gpt-4-0314, gpt-4-0613)
   */
  private modelRequiresMaxCompletionTokens(model: string): boolean {
    // If we're not talking to the actual OpenAI API, always use max_tokens
    // Third-party OpenAI-compatible APIs (Z.AI, DeepSeek, local LLMs, etc.)
    // typically use the standard max_tokens parameter
    if (!this.isActualOpenAIAPI()) {
      return false;
    }

    const lowerModel = model.toLowerCase();

    // Legacy models that use max_tokens (the old parameter)
    const legacyModels = [
      'gpt-3.5',
      'gpt-4-0314',
      'gpt-4-0613',
      'gpt-4-32k',
    ];

    // If it's a known legacy model, use old parameter
    if (legacyModels.some(m => lowerModel.includes(m))) {
      return false;
    }

    // For all other models (gpt-4o, gpt-4-turbo, gpt-5.x, o1, o3, etc.), use new parameter
    // This is safer as OpenAI is moving toward max_completion_tokens
    return true;
  }

  /**
   * Translate messages from AgentRouter format to OpenAI format.
   *
   * Key translations:
   * - Content blocks are flattened to strings
   * - tool_use blocks become tool_calls array on assistant messages
   * - tool_result blocks become separate role: "tool" messages
   */
  private translateMessages(messages: Message[]): OpenAIMessage[] {
    const openAIMessages: OpenAIMessage[] = [];

    for (const message of messages) {
      if (typeof message.content === 'string') {
        // Simple string content
        openAIMessages.push({
          role: message.role,
          content: message.content,
        });
      } else {
        // Content blocks - need to process differently based on type
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];
        const toolResults: { tool_call_id: string; content: string }[] = [];

        for (const block of message.content) {
          switch (block.type) {
            case 'text':
              if (block.text) {
                textParts.push(block.text);
              }
              break;

            case 'tool_use':
              if (block.id && block.name) {
                toolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input || {}),
                  },
                });
              }
              break;

            case 'tool_result':
              if (block.tool_use_id && block.content) {
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
          const assistantMessage: OpenAIMessage = {
            role: 'assistant',
            content: textParts.length > 0 ? textParts.join('\n') : null,
          };

          if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
          }

          openAIMessages.push(assistantMessage);
        } else {
          // User messages
          if (textParts.length > 0) {
            openAIMessages.push({
              role: 'user',
              content: textParts.join('\n'),
            });
          }

          // Add tool results as separate messages
          for (const result of toolResults) {
            openAIMessages.push({
              role: 'tool',
              content: result.content,
              tool_call_id: result.tool_call_id,
            });
          }
        }
      }
    }

    return openAIMessages;
  }

  /**
   * Translate tools from AgentRouter format to OpenAI format.
   */
  private translateTools(tools: Tool[]): OpenAITool[] {
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
   * Translate OpenAI response to AgentRouter format.
   */
  private translateResponse(response: OpenAIResponse): CompletionResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    const content: ContentBlock[] = [];

    // Add text content if present
    if (choice.message.content) {
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
          input: JSON.parse(toolCall.function.arguments),
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
      case 'content_filter':
        stopReason = 'content_filter';
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
   * Translate OpenAI streaming chunk to AgentRouter StreamChunk format.
   *
   * OpenAI streams deltas that need to be accumulated for tool calls.
   * Text content can be yielded immediately.
   */
  private translateStreamChunk(
    chunk: OpenAIStreamChunk,
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
            id: toolCallDelta.id || '',
            name: toolCallDelta.function?.name || '',
            arguments: '',
          });

          // Emit content_block_start for tool use
          if (toolCallDelta.id && toolCallDelta.function?.name) {
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
        const toolCall = toolCallsInProgress.get(index)!;
        if (toolCallDelta.id) {
          toolCall.id = toolCallDelta.id;
        }
        if (toolCallDelta.function?.name) {
          toolCall.name = toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
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

    return chunks;
  }
}
