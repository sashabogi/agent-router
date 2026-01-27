/**
 * Interactive setup wizard for AgentRouter
 * Provides a beautiful CLI experience for configuring providers and roles
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
  testAnthropicConnection,
  testOpenAIConnection,
  testGeminiConnection,
  testOllamaConnection,
  testConnectionWithSpinner,
  type ConnectionTestResult,
} from "./test-connection.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Environment variable names for each provider
 */
const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  ollama: "", // No API key needed
};

/**
 * Track which environment variables were configured during setup
 */
const configuredEnvVars: Map<string, string> = new Map();

/**
 * Available provider options
 */
interface ProviderOption {
  value: string;
  label: string;
  hint?: string;
}

const AVAILABLE_PROVIDERS: ProviderOption[] = [
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "Claude models - excellent for coding",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "GPT-4o, o1 reasoning models",
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
 * Model options per provider
 */
const ANTHROPIC_MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", hint: "Fast and capable" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", hint: "Most capable" },
];

const OPENAI_MODELS = [
  { value: "gpt-4o", label: "GPT-4o", hint: "Versatile flagship model" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Faster, cheaper" },
  { value: "o1", label: "o1", hint: "Advanced reasoning" },
  { value: "o1-mini", label: "o1 Mini", hint: "Faster reasoning" },
];

const GEMINI_MODELS = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Most capable" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Faster" },
  { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp", hint: "Experimental" },
];

/**
 * AgentRouter role definitions
 */
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
    value: "coder",
    label: "Coder",
    hint: "Code generation and implementation",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    systemPrompt: `You are an expert software engineer. Write clean, efficient, well-documented code.
Follow best practices, use appropriate design patterns, and consider edge cases.
Provide explanations for complex logic.`,
  },
  {
    value: "critic",
    label: "Critic",
    hint: "Plan review, challenge assumptions",
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    temperature: 0.3,
    systemPrompt: `You are a skeptical senior architect and technical reviewer. Your job is to:

1. **Challenge Assumptions**: Don't accept claims at face value. Ask "Why?" and "What if?"
2. **Identify Risks**: Find failure modes, edge cases, and potential issues
3. **Question Scope**: Is the solution over-engineered? Under-specified?
4. **Check Completeness**: What's missing? What hasn't been considered?
5. **Push for Excellence**: "Good enough" isn't good enough. Find ways to improve.

Be constructive but rigorous. Your goal is to make plans better, not to tear them down.
Provide specific, actionable feedback.`,
  },
  {
    value: "designer",
    label: "Designer",
    hint: "UI/UX feedback and design review",
    defaultProvider: "google",
    defaultModel: "gemini-2.5-pro",
    systemPrompt: `You are a senior UI/UX designer and frontend architect. Focus on:

1. **User Experience**: Is it intuitive? Accessible? Delightful?
2. **Visual Hierarchy**: Does the layout guide the user's eye?
3. **Component Architecture**: Are components reusable? Maintainable?
4. **Design Systems**: Does it follow established patterns?
5. **Responsive Design**: How does it work across devices?
6. **Accessibility**: WCAG compliance, keyboard navigation, screen readers

Provide specific feedback with examples and alternatives where applicable.`,
  },
  {
    value: "researcher",
    label: "Researcher",
    hint: "Fact-finding and research",
    defaultProvider: "google",
    defaultModel: "gemini-2.5-pro",
    systemPrompt: `You are a research analyst. Provide well-researched, factual information.
When possible, cite sources or indicate confidence levels.
If you're uncertain, say so. Prefer accuracy over completeness.`,
  },
  {
    value: "reviewer",
    label: "Reviewer",
    hint: "Code review and quality assurance",
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
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
];

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Display the wizard intro banner
 */
function displayBanner(): void {
  console.log();
  console.log(color.cyan("+-------------------------------------------------+"));
  console.log(color.cyan("|                                                 |"));
  console.log(
    color.cyan("|   ") +
      color.bold(color.yellow("@")) +
      color.bold(" AgentRouter Setup") +
      color.cyan("                         |")
  );
  console.log(color.cyan("|                                                 |"));
  console.log(
    color.cyan("|   ") +
      color.dim("Multi-agent orchestration for Claude Code") +
      color.cyan("     |")
  );
  console.log(color.cyan("|                                                 |"));
  console.log(color.cyan("+-------------------------------------------------+"));
  console.log();
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate API key format
 */
function validateApiKey(value: string, _provider: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return "API key is required";
  }

  // Basic length check - most API keys are at least 20 chars
  if (value.length < 10) {
    return "API key seems too short";
  }

  return undefined;
}

// ============================================================================
// Provider Configuration Functions
// ============================================================================

/**
 * Configure Anthropic provider
 */
async function configureAnthropic(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Anthropic Configuration"));

  p.note(
    "Get your API key from the Anthropic console:\n" +
      color.cyan("https://console.anthropic.com/settings/keys"),
    "Anthropic Setup"
  );

  // Loop to allow retrying API key entry
  while (true) {
    const apiKey = await p.password({
      message: "Enter your Anthropic API key:",
      validate: (v) => validateApiKey(v, "anthropic"),
    });

    if (p.isCancel(apiKey)) return null;

    // Test connection
    const result = await testConnectionWithSpinner("Anthropic", () =>
      testAnthropicConnection(apiKey)
    );

    if (result.success) {
      // Select default model
      const defaultModel = await p.select({
        message: "Select default Claude model:",
        options: ANTHROPIC_MODELS,
      });

      if (p.isCancel(defaultModel)) return null;

      // Store env var reference instead of actual key
      const envVarName = PROVIDER_ENV_VARS["anthropic"]!;
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.anthropic.com",
      };
    }

    // Test failed - ask what to do
    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["anthropic"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.anthropic.com",
      };
    }
    // action === "retry" - loop continues
  }
}

/**
 * Configure OpenAI provider
 */
async function configureOpenAI(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("OpenAI Configuration"));

  p.note(
    "Get your API key from the OpenAI dashboard:\n" +
      color.cyan("https://platform.openai.com/api-keys"),
    "OpenAI Setup"
  );

  // Loop to allow retrying API key entry
  while (true) {
    const apiKey = await p.password({
      message: "Enter your OpenAI API key:",
      validate: (v) => validateApiKey(v, "openai"),
    });

    if (p.isCancel(apiKey)) return null;

    // Test connection
    const result = await testConnectionWithSpinner("OpenAI", () =>
      testOpenAIConnection(apiKey)
    );

    if (result.success) {
      // Select default model
      const defaultModel = await p.select({
        message: "Select default OpenAI model:",
        options: OPENAI_MODELS,
      });

      if (p.isCancel(defaultModel)) return null;

      // Store env var reference instead of actual key
      const envVarName = PROVIDER_ENV_VARS["openai"]!;
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
      };
    }

    // Test failed - ask what to do
    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["openai"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
        base_url: "https://api.openai.com/v1",
      };
    }
    // action === "retry" - loop continues
  }
}

/**
 * Configure Google Gemini provider
 */
async function configureGemini(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Google Gemini Configuration"));

  p.note(
    "Get your API key from Google AI Studio:\n" +
      color.cyan("https://aistudio.google.com/apikey"),
    "Gemini Setup"
  );

  // Loop to allow retrying API key entry
  while (true) {
    const apiKey = await p.password({
      message: "Enter your Google Gemini API key:",
      validate: (v) => validateApiKey(v, "google"),
    });

    if (p.isCancel(apiKey)) return null;

    // Test connection
    const result = await testConnectionWithSpinner("Gemini", () =>
      testGeminiConnection(apiKey)
    );

    if (result.success) {
      // Select default model
      const defaultModel = await p.select({
        message: "Select default Gemini model:",
        options: GEMINI_MODELS,
      });

      if (p.isCancel(defaultModel)) return null;

      // Store env var reference instead of actual key
      const envVarName = PROVIDER_ENV_VARS["google"]!;
      configuredEnvVars.set(envVarName, apiKey);

      p.log.info(
        `Your API key will be stored as ${color.cyan("${" + envVarName + "}")} in the config.`
      );

      return {
        api_key: "${" + envVarName + "}",
      };
    }

    // Test failed - ask what to do
    const action = await p.select({
      message: "Connection test failed. What would you like to do?",
      options: [
        { value: "retry", label: "Re-enter API key", hint: "Try a different key" },
        { value: "skip", label: "Skip this provider" },
        { value: "add", label: "Add anyway", hint: "Use this key despite the error" },
      ],
    });

    if (p.isCancel(action) || action === "skip") return null;

    if (action === "add") {
      const envVarName = PROVIDER_ENV_VARS["google"]!;
      configuredEnvVars.set(envVarName, apiKey);

      return {
        api_key: "${" + envVarName + "}",
      };
    }
    // action === "retry" - loop continues
  }
}

/**
 * Configure Ollama provider
 */
async function configureOllama(): Promise<ProviderConfig | null> {
  p.log.step(color.bold("Ollama Configuration"));

  // Loop to allow retrying URL entry
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

    // Test connection and get models
    const result = await testConnectionWithSpinner("Ollama", () =>
      testOllamaConnection(baseUrl)
    );

    if (result.success) {
      // Select models to use if available
      if (result.models && result.models.length > 0) {
        const modelChoice = await p.select({
          message: "Select default model:",
          options: result.models.map((m) => ({
            value: m,
            label: m,
          })),
        });

        if (p.isCancel(modelChoice)) return null;

        p.log.success(`Found ${result.models.length} installed model(s)`);
      } else {
        p.log.warn("No models found. Pull a model with: ollama pull llama3.2");
      }

      return {
        base_url: baseUrl,
      };
    }

    // Test failed - show help and ask what to do
    p.note(
      "Make sure Ollama is running:\n" +
        color.cyan("  ollama serve") +
        "\n\nOr install from:\n" +
        color.cyan("  https://ollama.ai"),
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
    // action === "retry" - loop continues
  }
}

// ============================================================================
// Role Configuration Functions
// ============================================================================

/**
 * Get model options for a provider
 */
function getProviderModels(
  providerName: string
): { value: string; label: string; hint?: string }[] {
  switch (providerName) {
    case "anthropic":
      return ANTHROPIC_MODELS;
    case "openai":
      return OPENAI_MODELS;
    case "google":
      return GEMINI_MODELS;
    case "ollama":
      return [
        { value: "llama3.2", label: "Llama 3.2", hint: "Default local model" },
        { value: "qwen3:32b", label: "Qwen 3 32B", hint: "Alternative" },
        { value: "codellama", label: "CodeLlama", hint: "Code-focused" },
      ];
    default:
      return [{ value: "default", label: "Default model" }];
  }
}

/**
 * Configure role assignments
 */
async function configureRoles(
  configuredProviders: string[]
): Promise<Record<string, RoleConfig>> {
  p.log.step(color.bold("Role Configuration"));
  p.log.info(color.dim("Assign each agent role to a provider and model"));

  const roles: Record<string, RoleConfig> = {};

  // Ask how to configure roles
  const configMode = await p.select({
    message: "How would you like to configure roles?",
    options: [
      {
        value: "quick",
        label: "Quick setup",
        hint: "Use recommended defaults for configured providers",
      },
      {
        value: "custom",
        label: "Custom",
        hint: "Choose provider and model for each role",
      },
    ],
  });

  if (p.isCancel(configMode)) {
    // Return default roles using first configured provider
    return buildDefaultRoles(configuredProviders);
  }

  if (configMode === "quick") {
    return buildDefaultRoles(configuredProviders);
  }

  // Custom configuration - let user select for each role
  for (const role of AGENT_ROLES) {
    console.log();
    p.log.step(color.cyan(`Configuring: ${role.label}`));
    console.log(color.dim(`  ${role.hint}`));

    // Build provider options
    const providerOptions: Array<{ value: string; label: string; hint?: string }> =
      configuredProviders.map((provider) => {
        const option: { value: string; label: string; hint?: string } = {
          value: provider,
          label: provider,
        };
        if (provider === role.defaultProvider) {
          option.hint = `${role.defaultModel} [Recommended]`;
        }
        return option;
      });

    // Add skip option
    providerOptions.push({
      value: "__skip__",
      label: "Skip this role",
      hint: "Don't configure this role",
    });

    const selectedProvider = await p.select({
      message: `Which provider for ${role.label.toLowerCase()}?`,
      options: providerOptions,
    });

    if (p.isCancel(selectedProvider) || selectedProvider === "__skip__") {
      continue;
    }

    // Let user select model
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
      color.green(`  + ${role.value}`) +
        color.dim(` -> ${selectedProvider}/${selectedModel}`)
    );
  }

  // If no roles configured, use defaults
  if (Object.keys(roles).length === 0) {
    p.log.warn("No roles configured. Using defaults.");
    return buildDefaultRoles(configuredProviders);
  }

  return roles;
}

/**
 * Build default role configurations based on configured providers
 */
function buildDefaultRoles(configuredProviders: string[]): Record<string, RoleConfig> {
  const roles: Record<string, RoleConfig> = {};

  for (const role of AGENT_ROLES) {
    // Use recommended provider if available, otherwise use first configured provider
    let provider = role.defaultProvider;
    let model = role.defaultModel;

    if (!configuredProviders.includes(provider)) {
      provider = configuredProviders[0]!;
      // Get appropriate model for fallback provider
      const models = getProviderModels(provider);
      model = models[0]?.value ?? "default";
    }

    roles[role.value] = {
      provider,
      model,
      system_prompt: role.systemPrompt,
      ...(role.temperature !== undefined ? { temperature: role.temperature } : {}),
    };
  }

  // Display summary
  console.log();
  console.log(color.bold("  Role Assignments"));
  console.log();
  for (const [roleName, roleConfig] of Object.entries(roles)) {
    console.log(
      `  ${color.cyan(roleName.padEnd(12))} -> ${roleConfig.provider}/${color.dim(roleConfig.model)}`
    );
  }
  console.log();

  return roles;
}

// ============================================================================
// Shell Profile Integration
// ============================================================================

/**
 * Get the appropriate shell profile path based on the current shell
 */
function getShellProfilePath(): string {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }
  return path.join(os.homedir(), ".bashrc");
}

/**
 * Add environment variables to the user's shell profile
 */
async function addEnvVarsToShellProfile(): Promise<void> {
  if (configuredEnvVars.size === 0) {
    return;
  }

  const profilePath = getShellProfilePath();
  const profileName = path.basename(profilePath);

  // Ask user if they want to add env vars to shell profile
  const shouldAdd = await p.confirm({
    message: `Add API keys to ~/${profileName}?`,
    initialValue: true,
  });

  if (p.isCancel(shouldAdd) || !shouldAdd) {
    p.log.info("You'll need to set the environment variables manually.");
    displayEnvVarsSummary();
    return;
  }

  try {
    // Read existing profile content (or empty string if file doesn't exist)
    let profileContent = "";
    if (fs.existsSync(profilePath)) {
      profileContent = fs.readFileSync(profilePath, "utf-8");
    }

    // Collect env vars to add
    const envVarsToAdd: Array<{ name: string; value: string }> = [];

    for (const [envVar, value] of configuredEnvVars) {
      // Check if this env var already exists in the profile
      const existsPattern = new RegExp(`^\\s*export\\s+${envVar}=`, "m");
      if (!existsPattern.test(profileContent)) {
        envVarsToAdd.push({ name: envVar, value });
      }
    }

    if (envVarsToAdd.length === 0) {
      p.log.info(`All environment variables already exist in ~/${profileName}`);
      return;
    }

    // Build the export block
    const exportLines: string[] = [];
    exportLines.push("");
    exportLines.push("# AgentRouter");
    for (const { name, value } of envVarsToAdd) {
      exportLines.push(`export ${name}="${value}"`);
    }
    const exportBlock = exportLines.join("\n");

    // Ensure we add a newline before our block if the file doesn't end with one
    let prefix = "";
    if (profileContent.length > 0 && !profileContent.endsWith("\n")) {
      prefix = "\n";
    }

    // Append to profile
    fs.appendFileSync(profilePath, prefix + exportBlock + "\n", "utf-8");

    p.log.success(`Added environment variables to ~/${profileName}`);
    p.log.info(
      `Run ${color.cyan(`source ~/${profileName}`)} to apply changes (or restart your terminal)`
    );
  } catch (error) {
    p.log.error(
      `Failed to update ${profilePath}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    p.log.info("You'll need to add the environment variables manually:");
    displayEnvVarsSummary();
  }
}

/**
 * Display environment variables summary with export commands
 */
function displayEnvVarsSummary(): void {
  if (configuredEnvVars.size === 0) {
    return;
  }

  console.log();
  console.log(color.bold("Set these environment variables:"));
  console.log();

  for (const [envVar] of configuredEnvVars) {
    console.log(`  ${color.cyan(`export ${envVar}="your-api-key-here"`)}`);
  }

  console.log();
}

// ============================================================================
// Config Generation and Saving
// ============================================================================

/**
 * Generate the full configuration object
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
 * Generate configuration summary for display
 */
function generateConfigSummary(config: Config, configPath: string): string {
  const lines: string[] = [];

  // Config path
  lines.push(`  ${color.bold("Config:")} ${color.dim(configPath)}`);
  lines.push("");

  // Providers summary
  const providerNames = Object.keys(config.providers);
  lines.push(`  ${color.bold(`Providers (${providerNames.length}):`)} `);
  for (const name of providerNames) {
    lines.push(`    ${color.green("+")} ${name}`);
  }
  lines.push("");

  // Roles summary
  const roleNames = Object.keys(config.roles);
  lines.push(`  ${color.bold(`Roles (${roleNames.length}):`)} `);
  for (const [name, roleConfig] of Object.entries(config.roles)) {
    lines.push(
      `    ${color.cyan(name.padEnd(12))} -> ${roleConfig.provider}/${color.dim(roleConfig.model)}`
    );
  }

  return lines.join("\n");
}

/**
 * Save configuration to file
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

    // Generate YAML with header
    const header = `# AgentRouter Configuration
# Generated by: agent-router setup
# Documentation: https://github.com/hive-dev/agent-router
#
# Environment variables can be interpolated using \${VAR_NAME} syntax.
# Example: api_key: \${ANTHROPIC_API_KEY}

`;

    const yamlContent = yamlStringify(config, {
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
// Clear State
// ============================================================================

/**
 * Clear configured env vars (for fresh setup)
 */
function clearConfiguredEnvVars(): void {
  configuredEnvVars.clear();
}

// ============================================================================
// Main Setup Wizard
// ============================================================================

/**
 * Run the main setup wizard
 */
export async function runSetupWizard(): Promise<void> {
  displayBanner();

  p.intro(color.bgCyan(color.black(" Welcome to AgentRouter ")));

  // Provider selection
  p.log.message(
    color.dim("Use arrow keys to navigate, space to select, enter to confirm.")
  );

  const selectedProviders = await p.multiselect({
    message: "Which providers would you like to configure?",
    options: AVAILABLE_PROVIDERS.map((provider) => ({
      value: provider.value,
      label: provider.label,
      ...(provider.hint ? { hint: provider.hint } : {}),
    })),
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
  console.log();
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
    // Offer to print full config
    const printConfig = await p.confirm({
      message: "Print full YAML configuration to console instead?",
      initialValue: true,
    });

    if (!p.isCancel(printConfig) && printConfig) {
      const yamlOutput = yamlStringify(config, { indent: 2, lineWidth: 100 });
      console.log("\n" + yamlOutput);
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

  // Add env vars to shell profile
  console.log();
  await addEnvVarsToShellProfile();

  // Success outro
  console.log();
  const shellProfile = getShellProfilePath();
  p.note(
    `${color.bold("1. Restart your terminal or run:")}\n` +
      `   ${color.cyan(`source ${shellProfile}`)}\n\n` +
      `${color.bold("2. Add AgentRouter to Claude Code's MCP config:")}\n` +
      `   ${color.cyan("~/.config/claude-code/mcp.json")}\n\n` +
      `${color.bold("3. Invoke agents from Claude Code:")}\n` +
      `   ${color.cyan('Use invoke_agent with role: "coder", "critic", etc.')}`,
    "Next Steps"
  );

  // Clear env vars tracking for next run
  clearConfiguredEnvVars();

  p.outro(color.green("Setup complete!"));
}

// ============================================================================
// Additional CLI Commands
// ============================================================================

/**
 * Add a single provider interactively
 */
export async function addProvider(providerName?: string): Promise<void> {
  p.intro(color.bgCyan(color.black(" Add Provider ")));

  // Load existing config if present
  const configPath = getUserConfigPath();
  let existingConfig: Config | null = null;

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const yaml = await import("yaml");
      existingConfig = yaml.parse(content) as Config;
    } catch {
      p.log.warn("Could not load existing config, will create new one");
    }
  }

  // Select provider to add
  let providerType: string | symbol;

  if (providerName && AVAILABLE_PROVIDERS.some((p) => p.value === providerName)) {
    providerType = providerName;
  } else {
    providerType = await p.select({
      message: "Select provider to add:",
      options: AVAILABLE_PROVIDERS.map((provider) => ({
        value: provider.value,
        label: provider.label,
        ...(provider.hint ? { hint: provider.hint } : {}),
      })),
    });

    if (p.isCancel(providerType)) {
      p.cancel("Cancelled");
      return;
    }
  }

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

  if (!config) {
    p.cancel("Provider configuration cancelled");
    return;
  }

  // Update or create config
  if (existingConfig) {
    // Check if provider already exists
    if (existingConfig.providers[providerType as string]) {
      const replace = await p.confirm({
        message: `Provider "${providerType}" already exists. Replace it?`,
        initialValue: true,
      });

      if (p.isCancel(replace) || !replace) {
        p.cancel("Cancelled");
        return;
      }
    }

    existingConfig.providers[providerType as string] = config;

    // Save updated config
    const saved = await saveConfig(existingConfig);

    if (saved) {
      // Add env vars to shell profile
      if (configuredEnvVars.size > 0) {
        console.log();
        await addEnvVarsToShellProfile();
      }

      clearConfiguredEnvVars();
      p.outro(color.green(`Added ${providerType} provider`));
    } else {
      p.outro(color.red("Failed to save configuration"));
    }
  } else {
    // Create new config with just this provider
    const newConfig = generateConfig(
      { [providerType as string]: config },
      buildDefaultRoles([providerType as string])
    );

    const saved = await saveConfig(newConfig);

    if (saved) {
      // Add env vars to shell profile
      if (configuredEnvVars.size > 0) {
        console.log();
        await addEnvVarsToShellProfile();
      }

      clearConfiguredEnvVars();
      p.outro(color.green(`Created config with ${providerType} provider`));
    } else {
      p.outro(color.red("Failed to save configuration"));
    }
  }
}

/**
 * Test provider connection
 */
export async function testProvider(providerName?: string): Promise<void> {
  p.intro(color.bgCyan(color.black(" Provider Connection Test ")));

  const configPath = getUserConfigPath();

  if (!fs.existsSync(configPath)) {
    p.log.warn("No configuration found. Run: agent-router setup");
    p.outro(color.yellow("No providers to test"));
    return;
  }

  let config: Config;
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const yaml = await import("yaml");
    config = yaml.parse(content) as Config;
  } catch (error) {
    p.log.error(
      `Failed to load config: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    p.outro(color.red("Test failed"));
    return;
  }

  const providerNames = Object.keys(config.providers);

  if (providerNames.length === 0) {
    p.log.warn("No providers configured. Run: agent-router setup");
    p.outro(color.yellow("No providers to test"));
    return;
  }

  // Select provider to test if not specified
  let selectedProvider: string;

  if (providerName && providerNames.includes(providerName)) {
    selectedProvider = providerName;
  } else {
    const selected = await p.select({
      message: "Select provider to test:",
      options: [
        { value: "__all__", label: "Test all providers" },
        ...providerNames.map((name) => ({
          value: name,
          label: name,
        })),
      ],
    });

    if (p.isCancel(selected)) {
      p.cancel("Test cancelled");
      return;
    }

    selectedProvider = selected as string;
  }

  const providersToTest =
    selectedProvider === "__all__" ? providerNames : [selectedProvider];

  let allPassed = true;

  for (const name of providersToTest) {
    const providerConfig = config.providers[name];
    if (!providerConfig) continue;

    let result: ConnectionTestResult;

    // Resolve env vars in API key
    let apiKey = providerConfig.api_key ?? "";
    const envVarMatch = apiKey.match(/\$\{(\w+)\}/);
    if (envVarMatch) {
      const envVarName = envVarMatch[1];
      apiKey = process.env[envVarName!] ?? "";
      if (!apiKey) {
        p.log.error(`Environment variable ${envVarName} is not set`);
        allPassed = false;
        continue;
      }
    }

    switch (name) {
      case "anthropic":
        result = await testConnectionWithSpinner("Anthropic", () =>
          testAnthropicConnection(apiKey, providerConfig.base_url)
        );
        break;
      case "openai":
        result = await testConnectionWithSpinner("OpenAI", () =>
          testOpenAIConnection(apiKey, providerConfig.base_url)
        );
        break;
      case "google":
        result = await testConnectionWithSpinner("Gemini", () =>
          testGeminiConnection(apiKey)
        );
        break;
      case "ollama":
        result = await testConnectionWithSpinner("Ollama", () =>
          testOllamaConnection(providerConfig.base_url)
        );
        if (result.success && result.models) {
          p.log.info(`Available models: ${result.models.join(", ")}`);
        }
        break;
      default:
        p.log.warn(`Unknown provider type: ${name}`);
        result = { success: false, latencyMs: 0, error: "Unknown provider" };
    }

    if (!result.success) {
      allPassed = false;
    }
  }

  if (allPassed) {
    p.outro(color.green("All connection tests passed"));
  } else {
    p.outro(color.red("Some connection tests failed"));
  }
}

/**
 * List configured providers
 */
export async function listProviders(): Promise<void> {
  p.intro(color.bgCyan(color.black(" Configured Providers ")));

  const configPath = getUserConfigPath();

  if (!fs.existsSync(configPath)) {
    p.log.warn("No configuration found. Run: agent-router setup");
    p.outro(color.yellow("No providers configured"));
    return;
  }

  let config: Config;
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const yaml = await import("yaml");
    config = yaml.parse(content) as Config;
  } catch (error) {
    p.log.error(
      `Failed to load config: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    p.outro(color.red("Error reading configuration"));
    return;
  }

  const providers = Object.entries(config.providers);

  if (providers.length === 0) {
    p.log.warn("No providers configured");
    p.outro(color.yellow("Run: agent-router setup"));
    return;
  }

  console.log();

  for (const [name, providerConfig] of providers) {
    console.log(`  ${color.bold(name)}`);

    if (providerConfig.base_url) {
      console.log(`    ${color.dim("URL:")} ${providerConfig.base_url}`);
    }

    if (providerConfig.api_key) {
      const keyDisplay = providerConfig.api_key.includes("${")
        ? providerConfig.api_key
        : "[REDACTED]";
      console.log(`    ${color.dim("Key:")} ${keyDisplay}`);
    }

    console.log();
  }

  // Show roles using each provider
  console.log(color.bold("  Role Assignments:"));
  for (const [roleName, roleConfig] of Object.entries(config.roles)) {
    console.log(
      `    ${color.cyan(roleName.padEnd(12))} -> ${roleConfig.provider}/${color.dim(roleConfig.model)}`
    );
  }
  console.log();

  p.log.info(`Config file: ${color.dim(configPath)}`);
  p.outro(`${providers.length} provider(s) configured`);
}
