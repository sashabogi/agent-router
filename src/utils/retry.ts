/**
 * Retry Utility with Exponential Backoff
 *
 * Provides configurable retry logic with:
 * - Exponential backoff with jitter
 * - Configurable retry predicates
 * - Rate limit awareness (respects retryAfterMs)
 * - Callbacks for retry events
 */

import { ProviderError, RateLimitError, TimeoutError } from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor to randomize delays (default: 0.1 = 10%) */
  jitterFactor?: number;
  /**
   * Predicate to determine if an error should be retried.
   * @param error The error that occurred
   * @param attempt The current attempt number (1-indexed)
   * @returns true if the operation should be retried
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /**
   * Callback invoked before each retry attempt.
   * @param error The error that triggered the retry
   * @param attempt The attempt number that just failed (1-indexed)
   * @param delayMs The delay before the next attempt
   */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Resolved retry options with all defaults applied.
 */
interface ResolvedRetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
  shouldRetry: (error: Error, attempt: number) => boolean;
  onRetry: ((error: Error, attempt: number, delayMs: number) => void) | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: ResolvedRetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  shouldRetry: isRetryableError,
  onRetry: undefined,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines if an error is retryable by default.
 *
 * Retryable errors:
 * - RateLimitError (429 responses)
 * - TimeoutError (request timeouts)
 * - ProviderError with 5xx status codes (server errors)
 *
 * @param error The error to check
 * @returns true if the error is retryable
 */
export function isRetryableError(error: Error): boolean {
  // RateLimitError is always retryable
  if (error instanceof RateLimitError) {
    return true;
  }

  // TimeoutError is always retryable
  if (error instanceof TimeoutError) {
    return true;
  }

  // ProviderError with 5xx status is retryable
  if (error instanceof ProviderError && error.statusCode !== undefined) {
    return error.statusCode >= 500 && error.statusCode < 600;
  }

  return false;
}

/**
 * Calculates the delay before the next retry attempt using exponential backoff with jitter.
 *
 * Formula: delay = min(initialDelay * (multiplier ^ attempt), maxDelay) * (1 +/- jitter)
 *
 * @param attempt The attempt number (0-indexed, where 0 is the first retry)
 * @param options Retry configuration options
 * @returns The delay in milliseconds before the next attempt
 */
export function calculateDelay(
  attempt: number,
  options: Pick<RetryOptions, 'initialDelayMs' | 'maxDelayMs' | 'backoffMultiplier' | 'jitterFactor'>
): number {
  const {
    initialDelayMs = DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    jitterFactor = DEFAULT_OPTIONS.jitterFactor,
  } = options;

  // Calculate base delay with exponential backoff
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs);

  // Apply jitter: randomize within +/- jitterFactor
  const jitterRange = cappedDelay * jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random value between -jitterRange and +jitterRange

  // Ensure delay is at least 0
  return Math.max(0, Math.floor(cappedDelay + jitter));
}

/**
 * Sleeps for a specified number of milliseconds.
 *
 * @param ms The number of milliseconds to sleep
 * @returns A promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves retry options by merging with defaults.
 *
 * @param options User-provided options
 * @returns Fully resolved options with all defaults applied
 */
function resolveOptions(options?: RetryOptions): ResolvedRetryOptions {
  return {
    maxAttempts: options?.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier: options?.backoffMultiplier ?? DEFAULT_OPTIONS.backoffMultiplier,
    jitterFactor: options?.jitterFactor ?? DEFAULT_OPTIONS.jitterFactor,
    shouldRetry: options?.shouldRetry ?? DEFAULT_OPTIONS.shouldRetry,
    onRetry: options?.onRetry,
  };
}

// ============================================================================
// Main Retry Function
// ============================================================================

/**
 * Executes a function with automatic retry on failure using exponential backoff.
 *
 * @param fn The async function to execute and potentially retry
 * @param options Configuration options for retry behavior
 * @returns The result of the function if successful
 * @throws The last error encountered if all retry attempts fail
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => provider.complete(request),
 *   {
 *     maxAttempts: 5,
 *     initialDelayMs: 500,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Attempt ${attempt} failed, retrying in ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const resolved = resolveOptions(options);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if we should retry
      const isLastAttempt = attempt >= resolved.maxAttempts;
      const shouldRetry = !isLastAttempt && resolved.shouldRetry(err, attempt);

      if (!shouldRetry) {
        throw err;
      }

      // Calculate delay
      let delayMs: number;

      // Respect RateLimitError.retryAfterMs if present
      if (err instanceof RateLimitError && err.retryAfterMs !== undefined) {
        delayMs = err.retryAfterMs;
      } else {
        // Use exponential backoff (attempt - 1 because attempt is 1-indexed)
        delayMs = calculateDelay(attempt - 1, resolved);
      }

      // Invoke retry callback if provided
      if (resolved.onRetry) {
        resolved.onRetry(err, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed with no error');
}

// ============================================================================
// Higher-Order Function Wrapper
// ============================================================================

/**
 * Creates a retryable version of an async function.
 *
 * This higher-order function wraps any async function with retry logic,
 * allowing you to create pre-configured retryable operations.
 *
 * @param fn The async function to wrap
 * @param options Configuration options for retry behavior
 * @returns A new function that executes with retry logic
 *
 * @example
 * ```typescript
 * const retryableComplete = withRetry(
 *   () => provider.complete(request),
 *   { maxAttempts: 5 }
 * );
 *
 * // Later, execute with retry
 * const result = await retryableComplete();
 * ```
 */
export function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): () => Promise<T> {
  return () => retry(fn, options);
}
