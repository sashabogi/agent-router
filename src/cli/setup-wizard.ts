/**
 * Interactive Setup Wizard for AgentRouter
 *
 * Provides a beautiful CLI experience for configuring providers, roles,
 * and default settings for multi-agent orchestration.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "yaml";

import type { Config, RoleConfig, ProviderConfig } from "../types.js";
import { getUserConfigDir, getUserConfigPath } from "../config/defaults.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Environment variable names for each provider type.
 */
const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  ollama: "", // No API key required
};

/**
 * API key documentation URLs for each provider.
 */
const PROVIDER_DOCS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  ollama: "https://ollama.ai/download",
};

/**
 * Track which environment variables were configured during setup.
 */
const configuredEnvVars: Map<string, string> = new Map();

// ============================================================================
// Types
// ============================================================================

/**
 * Provider option for selection.
 */
interface ProviderOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Model option for selection.
 */
interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Agent role definition with recommendations.
 */
interface AgentRoleDefinition {
  value: string;
  label: string;
  hint: string;
  recommendedProvider: string;
  recommendedModel: string;
}

// ============================================================================
// Data Definitions
// ============================================================================

/**
 * Available providers for configuration.
 */
const AVAILABLE_PROVIDERS: ProviderOption[] = [
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "Claude models - best for coding",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "GPT-4o and o1 reasoning models",
  },
  {
    value: "google",
    label: "Google Gemini",
    hint: "Gemini 2.5 Pro/Flash",
  },
  {
    value: "ollama",
    label: "Ollama",
    hint: "Local models - privacy focused",
  },
];

/**
 * Available models per provider.
 */
const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  anthropic: [
    { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", hint: "Most capable" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", hint: "Fast and smart" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", hint: "Fastest, cheapest" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o", hint: "Flagship model" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast and affordable" },
    { value: "o1", label: "o1", hint: "Advanced reasoning" },
    { value: "o1-mini", label: "o1 Mini", hint: "Efficient reasoning" },
  ],
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Best quality" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Faster, multimodal" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "Long context" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "Fast and cheap" },
  ],
  ollama: [
    { value: "llama3.2", label: "Llama 3.2", hint: "Meta's latest" },
    { value: "qwen3:32b", label: "Qwen 3 32B", hint: "Strong reasoning" },
    { value: "codellama", label: "Code Llama", hint: "Optimized for code" },
    { value: "mistral", label: "Mistral", hint: "Fast and capable" },
  ],
};

/**
 * Default agent roles with recommendations.
 */
const AGENT_ROLES: AgentRoleDefinition[] = [
  {
    value: "coder",
    label: "Coder",
    hint: "Code generation and implementation",
    recommendedProvider: "anthropic",
    recommendedModel: "claude-sonnet-4-20250514",
  },
  {
    value: "critic",
    label: "Critic",
    hint: "Plan review and risk identification",
    recommendedProvider: "openai",
    recommendedModel: "gpt-4o",
  },
  {
    value: "designer",
    label: "Designer",
    hint: "UI/UX feedback and visual design",
    recommendedProvider: "google",
    recommendedModel: "gemini-2.5-pro",
  },
  {
    value: "researcher",
    label: "Researcher",
    hint: "Fact-finding and information gathering",
    recommendedProvider: "google",
    recommendedModel: "gemini-2.5-pro",
  },
  {
    value: "reviewer",
    label: "Reviewer",
    hint: "Code review and security analysis",
    recommendedProvider: "openai",
    recommendedModel: "gpt-4o",
  },
];

/**
 * Default system prompts for each role.
 */
const DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
  coder: `You are an expert software engineer. Write clean, efficient, well-documented code.
Follow best practices, use appropriate design patterns, and consider edge cases.
Provide explanations for complex logic.`,

  critic: `You are a skeptical senior architect and technical reviewer. Your job is to:

1. **Challenge Assumptions**: Don't accept claims at face value. Ask "Why?" and "What if?"
2. **Identify Risks**: Find failure modes, edge cases, and potential issues
3. **Question Scope**: Is the solution over-engineered? Under-specified?
4. **Check Completeness**: What's missing? What hasn't been considered?
5. **Push for Excellence**: "Good enough" isn't good enough. Find ways to improve.

Be constructive but rigorous. Your goal is to make plans better, not to tear them down.
Provide specific, actionable feedback.`,

  designer: `You are a senior UI/UX designer and frontend architect. Focus on:

1. **User Experience**: Is it intuitive? Accessible? Delightful?
2. **Visual Hierarchy**: Does the layout guide the user's eye?
3. **Component Architecture**: Are components reusable? Maintainable?
4. **Design Systems**: Does it follow established patterns?
5. **Responsive Design**: How does it work across devices?
6. **Accessibility**: WCAG compliance, keyboard navigation, screen readers

Provide specific feedback with examples and alternatives where applicable.`,

  researcher: `You are a research analyst. Provide well-researched, factual information.
When possible, cite sources or indicate confidence levels.
If you're uncertain, say so. Prefer accuracy over completeness.`,

  reviewer: `You are a senior code reviewer. Review code for:

1. **Correctness**: Does it work? Are there bugs?
2. **Security**: SQL injection, XSS, auth issues, data exposure
3. **Performance**: N+1 queries, unnecessary computations, memory leaks
4. **Maintainability**: Is it readable? Well-structured? Documented?
5. **Best Practices**: Follows language/framework conventions?
6. **Testing**: Is it testable? Are there missing tests?

Be specific. Reference line numbers. Suggest improvements with code examples.`,
};

// ============================================================================
// UI Components
// ============================================================================

/**
 * Display the wizard intro banner.
 */
function displayBanner(): void {
  console.log();
  console.log(color.cyan("╭─────────────────────────────────────────────────╮"));
  console.log(color.cyan("│                                                 │"));
  console.log(
    color.cyan("│   ") +
      color.bold(color.yellow("🔀")) +
      color.bold(" AgentRouter Setup") +
      color.cyan("                         │")
  );
  console.log(color.cyan("│                                                 │"));
  console.log(
    color.cyan("│   ") +
      color.dim("Multi-agent LLM orchestration for Claude Code") +
      color.cyan("  │")
  );
  console.log(color.cyan("│                                                 │"));
  console.log(color.cyan("╰─────────────────────────────────────────────────╯"));
  console.log();
}

/**
 * Validate API key format.
 */
function validateApiKey(value: string, provider: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "API key is required";
  }

  // Basic length check - most API keys are at least 20 chars
  if (value.length < 10) {
    return "API key seems too short";
  }

  // Provider-specific validation
  if (provider === "anthropic" && !value.startsWith("sk-ant-")) {
    return "Anthropic API keys typically start with 'sk-ant-'";
  }

  if (provider === "openai" && !value.startsWith("sk-")) {
    return "OpenAI API keys typically start with 'sk-'";
  }

  return undefined;
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test Anthropic API connection.
 */
async function testAnthropicConnection(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (response.ok) {
      return { success: true };
    }

    const data = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      error: data.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Test OpenAI API connection.
 */
async function testOpenAIConnection(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true };
    }

    const data = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      error: data.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Test Gemini API connection.
 */
async function testGeminiConnection(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: "GET" }
    );

    if (response.ok) {
      return { success: true };
    }

    const data = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      error: data.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Test Ollama connection.
 */
async function testOllamaConnection(
  baseUrl: string
): Promise<{ success: boolean; error?: string; models?: string[] }> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { method: "GET" });

    if (response.ok) {
      const data = (await response.json()) as { models?: { name: string }[] };
      const models = data.models?.map((m) => m.name) ?? [];
      return { success: true, models };
    }

    return {
      success: false,
      error: `HTTP ${response.status}`,
    };
  } catch {
    return {
      success: false,
      error: "Ollama server not running. Start with: ollama serve",
    };
  }
}

/**
 * Test connection with a spinner.
 */
async function testConnectionWithSpinner<T>(
  providerName: string,
  testFn: () => Promise<T>
): Promise<T> {
  const spinner = p.spinner();
  spinner.start(`Testing ${providerName} connection...`);

  try {
    const result = await testFn();
    const resultObj = result as { success: boolean };
    if (resultObj.success) {
      spinner.stop(`${providerName} connection successful`);
    } else {
      spinner.stop(`${providerName} connection failed`);
    }
    return result;
  } catch (error) {
    spinner.stop(`${providerName} connection failed`);
    throw error;
  }
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Configure Anthropic provider.
 */
async function configureAnthropic(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Anthropic Configuration"));

  p.note(
    "Get your API key from the Anthropic Console:\n" +
      color.cyan(PROVIDER_DOCS["anthropic"] ?? ""),
    "Anthropic Setup"
  );

  while (true) {
    const apiKey = await p.password({
      message: "Enter your Anthropic API key:",
      validate: (v) => validateApiKey(v, "anthropic"),
    });

    if (p.isCancel(apiKey)) return null;

    const result = await testConnectionWithSpinner("Anthropic", () =>
      testAnthropicConnection(apiKey)
    );

    if (result.success) {
      const envVarName = PROVIDER_ENV_VARS["anthropic"] ?? "ANTHROPIC_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.anthropic.com",
      };
    }

    const action = await p.select({
      message: `Connection failed: ${result.error}. What would you like to do?`,
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["anthropic"] ?? "ANTHROPIC_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.anthropic.com",
      };
    }
  }
}

/**
 * Configure OpenAI provider.
 */
async function configureOpenAI(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("OpenAI Configuration"));

  p.note(
    "Get your API key from the OpenAI Dashboard:\n" + color.cyan(PROVIDER_DOCS["openai"] ?? ""),
    "OpenAI Setup"
  );

  while (true) {
    const apiKey = await p.password({
      message: "Enter your OpenAI API key:",
      validate: (v) => validateApiKey(v, "openai"),
    });

    if (p.isCancel(apiKey)) return null;

    const result = await testConnectionWithSpinner("OpenAI", () =>
      testOpenAIConnection(apiKey)
    );

    if (result.success) {
      const envVarName = PROVIDER_ENV_VARS["openai"] ?? "OPENAI_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
      };
    }

    const action = await p.select({
      message: `Connection failed: ${result.error}. What would you like to do?`,
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["openai"] ?? "OPENAI_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
      };
    }
  }
}

/**
 * Configure Google Gemini provider.
 */
async function configureGemini(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Google Gemini Configuration"));

  p.note(
    "Get your API key from Google AI Studio:\n" + color.cyan(PROVIDER_DOCS["google"] ?? ""),
    "Gemini Setup"
  );

  while (true) {
    const apiKey = await p.password({
      message: "Enter your Google Gemini API key:",
      validate: (v) => validateApiKey(v, "google"),
    });

    if (p.isCancel(apiKey)) return null;

    const result = await testConnectionWithSpinner("Gemini", () =>
      testGeminiConnection(apiKey)
    );

    if (result.success) {
      const envVarName = PROVIDER_ENV_VARS["google"] ?? "GEMINI_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
      };
    }

    const action = await p.select({
      message: `Connection failed: ${result.error}. What would you like to do?`,
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["google"] ?? "GEMINI_API_KEY";
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
      };
    }
  }
}

/**
 * Configure Ollama provider.
 */
async function configureOllama(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Ollama Configuration"));

  while (true) {
    const baseUrl = await p.text({
      message: "Enter Ollama base URL:",
      placeholder: "http://localhost:11434",
      initialValue: "http://localhost:11434",
      validate: (v) => {
        try {
          new URL(v);
          return undefined;
        } catch {
          return "Invalid URL format";
        }
      },
    });

    if (p.isCancel(baseUrl)) return null;

    const result = await testConnectionWithSpinner("Ollama", () =>
      testOllamaConnection(baseUrl)
    );

    if (result.success) {
      if (result.models && result.models.length > 0) {
        p.log.success(`Found ${result.models.length} installed model(s): ${result.models.slice(0, 3).join(", ")}${result.models.length > 3 ? "..." : ""}`);
      } else {
        p.log.warn("No models found. Pull a model with: ollama pull llama3.2");
      }

      return {
        base_url: baseUrl,
      };
    }

    p.note(
      "Make sure Ollama is running:\n" +
        color.cyan("  ollama serve") +
        "\n\nOr install from:\n" +
        color.cyan("  " + (PROVIDER_DOCS["ollama"] ?? "")),
      "Ollama Not Running"
    );

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter URL", hint: "Try a different URL" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Configure later when Ollama is running" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      return {
        base_url: baseUrl,
      };
    }
  }
}

// ============================================================================
// Role Configuration
// ============================================================================

/**
 * Get available models for a provider.
 */
function getProviderModels(providerName: string): ModelOption[] {
  return PROVIDER_MODELS[providerName] ?? [{ value: "default", label: "Default model" }];
}

/**
 * Configure role assignments.
 */
async function configureRoles(
  configuredProviders: string[]
): Promise<Record<string, RoleConfig>> {
  p.log.step(color.bold("Role Configuration"));

  const setupType = await p.select({
    message: "How would you like to configure agent roles?",
    options: [
      {
        value: "quick",
        label: "Quick setup",
        hint: "Use recommended providers for each role",
      },
      {
        value: "custom",
        label: "Custom",
        hint: "Choose provider and model for each role",
      },
    ],
  });

  if (p.isCancel(setupType)) {
    return generateDefaultRoles(configuredProviders);
  }

  const roles: Record<string, RoleConfig> = {};

  if (setupType === "quick") {
    // Quick setup: use defaults, falling back to first available provider
    const roleConfigs: Array<{ role: string; provider: string; model: string }> = [];

    for (const role of AGENT_ROLES) {
      let provider = role.recommendedProvider;
      let model = role.recommendedModel;

      // If recommended provider is not configured, use first available
      if (!configuredProviders.includes(provider)) {
        provider = configuredProviders[0] ?? "anthropic";
        const models = getProviderModels(provider);
        model = models[0]?.value ?? "default";
      }

      const systemPrompt = DEFAULT_SYSTEM_PROMPTS[role.value] ?? "";
      const roleConfig: RoleConfig = {
        provider,
        model,
        system_prompt: systemPrompt,
      };
      if (role.value === "critic" || role.value === "reviewer") {
        roleConfig.temperature = 0.3;
      }
      roles[role.value] = roleConfig;

      roleConfigs.push({ role: role.label, provider, model });
    }

    // Display summary
    displayRoleSummary(roleConfigs);
    p.log.success(`Configured ${Object.keys(roles).length} roles with recommended settings`);

    return roles;
  }

  // Custom setup: let user configure each role
  p.log.message(color.dim("Configure each role or press Enter to use defaults."));

  for (const role of AGENT_ROLES) {
    console.log();
    p.log.step(color.cyan(`Configuring: ${role.label}`));
    console.log(color.dim(`  ${role.hint}`));

    // Build provider options - filter out undefined hints for TypeScript
    const providerOptions: Array<{ value: string; label: string; hint?: string }> =
      configuredProviders.map((prov) => {
        const isRecommended = prov === role.recommendedProvider;
        const opt: { value: string; label: string; hint?: string } = {
          value: prov,
          label: prov,
        };
        if (isRecommended) {
          opt.hint = "Recommended";
        }
        return opt;
      });

    const selectedProvider = await p.select({
      message: `Provider for ${role.label}:`,
      options: providerOptions,
      initialValue: configuredProviders.includes(role.recommendedProvider)
        ? role.recommendedProvider
        : configuredProviders[0],
    });

    if (p.isCancel(selectedProvider)) {
      // Use default for remaining roles
      const defaultProv = configuredProviders[0] ?? "anthropic";
      roles[role.value] = {
        provider: defaultProv,
        model: getProviderModels(defaultProv)[0]?.value ?? "default",
        system_prompt: DEFAULT_SYSTEM_PROMPTS[role.value] ?? "",
      };
      continue;
    }

    // Select model for this provider
    const modelOptions = getProviderModels(selectedProvider as string);
    const selectedModel = await p.select({
      message: "Select model:",
      options: modelOptions,
    });

    if (p.isCancel(selectedModel)) {
      roles[role.value] = {
        provider: selectedProvider as string,
        model: modelOptions[0]?.value ?? "default",
        system_prompt: DEFAULT_SYSTEM_PROMPTS[role.value] ?? "",
      };
      continue;
    }

    const customRoleConfig: RoleConfig = {
      provider: selectedProvider as string,
      model: selectedModel as string,
      system_prompt: DEFAULT_SYSTEM_PROMPTS[role.value] ?? "",
    };
    if (role.value === "critic" || role.value === "reviewer") {
      customRoleConfig.temperature = 0.3;
    }
    roles[role.value] = customRoleConfig;

    console.log(
      color.green(`  ✓ ${role.label}: ${selectedProvider} → ${selectedModel}`)
    );
  }

  return roles;
}

/**
 * Generate default roles using available providers.
 */
function generateDefaultRoles(configuredProviders: string[]): Record<string, RoleConfig> {
  const roles: Record<string, RoleConfig> = {};
  const defaultProvider = configuredProviders[0] ?? "anthropic";
  const defaultModel = getProviderModels(defaultProvider)[0]?.value ?? "default";

  for (const role of AGENT_ROLES) {
    let provider = role.recommendedProvider;
    let model = role.recommendedModel;

    if (!configuredProviders.includes(provider)) {
      provider = defaultProvider;
      model = defaultModel;
    }

    const defaultRoleConfig: RoleConfig = {
      provider,
      model,
      system_prompt: DEFAULT_SYSTEM_PROMPTS[role.value] ?? "",
    };
    if (role.value === "critic" || role.value === "reviewer") {
      defaultRoleConfig.temperature = 0.3;
    }
    roles[role.value] = defaultRoleConfig;
  }

  return roles;
}

/**
 * Display role configuration summary.
 */
function displayRoleSummary(
  roleConfigs: Array<{ role: string; provider: string; model: string }>
): void {
  console.log();
  console.log(color.bold("  Role Configuration Summary"));
  console.log();

  const roleWidth = Math.max(12, ...roleConfigs.map((rc) => rc.role.length));
  const providerWidth = Math.max(10, ...roleConfigs.map((rc) => rc.provider.length));

  // Header
  const headerLine = `  ${"Role".padEnd(roleWidth)} ${"Provider".padEnd(providerWidth)} ${"Model"}`;
  console.log(color.dim(headerLine));
  console.log(color.dim("  " + "-".repeat(headerLine.length - 2)));

  // Rows
  for (const { role, provider, model } of roleConfigs) {
    const roleCol = color.cyan(role.padEnd(roleWidth));
    const providerCol = provider.padEnd(providerWidth);
    const modelCol = color.dim(model);
    console.log(`  ${roleCol} ${providerCol} ${modelCol}`);
  }

  console.log();
}

// ============================================================================
// Environment Variable Handling
// ============================================================================

/**
 * Get the appropriate shell profile path.
 */
function getShellProfilePath(): string {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }
  return path.join(os.homedir(), ".bashrc");
}

/**
 * Add environment variables to shell profile.
 */
async function addEnvVarsToShellProfile(): Promise<void> {
  if (configuredEnvVars.size === 0) {
    return;
  }

  const profilePath = getShellProfilePath();
  const profileName = path.basename(profilePath);

  const shouldAdd = await p.confirm({
    message: `Add API keys to ~/${profileName}?`,
    initialValue: true,
  });

  if (p.isCancel(shouldAdd) || !shouldAdd) {
    p.log.info("You'll need to set environment variables manually.");
    displayEnvVarsManual();
    return;
  }

  try {
    let profileContent = "";
    if (fs.existsSync(profilePath)) {
      profileContent = fs.readFileSync(profilePath, "utf-8");
    }

    const envVarsToAdd: Array<{ name: string; value: string }> = [];

    for (const [envVar, value] of configuredEnvVars) {
      const existsPattern = new RegExp(`^\\s*export\\s+${envVar}=`, "m");
      if (!existsPattern.test(profileContent)) {
        envVarsToAdd.push({ name: envVar, value });
      }
    }

    if (envVarsToAdd.length === 0) {
      p.log.info(`All environment variables already exist in ~/${profileName}`);
      return;
    }

    // Build export block
    const exportLines: string[] = [];
    exportLines.push("");
    exportLines.push("# AgentRouter API Keys");
    for (const { name, value } of envVarsToAdd) {
      exportLines.push(`export ${name}="${value}"`);
    }
    const exportBlock = exportLines.join("\n");

    // Append to profile
    fs.appendFileSync(profilePath, exportBlock + "\n", "utf-8");

    p.log.success(`Added ${envVarsToAdd.length} environment variable(s) to ~/${profileName}`);
    p.log.info(
      `Run ${color.cyan(`source ~/${profileName}`)} to apply changes (or restart your terminal)`
    );
  } catch (error) {
    p.log.error(
      `Failed to update ${profilePath}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    displayEnvVarsManual();
  }
}

/**
 * Display manual environment variable setup instructions.
 */
function displayEnvVarsManual(): void {
  if (configuredEnvVars.size === 0) return;

  const lines: string[] = [];
  lines.push(color.bold("Set these environment variables:"));
  lines.push("");

  for (const [envVar] of configuredEnvVars) {
    lines.push(`  ${color.cyan(`export ${envVar}="your-api-key-here"`)}`);
  }

  p.note(lines.join("\n"), "Required Environment Variables");
}

// ============================================================================
// Configuration Generation
// ============================================================================

/**
 * Generate the full configuration object.
 */
function generateConfig(
  providers: Record<string, ProviderConfig>,
  roles: Record<string, RoleConfig>
): Config {
  return {
    version: "1.0",
    defaults: {
      temperature: 0.7,
      max_tokens: 4096,
      timeout_ms: 60000,
    },
    roles,
    providers,
  };
}

/**
 * Generate configuration summary.
 */
function generateConfigSummary(config: Config, configPath: string): string {
  const lines: string[] = [];

  lines.push(`  ${color.bold("Version:")} ${config.version}`);
  lines.push("");

  // Providers summary
  const providerCount = Object.keys(config.providers).length;
  lines.push(`  ${color.bold(`Providers (${providerCount}):`)} `);
  for (const [name] of Object.entries(config.providers)) {
    lines.push(`    ${color.green("✓")} ${name}`);
  }
  lines.push("");

  // Roles summary
  const roleCount = Object.keys(config.roles).length;
  lines.push(`  ${color.bold(`Roles (${roleCount}):`)}`);
  for (const [name, role] of Object.entries(config.roles)) {
    lines.push(`    ${color.cyan(name)} ${color.dim("→")} ${role.provider}/${role.model}`);
  }
  lines.push("");

  // Config path
  lines.push(`  ${color.bold("Config:")} ${color.dim(configPath)}`);

  return lines.join("\n");
}

/**
 * Save configuration to file.
 */
async function saveConfig(config: Config): Promise<boolean> {
  const configPath = getUserConfigPath();
  const configDir = getUserConfigDir();

  try {
    // Create directory if needed
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Backup existing config
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup.${Date.now()}`;
      fs.copyFileSync(configPath, backupPath);
      p.log.info(`Backed up existing config to: ${color.dim(backupPath)}`);
    }

    // Add header comment
    const header = `# AgentRouter Configuration
# Generated by: agent-router setup
# Documentation: https://github.com/hive-dev/agent-router
#
# Environment variables can be interpolated using \${VAR_NAME} syntax.

`;

    // Write new config
    const yamlContent = yaml.stringify(config, {
      indent: 2,
      lineWidth: 100,
    });

    fs.writeFileSync(configPath, header + yamlContent, "utf-8");
    return true;
  } catch (error) {
    p.log.error(
      `Failed to save config: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return false;
  }
}

// ============================================================================
// Main Setup Wizard
// ============================================================================

/**
 * Run the main setup wizard.
 */
export async function runSetupWizard(): Promise<void> {
  displayBanner();

  p.intro(color.bgCyan(color.black(" Welcome to AgentRouter ")));

  // Provider selection
  p.log.message(
    color.dim("Use ↑↓ to navigate, space to select, enter to confirm.")
  );

  // Build multiselect options - filter out undefined hints for TypeScript
  const providerSelectOptions: Array<{ value: string; label: string; hint?: string }> =
    AVAILABLE_PROVIDERS.map((provider) => {
      const opt: { value: string; label: string; hint?: string } = {
        value: provider.value,
        label: provider.label,
      };
      if (provider.hint) {
        opt.hint = provider.hint;
      }
      return opt;
    });

  const selectedProviders = await p.multiselect({
    message: "Which providers would you like to configure?",
    options: providerSelectOptions,
    required: true,
  });

  if (p.isCancel(selectedProviders)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const providers: Record<string, ProviderConfig> = {};
  const configuredProviderNames: string[] = [];

  // Configure each selected provider
  for (const providerType of selectedProviders as string[]) {
    let config: ProviderConfig | null = null;

    switch (providerType) {
      case "anthropic":
        config = await configureAnthropic();
        break;
      case "openai":
        config = await configureOpenAI();
        break;
      case "google":
        config = await configureGemini();
        break;
      case "ollama":
        config = await configureOllama();
        break;
    }

    if (config) {
      providers[providerType] = config;
      configuredProviderNames.push(providerType);
      p.log.success(`Configured ${color.cyan(providerType)} provider`);
    }
  }

  if (configuredProviderNames.length === 0) {
    p.cancel("No providers configured. Please run setup again.");
    process.exit(1);
  }

  // Configure roles
  const roles = await configureRoles(configuredProviderNames);

  // Generate config
  const config = generateConfig(providers, roles);
  const configPath = getUserConfigPath();

  // Preview config
  console.log();
  p.note(generateConfigSummary(config, configPath), "Configuration Summary");

  // Confirm save
  const saveConfirm = await p.confirm({
    message: `Save configuration to ${color.cyan(configPath)}?`,
    initialValue: true,
  });

  if (p.isCancel(saveConfirm) || !saveConfirm) {
    // Offer to print YAML
    const printYaml = await p.confirm({
      message: "Print YAML configuration to console instead?",
      initialValue: true,
    });

    if (!p.isCancel(printYaml) && printYaml) {
      console.log("\n" + yaml.stringify(config, { indent: 2 }));
    }

    p.outro(color.yellow("Configuration not saved"));
    return;
  }

  // Save config
  const saved = await saveConfig(config);

  if (!saved) {
    p.outro(color.red("Failed to save configuration"));
    return;
  }

  // Handle environment variables
  console.log();
  await addEnvVarsToShellProfile();

  // Final instructions
  console.log();
  const shellProfile = getShellProfilePath();
  p.note(
    `${color.bold("1. Restart your terminal or run:")}\n` +
      `  ${color.cyan(`source ${shellProfile}`)}\n\n` +
      `${color.bold("2. Start the MCP server:")}\n` +
      `  ${color.cyan("agent-router start")}\n\n` +
      `${color.bold("3. Use with Claude Code:")}\n` +
      `  Add agent-router to your MCP config`,
    "Next Steps"
  );

  // Clear env vars tracking
  configuredEnvVars.clear();

  p.outro(color.green("Setup complete!"));
}

/**
 * Clear configured env vars (for testing).
 */
export function clearConfiguredEnvVars(): void {
  configuredEnvVars.clear();
}

// ============================================================================
// Stub Exports for CLI Compatibility
// ============================================================================

/**
 * Add a provider interactively.
 * This is a stub that redirects to the full setup wizard.
 */
export async function addProvider(_providerName?: string): Promise<void> {
  p.log.warn("The 'provider add' command is deprecated.");
  p.log.info("Please use 'agent-router setup' to configure providers interactively.");
  process.exit(0);
}

/**
 * Test provider connections.
 * This is a stub that provides basic connection testing.
 */
export async function testProvider(providerName?: string): Promise<void> {
  displayBanner();
  p.intro(color.bgCyan(color.black(" AgentRouter Provider Test ")));

  // Load existing config
  const configPath = getUserConfigPath();
  if (!fs.existsSync(configPath)) {
    p.log.error("No configuration found. Run 'agent-router setup' first.");
    process.exit(1);
  }

  const configContent = fs.readFileSync(configPath, "utf-8");
  const config = yaml.parse(configContent) as Config;

  const providersToTest = providerName
    ? [providerName]
    : Object.keys(config.providers);

  if (providerName && !config.providers[providerName]) {
    p.log.error(`Provider '${providerName}' not found in configuration.`);
    p.log.info(`Configured providers: ${Object.keys(config.providers).join(", ")}`);
    process.exit(1);
  }

  let allPassed = true;

  for (const name of providersToTest) {
    const providerConfig = config.providers[name];
    if (!providerConfig) continue;

    const spinner = p.spinner();
    spinner.start(`Testing ${name}...`);

    try {
      let result: { success: boolean; error?: string };

      switch (name) {
        case "anthropic": {
          const apiKey = providerConfig.api_key?.includes("${")
            ? process.env[providerConfig.api_key.replace(/\$\{|\}/g, "")] ?? ""
            : providerConfig.api_key ?? "";
          result = await testAnthropicConnection(apiKey);
          break;
        }
        case "openai": {
          const apiKey = providerConfig.api_key?.includes("${")
            ? process.env[providerConfig.api_key.replace(/\$\{|\}/g, "")] ?? ""
            : providerConfig.api_key ?? "";
          result = await testOpenAIConnection(apiKey);
          break;
        }
        case "google": {
          const apiKey = providerConfig.api_key?.includes("${")
            ? process.env[providerConfig.api_key.replace(/\$\{|\}/g, "")] ?? ""
            : providerConfig.api_key ?? "";
          result = await testGeminiConnection(apiKey);
          break;
        }
        case "ollama": {
          const baseUrl = providerConfig.base_url ?? "http://localhost:11434";
          result = await testOllamaConnection(baseUrl);
          break;
        }
        default:
          result = { success: false, error: "Unknown provider" };
      }

      if (result.success) {
        spinner.stop(color.green(`${name}: Connection successful`));
      } else {
        spinner.stop(color.red(`${name}: ${result.error}`));
        allPassed = false;
      }
    } catch (error) {
      spinner.stop(color.red(`${name}: ${error instanceof Error ? error.message : "Unknown error"}`));
      allPassed = false;
    }
  }

  if (allPassed) {
    p.outro(color.green("All providers passed connection test"));
  } else {
    p.outro(color.yellow("Some providers failed connection test"));
    process.exit(1);
  }
}

/**
 * List configured providers.
 */
export async function listProviders(): Promise<void> {
  displayBanner();
  p.intro(color.bgCyan(color.black(" AgentRouter Providers ")));

  const configPath = getUserConfigPath();
  if (!fs.existsSync(configPath)) {
    p.log.error("No configuration found. Run 'agent-router setup' first.");
    process.exit(1);
  }

  const configContent = fs.readFileSync(configPath, "utf-8");
  const config = yaml.parse(configContent) as Config;

  const providers = Object.entries(config.providers);

  if (providers.length === 0) {
    p.log.warn("No providers configured.");
    process.exit(0);
  }

  console.log();
  console.log(color.bold("  Configured Providers"));
  console.log();

  for (const [name, providerConfig] of providers) {
    console.log(`  ${color.cyan(name)}`);

    if (providerConfig.base_url) {
      console.log(`    Base URL: ${color.dim(providerConfig.base_url)}`);
    }

    if (providerConfig.api_key) {
      if (providerConfig.api_key.includes("${")) {
        const envVar = providerConfig.api_key.replace(/\$\{|\}/g, "");
        const isSet = !!process.env[envVar];
        console.log(
          `    API Key: ${providerConfig.api_key} ${isSet ? color.green("(set)") : color.red("(NOT SET)")}`
        );
      } else {
        console.log(`    API Key: ${color.dim("****" + providerConfig.api_key.slice(-4))}`);
      }
    }

    console.log();
  }

  p.log.info(`Configuration file: ${color.dim(configPath)}`);
  p.outro(`${providers.length} provider(s) configured`);
}
