/**
 * Provider connection testing utilities
 *
 * Tests connectivity to various LLM providers to validate API keys
 * and verify that services are reachable.
 */

import * as p from "@clack/prompts";
import color from "picocolors";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported LLM provider types for connection testing.
 */
export type ProviderType = "anthropic" | "openai" | "google" | "ollama";

/**
 * Connection test result returned by all test functions.
 */
export interface ConnectionTestResult {
  /** Whether the connection was successful */
  success: boolean;
  /** Time taken for the request in milliseconds */
  latencyMs: number;
  /** Error message if the connection failed */
  error?: string;
  /** List of available models (for Ollama) */
  models?: string[];
}

/**
 * Options for connection testing.
 */
export interface ConnectionTestOptions {
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Base URL override for the provider */
  baseUrl?: string;
}

/**
 * Ollama model info from the /api/tags endpoint.
 */
interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an HTTP error response into a user-friendly message.
 */
function classifyHttpError(status: number, provider: string): string {
  if (status === 401 || status === 403) {
    return "Authentication failed - check your API key";
  }
  if (status === 429) {
    return "Rate limited - try again later";
  }
  if (status >= 500) {
    return `${provider} server error - try again later`;
  }
  return `HTTP ${status}`;
}

/**
 * Classify a network/fetch error into a user-friendly message.
 */
function classifyNetworkError(error: Error): string {
  if (error.name === "AbortError" || error.message.includes("timeout")) {
    return "Server not responding";
  }
  if (error.message.includes("ECONNREFUSED")) {
    return "Connection refused - server unreachable";
  }
  if (error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo")) {
    return "Invalid URL or server unreachable";
  }
  if (error.message.includes("certificate") || error.message.includes("SSL")) {
    return "SSL/TLS certificate error";
  }
  return error.message;
}

// ============================================================================
// Provider-Specific Test Functions
// ============================================================================

/**
 * Test Anthropic API connection.
 *
 * Uses a minimal messages API call with max_tokens: 1 to verify credentials.
 */
export async function testAnthropicConnection(
  apiKey: string,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const { timeoutMs = 10000, baseUrl = "https://api.anthropic.com" } = options;
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    // Consume body to prevent connection leak
    await response.text();
    const error = classifyHttpError(response.status, "Anthropic");

    return { success: false, latencyMs, error };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const error = err instanceof Error ? classifyNetworkError(err) : "Unknown error";

    return { success: false, latencyMs, error };
  }
}

/**
 * Test OpenAI API connection.
 *
 * Uses a minimal chat completions API call with max_tokens: 1 to verify credentials.
 */
export async function testOpenAIConnection(
  apiKey: string,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const { timeoutMs = 10000, baseUrl = "https://api.openai.com" } = options;
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    // Consume body to prevent connection leak
    await response.text();
    const error = classifyHttpError(response.status, "OpenAI");

    return { success: false, latencyMs, error };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const error = err instanceof Error ? classifyNetworkError(err) : "Unknown error";

    return { success: false, latencyMs, error };
  }
}

/**
 * Test Google Gemini API connection.
 *
 * Uses the generateContent endpoint with minimal tokens to verify credentials.
 */
export async function testGeminiConnection(
  apiKey: string,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const {
    timeoutMs = 10000,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  } = options;
  const startTime = Date.now();

  try {
    const model = "gemini-1.5-flash";
    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hi" }] }],
          generationConfig: {
            maxOutputTokens: 1,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    // Consume body to prevent connection leak
    await response.text();

    // Gemini uses 400 for invalid API keys
    let error: string;
    if (response.status === 400 || response.status === 403) {
      error = "Authentication failed - check your API key";
    } else {
      error = classifyHttpError(response.status, "Gemini");
    }

    return { success: false, latencyMs, error };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const error = err instanceof Error ? classifyNetworkError(err) : "Unknown error";

    return { success: false, latencyMs, error };
  }
}

/**
 * Test Ollama connection.
 *
 * Uses the /api/tags endpoint to check if the server is running.
 * This doesn't require any API key since Ollama runs locally.
 */
export async function testOllamaConnection(
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const { timeoutMs = 10000, baseUrl = "http://localhost:11434" } = options;
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = (await response.json()) as { models?: OllamaModelInfo[] };
      const models = data.models?.map((m) => m.name) ?? [];

      return { success: true, latencyMs, models };
    }

    return {
      success: false,
      latencyMs,
      error: `HTTP ${response.status} - Ollama API error`,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    let error: string;

    if (err instanceof Error) {
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        error = "Connection timeout - is Ollama running?";
      } else if (err.message.includes("ECONNREFUSED")) {
        error = "Connection refused - start Ollama with: ollama serve";
      } else {
        error = classifyNetworkError(err);
      }
    } else {
      error = "Unknown error";
    }

    return { success: false, latencyMs, error };
  }
}

// ============================================================================
// Generic Test Function
// ============================================================================

/**
 * Test a provider connection by type.
 *
 * This is a convenience function that dispatches to the appropriate
 * provider-specific test function.
 *
 * @param provider - The provider type to test
 * @param apiKey - The API key (not required for Ollama)
 * @param options - Optional configuration
 */
export async function testProviderConnection(
  provider: ProviderType,
  apiKey?: string,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  switch (provider) {
    case "anthropic":
      if (!apiKey) {
        return {
          success: false,
          latencyMs: 0,
          error: "API key required for Anthropic",
        };
      }
      return testAnthropicConnection(apiKey, options);

    case "openai":
      if (!apiKey) {
        return {
          success: false,
          latencyMs: 0,
          error: "API key required for OpenAI",
        };
      }
      return testOpenAIConnection(apiKey, options);

    case "google":
      if (!apiKey) {
        return {
          success: false,
          latencyMs: 0,
          error: "API key required for Gemini",
        };
      }
      return testGeminiConnection(apiKey, options);

    case "ollama":
      return testOllamaConnection(options);

    default: {
      const _exhaustive: never = provider;
      return {
        success: false,
        latencyMs: 0,
        error: `Unknown provider type: ${_exhaustive}`,
      };
    }
  }
}

// ============================================================================
// Interactive Testing with Spinner
// ============================================================================

/**
 * Test a provider connection with an interactive spinner.
 *
 * Shows a spinner while testing, then displays success with latency
 * or failure with error message.
 *
 * @param provider - Human-readable provider name for display
 * @param apiKey - The API key (optional for Ollama)
 * @param providerType - The provider type for testing
 * @param options - Optional configuration
 */
export async function testConnectionWithSpinner(
  provider: string,
  apiKey: string | undefined,
  providerType: ProviderType,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const spinner = p.spinner();
  spinner.start(`Testing ${provider} connection...`);

  const result = await testProviderConnection(providerType, apiKey, options);

  if (result.success) {
    spinner.stop(
      color.green(`Connected to ${provider}`) + color.dim(` (${result.latencyMs}ms)`)
    );

    // Show available models for Ollama
    if (result.models && result.models.length > 0) {
      p.log.info(`Available models: ${result.models.join(", ")}`);
    }
  } else {
    spinner.stop(color.red(`Failed to connect to ${provider}`));
    p.log.error(color.dim(result.error ?? "Unknown error"));
  }

  return result;
}

/**
 * Test multiple providers with interactive spinners.
 *
 * Tests each provider in sequence and returns all results.
 *
 * @param providers - Array of providers to test
 */
export async function testAllConnections(
  providers: Array<{
    name: string;
    type: ProviderType;
    apiKey?: string;
    baseUrl?: string;
  }>
): Promise<Map<string, ConnectionTestResult>> {
  const results = new Map<string, ConnectionTestResult>();

  for (const provider of providers) {
    const options: ConnectionTestOptions = {};
    if (provider.baseUrl !== undefined) {
      options.baseUrl = provider.baseUrl;
    }
    const result = await testConnectionWithSpinner(
      provider.name,
      provider.apiKey,
      provider.type,
      options
    );
    results.set(provider.name, result);
  }

  return results;
}
