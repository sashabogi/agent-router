/**
 * Error Translation Layer
 *
 * Normalizes error formats from different LLM providers (Anthropic, OpenAI, Gemini)
 * into AgentRouter's standardized error types. This allows consistent error handling
 * regardless of which provider produced the error.
 *
 * Provider error format differences:
 * - Anthropic: { type: "error", error: { type, message } }
 * - OpenAI: { error: { message, type, code } }
 * - Gemini: { error: { message, status, code } }
 *
 * All errors are mapped to the appropriate AgentRouterError subclass with the
 * original error preserved in the `cause` property for debugging.
 */

import {
  AgentRouterError,
  AuthenticationError,
  RateLimitError,
  ProviderError,
  TimeoutError,
  ConfigurationError,
} from '../types.js';

// ============================================================================
// Provider-Specific Error Types
// ============================================================================

/**
 * Anthropic API error structure.
 * Format: { type: "error", error: { type: string, message: string } }
 */
export interface AnthropicError {
  type?: 'error';
  error?: {
    type?: string;
    message?: string;
  };
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * OpenAI API error structure.
 * Format: { error: { message: string, type: string, code: string } }
 */
export interface OpenAIError {
  error?: {
    message?: string;
    type?: string;
    code?: string | null;
    param?: string | null;
  };
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * Google Gemini API error structure.
 * Format: { error: { message: string, status: string, code: number } }
 */
export interface GeminiError {
  error?: {
    message?: string;
    status?: string;
    code?: number;
    details?: {
      '@type'?: string;
      reason?: string;
      domain?: string;
      metadata?: Record<string, string>;
    }[];
  };
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * Generic error with HTTP-like properties (for errors from fetch, SDK wrappers, etc.)
 */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
}

// ============================================================================
// Error Type Detection Helpers
// ============================================================================

/**
 * Extract HTTP status code from various error formats.
 */
function extractStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const err = error as Record<string, unknown>;

  // Check common status code properties
  if (typeof err['status'] === 'number') {
    return err['status'];
  }
  if (typeof err['statusCode'] === 'number') {
    return err['statusCode'];
  }
  if (typeof err['response'] === 'object' && err['response'] !== null) {
    const response = err['response'] as Record<string, unknown>;
    if (typeof response['status'] === 'number') {
      return response['status'];
    }
  }

  return undefined;
}

/**
 * Extract error message from various error formats.
 */
function extractMessage(error: unknown, defaultMessage: string): string {
  if (error instanceof Error) {
    return error.message || defaultMessage;
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err['message'] === 'string') {
      return err['message'];
    }
  }

  if (typeof error === 'string') {
    return error;
  }

  return defaultMessage;
}

/**
 * Check if an error indicates a timeout.
 */
function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    // AbortError is typically thrown for timeouts
    if (error.name === 'AbortError') {
      return true;
    }

    // Check for timeout-related messages
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('etimedout') ||
      message.includes('econnaborted')
    ) {
      return true;
    }
  }

  // Check for code property
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (
      err['code'] === 'ETIMEDOUT' ||
      err['code'] === 'ECONNABORTED' ||
      err['code'] === 'ESOCKETTIMEDOUT'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extract retry-after value from error (for rate limit errors).
 * Returns value in milliseconds.
 */
function extractRetryAfter(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const err = error as Record<string, unknown>;

  // Check for retryAfter property (may be in seconds or milliseconds)
  const retryAfterValue = err['retryAfter'];
  if (typeof retryAfterValue === 'number') {
    // Assume seconds if small value, milliseconds if large
    return retryAfterValue > 1000 ? retryAfterValue : retryAfterValue * 1000;
  }

  // Check response headers (if available)
  const headersValue = err['headers'];
  if (typeof headersValue === 'object' && headersValue !== null) {
    const headers = headersValue as Record<string, string>;
    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }

  return undefined;
}

/**
 * Create an appropriate AgentRouterError based on HTTP status code.
 */
function createErrorFromStatusCode(
  statusCode: number,
  message: string,
  provider: string,
  cause?: Error
): AgentRouterError {
  switch (statusCode) {
    case 400:
      return new ConfigurationError(`Invalid request: ${message}`, cause);

    case 401:
    case 403:
      return new AuthenticationError(provider, cause);

    case 429:
      return new RateLimitError(provider, undefined, cause);

    case 500:
    case 502:
    case 503:
    case 504:
      return new ProviderError(
        `Provider error (${statusCode}): ${message}`,
        provider,
        statusCode,
        cause
      );

    default:
      return new ProviderError(message, provider, statusCode, cause);
  }
}

// ============================================================================
// Provider-Specific Translation Functions
// ============================================================================

/**
 * Translate an Anthropic API error to an AgentRouterError.
 *
 * Anthropic error format:
 * ```json
 * {
 *   "type": "error",
 *   "error": {
 *     "type": "invalid_request_error" | "authentication_error" | "rate_limit_error" | ...,
 *     "message": "Human-readable error message"
 *   }
 * }
 * ```
 *
 * Error types from Anthropic:
 * - invalid_request_error: Bad request parameters (400)
 * - authentication_error: Invalid API key (401)
 * - permission_error: Forbidden (403)
 * - not_found_error: Resource not found (404)
 * - rate_limit_error: Rate limited (429)
 * - api_error: Internal server error (500)
 * - overloaded_error: Overloaded (529)
 *
 * @param error - The raw Anthropic error
 * @returns Normalized AgentRouterError
 */
export function translateAnthropicError(error: AnthropicError): AgentRouterError {
  const provider = 'anthropic';
  const originalError = error instanceof Error ? error : new Error(JSON.stringify(error));

  // Extract message from nested error structure
  const message =
    error.error?.message ||
    error.message ||
    'Unknown Anthropic error';

  // Extract error type
  const errorType = error.error?.type;

  // Extract status code
  const statusCode = extractStatusCode(error);

  // Handle timeout errors
  if (isTimeoutError(error)) {
    return new TimeoutError(provider, 60000, originalError);
  }

  // Map Anthropic error types to AgentRouter errors
  switch (errorType) {
    case 'invalid_request_error':
      return new ConfigurationError(`Invalid request: ${message}`, originalError);

    case 'authentication_error':
      return new AuthenticationError(provider, originalError);

    case 'permission_error':
      return new AuthenticationError(provider, originalError);

    case 'rate_limit_error': {
      const retryAfter = extractRetryAfter(error);
      return new RateLimitError(provider, retryAfter, originalError);
    }

    case 'api_error':
      return new ProviderError(
        `Anthropic API error: ${message}`,
        provider,
        statusCode ?? 500,
        originalError
      );

    case 'overloaded_error':
      return new ProviderError(
        `Anthropic API overloaded: ${message}`,
        provider,
        529,
        originalError
      );

    default:
      // Fall back to status code based mapping
      if (statusCode !== undefined) {
        return createErrorFromStatusCode(statusCode, message, provider, originalError);
      }

      return new ProviderError(message, provider, undefined, originalError);
  }
}

/**
 * Translate an OpenAI API error to an AgentRouterError.
 *
 * OpenAI error format:
 * ```json
 * {
 *   "error": {
 *     "message": "Human-readable error message",
 *     "type": "invalid_request_error" | "authentication_error" | "rate_limit_error" | ...,
 *     "code": "specific_error_code" | null,
 *     "param": "parameter_name" | null
 *   }
 * }
 * ```
 *
 * Common error types from OpenAI:
 * - invalid_request_error: Bad request (400)
 * - invalid_api_key: Invalid API key (401)
 * - insufficient_quota: Quota exceeded (429)
 * - rate_limit_exceeded: Rate limited (429)
 * - server_error: Internal error (500)
 * - engine_overloaded: Overloaded (503)
 *
 * @param error - The raw OpenAI error
 * @returns Normalized AgentRouterError
 */
export function translateOpenAIError(error: OpenAIError): AgentRouterError {
  const provider = 'openai';
  const originalError = error instanceof Error ? error : new Error(JSON.stringify(error));

  // Extract message from nested error structure
  const message =
    error.error?.message ||
    error.message ||
    'Unknown OpenAI error';

  // Extract error type and code
  const errorType = error.error?.type;
  const errorCode = error.error?.code;

  // Extract status code
  const statusCode = extractStatusCode(error);

  // Handle timeout errors
  if (isTimeoutError(error)) {
    return new TimeoutError(provider, 60000, originalError);
  }

  // Map OpenAI error types/codes to AgentRouter errors
  // First check specific error codes
  switch (errorCode) {
    case 'invalid_api_key':
      return new AuthenticationError(provider, originalError);

    case 'insufficient_quota':
    case 'rate_limit_exceeded': {
      const retryAfter = extractRetryAfter(error);
      return new RateLimitError(provider, retryAfter, originalError);
    }

    case 'model_not_found':
      return new ConfigurationError(`Model not found: ${message}`, originalError);

    case 'context_length_exceeded':
      return new ConfigurationError(`Context length exceeded: ${message}`, originalError);
  }

  // Then check error type
  switch (errorType) {
    case 'invalid_request_error':
      return new ConfigurationError(`Invalid request: ${message}`, originalError);

    case 'authentication_error':
      return new AuthenticationError(provider, originalError);

    case 'rate_limit_error': {
      const retryAfter = extractRetryAfter(error);
      return new RateLimitError(provider, retryAfter, originalError);
    }

    case 'server_error':
      return new ProviderError(
        `OpenAI server error: ${message}`,
        provider,
        statusCode ?? 500,
        originalError
      );
  }

  // Fall back to status code based mapping
  if (statusCode !== undefined) {
    return createErrorFromStatusCode(statusCode, message, provider, originalError);
  }

  return new ProviderError(message, provider, undefined, originalError);
}

/**
 * Translate a Google Gemini API error to an AgentRouterError.
 *
 * Gemini error format:
 * ```json
 * {
 *   "error": {
 *     "code": 400,
 *     "message": "Human-readable error message",
 *     "status": "INVALID_ARGUMENT" | "UNAUTHENTICATED" | "RESOURCE_EXHAUSTED" | ...,
 *     "details": [...]
 *   }
 * }
 * ```
 *
 * Common status values from Gemini:
 * - INVALID_ARGUMENT: Bad request (400)
 * - UNAUTHENTICATED: Invalid API key (401)
 * - PERMISSION_DENIED: Forbidden (403)
 * - NOT_FOUND: Resource not found (404)
 * - RESOURCE_EXHAUSTED: Rate limited or quota exceeded (429)
 * - INTERNAL: Internal server error (500)
 * - UNAVAILABLE: Service unavailable (503)
 *
 * @param error - The raw Gemini error
 * @returns Normalized AgentRouterError
 */
export function translateGeminiError(error: GeminiError): AgentRouterError {
  const provider = 'google';
  const originalError = error instanceof Error ? error : new Error(JSON.stringify(error));

  // Extract message from nested error structure
  const message =
    error.error?.message ||
    error.message ||
    'Unknown Gemini error';

  // Extract status (string status like "INVALID_ARGUMENT")
  const status = error.error?.status;

  // Extract numeric code
  const code = error.error?.code;

  // Get status code from various sources
  const statusCode = extractStatusCode(error) ?? code;

  // Handle timeout errors
  if (isTimeoutError(error)) {
    return new TimeoutError(provider, 60000, originalError);
  }

  // Map Gemini status values to AgentRouter errors
  switch (status) {
    case 'INVALID_ARGUMENT':
      return new ConfigurationError(`Invalid argument: ${message}`, originalError);

    case 'UNAUTHENTICATED':
      return new AuthenticationError(provider, originalError);

    case 'PERMISSION_DENIED':
      return new AuthenticationError(provider, originalError);

    case 'NOT_FOUND':
      return new ConfigurationError(`Resource not found: ${message}`, originalError);

    case 'RESOURCE_EXHAUSTED': {
      const retryAfter = extractRetryAfter(error);
      return new RateLimitError(provider, retryAfter, originalError);
    }

    case 'INTERNAL':
      return new ProviderError(
        `Gemini internal error: ${message}`,
        provider,
        statusCode ?? 500,
        originalError
      );

    case 'UNAVAILABLE':
      return new ProviderError(
        `Gemini service unavailable: ${message}`,
        provider,
        statusCode ?? 503,
        originalError
      );

    case 'DEADLINE_EXCEEDED':
      return new TimeoutError(provider, 60000, originalError);
  }

  // Fall back to status code based mapping
  if (statusCode !== undefined) {
    return createErrorFromStatusCode(statusCode, message, provider, originalError);
  }

  return new ProviderError(message, provider, undefined, originalError);
}

// ============================================================================
// Generic Error Translation
// ============================================================================

/**
 * Translate any error into an AgentRouterError.
 * Used when the provider is unknown or for generic error handling.
 *
 * @param error - Any error object
 * @param provider - Provider name for error context
 * @returns Normalized AgentRouterError
 */
export function translateGenericError(
  error: unknown,
  provider: string
): AgentRouterError {
  // Already an AgentRouterError - return as-is
  if (error instanceof AgentRouterError) {
    return error;
  }

  const originalError = error instanceof Error ? error : new Error(String(error));
  const message = extractMessage(error, 'Unknown error');
  const statusCode = extractStatusCode(error);

  // Handle timeout errors
  if (isTimeoutError(error)) {
    return new TimeoutError(provider, 60000, originalError);
  }

  // Map by status code if available
  if (statusCode !== undefined) {
    return createErrorFromStatusCode(statusCode, message, provider, originalError);
  }

  // Default to generic provider error
  return new ProviderError(message, provider, undefined, originalError);
}

/**
 * Translate an error from a specific provider.
 * Routes to the appropriate provider-specific translator.
 *
 * @param error - The raw error from the provider
 * @param provider - Provider name ('anthropic', 'openai', 'google', etc.)
 * @returns Normalized AgentRouterError
 */
export function translateProviderError(
  error: unknown,
  provider: string
): AgentRouterError {
  // Already an AgentRouterError - return as-is
  if (error instanceof AgentRouterError) {
    return error;
  }

  switch (provider.toLowerCase()) {
    case 'anthropic':
      return translateAnthropicError(error as AnthropicError);

    case 'openai':
      return translateOpenAIError(error as OpenAIError);

    case 'google':
    case 'gemini':
      return translateGeminiError(error as GeminiError);

    default:
      return translateGenericError(error, provider);
  }
}

/**
 * Wrap an async function to translate provider errors.
 * Useful for wrapping provider calls to ensure consistent error handling.
 *
 * @param fn - Async function to wrap
 * @param provider - Provider name for error context
 * @returns Wrapped function that translates errors
 */
export function withErrorTranslation<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  provider: string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw translateProviderError(error, provider);
    }
  };
}

/**
 * Check if an error is retryable (transient error that may succeed on retry).
 *
 * @param error - The error to check
 * @returns True if the error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }

  if (error instanceof TimeoutError) {
    return true;
  }

  if (error instanceof ProviderError) {
    const status = error.statusCode;
    // 5xx errors are generally retryable
    if (status !== undefined && status >= 500 && status < 600) {
      return true;
    }
    // 429 is also retryable (rate limit)
    if (status === 429) {
      return true;
    }
  }

  return false;
}

/**
 * Get recommended retry delay for an error.
 *
 * @param error - The error to get retry delay for
 * @param attempt - Current attempt number (1-based)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000)
 * @returns Recommended delay in milliseconds, or undefined if not retryable
 */
export function getRetryDelay(
  error: unknown,
  attempt: number,
  baseDelayMs = 1000
): number | undefined {
  if (!isRetryableError(error)) {
    return undefined;
  }

  // Use retry-after if available
  if (error instanceof RateLimitError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs;
  }

  // Exponential backoff with jitter
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
  const delay = exponentialDelay + jitter;

  // Cap at 60 seconds
  return Math.min(delay, 60000);
}
