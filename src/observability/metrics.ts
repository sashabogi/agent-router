/**
 * Metrics Collection Module
 *
 * Simple in-memory metrics collection for AgentRouter observability.
 * Tracks:
 * - Request counts (by role, provider, status)
 * - Latency histograms with percentile calculations (by role, provider)
 * - Token usage (input, output by provider)
 * - Error counts (by type, provider)
 * - Circuit breaker state changes
 *
 * No external dependencies - pure TypeScript implementation.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Token usage statistics for a provider.
 */
export interface TokenStats {
  input: number;
  output: number;
  total: number;
}

/**
 * Latency statistics with percentiles.
 */
export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Circuit breaker state.
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker state change event.
 */
export interface CircuitBreakerEvent {
  provider: string;
  previousState: CircuitBreakerState;
  newState: CircuitBreakerState;
  timestamp: number;
}

/**
 * Request status for metrics tracking.
 */
export type RequestStatus = 'success' | 'error' | 'timeout' | 'rate_limited';

/**
 * Input for recording a request.
 */
export interface RequestRecord {
  role: string;
  provider: string;
  status: RequestStatus;
  durationMs: number;
  tokens?: {
    input: number;
    output: number;
  };
}

/**
 * Aggregated metrics snapshot.
 */
export interface Metrics {
  requests: {
    total: number;
    byRole: Map<string, number>;
    byProvider: Map<string, number>;
    byStatus: Map<string, number>;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    byProvider: Map<string, LatencyStats>;
    byRole: Map<string, LatencyStats>;
  };
  tokens: {
    input: number;
    output: number;
    byProvider: Map<string, TokenStats>;
  };
  errors: {
    total: number;
    byType: Map<string, number>;
    byProvider: Map<string, number>;
  };
  circuitBreaker: {
    stateChanges: CircuitBreakerEvent[];
    currentStates: Map<string, CircuitBreakerState>;
  };
  startTime: number;
  lastUpdated: number;
}

/**
 * JSON-serializable metrics format.
 */
export interface MetricsJSON {
  requests: {
    total: number;
    byRole: Record<string, number>;
    byProvider: Record<string, number>;
    byStatus: Record<string, number>;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    byProvider: Record<string, LatencyStats>;
    byRole: Record<string, LatencyStats>;
  };
  tokens: {
    input: number;
    output: number;
    byProvider: Record<string, TokenStats>;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
    byProvider: Record<string, number>;
  };
  circuitBreaker: {
    stateChanges: CircuitBreakerEvent[];
    currentStates: Record<string, CircuitBreakerState>;
  };
  startTime: number;
  lastUpdated: number;
  uptimeMs: number;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate percentile from a sorted array of numbers.
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower]!;

  const fraction = index - lower;
  return sortedValues[lower]! + fraction * (sortedValues[upper]! - sortedValues[lower]!);
}

/**
 * Calculate latency statistics from an array of latency values.
 */
function calculateLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);

  return {
    count: values.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / values.length,
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  };
}

/**
 * Convert a Map to a plain object for JSON serialization.
 */
function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  const obj: Record<string, T> = {};
  for (const [key, value] of map) {
    obj[key] = value;
  }
  return obj;
}

// ============================================================================
// MetricsCollector Class
// ============================================================================

/**
 * Metrics collector for tracking AgentRouter performance and usage.
 *
 * Thread-safe for single-threaded Node.js runtime.
 * Maintains rolling latency data for percentile calculations.
 *
 * @example
 * ```typescript
 * const metrics = new MetricsCollector();
 *
 * // Record a successful request
 * metrics.recordRequest({
 *   role: 'coder',
 *   provider: 'anthropic',
 *   status: 'success',
 *   durationMs: 1234,
 *   tokens: { input: 100, output: 500 }
 * });
 *
 * // Record an error
 * metrics.recordError('RateLimitError', 'openai');
 *
 * // Get metrics snapshot
 * const snapshot = metrics.getMetrics();
 * console.log(`Total requests: ${snapshot.requests.total}`);
 * console.log(`P95 latency: ${snapshot.latency.p95}ms`);
 * ```
 */
export class MetricsCollector {
  // Request counts
  private requestCount = 0;
  private requestsByRole = new Map<string, number>();
  private requestsByProvider = new Map<string, number>();
  private requestsByStatus = new Map<string, number>();

  // Latency tracking (store raw values for percentile calculation)
  private latencyValues: number[] = [];
  private latencyByProvider = new Map<string, number[]>();
  private latencyByRole = new Map<string, number[]>();

  // Token tracking
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private tokensByProvider = new Map<string, TokenStats>();

  // Error tracking
  private errorCount = 0;
  private errorsByType = new Map<string, number>();
  private errorsByProvider = new Map<string, number>();

  // Circuit breaker tracking
  private circuitBreakerEvents: CircuitBreakerEvent[] = [];
  private circuitBreakerStates = new Map<string, CircuitBreakerState>();

  // Timing
  private readonly startTime: number;
  private lastUpdated: number;

  // Configuration
  private readonly maxLatencySamples: number;
  private readonly maxCircuitBreakerEvents: number;

  /**
   * Create a new MetricsCollector.
   *
   * @param options Configuration options
   * @param options.maxLatencySamples Maximum number of latency samples to keep (default: 10000)
   * @param options.maxCircuitBreakerEvents Maximum circuit breaker events to keep (default: 1000)
   */
  constructor(options?: { maxLatencySamples?: number; maxCircuitBreakerEvents?: number }) {
    this.startTime = Date.now();
    this.lastUpdated = this.startTime;
    this.maxLatencySamples = options?.maxLatencySamples ?? 10000;
    this.maxCircuitBreakerEvents = options?.maxCircuitBreakerEvents ?? 1000;
  }

  /**
   * Record a completed request.
   *
   * @param record Request details to record
   */
  recordRequest(record: RequestRecord): void {
    this.lastUpdated = Date.now();

    // Increment request counts
    this.requestCount++;
    this.incrementMap(this.requestsByRole, record.role);
    this.incrementMap(this.requestsByProvider, record.provider);
    this.incrementMap(this.requestsByStatus, record.status);

    // Record latency
    this.addLatencySample(this.latencyValues, record.durationMs);
    this.addLatencySampleToMap(this.latencyByProvider, record.provider, record.durationMs);
    this.addLatencySampleToMap(this.latencyByRole, record.role, record.durationMs);

    // Record tokens if provided
    if (record.tokens) {
      this.totalInputTokens += record.tokens.input;
      this.totalOutputTokens += record.tokens.output;

      const providerTokens = this.tokensByProvider.get(record.provider) ?? {
        input: 0,
        output: 0,
        total: 0,
      };
      providerTokens.input += record.tokens.input;
      providerTokens.output += record.tokens.output;
      providerTokens.total += record.tokens.input + record.tokens.output;
      this.tokensByProvider.set(record.provider, providerTokens);
    }
  }

  /**
   * Record an error occurrence.
   *
   * @param errorType The type/class of the error
   * @param provider The provider that produced the error (optional)
   */
  recordError(errorType: string, provider?: string): void {
    this.lastUpdated = Date.now();

    this.errorCount++;
    this.incrementMap(this.errorsByType, errorType);

    if (provider) {
      this.incrementMap(this.errorsByProvider, provider);
    }
  }

  /**
   * Record a circuit breaker state change.
   *
   * @param provider The provider whose circuit breaker changed
   * @param previousState The previous state
   * @param newState The new state
   */
  recordCircuitBreakerChange(
    provider: string,
    previousState: CircuitBreakerState,
    newState: CircuitBreakerState
  ): void {
    this.lastUpdated = Date.now();

    const event: CircuitBreakerEvent = {
      provider,
      previousState,
      newState,
      timestamp: Date.now(),
    };

    this.circuitBreakerEvents.push(event);
    this.circuitBreakerStates.set(provider, newState);

    // Trim old events if needed
    if (this.circuitBreakerEvents.length > this.maxCircuitBreakerEvents) {
      this.circuitBreakerEvents = this.circuitBreakerEvents.slice(-this.maxCircuitBreakerEvents);
    }
  }

  /**
   * Get the current metrics snapshot.
   *
   * @returns Aggregated metrics with calculated percentiles
   */
  getMetrics(): Metrics {
    const globalLatencyStats = calculateLatencyStats(this.latencyValues);

    return {
      requests: {
        total: this.requestCount,
        byRole: new Map(this.requestsByRole),
        byProvider: new Map(this.requestsByProvider),
        byStatus: new Map(this.requestsByStatus),
      },
      latency: {
        p50: globalLatencyStats.p50,
        p95: globalLatencyStats.p95,
        p99: globalLatencyStats.p99,
        byProvider: this.calculateLatencyStatsByKey(this.latencyByProvider),
        byRole: this.calculateLatencyStatsByKey(this.latencyByRole),
      },
      tokens: {
        input: this.totalInputTokens,
        output: this.totalOutputTokens,
        byProvider: new Map(this.tokensByProvider),
      },
      errors: {
        total: this.errorCount,
        byType: new Map(this.errorsByType),
        byProvider: new Map(this.errorsByProvider),
      },
      circuitBreaker: {
        stateChanges: [...this.circuitBreakerEvents],
        currentStates: new Map(this.circuitBreakerStates),
      },
      startTime: this.startTime,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Reset all metrics to initial state.
   * Useful for testing or periodic resets.
   */
  reset(): void {
    this.requestCount = 0;
    this.requestsByRole.clear();
    this.requestsByProvider.clear();
    this.requestsByStatus.clear();

    this.latencyValues = [];
    this.latencyByProvider.clear();
    this.latencyByRole.clear();

    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.tokensByProvider.clear();

    this.errorCount = 0;
    this.errorsByType.clear();
    this.errorsByProvider.clear();

    this.circuitBreakerEvents = [];
    this.circuitBreakerStates.clear();

    this.lastUpdated = Date.now();
  }

  /**
   * Export metrics as a JSON string.
   *
   * @returns JSON string representation of all metrics
   */
  toJSON(): string {
    const metrics = this.getMetrics();
    const globalLatencyStats = calculateLatencyStats(this.latencyValues);

    const jsonMetrics: MetricsJSON = {
      requests: {
        total: metrics.requests.total,
        byRole: mapToObject(metrics.requests.byRole),
        byProvider: mapToObject(metrics.requests.byProvider),
        byStatus: mapToObject(metrics.requests.byStatus),
      },
      latency: {
        p50: globalLatencyStats.p50,
        p95: globalLatencyStats.p95,
        p99: globalLatencyStats.p99,
        byProvider: mapToObject(metrics.latency.byProvider),
        byRole: mapToObject(metrics.latency.byRole),
      },
      tokens: {
        input: metrics.tokens.input,
        output: metrics.tokens.output,
        byProvider: mapToObject(metrics.tokens.byProvider),
      },
      errors: {
        total: metrics.errors.total,
        byType: mapToObject(metrics.errors.byType),
        byProvider: mapToObject(metrics.errors.byProvider),
      },
      circuitBreaker: {
        stateChanges: metrics.circuitBreaker.stateChanges,
        currentStates: mapToObject(metrics.circuitBreaker.currentStates),
      },
      startTime: metrics.startTime,
      lastUpdated: metrics.lastUpdated,
      uptimeMs: Date.now() - metrics.startTime,
    };

    return JSON.stringify(jsonMetrics, null, 2);
  }

  /**
   * Get a summary string suitable for logging.
   *
   * @returns Human-readable summary of key metrics
   */
  getSummary(): string {
    const m = this.getMetrics();
    const uptimeSeconds = Math.floor((Date.now() - m.startTime) / 1000);

    return [
      `Metrics Summary (uptime: ${uptimeSeconds}s)`,
      `  Requests: ${m.requests.total} total`,
      `  Latency: p50=${m.latency.p50.toFixed(0)}ms, p95=${m.latency.p95.toFixed(0)}ms, p99=${m.latency.p99.toFixed(0)}ms`,
      `  Tokens: ${m.tokens.input} input, ${m.tokens.output} output`,
      `  Errors: ${m.errors.total} total`,
    ].join('\n');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private incrementMap(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private addLatencySample(values: number[], sample: number): void {
    values.push(sample);
    // Trim to max samples (remove oldest)
    if (values.length > this.maxLatencySamples) {
      values.shift();
    }
  }

  private addLatencySampleToMap(
    map: Map<string, number[]>,
    key: string,
    sample: number
  ): void {
    let values = map.get(key);
    if (!values) {
      values = [];
      map.set(key, values);
    }
    values.push(sample);
    // Trim to max samples per key
    if (values.length > this.maxLatencySamples) {
      values.shift();
    }
  }

  private calculateLatencyStatsByKey(
    map: Map<string, number[]>
  ): Map<string, LatencyStats> {
    const result = new Map<string, LatencyStats>();
    for (const [key, values] of map) {
      result.set(key, calculateLatencyStats(values));
    }
    return result;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default metrics collector instance for the agent-router package.
 * Pre-configured and ready to use.
 */
export const metrics = new MetricsCollector();

/**
 * Re-export for convenience.
 */
export default metrics;
