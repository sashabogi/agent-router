#!/usr/bin/env node
/**
 * AgentRouter CLI
 *
 * Command-line interface for the AgentRouter MCP server.
 * Provides commands for starting the server, initializing configuration,
 * listing roles, and validating configuration.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { stringify as stringifyYAML } from "yaml";

import { DEFAULT_CONFIG, getUserConfigPath } from "./config/defaults.js";
import { ConfigManager } from "./config/manager.js";
import { createServer, startServer } from "./server.js";

export const VERSION = "0.1.0";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported CLI commands.
 */
export type Command = "start" | "init" | "list-roles" | "validate" | "version" | "help";

/**
 * Parsed CLI options.
 */
export interface CLIOptions {
  /** The command to execute */
  command: Command;
  /** Path to config file (--config, -c) */
  configPath?: string;
  /** Profile name (--profile, -p) */
  profile?: string;
  /** Enable verbose logging (--verbose, -v) */
  verbose: boolean;
  /** Show help (--help, -h) */
  help: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const HELP_TEXT = `
AgentRouter - MCP server for multi-agent orchestration

Usage:
  agent-router [command] [options]

Commands:
  start         Start the MCP server (default)
  init          Initialize configuration
  list-roles    List available agent roles
  validate      Validate configuration
  version       Show version
  help          Show this help message

Options:
  --config, -c  Path to config file
  --profile, -p Profile name (default, development, production)
  --verbose, -v Enable verbose logging
  --help, -h    Show help

Examples:
  agent-router                     # Start server with default config
  agent-router start -c config.yaml # Start server with custom config
  agent-router init                # Create default config file
  agent-router list-roles          # List configured roles
  agent-router validate            # Validate configuration

Configuration:
  Config files are searched in this order (highest priority first):
    1. --config flag value
    2. .agent-router.yaml in current directory
    3. ~/.config/agent-router/config.yaml (Linux/macOS)
    4. %APPDATA%/agent-router/config.yaml (Windows)

  Environment variables can be interpolated using \${VAR_NAME} syntax.

For more information, visit: https://github.com/hive-dev/agent-router
`.trim();

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Parse command line arguments into CLIOptions.
 *
 * @param argv - Array of command line arguments (process.argv.slice(2))
 * @returns Parsed CLI options
 */
export function parseArgs(argv: string[]): CLIOptions {
  const options: CLIOptions = {
    command: "start",
    verbose: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // Handle flags
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      i++;
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
      i++;
      continue;
    }

    if (arg === "--config" || arg === "-c") {
      const nextArg = argv[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        console.error("Error: --config requires a path argument");
        process.exit(1);
      }
      options.configPath = nextArg;
      i += 2;
      continue;
    }

    if (arg === "--profile" || arg === "-p") {
      const nextArg = argv[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        console.error("Error: --profile requires a name argument");
        process.exit(1);
      }
      options.profile = nextArg;
      i += 2;
      continue;
    }

    // Handle combined short flags (e.g., -vh)
    if (arg !== undefined && arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
      const flags = arg.slice(1).split("");
      for (const flag of flags) {
        if (flag === "h") options.help = true;
        else if (flag === "v") options.verbose = true;
        else {
          console.error(`Error: Unknown flag: -${flag}`);
          process.exit(1);
        }
      }
      i++;
      continue;
    }

    // Handle unknown flags
    if (arg !== undefined && arg.startsWith("-")) {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Run "agent-router --help" for usage information.');
      process.exit(1);
    }

    // Handle commands
    const command = (arg ?? "").toLowerCase() as Command;
    if (isValidCommand(command)) {
      options.command = command;
    } else {
      console.error(`Error: Unknown command: ${arg}`);
      console.error('Run "agent-router --help" for usage information.');
      process.exit(1);
    }

    i++;
  }

  // If help flag is set, override command to help
  if (options.help) {
    options.command = "help";
  }

  return options;
}

/**
 * Check if a string is a valid command.
 */
function isValidCommand(cmd: string): cmd is Command {
  return ["start", "init", "list-roles", "validate", "version", "help"].includes(cmd);
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Start the MCP server.
 */
async function cmdStart(options: CLIOptions): Promise<void> {
  if (options.verbose) {
    console.error("[AgentRouter] Starting MCP server...");
    if (options.configPath) {
      console.error(`[AgentRouter] Using config: ${options.configPath}`);
    }
    if (options.profile) {
      console.error(`[AgentRouter] Profile: ${options.profile}`);
    }
  }

  // Set environment variable for config path if provided
  if (options.configPath) {
    process.env["AGENT_ROUTER_CONFIG"] = options.configPath;
  }

  const server = await createServer();
  await startServer(server);
}

/**
 * Initialize configuration file.
 */
async function cmdInit(options: CLIOptions): Promise<void> {
  const configPath = options.configPath ?? getUserConfigPath();
  const configDir = dirname(configPath);

  // Check if config already exists
  if (existsSync(configPath)) {
    console.error(`Configuration file already exists: ${configPath}`);
    console.error("Use --config to specify a different path, or delete the existing file.");
    process.exit(1);
  }

  // Create directory if needed
  if (!existsSync(configDir)) {
    if (options.verbose) {
      console.error(`Creating directory: ${configDir}`);
    }
    mkdirSync(configDir, { recursive: true });
  }

  // Generate default config as YAML
  const configYAML = stringifyYAML(DEFAULT_CONFIG, {
    indent: 2,
    lineWidth: 100,
  });

  // Add header comment
  const header = `# AgentRouter Configuration
# Generated by: agent-router init
# Documentation: https://github.com/hive-dev/agent-router
#
# Environment variables can be interpolated using \${VAR_NAME} syntax.
# Example: api_key: \${ANTHROPIC_API_KEY}

`;

  writeFileSync(configPath, header + configYAML, "utf-8");

  console.log(`Configuration file created: ${configPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Edit the config file to set your API keys");
  console.log("  2. Customize roles and providers as needed");
  console.log('  3. Run "agent-router validate" to check your configuration');
  console.log('  4. Run "agent-router start" to start the MCP server');
}

/**
 * List available agent roles.
 */
async function cmdListRoles(options: CLIOptions): Promise<void> {
  try {
    const managerOptions = {
      watch: false,
      allowMissingEnv: true,
      ...(options.configPath ? { configPath: options.configPath } : {}),
    };
    const manager = await ConfigManager.load(managerOptions);

    const config = manager.get();
    const roles = Object.entries(config.roles);

    if (roles.length === 0) {
      console.log("No roles configured.");
      return;
    }

    console.log("Available agent roles:");
    console.log("");

    for (const [roleName, roleConfig] of roles) {
      const fallbackInfo = roleConfig.fallback
        ? ` (fallback: ${roleConfig.fallback.provider}/${roleConfig.fallback.model})`
        : "";

      console.log(`  ${roleName}`);
      console.log(`    Provider: ${roleConfig.provider}`);
      console.log(`    Model:    ${roleConfig.model}${fallbackInfo}`);

      if (options.verbose && roleConfig.system_prompt) {
        // Show first 100 chars of system prompt
        const preview = roleConfig.system_prompt.slice(0, 100).replace(/\n/g, " ");
        const truncated = roleConfig.system_prompt.length > 100 ? "..." : "";
        console.log(`    Prompt:   ${preview}${truncated}`);
      }

      console.log("");
    }

    console.log(`Total: ${roles.length} role(s)`);

    // Also show loaded config paths in verbose mode
    if (options.verbose) {
      const loadedPaths = manager.getLoadedPaths();
      if (loadedPaths.length > 0) {
        console.log("");
        console.log("Loaded from:");
        for (const path of loadedPaths) {
          console.log(`  - ${path}`);
        }
      }
    }

    manager.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error loading configuration: ${message}`);
    process.exit(1);
  }
}

/**
 * Validate configuration.
 */
async function cmdValidate(options: CLIOptions): Promise<void> {
  console.log("Validating configuration...");
  console.log("");

  try {
    const validateOptions = {
      watch: false,
      allowMissingEnv: true, // Don't fail on missing env vars during validation
      ...(options.configPath ? { configPath: options.configPath } : {}),
    };
    const manager = await ConfigManager.load(validateOptions);

    const config = manager.get();
    const loadedPaths = manager.getLoadedPaths();

    // Report loaded files
    if (loadedPaths.length === 0) {
      console.log("No configuration files found. Using default configuration.");
    } else {
      console.log("Configuration files loaded:");
      for (const path of loadedPaths) {
        console.log(`  - ${path}`);
      }
    }

    console.log("");

    // Report configuration summary
    console.log("Configuration summary:");
    console.log(`  Version:   ${config.version}`);
    console.log(`  Roles:     ${Object.keys(config.roles).length}`);
    console.log(`  Providers: ${Object.keys(config.providers).length}`);
    console.log("");

    // Check for potential issues
    const warnings: string[] = [];

    // Check if any roles reference non-existent providers
    for (const [roleName, roleConfig] of Object.entries(config.roles)) {
      if (!config.providers[roleConfig.provider]) {
        warnings.push(`Role "${roleName}" references unknown provider "${roleConfig.provider}"`);
      }
      if (roleConfig.fallback && !config.providers[roleConfig.fallback.provider]) {
        warnings.push(
          `Role "${roleName}" fallback references unknown provider "${roleConfig.fallback.provider}"`
        );
      }
    }

    // Check for missing API keys
    for (const [providerName, providerConfig] of Object.entries(config.providers)) {
      if (providerConfig.api_key?.includes("${")) {
        warnings.push(
          `Provider "${providerName}" has unresolved environment variable in api_key`
        );
      }
    }

    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
      console.log("");
    }

    console.log("Configuration is valid.");

    manager.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Configuration validation failed: ${message}`);
    process.exit(1);
  }
}

/**
 * Show version.
 */
function cmdVersion(): void {
  console.log(`agent-router ${VERSION}`);
}

/**
 * Show help.
 */
function cmdHelp(): void {
  console.log(HELP_TEXT);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run the CLI with the given options.
 *
 * @param options - Parsed CLI options
 */
export async function runCLI(options: CLIOptions): Promise<void> {
  switch (options.command) {
    case "start":
      await cmdStart(options);
      break;
    case "init":
      await cmdInit(options);
      break;
    case "list-roles":
      await cmdListRoles(options);
      break;
    case "validate":
      await cmdValidate(options);
      break;
    case "version":
      cmdVersion();
      break;
    case "help":
      cmdHelp();
      break;
    default: {
      // Type guard for exhaustiveness check
      const _exhaustive: never = options.command;
      console.error(`Unknown command: ${_exhaustive}`);
      process.exit(1);
    }
  }
}

/**
 * Main entry point for the CLI.
 * Parses arguments and executes the appropriate command.
 */
export function main(): void {
  const options = parseArgs(process.argv.slice(2));

  runCLI(options).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}

// Graceful shutdown handling
function setupShutdownHandlers(): void {
  const shutdown = (signal: string): void => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

// Run if executed directly
setupShutdownHandlers();
main();
