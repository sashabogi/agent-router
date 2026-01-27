/**
 * Anthropic Provider Implementation
 *
 * Provider adapter for the Anthropic Claude API.
 * Handles message formatting, streaming, and tool use for Claude models.
 */

import { BaseProvider } from './base.js';

import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ContentBlock,
  Tool,
  UsageInfo,
} from '../types.js';


// ============================================================================
// Anthropic API Types
// ============================================================================

/**
 * Anthropic API request body structure.
 */
interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  temperature?: number;
  system?: string;
  tools?: AnthropicTool[];
  stream?: boolean;
}

/**
 * Anthropic message format.
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic content block types.
 */
interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

/**
 * Anthropic tool definition format.
 */
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Anthropic API response structure.
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Anthropic streaming event types.
 */
type AnthropicStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

interface MessageStopEvent {
  type: 'message_stop';
}

interface PingEvent {
  type: 'ping';
}

interface ErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ============================================================================
// Anthropic Provider
// ============================================================================

/**
 * Anthropic Claude API provider adapter.
 *
 * Implements the Provider interface for Anthropic's Claude models.
 * Handles:
 * - Message format translation (our format -> Anthropic format)
 * - Streaming SSE event parsing
 * - Tool use formatting
 * - Authentication via x-api-key header
 */
export class AnthropicProvider extends BaseProvider {
  public readonly name = 'anthropic';

  /** Default Anthropic API base URL */
  private readonly DEFAULT_BASE_URL = 'https://api.anthropic.com';

  /** Required API version header value */
  private readonly API_VERSION = '2023-06-01';

  /** Default max tokens if not specified in request */
  private readonly DEFAULT_MAX_TOKENS = 4096;

  /**
   * Build Anthropic-specific HTTP headers.
   * Uses x-api-key instead of Bearer token for authentication.
   */
  protected override buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.API_VERSION,
    };

    // Anthropic uses x-api-key header instead of Bearer token
    if (this.config.api_key) {
      headers['x-api-key'] = this.config.api_key;
    }

    // Add any custom headers from config
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  /**
   * Execute a completion request and return the full response.
   *
   * @param request - The completion request
   * @returns Promise resolving to the normalized completion response
   */
  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.getBaseUrl(this.DEFAULT_BASE_URL)}/v1/messages`;
    const anthropicRequest = this.translateRequest(request);

    const response = await this.makeRequest<AnthropicResponse>({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: anthropicRequest,
      timeoutMs: this.defaultTimeoutMs,
    });

    return this.translateResponse(response);
  }

  /**
   * Execute a streaming completion request.
   * Yields normalized StreamChunk events as they arrive.
   *
   * @param request - The completion request
   * @returns Async iterable of stream chunks
   */
  public async *completeStream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const url = `${this.getBaseUrl(this.DEFAULT_BASE_URL)}/v1/messages`;
    const anthropicRequest = this.translateRequest(request);
    anthropicRequest.stream = true;

    const response = await this.makeStreamingRequest({
      method: 'POST',
      url,
      headers: this.buildHeaders(),
      body: anthropicRequest,
      timeoutMs: this.defaultTimeoutMs,
      stream: true,
    });

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Parse SSE stream
    yield* this.parseSSEStream(response.body);
  }

  /**
   * Check if the Anthropic API is available and credentials are valid.
   *
   * @throws ProviderError if the health check fails
   */
  public async healthCheck(): Promise<void> {
    // Make a minimal request to verify credentials
    // We use a simple message with minimal tokens
    const request: CompletionRequest = {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    };

    // If this throws, the health check failed
    await this.complete(request);
  }

  /**
   * Translate our normalized request format to Anthropic's format.
   *
   * @param request - Normalized completion request
   * @returns Anthropic API request body
   */
  private translateRequest(request: CompletionRequest): AnthropicRequest {
    const anthropicRequest: AnthropicRequest = {
      model: request.model,
      messages: this.translateMessages(request.messages),
      max_tokens: request.max_tokens ?? this.DEFAULT_MAX_TOKENS,
    };

    // Add optional parameters
    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    // Extract system prompt from messages if present
    const systemPrompt = this.extractSystemPrompt();
    if (systemPrompt) {
      anthropicRequest.system = systemPrompt;
    }

    // Translate tools if present
    if (request.tools && request.tools.length > 0) {
      anthropicRequest.tools = this.translateTools(request.tools);
    }

    if (request.stream) {
      anthropicRequest.stream = true;
    }

    return anthropicRequest;
  }

  /**
   * Translate normalized messages to Anthropic format.
   * Filters out system messages (handled separately).
   *
   * @param messages - Normalized messages
   * @returns Anthropic-formatted messages
   */
  private translateMessages(messages: Message[]): AnthropicMessage[] {
    return messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role,
        content: this.translateMessageContent(msg.content),
      }));
  }

  /**
   * Translate message content to Anthropic format.
   *
   * @param content - String or content blocks
   * @returns Anthropic-formatted content
   */
  private translateMessageContent(
    content: string | ContentBlock[]
  ): string | AnthropicContentBlock[] {
    if (typeof content === 'string') {
      return content;
    }

    // Translate content blocks
    return content.map((block) => this.translateContentBlock(block));
  }

  /**
   * Translate a single content block to Anthropic format.
   *
   * @param block - Normalized content block
   * @returns Anthropic content block
   */
  private translateContentBlock(block: ContentBlock): AnthropicContentBlock {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text ?? '',
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id ?? '',
          name: block.name ?? '',
          input: block.input ?? {},
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id ?? '',
          content: block.content ?? '',
        };

      default:
        return {
          type: 'text',
          text: '',
        };
    }
  }

  /**
   * Extract system prompt from messages.
   * Our format may include it in messages; Anthropic uses a separate parameter.
   *
   * @returns System prompt string or undefined
   */
  private extractSystemPrompt(): string | undefined {
    // Look for a system message (not part of standard Message type, but may be passed)
    // For now, we don't have system role in Message type, so return undefined
    // The system prompt should be passed via the role config, not in messages
    return undefined;
  }

  /**
   * Translate tools to Anthropic format.
   * Our tool format is already compatible with Anthropic's format.
   *
   * @param tools - Normalized tools
   * @returns Anthropic tool definitions
   */
  private translateTools(tools: Tool[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  /**
   * Translate Anthropic response to our normalized format.
   *
   * @param response - Anthropic API response
   * @returns Normalized completion response
   */
  private translateResponse(response: AnthropicResponse): CompletionResponse {
    return {
      id: response.id,
      content: this.translateResponseContent(response.content),
      model: response.model,
      stop_reason: response.stop_reason,
      usage: this.translateUsage(response.usage),
    };
  }

  /**
   * Translate Anthropic content blocks to our normalized format.
   *
   * @param content - Anthropic content blocks
   * @returns Normalized content blocks
   */
  private translateResponseContent(content: AnthropicContentBlock[]): ContentBlock[] {
    return content.map((block): ContentBlock => {
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            text: block.text ?? '',
          };

        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.id ?? '',
            name: block.name ?? '',
            input: block.input ?? {},
          };

        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id ?? '',
            content: block.content ?? '',
          };

        default:
          return {
            type: 'text',
            text: '',
          };
      }
    });
  }

  /**
   * Translate Anthropic usage info to our normalized format.
   *
   * @param usage - Anthropic usage info
   * @returns Normalized usage info
   */
  private translateUsage(usage: AnthropicResponse['usage']): UsageInfo {
    const result: UsageInfo = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    };

    // Only add cache tokens if they are defined
    if (usage.cache_creation_input_tokens !== undefined) {
      result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens !== undefined) {
      result.cache_read_input_tokens = usage.cache_read_input_tokens;
    }

    return result;
  }

  /**
   * Parse Anthropic SSE stream and yield normalized stream chunks.
   *
   * @param body - ReadableStream from fetch response
   * @returns Async generator of normalized stream chunks
   */
  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}

        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          // Parse SSE data line
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            // Handle stream end marker
            if (data === '[DONE]') {
              continue;
            }

            try {
              const event = JSON.parse(data) as AnthropicStreamEvent;
              const chunk = this.translateStreamEvent(event);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Translate an Anthropic SSE event to our normalized StreamChunk format.
   *
   * @param event - Anthropic stream event
   * @returns Normalized stream chunk or undefined to skip
   */
  private translateStreamEvent(event: AnthropicStreamEvent): StreamChunk | undefined {
    switch (event.type) {
      case 'content_block_start':
        return {
          type: 'content_block_start',
          index: event.index,
          content_block: this.translateContentBlockFromStream(event.content_block),
        };

      case 'content_block_delta': {
        const delta: StreamChunk['delta'] = {
          type: event.delta.type,
        };
        if (event.delta.text !== undefined) {
          delta.text = event.delta.text;
        }
        return {
          type: 'content_block_delta',
          index: event.index,
          delta,
        };
      }

      case 'message_stop':
        return {
          type: 'message_stop',
        };

      // Skip other events (message_start, content_block_stop, ping, etc.)
      default:
        return undefined;
    }
  }

  /**
   * Translate a content block from a stream event.
   *
   * @param block - Anthropic content block from stream
   * @returns Normalized content block
   */
  private translateContentBlockFromStream(block: AnthropicContentBlock): ContentBlock {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text ?? '',
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id ?? '',
          name: block.name ?? '',
          input: block.input ?? {},
        };

      default:
        return {
          type: 'text',
          text: '',
        };
    }
  }
}
