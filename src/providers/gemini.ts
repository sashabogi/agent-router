/**
 * Google Gemini Provider Implementation
 *
 * Provider adapter for the Google Gemini API (Generative Language API).
 * Handles message formatting, streaming, and tool use for Gemini models.
 *
 * Key differences from Anthropic format:
 * - Messages use "contents" array with "parts" instead of "content"
 * - System prompt is a separate "systemInstruction" field
 * - Tool schemas use "parameters" (OpenAI style) in function declarations
 * - Tool calls return "functionCall" parts, results use "functionResponse" parts
 * - Auth via API key query param or Authorization header
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
// Gemini API Types
// ============================================================================

/**
 * Gemini content part types.
 */
interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: {
      content: string;
    };
  };
}

/**
 * Gemini content (message) format.
 */
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Gemini function declaration (tool definition).
 */
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Gemini tool definition wrapper.
 */
interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/**
 * Gemini generation config.
 */
interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

/**
 * Gemini API request body.
 */
interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiTool[];
}

/**
 * Gemini API response structure.
 */
interface GeminiResponse {
  candidates: {
    content: {
      role: 'model';
      parts: GeminiPart[];
    };
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    safetyRatings?: {
      category: string;
      probability: string;
    }[];
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Gemini streaming chunk structure.
 */
interface GeminiStreamChunk {
  candidates?: {
    content?: {
      role: 'model';
      parts: GeminiPart[];
    };
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ============================================================================
// Gemini Provider Implementation
// ============================================================================

/**
 * Google Gemini API provider adapter.
 *
 * Implements the Provider interface for Google's Gemini models.
 * Handles:
 * - Message format translation (our format -> Gemini format)
 * - Streaming SSE event parsing
 * - Tool use / function calling
 * - Authentication via API key
 */
export class GeminiProvider extends BaseProvider {
  public readonly name = 'google';

  private static readonly DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  /** Default max tokens if not specified in request */
  private static readonly DEFAULT_MAX_TOKENS = 4096;

  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Build the full API URL with model and action.
   * Gemini uses URL path for model selection and action.
   *
   * @param model - Model identifier
   * @param action - API action (generateContent, streamGenerateContent)
   * @returns Full API URL
   */
  private buildUrl(model: string, action: 'generateContent' | 'streamGenerateContent'): string {
    const baseUrl = this.getBaseUrl(GeminiProvider.DEFAULT_BASE_URL);
    const url = `${baseUrl}/models/${model}:${action}`;

    // Gemini supports API key as query parameter
    if (this.config.api_key) {
      return `${url}?key=${this.config.api_key}`;
    }

    return url;
  }

  /**
   * Build headers for Gemini API requests.
   * Uses Bearer token if API key is provided (alternative to query param).
   */
  protected override buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Gemini also supports Authorization header (alternative to query param)
    // We use query param by default, but support Bearer if explicitly configured
    if (this.config.headers?.['Authorization']) {
      headers['Authorization'] = this.config.headers['Authorization'];
    }

    // Add any custom headers from config
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  /**
   * Execute a completion request and return the full response.
   */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = this.buildUrl(request.model, 'generateContent');
    const geminiRequest = this.translateRequest(request);

    const response = await this.makeRequest<GeminiResponse>({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: geminiRequest,
      timeoutMs: this.defaultTimeoutMs,
    });

    return this.translateResponse(response, request.model);
  }

  /**
   * Execute a streaming completion request.
   */
  public async *completeStream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    // Gemini uses streamGenerateContent endpoint with alt=sse query param
    let url = this.buildUrl(request.model, 'streamGenerateContent');
    // Add alt=sse for server-sent events format
    url += url.includes('?') ? '&alt=sse' : '?alt=sse';

    const geminiRequest = this.translateRequest(request);

    const response = await this.makeStreamingRequest({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: geminiRequest,
      timeoutMs: this.defaultTimeoutMs,
      stream: true,
    });

    if (!response.body) {
      throw new Error('No response body for streaming request');
    }

    // Track state for content block management
    let hasStartedContent = false;
    let currentToolCallIndex = 0;
    const activeToolCalls = new Map<number, { id: string; name: string }>();

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
              const chunk = JSON.parse(jsonStr) as GeminiStreamChunk;
              const chunks = this.translateStreamChunk(
                chunk,
                hasStartedContent,
                currentToolCallIndex,
                activeToolCalls
              );

              for (const streamChunk of chunks) {
                // Track state for content block management
                if (
                  streamChunk.type === 'content_block_start' &&
                  streamChunk.content_block?.type === 'text'
                ) {
                  hasStartedContent = true;
                }
                if (
                  streamChunk.type === 'content_block_start' &&
                  streamChunk.content_block?.type === 'tool_use'
                ) {
                  currentToolCallIndex++;
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
   * Check if the Gemini API is available and credentials are valid.
   */
  public async healthCheck(): Promise<void> {
    // List models endpoint to verify API key
    const baseUrl = this.getBaseUrl(GeminiProvider.DEFAULT_BASE_URL);
    let url = `${baseUrl}/models`;

    if (this.config.api_key) {
      url += `?key=${this.config.api_key}`;
    }

    await this.makeRequest<{ models: unknown[] }>({
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
   * Translate AgentRouter request to Gemini format.
   */
  private translateRequest(request: CompletionRequest): GeminiRequest {
    const geminiRequest: GeminiRequest = {
      contents: this.translateMessages(request.messages),
    };

    // Add generation config if any options specified
    const generationConfig: GeminiGenerationConfig = {};
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      generationConfig.maxOutputTokens = request.max_tokens;
    } else {
      generationConfig.maxOutputTokens = GeminiProvider.DEFAULT_MAX_TOKENS;
    }

    if (Object.keys(generationConfig).length > 0) {
      geminiRequest.generationConfig = generationConfig;
    }

    // Translate tools if present
    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = [
        {
          functionDeclarations: this.translateTools(request.tools),
        },
      ];
    }

    return geminiRequest;
  }

  /**
   * Translate messages from AgentRouter format to Gemini format.
   *
   * Key translations:
   * - role: "user" -> "user", role: "assistant" -> "model"
   * - Content blocks become parts
   * - tool_use blocks become functionCall parts
   * - tool_result blocks become functionResponse parts
   */
  private translateMessages(messages: Message[]): GeminiContent[] {
    const geminiContents: GeminiContent[] = [];

    for (const message of messages) {
      const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiPart[] = [];

      if (typeof message.content === 'string') {
        // Simple string content
        parts.push({ text: message.content });
      } else {
        // Content blocks - translate each type
        for (const block of message.content) {
          switch (block.type) {
            case 'text':
              if (block.text) {
                parts.push({ text: block.text });
              }
              break;

            case 'tool_use':
              if (block.name) {
                parts.push({
                  functionCall: {
                    name: block.name,
                    args: block.input || {},
                  },
                });
              }
              break;

            case 'tool_result':
              if (block.tool_use_id && block.content) {
                // Gemini expects function name, not ID
                // We need to track tool calls to map IDs to names
                // For now, use the ID as name (caller should ensure consistency)
                parts.push({
                  functionResponse: {
                    name: block.tool_use_id,
                    response: {
                      content: block.content,
                    },
                  },
                });
              }
              break;
          }
        }
      }

      if (parts.length > 0) {
        geminiContents.push({ role, parts });
      }
    }

    return geminiContents;
  }

  /**
   * Translate tools from AgentRouter format to Gemini function declarations.
   */
  private translateTools(tools: Tool[]): GeminiFunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    }));
  }

  /**
   * Translate Gemini response to AgentRouter format.
   */
  private translateResponse(response: GeminiResponse, model: string): CompletionResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidates in Gemini response');
    }

    const content: ContentBlock[] = [];
    let toolCallCounter = 0;

    // Translate parts to content blocks
    for (const part of candidate.content.parts) {
      if (part.text !== undefined) {
        content.push({
          type: 'text',
          text: part.text,
        });
      }

      if (part.functionCall) {
        // Generate a unique ID for the tool call
        const toolId = `call_${Date.now()}_${toolCallCounter++}`;
        content.push({
          type: 'tool_use',
          id: toolId,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }

    // Map Gemini finish reason to AgentRouter stop_reason
    let stopReason = 'end_turn';
    switch (candidate.finishReason) {
      case 'STOP':
        stopReason = 'end_turn';
        break;
      case 'MAX_TOKENS':
        stopReason = 'max_tokens';
        break;
      case 'SAFETY':
        stopReason = 'content_filter';
        break;
      case 'RECITATION':
        stopReason = 'content_filter';
        break;
      default:
        stopReason = 'end_turn';
    }

    // Check if we have tool calls - that changes the stop reason
    if (content.some((block) => block.type === 'tool_use')) {
      stopReason = 'tool_use';
    }

    const result: CompletionResponse = {
      id: `gemini-${Date.now()}`, // Gemini doesn't provide response ID
      content,
      model,
      stop_reason: stopReason,
    };

    if (response.usageMetadata) {
      result.usage = {
        input_tokens: response.usageMetadata.promptTokenCount,
        output_tokens: response.usageMetadata.candidatesTokenCount,
      };
    }

    return result;
  }

  /**
   * Translate Gemini streaming chunk to AgentRouter StreamChunk format.
   */
  private translateStreamChunk(
    chunk: GeminiStreamChunk,
    hasStartedContent: boolean,
    currentToolCallIndex: number,
    activeToolCalls: Map<number, { id: string; name: string }>
  ): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const candidate = chunk.candidates?.[0];

    if (!candidate?.content?.parts) {
      return chunks;
    }

    for (const part of candidate.content.parts) {
      // Handle text content
      if (part.text !== undefined) {
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
            text: part.text,
          },
        });
      }

      // Handle function calls
      if (part.functionCall) {
        const toolIndex = currentToolCallIndex;
        const toolId = `call_${Date.now()}_${toolIndex}`;

        // Track this tool call
        activeToolCalls.set(toolIndex, {
          id: toolId,
          name: part.functionCall.name,
        });

        // Emit content_block_start for tool use
        chunks.push({
          type: 'content_block_start',
          index: toolIndex + 1, // Offset by 1 since text is at index 0
          content_block: {
            type: 'tool_use',
            id: toolId,
            name: part.functionCall.name,
            input: part.functionCall.args,
          },
        });

        // Emit the full arguments as a delta (Gemini sends complete args)
        chunks.push({
          type: 'content_block_delta',
          index: toolIndex + 1,
          delta: {
            type: 'input_json_delta',
            text: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    return chunks;
  }
}
