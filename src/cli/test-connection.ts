/**
 * Provider connection testing utilities for AgentRouter v2
 * Tests connectivity to LLM providers
 * 
 * Updated January 2026 to include Anthropic testing.
 */

import * as p from "@clack/prompts";
import color from "picocolors";

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  models?: string[];
}

/**
 * Test Anthropic API connection
 */
export async function testAnthropicConnection(
  apiKey: string,
  baseUrl: string = "https://api.anthropic.com/v1"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    // Anthropic doesn't have a /models endpoint, so we do a minimal completion test
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 401) {
      errorMessage = "Invalid API key - check your Anthropic console";
    } else if (response.status === 403) {
      errorMessage = "API key lacks permission - check your Anthropic console";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "Anthropic server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check Anthropic service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Test OpenAI API connection
 */
export async function testOpenAIConnection(
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 401) {
      errorMessage = "Invalid API key - check your OpenAI dashboard";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "OpenAI server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check OpenAI service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Test Google Gemini API connection
 */
export async function testGeminiConnection(
  apiKey: string,
  baseUrl: string = "https://generativelanguage.googleapis.com/v1beta"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 400 || response.status === 403) {
      errorMessage = "Invalid API key - check your Google AI Studio dashboard";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "Gemini server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check Google AI service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Test DeepSeek API connection
 */
export async function testDeepSeekConnection(
  apiKey: string,
  baseUrl: string = "https://api.deepseek.com"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 401) {
      errorMessage = "Invalid API key - check your DeepSeek dashboard";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "DeepSeek server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check DeepSeek service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Test Z.AI (GLM) API connection
 */
export async function testZaiConnection(
  apiKey: string,
  baseUrl: string = "https://api.z.ai/api/paas/v4"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    // Z.AI uses a simple chat completion test
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-4.7-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 401) {
      errorMessage = "Invalid API key - check your Z.AI dashboard";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "Z.AI server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check Z.AI service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

// Keep old name as alias for backwards compatibility
export const testZhipuConnection = testZaiConnection;

/**
 * Test Kimi Code API connection
 * Uses OpenAI-compatible format with Kimi's coding-specific endpoint
 * Requires User-Agent header identifying as a coding agent
 */
export async function testKimiConnection(
  apiKey: string,
  baseUrl: string = "https://api.kimi.com/coding/v1"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    // Kimi Code uses OpenAI-compatible API, test with a minimal completion
    // Requires User-Agent header to identify as a coding agent
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "claude-code/1.0",
      },
      body: JSON.stringify({
        model: "kimi-for-coding",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs };
    }

    await response.text(); // Consume body
    let errorMessage = `HTTP ${response.status}`;

    if (response.status === 401) {
      errorMessage = "Invalid API key - get your sk-kimi-xxx key from kimi.com membership page";
    } else if (response.status === 429) {
      errorMessage = "Rate limited - quota exceeded";
    } else if (response.status >= 500) {
      errorMessage = "Kimi server error - try again later";
    }

    return { success: false, latencyMs, error: errorMessage };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - server not responding";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - check Kimi service status";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Ollama model info
 */
interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

/**
 * Test Ollama connection and fetch available models
 */
export async function testOllamaConnection(
  baseUrl: string = "http://localhost:11434"
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
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
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        errorMessage = "Connection timeout - is Ollama running?";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused - start Ollama with: ollama serve";
      } else {
        errorMessage = error.message;
      }
    }

    return { success: false, latencyMs, error: errorMessage };
  }
}

/**
 * Display spinner while testing connection
 */
export async function testConnectionWithSpinner(
  providerName: string,
  testFn: () => Promise<ConnectionTestResult>
): Promise<ConnectionTestResult> {
  const spinner = p.spinner();
  spinner.start(`Testing ${providerName} connection...`);

  const result = await testFn();

  if (result.success) {
    spinner.stop(
      color.green(`Connected to ${providerName}`) +
        color.dim(` (${result.latencyMs}ms)`)
    );
  } else {
    spinner.stop(color.red(`Failed to connect to ${providerName}`));
    p.log.error(color.dim(result.error ?? "Unknown error"));
  }

  return result;
}
