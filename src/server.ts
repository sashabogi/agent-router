/**
 * AgentRouter MCP Server
 * Creates and configures the MCP server with tool capabilities
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { DEFAULT_CONFIG } from "./config/defaults.js";
import { ConfigManager } from "./config/manager.js";
import { registerTools } from "./mcp/tools/index.js";
import { createStdioTransport } from "./mcp/transport/stdio.js";
import { Logger } from "./observability/logger.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { ProviderManager } from "./providers/manager.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAIProvider } from "./providers/openai.js";
import { ZAIProvider } from "./providers/zai.js";
import { KimiProvider } from "./providers/kimi.js";
import { RouterEngine } from "./router/engine.js";
import { TaskCoordinator, PipelineManager } from "./tasks/index.js";

import type { Config, TasksConfig } from "./types.js";

const SERVER_NAME = "agent-router";
const SERVER_VERSION = "3.0.2";

/**
 * Creates and configures the MCP server
 * @returns Promise resolving to configured MCP Server instance
 */
export async function createServer(): Promise<McpServer> {
  // Create logger
  const logger = new Logger({ name: SERVER_NAME });

  logger.info("Creating AgentRouter MCP server", {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Load configuration (with fallback to defaults on error)
  let config: Config;
  let configManager: ConfigManager | undefined;

  try {
    configManager = await ConfigManager.load({
      watch: true,
      allowMissingEnv: true, // Allow missing env vars, will fail at runtime if needed
    });
    config = configManager.get();
    logger.info("Configuration loaded", {
      version: config.version,
      roleCount: Object.keys(config.roles).length,
      providerCount: Object.keys(config.providers).length,
      loadedPaths: configManager.getLoadedPaths(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to load configuration, using defaults", {
      errorMessage,
    });
    config = structuredClone(DEFAULT_CONFIG);
  }

  // Create ProviderManager and register all provider factories
  const providers = new ProviderManager();

  // Register provider factories
  providers.registerFactory("anthropic", (providerConfig) => new AnthropicProvider(providerConfig));
  providers.registerFactory("openai", (providerConfig) => new OpenAIProvider(providerConfig));
  providers.registerFactory("google", (providerConfig) => new GeminiProvider(providerConfig));
  providers.registerFactory("ollama", (providerConfig) => new OllamaProvider(providerConfig));
  // zai (GLM) uses dedicated ZAI provider (OpenAI-compatible API with correct name)
  providers.registerFactory("zai", (providerConfig) => new ZAIProvider(providerConfig));
  // kimi (Moonshot AI) uses dedicated Kimi provider (OpenAI-compatible API with correct name)
  providers.registerFactory("kimi", (providerConfig) => new KimiProvider(providerConfig));

  logger.debug("Provider factories registered", {
    providers: providers.listProviders(),
  });

  // Update provider configurations from loaded config
  providers.updateConfig(config.providers);

  logger.debug("Provider configurations updated", {
    configuredProviders: providers.listConfigured(),
  });

  // Create RouterEngine
  const router = new RouterEngine(config, providers, logger);

  logger.debug("RouterEngine created", {
    availableRoles: router.listRoles(),
  });

  // Create task integration modules if enabled
  let taskCoordinator: TaskCoordinator | undefined;
  let pipelineManager: PipelineManager | undefined;

  const tasksConfig = (config as { tasks?: TasksConfig }).tasks;
  if (tasksConfig?.enabled) {
    logger.info("Tasks integration enabled, creating task modules");
    taskCoordinator = new TaskCoordinator(logger);
    pipelineManager = new PipelineManager(logger);
  }

  // Create MCP server with capabilities
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tools
  registerTools(server, router, logger, taskCoordinator, pipelineManager);

  // Setup config change listener for hot reload
  if (configManager) {
    configManager.on("change", (newConfig) => {
      logger.info("Configuration changed, reloading...", {
        version: newConfig.version,
      });

      // Update router configuration
      router.updateConfig(newConfig);

      // Update provider configurations
      providers.updateConfig(newConfig.providers);

      logger.info("Configuration reloaded successfully");
    });

    configManager.on("error", (error, path) => {
      logger.error("Configuration reload failed", {
        errorMessage: error.message,
        path,
      });
    });
  }

  logger.info("MCP server created successfully");

  return server;
}

/**
 * Starts the server with stdio transport
 * @param server - The MCP server instance to start
 */
export async function startServer(server: McpServer): Promise<void> {
  const logger = new Logger({ name: SERVER_NAME });
  const transport = createStdioTransport();

  logger.info("Connecting to stdio transport...");

  await server.connect(transport);

  logger.info("AgentRouter MCP server is running");
}
