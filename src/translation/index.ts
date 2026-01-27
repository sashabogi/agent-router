/**
 * Translation Layer
 *
 * This module provides utilities for translating between different LLM provider
 * formats. It normalizes messages, tools, and streaming events to a common
 * AgentRouter format.
 *
 * @module translation
 */

// Streaming response translation
export {
  // Stream parsers
  parseAnthropicStream,
  parseOpenAIStream,
  parseGeminiStream,
  // SSE utilities
  parseSSE,
  // Transform stream helpers
  createStreamTransformer,
  // Collection utilities
  collectStreamText,
  collectStreamChunks,
  // Types
  type AnthropicStreamEvent,
  type OpenAIStreamChunk,
  type GeminiStreamChunk,
} from './streaming.js';

// Re-export from messages when implemented
// export * from './messages.js';

// Re-export from tools when implemented
// export * from './tools.js';

// Error translation
export {
  // Provider-specific translators
  translateAnthropicError,
  translateOpenAIError,
  translateGeminiError,
  // Generic translators
  translateGenericError,
  translateProviderError,
  // Utilities
  withErrorTranslation,
  isRetryableError,
  getRetryDelay,
  // Types
  type AnthropicError,
  type OpenAIError,
  type GeminiError,
  type HttpError,
} from './errors.js';
