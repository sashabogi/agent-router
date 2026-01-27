/**
 * Circuit Breaker Implementation
 *
 * Provides fault tolerance for provider operations by preventing cascading failures.
 * Implements the circuit breaker pattern with three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing, requests rejected immediately
 * - HALF_OPEN: Testing recovery, limited requests allowed
 */

import { AgentRouterError } from '../types.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Circuit breaker states.
 */
export enum CircuitState {
  /** Normal operation - requests pass through */
  CLOSED = 'CLOSED',
  /** Circuit is open - requests rejected immediately */
  OPEN = 'OPEN',
  /** Testing recovery - limited requests allowed */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Configuration options for the circuit breaker.
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Number of successes needed to close from half-open (default: 2) */
  successThreshold: number;
  /** Milliseconds to wait before trying half-open (default: 30000) */
  timeout: number;
  /** Milliseconds to reset failure count in closed state (default: 60000) */
  resetTimeout?: number;
}

/**
 * Callback function type for state change notifications.
 */
export type StateChangeCallback = (
  previousState: CircuitState,
  newState: CircuitState,
  metadata: StateChangeMetadata
) => void;

/**
 * Metadata provided with state change notifications.
 */
export interface StateChangeMetadata {
  /** Current failure count */
  failureCount: number;
  /** Current success count (relevant in HALF_OPEN state) */
  successCount: number;
  /** Timestamp of the state change */
  timestamp: Date;
  /** The error that caused the state change (if applicable) */
  error?: Error;
}

/**
 * Internal state tracking for the circuit breaker.
 */
interface CircuitBreakerState {
  /** Current circuit state */
  state: CircuitState;
  /** Count of consecutive failures in CLOSED state */
  failureCount: number;
  /** Count of consecutive successes in HALF_OPEN state */
  successCount: number;
  /** Timestamp when the circuit was opened */
  lastFailureTime: number | null;
  /** Timestamp of the first failure in the current window */
  firstFailureTime: number | null;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when the circuit is open and requests are rejected.
 */
export class CircuitOpenError extends AgentRouterError {
  /** Time remaining until the circuit may transition to half-open */
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, cause?: Error) {
    super(
      `Circuit breaker is open. Retry after ${retryAfterMs}ms`,
      'CIRCUIT_OPEN',
      cause
    );
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
  resetTimeout: 60000,
};

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

/**
 * Circuit Breaker for provider resilience.
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when a provider is experiencing issues. The circuit breaker monitors
 * failures and opens the circuit when the failure threshold is reached,
 * rejecting requests immediately until the timeout expires.
 *
 * State Transitions:
 * - CLOSED → OPEN: When failureCount >= failureThreshold
 * - OPEN → HALF_OPEN: When timeout expires
 * - HALF_OPEN → CLOSED: When successCount >= successThreshold
 * - HALF_OPEN → OPEN: On any failure
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   timeout: 30000,
 * });
 *
 * // Wrap provider calls
 * const result = await breaker.execute(async () => {
 *   return provider.complete(request);
 * });
 *
 * // Subscribe to state changes
 * breaker.onStateChange((prev, next, meta) => {
 *   console.log(`Circuit changed from ${prev} to ${next}`);
 * });
 * ```
 */
export class CircuitBreaker {
  /** Configuration options */
  private readonly options: Required<CircuitBreakerOptions>;

  /** Internal state */
  private state: CircuitBreakerState;

  /** State change subscribers */
  private readonly listeners: Set<StateChangeCallback>;

  /**
   * Create a new CircuitBreaker instance.
   *
   * @param options - Configuration options (all have sensible defaults)
   */
  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      firstFailureTime: null,
    };

    this.listeners = new Set();
  }

  /**
   * Execute an async operation through the circuit breaker.
   *
   * In CLOSED state, the operation is executed normally and failures are tracked.
   * In OPEN state, a CircuitOpenError is thrown immediately without executing.
   * In HALF_OPEN state, the operation is executed and success/failure determines
   * whether to close or re-open the circuit.
   *
   * @param fn - The async operation to execute
   * @returns The result of the operation
   * @throws CircuitOpenError if the circuit is open
   * @throws The original error if the operation fails
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    this.checkStateTransition();

    const currentState = this.state.state;

    // If circuit is open, reject immediately
    if (currentState === CircuitState.OPEN) {
      const timeElapsed = Date.now() - (this.state.lastFailureTime || 0);
      const retryAfterMs = Math.max(0, this.options.timeout - timeElapsed);
      throw new CircuitOpenError(retryAfterMs);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get the current circuit state.
   *
   * @returns The current CircuitState
   */
  public getState(): CircuitState {
    // Check for state transition before returning
    this.checkStateTransition();
    return this.state.state;
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   *
   * This clears all failure/success counts and allows normal operation
   * to resume. Use this when you know the underlying issue has been resolved.
   */
  public reset(): void {
    const previousState = this.state.state;

    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      firstFailureTime: null,
    };

    if (previousState !== CircuitState.CLOSED) {
      this.notifyStateChange(previousState, CircuitState.CLOSED);
    }
  }

  /**
   * Subscribe to state change notifications.
   *
   * The callback will be invoked whenever the circuit state changes.
   * Returns an unsubscribe function to remove the listener.
   *
   * @param callback - Function to call on state changes
   * @returns Unsubscribe function
   */
  public onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Get current statistics about the circuit breaker.
   *
   * @returns Object with current state and counts
   */
  public getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
  } {
    this.checkStateTransition();
    return {
      state: this.state.state,
      failureCount: this.state.failureCount,
      successCount: this.state.successCount,
      lastFailureTime: this.state.lastFailureTime
        ? new Date(this.state.lastFailureTime)
        : null,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check if we should transition from OPEN to HALF_OPEN based on timeout.
   */
  private checkStateTransition(): void {
    if (this.state.state === CircuitState.OPEN && this.state.lastFailureTime) {
      const timeElapsed = Date.now() - this.state.lastFailureTime;
      if (timeElapsed >= this.options.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }

    // Reset failure count if we're in CLOSED state and the reset timeout has elapsed
    if (
      this.state.state === CircuitState.CLOSED &&
      this.state.firstFailureTime &&
      this.options.resetTimeout
    ) {
      const timeSinceFirstFailure = Date.now() - this.state.firstFailureTime;
      if (timeSinceFirstFailure >= this.options.resetTimeout) {
        this.state.failureCount = 0;
        this.state.firstFailureTime = null;
      }
    }
  }

  /**
   * Record a successful operation.
   */
  private recordSuccess(): void {
    const currentState = this.state.state;

    if (currentState === CircuitState.HALF_OPEN) {
      this.state.successCount++;

      if (this.state.successCount >= this.options.successThreshold) {
        // Enough successes to close the circuit
        this.state.failureCount = 0;
        this.state.successCount = 0;
        this.state.lastFailureTime = null;
        this.state.firstFailureTime = null;
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (currentState === CircuitState.CLOSED) {
      // Reset failure tracking on success in closed state
      // This implements a "consecutive failures" model
      this.state.failureCount = 0;
      this.state.firstFailureTime = null;
    }
  }

  /**
   * Record a failed operation.
   */
  private recordFailure(error: Error): void {
    const currentState = this.state.state;
    const now = Date.now();

    if (currentState === CircuitState.HALF_OPEN) {
      // Any failure in half-open state immediately opens the circuit
      this.state.lastFailureTime = now;
      this.state.successCount = 0;
      this.transitionTo(CircuitState.OPEN, error);
    } else if (currentState === CircuitState.CLOSED) {
      // Track the first failure time for reset timeout
      if (this.state.firstFailureTime === null) {
        this.state.firstFailureTime = now;
      }

      this.state.failureCount++;
      this.state.lastFailureTime = now;

      if (this.state.failureCount >= this.options.failureThreshold) {
        // Threshold reached, open the circuit
        this.transitionTo(CircuitState.OPEN, error);
      }
    }
  }

  /**
   * Transition to a new state and notify listeners.
   */
  private transitionTo(newState: CircuitState, error?: Error): void {
    const previousState = this.state.state;

    if (previousState === newState) {
      return;
    }

    this.state.state = newState;

    // Reset success count when transitioning to HALF_OPEN
    if (newState === CircuitState.HALF_OPEN) {
      this.state.successCount = 0;
    }

    this.notifyStateChange(previousState, newState, error);
  }

  /**
   * Notify all listeners of a state change.
   */
  private notifyStateChange(
    previousState: CircuitState,
    newState: CircuitState,
    error?: Error
  ): void {
    const metadata: StateChangeMetadata = {
      failureCount: this.state.failureCount,
      successCount: this.state.successCount,
      timestamp: new Date(),
    };

    // Only add error property if it's defined (exactOptionalPropertyTypes)
    if (error !== undefined) {
      metadata.error = error;
    }

    for (const listener of this.listeners) {
      try {
        listener(previousState, newState, metadata);
      } catch {
        // Ignore errors from listeners to prevent them from affecting the circuit
      }
    }
  }
}
