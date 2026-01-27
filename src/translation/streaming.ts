/**
 * Streaming Response Translation
 *
 * Provides utilities for parsing Server-Sent Events (SSE) streams from
 * different LLM providers and normalizing them to AgentRouter's StreamChunk format.
 *
 * Supported providers:
 * - Anthropic: message_start, content_block_start, content_block_delta, message_stop events
 * - OpenAI: data: {"choices":[{"delta":{...}}]} format
 * - Gemini: data: {"candidates":[{"content":{"parts":[...]}}]} format
 *
 * All streams are normalized to the common StreamChunk interface.
 */

import { TranslationError ,type  StreamChunk,type  ContentBlock } from '../types.js';

// ============================================================================
// Anthropic Streaming Types
// ============================================================================

/**
 * Anthropic SSE event types.
 */
export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicErrorEvent;

interface AnthropicMessageStartEvent {
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

interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

interface AnthropicMessageStopEvent {
  type: 'message_stop';
}

interface AnthropicPingEvent {
  type: 'ping';
}

interface AnthropicErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

// ============================================================================
// OpenAI Streaming Types
// ============================================================================

/**
 * OpenAI streaming chunk format.
 */
export interface OpenAIStreamChunk {
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
// Gemini Streaming Types
// ============================================================================

/**
 * Gemini streaming chunk format.
 */
export interface GeminiStreamChunk {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }[];
      role?: 'model';
    };
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
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

// ============================================================================
// SSE Parser Utility
// ============================================================================

/**
 * Parse SSE (Server-Sent Events) data from a ReadableStream.
 * Handles buffering of partial lines and yields complete events.
 *
 * @param stream - The ReadableStream to parse
 * @param options - Parser options
 * @returns AsyncIterable yielding parsed event data strings
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  options?: {
    /** Event data prefix (default: 'data: ') */
    dataPrefix?: string;
    /** Stream end marker (default: '[DONE]') */
    doneMarker?: string;
  }
): AsyncIterable<string> {
  const dataPrefix = options?.dataPrefix ?? 'data: ';
  const doneMarker = options?.doneMarker ?? '[DONE]';

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }

        // Parse data line
        if (trimmedLine.startsWith(dataPrefix)) {
          const data = trimmedLine.slice(dataPrefix.length);

          // Skip stream end marker
          if (data === doneMarker) {
            continue;
          }

          yield data;
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const trimmedLine = buffer.trim();
      if (trimmedLine.startsWith(dataPrefix)) {
        const data = trimmedLine.slice(dataPrefix.length);
        if (data !== doneMarker) {
          yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================================================
// Anthropic Stream Parser
// ============================================================================

/**
 * State tracker for Anthropic stream parsing.
 * Tracks content blocks being built across multiple events.
 */
interface AnthropicStreamState {
  /** Currently active content blocks by index */
  contentBlocks: Map<number, ContentBlock>;
  /** Whether message has started */
  messageStarted: boolean;
}

/**
 * Parse Anthropic SSE stream and yield normalized StreamChunks.
 *
 * Anthropic streaming events:
 * - message_start: Contains initial message metadata
 * - content_block_start: Starts a new content block (text or tool_use)
 * - content_block_delta: Incremental content updates
 * - content_block_stop: Marks end of a content block
 * - message_delta: Final message metadata (stop_reason, usage)
 * - message_stop: Marks end of the message
 * - ping: Keep-alive (ignored)
 * - error: Stream error
 *
 * @param stream - ReadableStream from Anthropic API response
 * @returns AsyncIterable of normalized StreamChunks
 */
export async function* parseAnthropicStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StreamChunk> {
  const state: AnthropicStreamState = {
    contentBlocks: new Map(),
    messageStarted: false,
  };

  for await (const data of parseSSE(stream)) {
    let event: AnthropicStreamEvent;

    try {
      event = JSON.parse(data) as AnthropicStreamEvent;
    } catch (error) {
      // Skip malformed JSON
      continue;
    }

    const chunk = translateAnthropicEvent(event, state);
    if (chunk) {
      yield chunk;
    }
  }
}

/**
 * Translate a single Anthropic stream event to a normalized StreamChunk.
 *
 * @param event - Anthropic stream event
 * @param state - Parser state for tracking content blocks
 * @returns StreamChunk or undefined if event should be skipped
 */
function translateAnthropicEvent(
  event: AnthropicStreamEvent,
  state: AnthropicStreamState
): StreamChunk | undefined {
  switch (event.type) {
    case 'content_block_start': {
      const contentBlock = translateAnthropicContentBlock(event.content_block);
      state.contentBlocks.set(event.index, contentBlock);

      return {
        type: 'content_block_start',
        index: event.index,
        content_block: contentBlock,
      };
    }

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

    case 'error':
      throw new TranslationError(
        `Anthropic stream error: ${event.error.message}`,
        'anthropic_stream',
        'stream_chunk',
        new Error(event.error.message)
      );

    // Skip these events - they don't produce output
    case 'message_start':
      state.messageStarted = true;
      return undefined;

    case 'content_block_stop':
    case 'message_delta':
    case 'ping':
      return undefined;

    default:
      return undefined;
  }
}

/**
 * Translate Anthropic content block to normalized format.
 */
function translateAnthropicContentBlock(block: AnthropicContentBlock): ContentBlock {
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

// ============================================================================
// OpenAI Stream Parser
// ============================================================================

/**
 * State tracker for OpenAI stream parsing.
 * Tracks tool calls being built across multiple chunks.
 */
interface OpenAIStreamState {
  /** Tool calls in progress, keyed by index */
  toolCallsInProgress: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }>;
  /** Whether text content has started */
  hasStartedContent: boolean;
  /** Next content block index to assign */
  nextBlockIndex: number;
}

/**
 * Parse OpenAI SSE stream and yield normalized StreamChunks.
 *
 * OpenAI streams JSON objects with this structure:
 * - data: {"choices":[{"delta":{"content":"..."}}]}
 * - data: {"choices":[{"delta":{"tool_calls":[...]}}]}
 * - data: [DONE]
 *
 * Key differences from Anthropic:
 * - Content comes in delta.content field
 * - Tool calls are accumulated across chunks
 * - No explicit content_block_start/stop events
 *
 * @param stream - ReadableStream from OpenAI API response
 * @returns AsyncIterable of normalized StreamChunks
 */
export async function* parseOpenAIStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StreamChunk> {
  const state: OpenAIStreamState = {
    toolCallsInProgress: new Map(),
    hasStartedContent: false,
    nextBlockIndex: 0,
  };

  for await (const data of parseSSE(stream)) {
    let chunk: OpenAIStreamChunk;

    try {
      chunk = JSON.parse(data) as OpenAIStreamChunk;
    } catch {
      // Skip malformed JSON
      continue;
    }

    const streamChunks = translateOpenAIChunk(chunk, state);
    for (const streamChunk of streamChunks) {
      yield streamChunk;
    }
  }

  // Emit message_stop at the end
  yield { type: 'message_stop' };
}

/**
 * Translate a single OpenAI stream chunk to normalized StreamChunks.
 *
 * OpenAI chunks may produce multiple StreamChunks, especially when
 * starting new content blocks (text or tool_use).
 *
 * @param chunk - OpenAI stream chunk
 * @param state - Parser state for tracking progress
 * @returns Array of StreamChunks to yield
 */
function translateOpenAIChunk(
  chunk: OpenAIStreamChunk,
  state: OpenAIStreamState
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
    if (!state.hasStartedContent) {
      chunks.push({
        type: 'content_block_start',
        index: state.nextBlockIndex,
        content_block: {
          type: 'text',
          text: '',
        },
      });
      state.hasStartedContent = true;
    }

    // Emit content delta
    chunks.push({
      type: 'content_block_delta',
      index: 0, // Text is always at index 0
      delta: {
        type: 'text_delta',
        text: delta.content,
      },
    });
  }

  // Handle tool calls
  if (delta.tool_calls) {
    for (const toolCallDelta of delta.tool_calls) {
      const toolIndex = toolCallDelta.index;

      // Initialize tool call tracking if new
      if (!state.toolCallsInProgress.has(toolIndex)) {
        state.toolCallsInProgress.set(toolIndex, {
          id: toolCallDelta.id ?? '',
          name: toolCallDelta.function?.name ?? '',
          arguments: '',
        });

        // Emit content_block_start for tool use
        if (toolCallDelta.id && toolCallDelta.function?.name) {
          // Tool calls start after text block (if any)
          const blockIndex = state.hasStartedContent ? toolIndex + 1 : toolIndex;

          chunks.push({
            type: 'content_block_start',
            index: blockIndex,
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
      const toolCall = state.toolCallsInProgress.get(toolIndex)!;
      if (toolCallDelta.id) {
        toolCall.id = toolCallDelta.id;
      }
      if (toolCallDelta.function?.name) {
        toolCall.name = toolCallDelta.function.name;
      }
      if (toolCallDelta.function?.arguments) {
        toolCall.arguments += toolCallDelta.function.arguments;

        // Emit delta for argument chunks
        const blockIndex = state.hasStartedContent ? toolIndex + 1 : toolIndex;

        chunks.push({
          type: 'content_block_delta',
          index: blockIndex,
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

// ============================================================================
// Gemini Stream Parser
// ============================================================================

/**
 * State tracker for Gemini stream parsing.
 */
interface GeminiStreamState {
  /** Whether text content has started */
  hasStartedContent: boolean;
  /** Current tool call index */
  currentToolIndex: number;
  /** Accumulated text for deduplication (Gemini may send full text each time) */
  lastTextLength: number;
}

/**
 * Parse Gemini SSE stream and yield normalized StreamChunks.
 *
 * Gemini streams JSON objects with this structure:
 * - data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
 * - data: {"candidates":[{"content":{"parts":[{"functionCall":{...}}]}}]}
 *
 * Key differences from Anthropic:
 * - Content comes in parts array
 * - Function calls use "functionCall" with "args" (not "arguments")
 * - Gemini may send cumulative text (full content each chunk) - we need to deduplicate
 *
 * @param stream - ReadableStream from Gemini API response
 * @returns AsyncIterable of normalized StreamChunks
 */
export async function* parseGeminiStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StreamChunk> {
  const state: GeminiStreamState = {
    hasStartedContent: false,
    currentToolIndex: 0,
    lastTextLength: 0,
  };

  for await (const data of parseSSE(stream)) {
    let chunk: GeminiStreamChunk;

    try {
      chunk = JSON.parse(data) as GeminiStreamChunk;
    } catch {
      // Skip malformed JSON
      continue;
    }

    const streamChunks = translateGeminiChunk(chunk, state);
    for (const streamChunk of streamChunks) {
      yield streamChunk;
    }
  }

  // Emit message_stop at the end
  yield { type: 'message_stop' };
}

/**
 * Translate a single Gemini stream chunk to normalized StreamChunks.
 *
 * @param chunk - Gemini stream chunk
 * @param state - Parser state for tracking progress
 * @returns Array of StreamChunks to yield
 */
function translateGeminiChunk(
  chunk: GeminiStreamChunk,
  state: GeminiStreamState
): StreamChunk[] {
  const chunks: StreamChunk[] = [];

  const candidate = chunk.candidates?.[0];
  if (!candidate?.content?.parts) {
    return chunks;
  }

  for (const part of candidate.content.parts) {
    // Handle text content
    if (part.text !== undefined) {
      // Gemini may send cumulative text - extract only new content
      const fullText = part.text;
      const newText = fullText.slice(state.lastTextLength);
      state.lastTextLength = fullText.length;

      // Skip if no new text
      if (!newText) {
        continue;
      }

      // Emit content_block_start if this is the first content
      if (!state.hasStartedContent) {
        chunks.push({
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: '',
          },
        });
        state.hasStartedContent = true;
      }

      // Emit content delta with new text only
      chunks.push({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: newText,
        },
      });
    }

    // Handle function calls
    if (part.functionCall) {
      const toolIndex = state.hasStartedContent
        ? state.currentToolIndex + 1
        : state.currentToolIndex;

      // Emit content_block_start for tool use
      chunks.push({
        type: 'content_block_start',
        index: toolIndex,
        content_block: {
          type: 'tool_use',
          id: `tool_${toolIndex}`, // Gemini doesn't provide IDs, generate one
          name: part.functionCall.name,
          input: part.functionCall.args,
        },
      });

      // Emit the full input as a delta (Gemini sends complete function calls)
      chunks.push({
        type: 'content_block_delta',
        index: toolIndex,
        delta: {
          type: 'input_json_delta',
          text: JSON.stringify(part.functionCall.args),
        },
      });

      state.currentToolIndex++;
    }
  }

  return chunks;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a TransformStream that converts raw SSE bytes to StreamChunks.
 *
 * @param provider - The provider type ('anthropic', 'openai', 'gemini')
 * @returns TransformStream that outputs StreamChunks
 */
export function createStreamTransformer(
  provider: 'anthropic' | 'openai' | 'gemini'
): TransformStream<Uint8Array, StreamChunk> {
  let parseFunction: (stream: ReadableStream<Uint8Array>) => AsyncIterable<StreamChunk>;

  switch (provider) {
    case 'anthropic':
      parseFunction = parseAnthropicStream;
      break;
    case 'openai':
      parseFunction = parseOpenAIStream;
      break;
    case 'gemini':
      parseFunction = parseGeminiStream;
      break;
  }

  // Create a pass-through that collects chunks and processes them
  let transformController: TransformStreamDefaultController<StreamChunk>;
  const buffer: Uint8Array[] = [];

  return new TransformStream<Uint8Array, StreamChunk>({
    start(ctrl) {
      transformController = ctrl;
    },
    transform(chunk) {
      buffer.push(chunk);
    },
    async flush() {
      // Combine all buffered chunks
      const totalLength = buffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of buffer) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Create a ReadableStream from the combined data
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(combined);
          ctrl.close();
        },
      });

      // Parse and emit chunks
      for await (const streamChunk of parseFunction(stream)) {
        transformController.enqueue(streamChunk);
      }
    },
  });
}

/**
 * Collect all text content from a stream of StreamChunks.
 * Useful for testing or when you need the full response text.
 *
 * @param stream - AsyncIterable of StreamChunks
 * @returns Promise resolving to the complete text content
 */
export async function collectStreamText(
  stream: AsyncIterable<StreamChunk>
): Promise<string> {
  let text = '';

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      text += chunk.delta.text ?? '';
    }
  }

  return text;
}

/**
 * Collect all StreamChunks from an async iterable into an array.
 * Useful for testing.
 *
 * @param stream - AsyncIterable of StreamChunks
 * @returns Promise resolving to array of all chunks
 */
export async function collectStreamChunks(
  stream: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}
