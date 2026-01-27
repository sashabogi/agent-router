/**
 * Logger Module
 *
 * Pino-based structured logging for AgentRouter.
 * Provides a Logger class with support for:
 * - Log levels (trace, debug, info, warn, error, fatal)
 * - Structured logging with context
 * - Child loggers with bound context
 * - Pretty printing in development mode
 * - Correlation IDs and timestamps
 */

import { randomUUID } from 'crypto';

import pino, { type Logger as PinoLogger } from 'pino';

// ============================================================================
// Types
// ============================================================================

/**
 * Log context that can be bound to a logger or passed per-call.
 */
export interface LogContext {
  /** Trace ID for request correlation */
  traceId?: string;
  /** Agent role being invoked */
  role?: string;
  /** Provider handling the request */
  provider?: string;
  /** Model being used */
  model?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Additional arbitrary context */
  [key: string]: unknown;
}

/**
 * Options for creating a Logger instance.
 */
export interface LoggerOptions {
  /** Logger name (appears in logs) */
  name?: string;
  /** Log level (default: info, or debug in development) */
  level?: LogLevel;
  /** Context to bind to all log entries */
  context?: LogContext;
  /** Whether to enable pretty printing (default: auto-detect from NODE_ENV) */
  pretty?: boolean;
}

/**
 * Supported log levels.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ============================================================================
// Logger Class
// ============================================================================

/**
 * Logger class wrapping pino with structured logging support.
 *
 * @example
 * ```typescript
 * const logger = new Logger({ name: 'agent-router' });
 * logger.info('Request received', { traceId, role: 'coder' });
 *
 * const childLogger = logger.child({ traceId: '123' });
 * childLogger.debug('Processing', { step: 1 });
 * ```
 */
export class Logger {
  private readonly pino: PinoLogger;
  private readonly boundContext: LogContext;

  constructor(options: LoggerOptions = {}) {
    const isDevelopment = process.env['NODE_ENV'] === 'development';
    const usePretty = options.pretty ?? isDevelopment;
    const defaultLevel: LogLevel = isDevelopment ? 'debug' : 'info';

    // Build pino options without using exactOptionalPropertyTypes conflicts
    const pinoOptions: pino.LoggerOptions = {
      level: options.level ?? process.env['LOG_LEVEL'] ?? defaultLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    };

    // Set base context if provided
    if (options.context) {
      pinoOptions.base = { ...options.context };
    }

    // Add name if provided
    if (options.name) {
      pinoOptions.name = options.name;
    }

    // Use pino-pretty transport in development if available
    if (usePretty) {
      pinoOptions.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    }

    try {
      this.pino = pino(pinoOptions);
    } catch {
      // pino-pretty not installed, fall back to standard JSON logging
      delete pinoOptions.transport;
      this.pino = pino(pinoOptions);
      if (usePretty) {
        // Log a one-time warning about pretty printing
        this.pino.warn(
          'pino-pretty not installed, falling back to JSON logging. ' +
          'Install with: npm install -D pino-pretty'
        );
      }
    }

    this.boundContext = options.context ?? {};
  }

  /**
   * Create a child logger with additional bound context.
   * The child logger inherits all parent context plus new bindings.
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger({
      level: this.pino.level as LogLevel,
    });
    // Create a pino child with merged context
    const mergedContext = { ...this.boundContext, ...context };
    (childLogger as unknown as { pino: PinoLogger }).pino = this.pino.child(mergedContext);
    (childLogger as unknown as { boundContext: LogContext }).boundContext = mergedContext;
    return childLogger;
  }

  /**
   * Log at trace level (most verbose).
   */
  trace(message: string, context?: LogContext): void {
    if (context) {
      this.pino.trace(context, message);
    } else {
      this.pino.trace(message);
    }
  }

  /**
   * Log at debug level.
   */
  debug(message: string, context?: LogContext): void {
    if (context) {
      this.pino.debug(context, message);
    } else {
      this.pino.debug(message);
    }
  }

  /**
   * Log at info level.
   */
  info(message: string, context?: LogContext): void {
    if (context) {
      this.pino.info(context, message);
    } else {
      this.pino.info(message);
    }
  }

  /**
   * Log at warn level.
   */
  warn(message: string, context?: LogContext): void {
    if (context) {
      this.pino.warn(context, message);
    } else {
      this.pino.warn(message);
    }
  }

  /**
   * Log at error level.
   */
  error(message: string, context?: LogContext & { error?: Error }): void {
    if (context) {
      // Extract error if present for proper serialization
      const { error, ...rest } = context;
      if (error) {
        this.pino.error({ ...rest, err: error }, message);
      } else {
        this.pino.error(rest, message);
      }
    } else {
      this.pino.error(message);
    }
  }

  /**
   * Log at fatal level (most severe).
   */
  fatal(message: string, context?: LogContext & { error?: Error }): void {
    if (context) {
      const { error, ...rest } = context;
      if (error) {
        this.pino.fatal({ ...rest, err: error }, message);
      } else {
        this.pino.fatal(rest, message);
      }
    } else {
      this.pino.fatal(message);
    }
  }

  /**
   * Get the current log level.
   */
  get level(): LogLevel {
    return this.pino.level as LogLevel;
  }

  /**
   * Set the log level dynamically.
   */
  set level(level: LogLevel) {
    this.pino.level = level;
  }

  /**
   * Check if a log level is enabled.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.pino.isLevelEnabled(level);
  }

  /**
   * Get the underlying pino instance (for advanced use cases).
   */
  get pinoInstance(): PinoLogger {
    return this.pino;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique trace ID for request correlation.
 * Uses UUID v4 format.
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Create a log context with a trace ID.
 * Useful for starting a new traced operation.
 */
export function createTracedContext(additionalContext?: LogContext): LogContext {
  return {
    traceId: generateTraceId(),
    ...additionalContext,
  };
}

// ============================================================================
// Default Logger Instance
// ============================================================================

/**
 * Default logger instance for the agent-router package.
 * Pre-configured with the package name.
 */
export const logger = new Logger({ name: 'agent-router' });

/**
 * Re-export for convenience.
 */
export default logger;
