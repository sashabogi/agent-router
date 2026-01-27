/**
 * Base Provider Implementation
 *
 * Abstract base class that implements common functionality for all LLM providers.
 * Handles authentication headers, error handling, timeout management, and
 * provides the interface that concrete providers must implement.
 */

import {
  ProviderError,
  RateLimitError,
  AuthenticationError,
  TimeoutError,
type 
  Provider,type 
  ProviderConfig,type 
  CompletionRequest,type 
  CompletionResponse,type 
  StreamChunk} from '../types.js';


/**
 * Options for making HTTP requests to provider APIs.
 */
export interface RequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Request URL */
  url: string;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether this is a streaming request */
  stream?: boolean;
}

/**
 * Error response structure from provider APIs.
 */
export interface ProviderErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  message?: string;
}

/**
 * Abstract base class for LLM providers.
 *
 * Provides common functionality including:
 * - Authentication header management
 * - HTTP request helpers with timeout support
 * - Standardized error handling
 * - Response parsing utilities
 *
 * Concrete providers must implement:
 * - complete(): Execute a completion request
 * - completeStream(): Execute a streaming completion request
 * - healthCheck(): Verify provider connectivity
 */
export abstract class BaseProvider implements Provider {
  /** Provider name identifier */
  public abstract readonly name: string;

  /** Provider configuration */
  protected readonly config: ProviderConfig;

  /** Default timeout in milliseconds */
  protected readonly defaultTimeoutMs: number = 60000;

  /**
   * Create a new provider instance.
   *
   * @param config - Provider-specific configuration (API keys, URLs, etc.)
   */
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Execute a completion request and return the full response.
   * Must be implemented by concrete providers.
   *
   * @param request - The completion request
   * @returns Promise resolving to the completion response
   */
  public abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Execute a streaming completion request.
   * Must be implemented by concrete providers.
   *
   * @param request - The completion request
   * @returns Async iterable of stream chunks
   */
  public abstract completeStream(request: CompletionRequest): AsyncIterable<StreamChunk>;

  /**
   * Check if the provider is available and configured correctly.
   * Must be implemented by concrete providers.
   *
   * @throws ProviderError if the health check fails
   */
  public abstract healthCheck(): Promise<void>;

  /**
   * Build common HTTP headers for provider requests.
   * Includes authentication and content-type headers.
   *
   * @returns Headers object for HTTP requests
   */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API key authentication if configured
    if (this.config.api_key) {
      headers['Authorization'] = `Bearer ${this.config.api_key}`;
    }

    // Add any custom headers from config
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  /**
   * Make an HTTP request to the provider API with timeout support.
   *
   * @param options - Request options
   * @returns Promise resolving to the parsed JSON response
   * @throws ProviderError for API errors
   * @throws TimeoutError if the request times out
   */
  protected async makeRequest<T>(options: RequestOptions): Promise<T> {
    const { method, url, headers, body, timeoutMs = this.defaultTimeoutMs } = options;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }
      const response = await fetch(url, fetchOptions);

      // Clear timeout on successful response
      clearTimeout(timeoutId);

      // Handle non-OK responses
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      // Parse and return JSON response
      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      this.handleRequestError(error, timeoutMs);
      // handleRequestError always throws, but TypeScript needs this
      throw error;
    }
  }

  /**
   * Make a streaming HTTP request to the provider API.
   *
   * @param options - Request options
   * @returns Response object for streaming
   * @throws ProviderError for API errors
   * @throws TimeoutError if the connection times out
   */
  protected async makeStreamingRequest(options: RequestOptions): Promise<Response> {
    const { method, url, headers, body, timeoutMs = this.defaultTimeoutMs } = options;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }
      const response = await fetch(url, fetchOptions);

      // Clear timeout once we have a response (streaming will handle its own timing)
      clearTimeout(timeoutId);

      // Handle non-OK responses
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      this.handleRequestError(error, timeoutMs);
      // handleRequestError always throws, but TypeScript needs this
      throw error;
    }
  }

  /**
   * Handle HTTP error responses from provider APIs.
   * Throws appropriate error types based on status code.
   *
   * @param response - The HTTP response object
   * @throws RateLimitError for 429 responses
   * @throws AuthenticationError for 401 responses
   * @throws ProviderError for other error responses
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let retryAfterMs: number | undefined;

    // Try to parse error details from response body
    try {
      const errorBody = (await response.json()) as ProviderErrorResponse;
      if (errorBody.error?.message) {
        errorMessage = errorBody.error.message;
      } else if (errorBody.message) {
        errorMessage = errorBody.message;
      }
    } catch {
      // Ignore JSON parse errors, use default message
    }

    // Check for retry-after header on rate limits
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      retryAfterMs = parseInt(retryAfter, 10) * 1000;
    }

    // Throw appropriate error type based on status
    switch (response.status) {
      case 401:
      case 403:
        throw new AuthenticationError(this.name);

      case 429:
        throw new RateLimitError(this.name, retryAfterMs);

      default:
        throw new ProviderError(errorMessage, this.name, response.status);
    }
  }

  /**
   * Handle request-level errors (network, timeout, etc.).
   *
   * @param error - The caught error
   * @param timeoutMs - The timeout that was configured
   * @throws TimeoutError for abort errors
   * @throws ProviderError for other errors
   */
  protected handleRequestError(error: unknown, timeoutMs: number): never {
    // Check if this is an abort error (timeout)
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new TimeoutError(this.name, timeoutMs);
      }

      // Re-throw if it's already one of our error types
      if (
        error instanceof ProviderError ||
        error instanceof RateLimitError ||
        error instanceof AuthenticationError ||
        error instanceof TimeoutError
      ) {
        throw error;
      }

      // Wrap other errors
      throw new ProviderError(error.message, this.name, undefined, error);
    }

    // Handle non-Error objects
    throw new ProviderError(String(error), this.name);
  }

  /**
   * Get the base URL for API requests.
   * Uses configured base_url or returns the default for the provider.
   *
   * @param defaultUrl - Default URL if not configured
   * @returns The base URL to use for requests
   */
  protected getBaseUrl(defaultUrl: string): string {
    return this.config.base_url || defaultUrl;
  }

  /**
   * Create an AbortController with a timeout.
   * Useful for streaming requests where we need to track the controller.
   *
   * @param timeoutMs - Timeout in milliseconds
   * @returns Object containing the controller and a cleanup function
   */
  protected createTimeoutController(timeoutMs: number): {
    controller: AbortController;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    return {
      controller,
      cleanup: () => { clearTimeout(timeoutId); },
    };
  }
}
