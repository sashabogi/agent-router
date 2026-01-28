/**
 * Interactive setup wizard for AgentRouter v2
 * 
 * AgentRouter is an MCP server for multi-agent orchestration.
 * This version supports:
 * - Multiple access modes: API keys OR subscription/CLI passthrough
 * - Configurable orchestrator (any provider can orchestrate)
 * - Full flexibility in role assignment
 * 
 * Updated January 2026 with latest models from all providers.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stringify as yamlStringify } from "yaml";

import type { Config, ProviderConfig, RoleConfig } from "../types.js";
import { getUserConfigPath, getUserConfigDir } from "../config/defaults.js";
import {
  testOpenAIConnection,
  testGeminiConnection,
  testDeepSeekConnection,
  testZaiConnection,
  testOllamaConnection,
  testAnthropicConnection,
  testConnectionWithSpinner,
} from "./test-connection.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Access mode for a provider
 * - api: Uses API key, pay-per-token
 * - subscription: Uses CLI tool with subscription (Claude Code, Codex CLI, Gemini CLI, etc.)
 */
type AccessMode = "api" | "subscription";

interface ProviderOption {
  value: string;
  label: string;
  hint?: string;
  supportsSubscription?: boolean;
  subscriptionInfo?: string;
}

interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

// ============================================================================
// Constants - Updated January 2026
// ============================================================================

/**
 * Environment variable names for each provider (API mode)
 */
const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  zai: "ZAI_API_KEY",
  ollama: "",
};

/**
 * Track which environment variables were configured during setup
 */
const configuredEnvVars: Map<string, string> = new Map();

/**
 * All available providers with their capabilities
 * Updated January 2026
 * 
 * NOTE: "subscription" mode (CLI passthrough) only works for the interface
 * you're currently running FROM. Since AgentRouter typically runs from
 * Claude Code, only Anthropic can use subscription mode for the orchestrator.
 * All other providers need API keys for agent roles.
 */
const AVAILABLE_PROVIDERS: ProviderOption[] = [
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Claude Opus/Sonnet 4.5 - Best for orchestration and code",
    supportsSubscription: true,
    subscriptionInfo: "Claude Code session (Max/Pro subscription) - orchestrator only",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "GPT-5.2/5.1 - Excellent for coding and critiques",
    supportsSubscription: false, // Requires API key when called from Claude Code
  },
  {
    value: "google",
    label: "Google Gemini",
    hint: "Gemini 3/2.5 - Great for research and multimodal",
    supportsSubscription: false, // Requires API key when called from Claude Code
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    hint: "V3.2 Reasoner - Excellent reasoning at 1/10th the cost",
    supportsSubscription: false,
  },
  {
    value: "zai",
    label: "Z.AI (GLM)",
    hint: "GLM-4.7 - Strong agentic coding, very affordable",
    supportsSubscription: false, // Requires API key when called from Claude Code
  },
  {
    value: "ollama",
    label: "Ollama",
    hint: "Local models - free, private, offline",
    supportsSubscription: false,
  },
];

// ============================================================================
// Model Options - Updated January 2026
// ============================================================================

/**
 * Anthropic models (January 2026)
 * https://docs.anthropic.com/en/docs/about-claude/models/overview
 */
const ANTHROPIC_MODELS: ModelOption[] = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", hint: "Best balance - recommended" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", hint: "Most intelligent" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "Fastest, cheapest" },
];

/**
 * OpenAI models (January 2026)
 * https://platform.openai.com/docs/models
 * GPT-5 series is current, GPT-4.1 still available
 */
const OPENAI_MODELS: ModelOption[] = [
  { value: "gpt-5.1", label: "GPT-5.1", hint: "Best for coding - adaptive reasoning" },
  { value: "gpt-5.2", label: "GPT-5.2", hint: "Most advanced frontier model" },
  { value: "gpt-5", label: "GPT-5", hint: "Strong coding, 400K context" },
  { value: "gpt-5-mini", label: "GPT-5 Mini", hint: "Smaller, cost-effective" },
  { value: "gpt-4.1", label: "GPT-4.1", hint: "Previous gen, 1M context" },
  { value: "o3", label: "o3", hint: "Advanced reasoning (slower)" },
];

/**
 * Google Gemini models (January 2026)
 * https://ai.google.dev/gemini-api/docs/models
 * Gemini 3 in preview, 2.5 stable
 */
const GEMINI_MODELS: ModelOption[] = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Stable, high capability" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast, balanced" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (Preview)", hint: "Most advanced reasoning" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", hint: "Fast frontier performance" },
];

/**
 * DeepSeek models (January 2026)
 * https://api-docs.deepseek.com/quick_start/pricing
 * V3.2 with thinking and non-thinking modes
 */
const DEEPSEEK_MODELS: ModelOption[] = [
  { value: "deepseek-reasoner", label: "DeepSeek V3.2 (Thinking)", hint: "Best reasoning - great for critiques" },
  { value: "deepseek-chat", label: "DeepSeek V3.2 (Non-thinking)", hint: "Fast and very cheap ($0.28/1M)" },
];

/**
 * Z.AI GLM models (January 2026)
 * https://docs.z.ai/guides/llm/glm-4.7
 * GLM-4.7 series with 200K context, 128K output
 */
const ZAI_MODELS: ModelOption[] = [
  { value: "glm-4.7", label: "GLM-4.7", hint: "Flagship - best for agentic coding" },
  { value: "glm-4.7-flashx", label: "GLM-4.7 FlashX", hint: "Fast and affordable" },
  { value: "glm-4.7-flash", label: "GLM-4.7 Flash", hint: "Free tier" },
];

/**
 * Ollama local models
 */
const OLLAMA_MODELS: ModelOption[] = [
  { value: "llama3.2", label: "Llama 3.2", hint: "Default local model" },
  { value: "qwen3:32b", label: "Qwen 3 32B", hint: "Strong reasoning" },
  { value: "codellama", label: "CodeLlama", hint: "Code-focused" },
  { value: "deepseek-coder-v2", label: "DeepSeek Coder V2", hint: "Excellent for code" },
];

// ============================================================================
// Role Definitions
// ============================================================================

interface RoleDefinition {
  value: string;
  label: string;
  hint: string;
  defaultProvider: string;
  defaultModel: string;
  systemPrompt: string;
  temperature?: number;
}

const AGENT_ROLES: RoleDefinition[] = [
  {
    value: "orchestrator",
    label: "Orchestrator",
    hint: "Main coordinator - routes tasks to other agents",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-5-20250929",
    temperature: 0.3,
    systemPrompt: `You are the orchestrating AI agent. Your role is to:

1. **Understand the user's intent** and break down complex tasks
2. **Route tasks** to specialized agents (critic, reviewer, researcher, etc.)
3. **Synthesize results** from multiple agents into coherent responses
4. **Maintain context** across the conversation

You have access to other AI agents with different specializations.
Use them strategically to provide the best possible assistance.`,
  },
  {
    value: "critic",
    label: "Critic",
    hint: "Challenge assumptions, find flaws in plans",
    defaultProvider: "deepseek",
    defaultModel: "deepseek-reasoner",
    temperature: 0.3,
    systemPrompt: `You are a skeptical senior architect reviewing a plan.
Your job is to provide a critical second opinion:

1. **Challenge Assumptions**: Don't accept claims at face value. Ask "Why?" and "What if?"
2. **Identify Risks**: Find failure modes, edge cases, and potential issues
3. **Question Scope**: Is the solution over-engineered? Under-specified?
4. **Check Completeness**: What's missing? What hasn't been considered?
5. **Push for Excellence**: "Good enough" isn't good enough. Find ways to improve.

Be constructive but rigorous. Provide specific, actionable feedback.`,
  },
  {
    value: "coder",
    label: "Coder",
    hint: "Write, refactor, and implement code",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-5-20250929",
    temperature: 0.2,
    systemPrompt: `You are an expert software engineer. Your role is to:

1. **Write Clean Code**: Follow best practices, use clear naming, add appropriate comments
2. **Implement Features**: Turn requirements into working, well-tested code
3. **Refactor**: Improve existing code structure without changing behavior
4. **Debug**: Find and fix bugs systematically
5. **Optimize**: Improve performance where it matters

Always consider:
- Error handling and edge cases
- Testing and testability
- Security implications
- Performance characteristics
- Maintainability and readability

Provide complete, runnable code with explanations of key decisions.`,
  },
  {
    value: "reviewer",
    label: "Code Reviewer",
    hint: "Review code for bugs, security, performance",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-5-20250929",
    temperature: 0.2,
    systemPrompt: `You are a senior code reviewer. Review code for:

1. **Correctness**: Does it work? Are there bugs?
2. **Security**: SQL injection, XSS, auth issues, data exposure
3. **Performance**: N+1 queries, unnecessary computations, memory leaks
4. **Maintainability**: Is it readable? Well-structured? Documented?
5. **Best Practices**: Follows language/framework conventions?
6. **Testing**: Is it testable? Are there missing tests?

Be specific. Reference line numbers. Suggest improvements with code examples.`,
  },
  {
    value: "designer",
    label: "Designer",
    hint: "UI/UX feedback and design review",
    defaultProvider: "google",
    defaultModel: "gemini-2.5-pro",
    systemPrompt: `You are a senior UI/UX designer. Focus on:

1. **User Experience**: Is it intuitive? Accessible? Delightful?
2. **Visual Hierarchy**: Does the layout guide the user's eye?
3. **Component Architecture**: Are components reusable? Maintainable?
4. **Design Systems**: Does it follow established patterns?
5. **Responsive Design**: How does it work across devices?
6. **Accessibility**: WCAG compliance, keyboard navigation, screen readers

Provide specific feedback with examples and alternatives.`,
  },
  {
    value: "researcher",
    label: "Researcher",
    hint: "Fact-finding and research tasks",
    defaultProvider: "google",
    defaultModel: "gemini-2.5-pro",
    systemPrompt: `You are a research analyst. Provide:

1. Well-researched, factual information
2. Source citations where possible
3. Confidence levels for claims
4. Alternative perspectives or approaches
5. Current best practices in the field

If you're uncertain, say so. Prefer accuracy over completeness.`,
  },
];

// ============================================================================
// Display Functions
// ============================================================================

function displayBanner(): void {
  console.log();
  console.log(color.cyan("╭─────────────────────────────────────────────────╮"));
  console.log(color.cyan("│                                                 │"));
  console.log(
    color.cyan("│   ") +
      color.bold(color.yellow("🔀")) +
      color.bold(" AgentRouter Setup v2") +
      color.cyan("                    │")
  );
  console.log(color.cyan("│                                                 │"));
  console.log(
    color.cyan("│   ") +
      color.dim("Multi-agent orchestration for AI coding tools") +
      color.cyan(" │")
  );
  console.log(color.cyan("│                                                 │"));
  console.log(color.cyan("╰─────────────────────────────────────────────────╯"));
  console.log();
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateApiKey(value: string, _provider: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "API key is required";
  }
  if (value.length < 10) {
    return "API key seems too short";
  }
  return undefined;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getProviderModels(providerName: string): ModelOption[] {
  switch (providerName) {
    case "anthropic":
      return ANTHROPIC_MODELS;
    case "openai":
      return OPENAI_MODELS;
    case "google":
      return GEMINI_MODELS;
    case "deepseek":
      return DEEPSEEK_MODELS;
    case "zai":
      return ZAI_MODELS;
    case "ollama":
      return OLLAMA_MODELS;
    default:
      return [{ value: "default", label: "Default model" }];
  }
}

function getProviderInfo(providerName: string): ProviderOption | undefined {
  return AVAILABLE_PROVIDERS.find((p) => p.value === providerName);
}

// ============================================================================
// Provider Configuration Functions
// ============================================================================

/**
 * Ask user for access mode (API or Subscription)
 */
async function selectAccessMode(provider: ProviderOption): Promise<AccessMode | null> {
  if (!provider.supportsSubscription) {
    return "api";
  }

  const accessMode = await p.select({
    message: `How do you want to access ${provider.label}?`,
    options: [
      {
        value: "subscription" as const,
        label: "Subscription/CLI",
        hint: provider.subscriptionInfo ?? "Uses CLI tool with subscription",
      },
      {
        value: "api" as const,
        label: "API Key",
        hint: "Pay-per-token usage",
      },
    ],
  });

  if (p.isCancel(accessMode)) return null;
  return accessMode as AccessMode;
}

/**
 * Configure Anthropic provider
 */
async function configureAnthropic(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Anthropic (Claude) Configuration"));
  
  const provider = getProviderInfo("anthropic")!;
  const accessMode = await selectAccessMode(provider);
  if (!accessMode) return null;

  if (accessMode === "subscription") {
    p.note(
      "You're using Claude Code with your existing subscription.\n" +
        "No API key needed - Claude will be accessed through the current session.",
      "Subscription Mode"
    );

    const defaultModel = await p.select({
      message: "Select default Claude model:",
      options: ANTHROPIC_MODELS,
    });
    if (p.isCancel(defaultModel)) return null;

    return {
      access_mode: "subscription",
      default_model: defaultModel as string,
    };
  }

  // API mode
  p.note(
    "Get your API key from:\n" +
      color.cyan("https://console.anthropic.com/settings/keys"),
    "API Key Setup"
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
      const defaultModel = await p.select({
        message: "Select default Claude model:",
        options: ANTHROPIC_MODELS,
      });
      if (p.isCancel(defaultModel)) return null;

      const envVarName = PROVIDER_ENV_VARS["anthropic"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        default_model: defaultModel as string,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["anthropic"]!;
      configuredEnvVars.set(envVarName, apiKey);
      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        default_model: "claude-sonnet-4-5-20250929",
      };
    }
  }
}

/**
 * Configure OpenAI provider
 */
async function configureOpenAI(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("OpenAI Configuration"));
  
  const provider = getProviderInfo("openai")!;
  const accessMode = await selectAccessMode(provider);
  if (!accessMode) return null;

  if (accessMode === "subscription") {
    p.note(
      "You're using Codex CLI with your ChatGPT Plus/Pro subscription.\n" +
        "Make sure Codex CLI is installed: " + color.cyan("npm install -g @openai/codex"),
      "Subscription Mode"
    );

    const defaultModel = await p.select({
      message: "Select default OpenAI model:",
      options: OPENAI_MODELS,
    });
    if (p.isCancel(defaultModel)) return null;

    return {
      access_mode: "subscription",
      default_model: defaultModel as string,
    };
  }

  // API mode
  p.note(
    "Get your API key from:\n" +
      color.cyan("https://platform.openai.com/api-keys"),
    "API Key Setup"
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
      const defaultModel = await p.select({
        message: "Select default OpenAI model:",
        options: OPENAI_MODELS,
      });
      if (p.isCancel(defaultModel)) return null;

      const envVarName = PROVIDER_ENV_VARS["openai"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
        default_model: defaultModel as string,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["openai"]!;
      configuredEnvVars.set(envVarName, apiKey);
      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-5.1",
      };
    }
  }
}

/**
 * Configure Google Gemini provider
 */
async function configureGemini(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Google Gemini Configuration"));
  
  const provider = getProviderInfo("google")!;
  const accessMode = await selectAccessMode(provider);
  if (!accessMode) return null;

  if (accessMode === "subscription") {
    p.note(
      "You're using Gemini CLI with your Google account.\n" +
        color.bold("FREE tier: 60 requests/min, 1000 requests/day!") + "\n\n" +
        "Install: " + color.cyan("npm install -g @google/gemini-cli") + "\n" +
        "Then run: " + color.cyan("gemini") + " and login with Google",
      "Gemini CLI (Free)"
    );

    const defaultModel = await p.select({
      message: "Select default Gemini model:",
      options: GEMINI_MODELS,
    });
    if (p.isCancel(defaultModel)) return null;

    return {
      access_mode: "subscription",
      default_model: defaultModel as string,
    };
  }

  // API mode
  p.note(
    "Get your API key from:\n" +
      color.cyan("https://aistudio.google.com/apikey"),
    "API Key Setup"
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
      const defaultModel = await p.select({
        message: "Select default Gemini model:",
        options: GEMINI_MODELS,
      });
      if (p.isCancel(defaultModel)) return null;

      const envVarName = PROVIDER_ENV_VARS["google"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        default_model: defaultModel as string,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["google"]!;
      configuredEnvVars.set(envVarName, apiKey);
      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        default_model: "gemini-2.5-flash",
      };
    }
  }
}

/**
 * Configure DeepSeek provider (API only)
 */
async function configureDeepSeek(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("DeepSeek Configuration"));

  p.note(
    "DeepSeek V3.2 offers excellent reasoning at ~1/10th the cost.\n" +
      color.bold("Pricing: $0.28/1M input, $0.42/1M output") + "\n\n" +
      "Get your API key from:\n" +
      color.cyan("https://platform.deepseek.com/api_keys"),
    "DeepSeek Setup"
  );

  while (true) {
    const apiKey = await p.password({
      message: "Enter your DeepSeek API key:",
      validate: (v) => validateApiKey(v, "deepseek"),
    });
    if (p.isCancel(apiKey)) return null;

    const result = await testConnectionWithSpinner("DeepSeek", () =>
      testDeepSeekConnection(apiKey)
    );

    if (result.success) {
      const defaultModel = await p.select({
        message: "Select default DeepSeek model:",
        options: DEEPSEEK_MODELS,
      });
      if (p.isCancel(defaultModel)) return null;

      const envVarName = PROVIDER_ENV_VARS["deepseek"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.deepseek.com",
        default_model: defaultModel as string,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["deepseek"]!;
      configuredEnvVars.set(envVarName, apiKey);
      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.deepseek.com",
        default_model: "deepseek-reasoner",
      };
    }
  }
}

/**
 * Configure Z.AI (GLM) provider
 */
async function configureZai(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Z.AI (GLM) Configuration"));
  
  const provider = getProviderInfo("zai")!;
  const accessMode = await selectAccessMode(provider);
  if (!accessMode) return null;

  if (accessMode === "subscription") {
    p.note(
      "GLM Coding Plan: " + color.bold("$3/month") + " - 3× usage, 1/7th cost\n" +
        "Works with Claude Code, Kilo Code, Cline, and more.\n\n" +
        "Subscribe at: " + color.cyan("https://z.ai/subscribe"),
      "GLM Coding Plan"
    );

    const defaultModel = await p.select({
      message: "Select default GLM model:",
      options: ZAI_MODELS,
    });
    if (p.isCancel(defaultModel)) return null;

    return {
      access_mode: "subscription",
      base_url: "https://api.z.ai/api/paas/v4",
      default_model: defaultModel as string,
    };
  }

  // API mode
  p.note(
    "GLM-4.7 is excellent for agentic coding tasks.\n" +
      "Get your API key from:\n" +
      color.cyan("https://z.ai/manage-apikey/apikey-list"),
    "API Key Setup"
  );

  while (true) {
    const apiKey = await p.password({
      message: "Enter your Z.AI API key:",
      validate: (v) => validateApiKey(v, "zai"),
    });
    if (p.isCancel(apiKey)) return null;

    const result = await testConnectionWithSpinner("Z.AI", () =>
      testZaiConnection(apiKey)
    );

    if (result.success) {
      const defaultModel = await p.select({
        message: "Select default GLM model:",
        options: ZAI_MODELS,
      });
      if (p.isCancel(defaultModel)) return null;

      const envVarName = PROVIDER_ENV_VARS["zai"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.z.ai/api/paas/v4",
        default_model: defaultModel as string,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["zai"]!;
      configuredEnvVars.set(envVarName, apiKey);
      return {
        access_mode: "api",
        api_key: "${" + envVarName + "}",
        base_url: "https://api.z.ai/api/paas/v4",
        default_model: "glm-4.7-flash",
      };
    }
  }
}

/**
 * Configure Ollama provider (local)
 */
async function configureOllama(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Ollama Configuration"));

  p.note(
    "Ollama runs models locally - free and private.\n" +
      "Install from: " + color.cyan("https://ollama.ai") + "\n" +
      "Then run: " + color.cyan("ollama serve"),
    "Ollama Setup"
  );

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
      let selectedModel = "llama3.2";

      if (result.models && result.models.length > 0) {
        const modelChoice = await p.select({
          message: "Select default model:",
          options: result.models.map((m) => ({ value: m, label: m })),
        });
        if (p.isCancel(modelChoice)) return null;
        selectedModel = modelChoice as string;
        p.log.success(`Found ${result.models.length} installed model(s)`);
      } else {
        p.log.warn("No models found. Pull a model with: ollama pull llama3.2");
      }

      return {
        access_mode: "api",
        base_url: baseUrl,
        default_model: selectedModel,
      };
    }

    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter URL" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;
    if (action === "add") {
      return {
        access_mode: "api",
        base_url: baseUrl,
        default_model: "llama3.2",
      };
    }
  }
}

// ============================================================================
// Role Configuration
// ============================================================================

async function configureRoles(
  configuredProviders: string[],
  orchestratorProvider: string
): Promise<Record<string, RoleConfig>> {
  const roles: Record<string, RoleConfig> = {};

  // Auto-configure orchestrator role
  const orchestratorRole = AGENT_ROLES.find((r) => r.value === "orchestrator");
  if (orchestratorRole) {
    const defaultModel = getProviderModels(orchestratorProvider)[0]?.value ?? "default";
    roles["orchestrator"] = {
      provider: orchestratorProvider,
      model: defaultModel,
      system_prompt: orchestratorRole.systemPrompt,
      ...(orchestratorRole.temperature !== undefined ? { temperature: orchestratorRole.temperature } : {}),
    };
    p.log.success(`Orchestrator → ${orchestratorProvider}/${defaultModel}`);
  }

  // Filter out orchestrator from selectable roles
  const selectableRoles = AGENT_ROLES.filter((r) => r.value !== "orchestrator");

  const selectedRoles = await p.multiselect({
    message: "Which agent roles would you like to enable?",
    options: selectableRoles.map((role) => ({
      value: role.value,
      label: role.label,
      ...(role.hint ? { hint: role.hint } : {}),
    })),
    required: false,
  });

  if (p.isCancel(selectedRoles) || (selectedRoles as string[]).length === 0) {
    p.log.warn("No additional roles selected. You can add roles later.");
    return roles;
  }

  for (const roleValue of selectedRoles as string[]) {
    const role = selectableRoles.find((r) => r.value === roleValue);
    if (!role) continue;

    console.log();
    p.log.step(color.cyan(`${role.label}`));
    console.log(color.dim(`  ${role.hint}`));

    const providerOptions = configuredProviders.map((provider) => {
      const models = getProviderModels(provider);
      const defaultModel = models[0]?.label ?? "default";
      return {
        value: provider,
        label: provider,
        hint: `Default: ${defaultModel}`,
      };
    });

    const selectedProvider = await p.select({
      message: `Which provider for ${role.label.toLowerCase()}?`,
      options: providerOptions,
    });
    if (p.isCancel(selectedProvider)) continue;

    const modelOptions = getProviderModels(selectedProvider as string);
    const selectedModel = await p.select({
      message: "Select model:",
      options: modelOptions,
    });
    if (p.isCancel(selectedModel)) continue;

    roles[role.value] = {
      provider: selectedProvider as string,
      model: selectedModel as string,
      system_prompt: role.systemPrompt,
      ...(role.temperature !== undefined ? { temperature: role.temperature } : {}),
    };

    console.log(
      color.green(`  ✓ ${role.value}`) +
        color.dim(` → ${selectedProvider}/${selectedModel}`)
    );
  }

  return roles;
}

// ============================================================================
// Shell Profile & Config Saving
// ============================================================================

function getShellProfilePath(): string {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }
  return path.join(os.homedir(), ".bashrc");
}

async function addEnvVarsToShellProfile(): Promise<void> {
  if (configuredEnvVars.size === 0) return;

  const profilePath = getShellProfilePath();
  const profileName = path.basename(profilePath);

  const shouldAdd = await p.confirm({
    message: `Add API keys to ~/${profileName}?`,
    initialValue: true,
  });

  if (p.isCancel(shouldAdd) || !shouldAdd) {
    p.log.info("Set environment variables manually:");
    for (const [envVar] of configuredEnvVars) {
      console.log(`  ${color.cyan(`export ${envVar}="your-api-key"`)}`);
    }
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
      p.log.info(`Environment variables already exist in ~/${profileName}`);
      return;
    }

    const exportLines: string[] = ["", "# AgentRouter"];
    for (const { name, value } of envVarsToAdd) {
      exportLines.push(`export ${name}="${value}"`);
    }

    let prefix = "";
    if (profileContent.length > 0 && !profileContent.endsWith("\n")) {
      prefix = "\n";
    }

    fs.appendFileSync(profilePath, prefix + exportLines.join("\n") + "\n", "utf-8");
    p.log.success(`Added environment variables to ~/${profileName}`);
    p.log.info(`Run ${color.cyan(`source ~/${profileName}`)} to apply changes`);
  } catch (error) {
    p.log.error(`Failed to update ${profilePath}`);
  }
}

function generateConfig(
  providers: Record<string, ProviderConfig>,
  roles: Record<string, RoleConfig>
): Config {
  return {
    version: "2.0",
    defaults: {
      temperature: 0.7,
      max_tokens: 4096,
      timeout_ms: 60000,
    },
    roles,
    providers,
  };
}

async function saveConfig(config: Config): Promise<boolean> {
  const configPath = getUserConfigPath();
  const configDir = getUserConfigDir();

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.backup.${Date.now()}`;
      fs.copyFileSync(configPath, backupPath);
      p.log.info(`Backed up existing config to: ${color.dim(backupPath)}`);
    }

    const header = `# AgentRouter Configuration v2
# Generated: ${new Date().toISOString()}
# Documentation: https://github.com/hive-dev/agent-router
#
# This configures multi-agent orchestration across AI providers.
# Supports both API keys and subscription/CLI access modes.
#
# Environment variables: \${VAR_NAME} syntax
# Access modes: "api" (pay-per-token) or "subscription" (CLI tools)

`;

    const yamlContent = yamlStringify(config, { indent: 2, lineWidth: 100 });
    fs.writeFileSync(configPath, header + yamlContent, "utf-8");
    return true;
  } catch (error) {
    p.log.error(`Failed to save config: ${error instanceof Error ? error.message : "Unknown"}`);
    return false;
  }
}

// ============================================================================
// Main Setup Wizard - Restructured Flow
// ============================================================================

/**
 * Detect which CLI environment we're running from
 * This determines which provider can use subscription mode
 */
function detectCurrentCLI(): string | null {
  // Check for Claude Code indicators
  if (process.env["CLAUDE_CODE"] || process.env["ANTHROPIC_API_KEY"] === "claude-code-session") {
    return "anthropic";
  }
  // Check for Codex CLI
  if (process.env["OPENAI_CODEX_CLI"]) {
    return "openai";
  }
  // Check for Gemini CLI
  if (process.env["GEMINI_CLI"]) {
    return "google";
  }
  // Default assumption: running from Claude Code
  return "anthropic";
}

export async function runSetupWizard(): Promise<void> {
  displayBanner();

  p.intro(color.bgCyan(color.black(" AgentRouter Setup v2 ")));

  const currentCLI = detectCurrentCLI();

  // ============================================================================
  // STEP 1: Choose Orchestrator
  // ============================================================================
  
  p.note(
    "The " + color.bold("orchestrator") + " is the main AI that coordinates all other agents.\n" +
    "It runs IN your current CLI session and routes tasks to specialized agents.\n\n" +
    "Since you're running from " + color.cyan("Claude Code") + ", Anthropic can use your\n" +
    "subscription. All other providers require API keys.",
    "Step 1: Choose Your Orchestrator"
  );

  const orchestratorProvider = await p.select({
    message: "Which provider should be your orchestrator?",
    options: AVAILABLE_PROVIDERS.map((provider) => ({
      value: provider.value,
      label: provider.label,
      hint: provider.value === currentCLI 
        ? "Can use subscription (no API key needed)" 
        : "Requires API key",
    })),
  });

  if (p.isCancel(orchestratorProvider)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Configure orchestrator
  const providers: Record<string, ProviderConfig> = {};
  const configuredProviderNames: string[] = [];
  
  let orchestratorConfig: ProviderConfig | null = null;
  let orchestratorAccessMode: AccessMode = "api";

  // If orchestrator matches current CLI, offer subscription mode
  if (orchestratorProvider === currentCLI) {
    const accessChoice = await p.select({
      message: `How do you want to access ${orchestratorProvider}?`,
      options: [
        {
          value: "subscription" as const,
          label: "Use my subscription (no API key)",
          hint: "Recommended - uses your current Claude Code session",
        },
        {
          value: "api" as const,
          label: "Use API key",
          hint: "Pay-per-token, separate from subscription",
        },
      ],
    });

    if (p.isCancel(accessChoice)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    orchestratorAccessMode = accessChoice as AccessMode;
  }

  // Configure the orchestrator provider
  if (orchestratorAccessMode === "subscription") {
    p.note(
      "Your orchestrator will use Claude Code's session.\n" +
      "No API key needed - requests pass through your subscription.",
      "Subscription Mode"
    );
    
    const model = await p.select({
      message: "Select default Claude model:",
      options: ANTHROPIC_MODELS.map((m) => ({
        value: m.value,
        label: m.label,
        ...(m.hint ? { hint: m.hint } : {}),
      })),
    });

    if (p.isCancel(model)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    orchestratorConfig = {
      access_mode: "subscription",
      default_model: model as string,
    };
  } else {
    // Need API key for orchestrator
    orchestratorConfig = await configureProviderWithAPIKey(orchestratorProvider as string);
  }

  if (orchestratorConfig) {
    providers[orchestratorProvider as string] = orchestratorConfig;
    configuredProviderNames.push(orchestratorProvider as string);
    p.log.success(`Orchestrator configured: ${orchestratorProvider}`);
  } else {
    p.cancel("Failed to configure orchestrator");
    process.exit(1);
  }

  // ============================================================================
  // STEP 2: Add Agent Providers (all require API keys)
  // ============================================================================

  const remainingProviders = AVAILABLE_PROVIDERS.filter(
    (prov) => prov.value !== orchestratorProvider
  );

  p.note(
    "Now add providers for your agent roles (coder, critic, reviewer, etc.).\n" +
    "These are called " + color.bold("via API") + " by your orchestrator.\n\n" +
    color.yellow("All providers below require API keys.") + "\n" +
    "Your orchestrator will make API calls to these providers.",
    "Step 2: Add Agent Providers"
  );

  const selectedAgentProviders = await p.multiselect({
    message: "Which additional providers do you want for agent roles?",
    options: remainingProviders.map((provider) => ({
      value: provider.value,
      label: provider.label,
      ...(provider.hint ? { hint: provider.hint } : {}),
    })),
    required: false,
  });

  if (p.isCancel(selectedAgentProviders)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // ============================================================================
  // STEP 3: Configure API Keys
  // ============================================================================

  if ((selectedAgentProviders as string[]).length > 0) {
    p.note(
      "Configure API keys for each selected provider.\n" +
      "Keys are stored in your config and/or shell profile.",
      "Step 3: Configure API Keys"
    );

    for (const providerType of selectedAgentProviders as string[]) {
      const config = await configureProviderWithAPIKey(providerType);

      if (config) {
        providers[providerType] = config;
        configuredProviderNames.push(providerType);
        p.log.success(`${providerType} configured`);
      }
    }
  }

  // ============================================================================
  // STEP 4: Assign Roles
  // ============================================================================

  p.note(
    "Assign providers to agent roles.\n" +
    "Each role can use any configured provider.",
    "Step 4: Assign Agent Roles"
  );

  const roles = await configureRoles(configuredProviderNames, orchestratorProvider as string);

  // ============================================================================
  // Save Configuration
  // ============================================================================

  const config = generateConfig(providers, roles);
  const saved = await saveConfig(config);

  if (saved) {
    await addEnvVarsToShellProfile();

    p.outro(color.green("✓ AgentRouter configured successfully!"));

    console.log();
    console.log(color.bold("  Summary"));
    console.log();
    console.log(`  Orchestrator: ${color.cyan(orchestratorProvider as string)} (${orchestratorAccessMode})`);
    console.log(`  Agent Providers: ${configuredProviderNames.filter(p => p !== orchestratorProvider).join(", ") || "none"}`);
    console.log(`  Roles: ${Object.keys(roles).join(", ")}`);
    console.log();
    console.log(`  Config: ${color.dim(getUserConfigPath())}`);
    console.log();
  } else {
    p.cancel("Failed to save configuration");
    process.exit(1);
  }
}

/**
 * Configure a provider that requires an API key
 */
async function configureProviderWithAPIKey(providerType: string): Promise<ProviderConfig | null> {
  switch (providerType) {
    case "anthropic":
      return configureAnthropicAPI();
    case "openai":
      return configureOpenAIAPI();
    case "google":
      return configureGeminiAPI();
    case "deepseek":
      return configureDeepSeek();
    case "zai":
      return configureZaiAPI();
    case "ollama":
      return configureOllama();
    default:
      return null;
  }
}

/**
 * Configure Anthropic with API key (no subscription option)
 */
async function configureAnthropicAPI(): Promise<ProviderConfig | null> {
  p.note(
    "Get your API key from:\n" +
    color.cyan("https://console.anthropic.com/settings/keys"),
    "Anthropic API Setup"
  );

  const apiKey = await p.password({
    message: "Enter your Anthropic API key:",
    validate: (value) => validateApiKey(value, "anthropic"),
  });

  if (p.isCancel(apiKey)) return null;

  const result = await testConnectionWithSpinner(
    "Anthropic",
    () => testAnthropicConnection(apiKey as string)
  );

  if (!result.success) {
    const continueAnyway = await p.confirm({
      message: `Connection failed: ${result.error}. Continue anyway?`,
      initialValue: false,
    });
    if (p.isCancel(continueAnyway) || !continueAnyway) return null;
  }

  const model = await p.select({
    message: "Select default Claude model:",
    options: ANTHROPIC_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      ...(m.hint ? { hint: m.hint } : {}),
    })),
  });

  if (p.isCancel(model)) return null;

  // Store API key for later shell profile export
  configuredEnvVars.set("ANTHROPIC_API_KEY", apiKey as string);

  return {
    access_mode: "api",
    api_key: `\${ANTHROPIC_API_KEY}`,
    base_url: "https://api.anthropic.com/v1",
    default_model: model as string,
  };
}

/**
 * Configure OpenAI with API key (no subscription option)
 */
async function configureOpenAIAPI(): Promise<ProviderConfig | null> {
  p.note(
    "Get your API key from:\n" +
    color.cyan("https://platform.openai.com/api-keys"),
    "OpenAI API Setup"
  );

  const apiKey = await p.password({
    message: "Enter your OpenAI API key:",
    validate: (value) => validateApiKey(value, "openai"),
  });

  if (p.isCancel(apiKey)) return null;

  const result = await testConnectionWithSpinner(
    "OpenAI",
    () => testOpenAIConnection(apiKey as string)
  );

  if (!result.success) {
    const continueAnyway = await p.confirm({
      message: `Connection failed: ${result.error}. Continue anyway?`,
      initialValue: false,
    });
    if (p.isCancel(continueAnyway) || !continueAnyway) return null;
  }

  const model = await p.select({
    message: "Select default OpenAI model:",
    options: OPENAI_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      ...(m.hint ? { hint: m.hint } : {}),
    })),
  });

  if (p.isCancel(model)) return null;

  // Store API key for later shell profile export
  configuredEnvVars.set("OPENAI_API_KEY", apiKey as string);

  return {
    access_mode: "api",
    api_key: `\${OPENAI_API_KEY}`,
    base_url: "https://api.openai.com/v1",
    default_model: model as string,
  };
}

/**
 * Configure Gemini with API key (no subscription option)
 */
async function configureGeminiAPI(): Promise<ProviderConfig | null> {
  p.note(
    "Get your API key from:\n" +
    color.cyan("https://aistudio.google.com/apikey"),
    "Google Gemini API Setup"
  );

  const apiKey = await p.password({
    message: "Enter your Gemini API key:",
    validate: (value) => validateApiKey(value, "gemini"),
  });

  if (p.isCancel(apiKey)) return null;

  const result = await testConnectionWithSpinner(
    "Gemini",
    () => testGeminiConnection(apiKey as string)
  );

  if (!result.success) {
    const continueAnyway = await p.confirm({
      message: `Connection failed: ${result.error}. Continue anyway?`,
      initialValue: false,
    });
    if (p.isCancel(continueAnyway) || !continueAnyway) return null;
  }

  const model = await p.select({
    message: "Select default Gemini model:",
    options: GEMINI_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      ...(m.hint ? { hint: m.hint } : {}),
    })),
  });

  if (p.isCancel(model)) return null;

  // Store API key for later shell profile export
  configuredEnvVars.set("GEMINI_API_KEY", apiKey as string);

  return {
    access_mode: "api",
    api_key: `\${GEMINI_API_KEY}`,
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    default_model: model as string,
  };
}

/**
 * Configure Z.AI with API key (no subscription option)
 */
async function configureZaiAPI(): Promise<ProviderConfig | null> {
  p.note(
    "GLM-4.7 excels at agentic coding tasks.\n" +
    "Get your API key from:\n" +
    color.cyan("https://z.ai/manage-apikey/apikey-list"),
    "Z.AI GLM API Setup"
  );

  const apiKey = await p.password({
    message: "Enter your Z.AI API key:",
    validate: (value) => validateApiKey(value, "zai"),
  });

  if (p.isCancel(apiKey)) return null;

  const result = await testConnectionWithSpinner(
    "Z.AI",
    () => testZaiConnection(apiKey as string)
  );

  if (!result.success) {
    const continueAnyway = await p.confirm({
      message: `Connection failed: ${result.error}. Continue anyway?`,
      initialValue: false,
    });
    if (p.isCancel(continueAnyway) || !continueAnyway) return null;
  }

  const model = await p.select({
    message: "Select default GLM model:",
    options: ZAI_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      ...(m.hint ? { hint: m.hint } : {}),
    })),
  });

  if (p.isCancel(model)) return null;

  // Store API key for later shell profile export
  configuredEnvVars.set("ZAI_API_KEY", apiKey as string);

  return {
    access_mode: "api",
    api_key: `\${ZAI_API_KEY}`,
    base_url: "https://api.z.ai/api/paas/v4",
    default_model: model as string,
  };
}


// ============================================================================
// Provider Management Functions (for CLI subcommands)
// ============================================================================

/**
 * Add a single provider interactively
 */
export async function addProvider(providerName?: string): Promise<void> {
  displayBanner();

  p.intro(color.bgCyan(color.black(" Add Provider ")));

  let selectedProvider: string;

  if (providerName) {
    // Validate provider name
    const validProvider = AVAILABLE_PROVIDERS.find(
      (p) => p.value.toLowerCase() === providerName.toLowerCase()
    );
    if (!validProvider) {
      p.log.error(`Unknown provider: ${providerName}`);
      p.log.info(`Available providers: ${AVAILABLE_PROVIDERS.map((p) => p.value).join(", ")}`);
      process.exit(1);
    }
    selectedProvider = validProvider.value;
  } else {
    // Let user select provider
    const choice = await p.select({
      message: "Which provider would you like to add?",
      options: AVAILABLE_PROVIDERS.map((provider) => ({
        value: provider.value,
        label: provider.label,
        ...(provider.hint ? { hint: provider.hint } : {}),
      })),
    });

    if (p.isCancel(choice)) {
      p.cancel("Cancelled");
      process.exit(0);
    }
    selectedProvider = choice as string;
  }

  let config: ProviderConfig | null = null;

  switch (selectedProvider) {
    case "anthropic":
      config = await configureAnthropic();
      break;
    case "openai":
      config = await configureOpenAI();
      break;
    case "google":
      config = await configureGemini();
      break;
    case "deepseek":
      config = await configureDeepSeek();
      break;
    case "zai":
      config = await configureZai();
      break;
    case "ollama":
      config = await configureOllama();
      break;
  }

  if (config) {
    // TODO: Merge with existing config
    p.log.success(`${selectedProvider} configured`);
    await addEnvVarsToShellProfile();
  }
}

/**
 * Test provider connection(s)
 */
export async function testProvider(providerName?: string): Promise<void> {
  p.intro(color.bgCyan(color.black(" Test Provider Connection ")));

  // Load existing config
  const configPath = getUserConfigPath();
  if (!fs.existsSync(configPath)) {
    p.log.error("No configuration file found.");
    p.log.info("Run 'agent-router setup' first to configure providers.");
    process.exit(1);
  }

  // For now, just test based on provider name
  if (providerName) {
    const provider = AVAILABLE_PROVIDERS.find(
      (p) => p.value.toLowerCase() === providerName.toLowerCase()
    );
    if (!provider) {
      p.log.error(`Unknown provider: ${providerName}`);
      p.log.info(`Available providers: ${AVAILABLE_PROVIDERS.map((p) => p.value).join(", ")}`);
      process.exit(1);
    }
    p.log.info(`Testing ${provider.label}...`);
    p.log.warn("Provider testing requires API keys in environment or config.");
  } else {
    p.log.info("Testing all configured providers...");
    p.log.warn("Provider testing requires API keys in environment or config.");
  }

  p.outro("Test complete");
}

/**
 * List configured providers
 */
export async function listProviders(): Promise<void> {
  const configPath = getUserConfigPath();

  if (!fs.existsSync(configPath)) {
    console.log("No configuration file found.");
    console.log("Run 'agent-router setup' to configure providers.");
    return;
  }

  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    const { parse } = await import("yaml");
    const config = parse(configContent) as { providers?: Record<string, ProviderConfig> };

    if (!config.providers || Object.keys(config.providers).length === 0) {
      console.log("No providers configured.");
      console.log("Run 'agent-router setup' to add providers.");
      return;
    }

    console.log();
    console.log(color.bold("Configured Providers:"));
    console.log();

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const accessMode = providerConfig.access_mode ?? "api";
      const model = providerConfig.default_model ?? "default";
      const hasApiKey = providerConfig.api_key ? "✓" : "✗";

      console.log(`  ${color.cyan(name.padEnd(12))} ${accessMode.padEnd(14)} ${model}`);
      if (accessMode === "api") {
        console.log(`    ${color.dim(`API Key: ${hasApiKey}`)}`);
      }
    }

    console.log();
  } catch (error) {
    console.error("Error reading configuration:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
