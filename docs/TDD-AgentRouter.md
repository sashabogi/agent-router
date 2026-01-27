# Technical Design Document (TDD)
# AgentRouter: Claude Code Multi-Agent Extension

**Version:** 1.0.0  
**Date:** January 27, 2026  
**Author:** Hive Development Team  
**Status:** Draft

---

## Table of Contents
1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Core Components](#3-core-components)
4. [Data Models](#4-data-models)
5. [API Specifications](#5-api-specifications)
6. [Translation Layer](#6-translation-layer)
7. [Configuration System](#7-configuration-system)
8. [MCP Integration](#8-mcp-integration)
9. [Orchestration Patterns](#9-orchestration-patterns)
10. [Error Handling](#10-error-handling)
11. [Security](#11-security)
12. [Testing Strategy](#12-testing-strategy)
13. [Deployment](#13-deployment)
14. [Implementation Plan](#14-implementation-plan)

---

## 1. Overview

### 1.1 Purpose
This document provides the technical specification for AgentRouter, a multi-agent orchestration system that extends Claude Code with the ability to route tasks to specialized AI agents from different LLM providers.

### 1.2 Scope
- MCP server implementation for Claude Code integration
- Role-based agent configuration and routing
- API translation layer for multi-provider support
- Orchestration patterns for agent collaboration
- Configuration management with hot reload

### 1.3 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Node.js 20+ / Bun | Fast startup, excellent TypeScript support, MCP SDK compatibility |
| Language | TypeScript 5.x | Type safety, better tooling, MCP SDK is TypeScript |
| Translation | LiteLLM (Python) or custom | Proven bidirectional translation, 100+ providers |
| Configuration | YAML + JSON Schema | Human-readable, validation, IDE support |
| MCP SDK | @modelcontextprotocol/sdk | Official Anthropic SDK for MCP servers |
| HTTP Client | undici / fetch | Modern, fast, streaming support |
| Testing | Vitest | Fast, TypeScript-native, compatible with Jest |
| Logging | pino | High-performance structured logging |

### 1.4 Design Principles

1. **Separation of Concerns**: Router logic, translation, and provider adapters are independent
2. **Configuration-Driven**: All behavior configurable without code changes
3. **Fail-Safe Defaults**: Sensible defaults that work out of the box
4. **Provider Agnostic**: Core logic doesn't depend on specific providers
5. **Explicit Over Implicit**: Agent invocation is explicit, not magic routing
6. **Stateless Core**: No shared state between requests (enables horizontal scaling)

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Claude Code                                     │
│                         (MCP Client / Orchestrator)                         │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ stdio / MCP Protocol
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AgentRouter MCP Server                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         MCP Transport Layer                             │ │
│  │                    (stdio / SSE / WebSocket)                           │ │
│  └────────────────────────────────┬───────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────────────────────▼───────────────────────────────────────┐ │
│  │                         Tool Handler                                    │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │invoke_agent │  │compare_agents│ │critique_plan│  │   ...       │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼──────────┘ │
│            │                │                │                │             │
│  ┌─────────▼────────────────▼────────────────▼────────────────▼──────────┐ │
│  │                         Router Engine                                  │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │ │
│  │  │  Role Resolver  │  │Pattern Executor │  │ Context Manager │       │ │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘       │ │
│  └───────────┼────────────────────┼────────────────────┼─────────────────┘ │
│              │                    │                    │                    │
│  ┌───────────▼────────────────────▼────────────────────▼─────────────────┐ │
│  │                      Config Manager                                    │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │ │
│  │  │ File Watcher│  │  Validator  │  │   Merger    │                   │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      Provider Manager                                   │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │  Anthropic  │  │   OpenAI    │  │   Gemini    │  │   Ollama    │   │ │
│  │  │  Provider   │  │  Provider   │  │  Provider   │  │  Provider   │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼──────────┘ │
│            │                │                │                │             │
│  ┌─────────▼────────────────▼────────────────▼────────────────▼──────────┐ │
│  │                    Translation Layer                                   │ │
│  │              (Anthropic ↔ OpenAI ↔ Gemini ↔ etc.)                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                │                │
                    ▼                ▼                ▼
               Anthropic         OpenAI           Gemini
                 API              API              API
```

### 2.2 Component Interaction Flow

```
1. Claude Code invokes MCP tool (e.g., invoke_agent)
                    │
                    ▼
2. MCP Transport receives request, parses tool call
                    │
                    ▼
3. Tool Handler validates input, extracts role + task
                    │
                    ▼
4. Router Engine resolves role → provider configuration
                    │
                    ▼
5. Config Manager provides agent config (system prompt, model, params)
                    │
                    ▼
6. Provider Manager selects appropriate provider adapter
                    │
                    ▼
7. Translation Layer converts request to provider format
                    │
                    ▼
8. Provider Adapter sends request, handles streaming
                    │
                    ▼
9. Translation Layer converts response back to Anthropic format
                    │
                    ▼
10. Tool Handler formats response for MCP
                    │
                    ▼
11. MCP Transport sends response to Claude Code
```

### 2.3 Directory Structure

```
agent-router/
├── src/
│   ├── index.ts                    # Entry point
│   ├── server.ts                   # MCP server setup
│   │
│   ├── mcp/
│   │   ├── tools/
│   │   │   ├── index.ts            # Tool registry
│   │   │   ├── invoke-agent.ts     # invoke_agent tool
│   │   │   ├── compare-agents.ts   # compare_agents tool
│   │   │   ├── critique-plan.ts    # critique_plan shorthand
│   │   │   ├── review-code.ts      # review_code shorthand
│   │   │   └── design-feedback.ts  # design_feedback shorthand
│   │   │
│   │   └── transport/
│   │       ├── stdio.ts            # stdio transport
│   │       └── sse.ts              # SSE transport (optional)
│   │
│   ├── router/
│   │   ├── engine.ts               # Main routing logic
│   │   ├── role-resolver.ts        # Role → config resolution
│   │   ├── pattern-executor.ts     # Orchestration patterns
│   │   └── context-manager.ts      # Conversation context
│   │
│   ├── config/
│   │   ├── manager.ts              # Config loading, watching
│   │   ├── schema.ts               # JSON Schema definitions
│   │   ├── validator.ts            # Config validation
│   │   ├── merger.ts               # Config layer merging
│   │   └── defaults.ts             # Default configuration
│   │
│   ├── providers/
│   │   ├── base.ts                 # Provider interface
│   │   ├── manager.ts              # Provider registry
│   │   ├── anthropic.ts            # Anthropic provider
│   │   ├── openai.ts               # OpenAI provider
│   │   ├── gemini.ts               # Gemini provider
│   │   ├── ollama.ts               # Ollama provider
│   │   └── openrouter.ts           # OpenRouter provider
│   │
│   ├── translation/
│   │   ├── index.ts                # Translation coordinator
│   │   ├── messages.ts             # Message format translation
│   │   ├── tools.ts                # Tool schema translation
│   │   ├── streaming.ts            # SSE event translation
│   │   └── errors.ts               # Error format translation
│   │
│   ├── observability/
│   │   ├── logger.ts               # Structured logging
│   │   ├── metrics.ts              # OpenTelemetry metrics
│   │   └── tracing.ts              # Request tracing
│   │
│   └── utils/
│       ├── env.ts                  # Environment variable handling
│       ├── retry.ts                # Retry with backoff
│       └── circuit-breaker.ts      # Circuit breaker implementation
│
├── config/
│   ├── default.yaml                # Default configuration
│   └── schema.json                 # JSON Schema for validation
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── configuration.md
│   ├── providers.md
│   └── orchestration-patterns.md
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. Core Components

### 3.1 MCP Server

The MCP server is the entry point for Claude Code integration.

```typescript
// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp/tools/index.js";
import { ConfigManager } from "./config/manager.js";
import { RouterEngine } from "./router/engine.js";
import { ProviderManager } from "./providers/manager.js";
import { Logger } from "./observability/logger.js";

export async function createServer(): Promise<Server> {
  const logger = new Logger();
  const config = await ConfigManager.load();
  const providers = new ProviderManager(config.providers, logger);
  const router = new RouterEngine(config, providers, logger);

  const server = new Server(
    {
      name: "agent-router",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register all tools
  registerTools(server, router, logger);

  // Watch for config changes
  config.on("change", (newConfig) => {
    router.updateConfig(newConfig);
    providers.updateConfig(newConfig.providers);
  });

  return server;
}

// Entry point
async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

### 3.2 Router Engine

The router engine is responsible for resolving roles to configurations and executing orchestration patterns.

```typescript
// src/router/engine.ts
import { RoleResolver } from "./role-resolver.js";
import { PatternExecutor } from "./pattern-executor.js";
import { ContextManager } from "./context-manager.js";
import { ProviderManager } from "../providers/manager.js";
import { ConfigManager } from "../config/manager.js";
import { Logger } from "../observability/logger.js";
import type { AgentConfig, InvokeAgentInput, AgentResponse } from "../types.js";

export class RouterEngine {
  private roleResolver: RoleResolver;
  private patternExecutor: PatternExecutor;
  private contextManager: ContextManager;
  private providers: ProviderManager;
  private logger: Logger;

  constructor(
    config: ConfigManager,
    providers: ProviderManager,
    logger: Logger
  ) {
    this.roleResolver = new RoleResolver(config);
    this.patternExecutor = new PatternExecutor(this);
    this.contextManager = new ContextManager();
    this.providers = providers;
    this.logger = logger;
  }

  async invokeAgent(input: InvokeAgentInput): Promise<AgentResponse> {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();

    this.logger.info("Invoking agent", {
      traceId,
      role: input.role,
      taskPreview: input.task.substring(0, 100),
    });

    try {
      // 1. Resolve role to agent configuration
      const agentConfig = this.roleResolver.resolve(input.role);

      // 2. Build messages with system prompt and context
      const messages = this.buildMessages(agentConfig, input);

      // 3. Get provider for this agent
      const provider = this.providers.get(agentConfig.provider);

      // 4. Execute request
      const response = await provider.complete({
        model: agentConfig.model,
        messages,
        temperature: agentConfig.temperature,
        max_tokens: agentConfig.max_tokens,
        tools: input.tools,
      });

      const duration = Date.now() - startTime;
      this.logger.info("Agent response received", {
        traceId,
        role: input.role,
        provider: agentConfig.provider,
        durationMs: duration,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      });

      return {
        role: input.role,
        provider: agentConfig.provider,
        model: agentConfig.model,
        content: response.content,
        usage: response.usage,
        metadata: {
          traceId,
          durationMs: duration,
        },
      };
    } catch (error) {
      this.logger.error("Agent invocation failed", {
        traceId,
        role: input.role,
        error: error instanceof Error ? error.message : String(error),
      });

      // Try fallback if configured
      const agentConfig = this.roleResolver.resolve(input.role);
      if (agentConfig.fallback) {
        this.logger.info("Attempting fallback provider", {
          traceId,
          fallbackProvider: agentConfig.fallback.provider,
        });
        return this.invokeWithFallback(input, agentConfig.fallback, traceId);
      }

      throw error;
    }
  }

  async compareAgents(
    roles: string[],
    task: string
  ): Promise<Map<string, AgentResponse>> {
    const results = new Map<string, AgentResponse>();

    // Execute in parallel
    const promises = roles.map(async (role) => {
      const response = await this.invokeAgent({ role, task });
      return { role, response };
    });

    const responses = await Promise.allSettled(promises);

    for (const result of responses) {
      if (result.status === "fulfilled") {
        results.set(result.value.role, result.value.response);
      } else {
        this.logger.error("Agent comparison failed for role", {
          error: result.reason,
        });
      }
    }

    return results;
  }

  private buildMessages(
    agentConfig: AgentConfig,
    input: InvokeAgentInput
  ): Message[] {
    const messages: Message[] = [];

    // Add system prompt
    if (agentConfig.system_prompt) {
      messages.push({
        role: "user",
        content: `<system>${agentConfig.system_prompt}</system>`,
      });
    }

    // Add context if provided
    if (input.context) {
      messages.push({
        role: "user",
        content: `<context>${input.context}</context>`,
      });
    }

    // Add the task
    messages.push({
      role: "user",
      content: input.task,
    });

    return messages;
  }

  private async invokeWithFallback(
    input: InvokeAgentInput,
    fallbackConfig: FallbackConfig,
    traceId: string
  ): Promise<AgentResponse> {
    // Similar to invokeAgent but with fallback config
    // ... implementation
  }

  updateConfig(newConfig: Config) {
    this.roleResolver.updateConfig(newConfig);
  }
}
```

### 3.3 Role Resolver

Maps role names to their configured agent settings.

```typescript
// src/router/role-resolver.ts
import type { AgentConfig, RoleConfig, Config } from "../types.js";

export class RoleResolver {
  private roles: Map<string, RoleConfig>;
  private defaults: DefaultConfig;

  constructor(config: Config) {
    this.roles = new Map(Object.entries(config.roles));
    this.defaults = config.defaults;
  }

  resolve(role: string): AgentConfig {
    const roleConfig = this.roles.get(role);

    if (!roleConfig) {
      throw new Error(
        `Unknown role: ${role}. Available roles: ${Array.from(this.roles.keys()).join(", ")}`
      );
    }

    // Merge with defaults
    return {
      provider: roleConfig.provider,
      model: roleConfig.model,
      system_prompt: roleConfig.system_prompt,
      temperature: roleConfig.temperature ?? this.defaults.temperature,
      max_tokens: roleConfig.max_tokens ?? this.defaults.max_tokens,
      timeout_ms: roleConfig.timeout_ms ?? this.defaults.timeout_ms,
      fallback: roleConfig.fallback,
    };
  }

  listRoles(): string[] {
    return Array.from(this.roles.keys());
  }

  hasRole(role: string): boolean {
    return this.roles.has(role);
  }

  updateConfig(newConfig: Config) {
    this.roles = new Map(Object.entries(newConfig.roles));
    this.defaults = newConfig.defaults;
  }
}
```

### 3.4 Provider Manager

Manages provider instances and handles provider selection.

```typescript
// src/providers/manager.ts
import type { Provider, ProviderConfig } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import { Logger } from "../observability/logger.js";

export class ProviderManager {
  private providers: Map<string, Provider> = new Map();
  private logger: Logger;

  constructor(config: Record<string, ProviderConfig>, logger: Logger) {
    this.logger = logger;
    this.initializeProviders(config);
  }

  private initializeProviders(config: Record<string, ProviderConfig>) {
    for (const [name, providerConfig] of Object.entries(config)) {
      const provider = this.createProvider(name, providerConfig);
      if (provider) {
        this.providers.set(name, provider);
        this.logger.info(`Initialized provider: ${name}`);
      }
    }
  }

  private createProvider(
    name: string,
    config: ProviderConfig
  ): Provider | null {
    switch (name) {
      case "anthropic":
        return new AnthropicProvider(config, this.logger);
      case "zai":
        // Z.AI uses Anthropic-compatible API
        return new AnthropicProvider(
          { ...config, base_url: config.base_url ?? "https://api.z.ai/api/anthropic" },
          this.logger
        );
      case "openai":
        return new OpenAIProvider(config, this.logger);
      case "google":
      case "gemini":
        return new GeminiProvider(config, this.logger);
      case "ollama":
        return new OllamaProvider(config, this.logger);
      case "openrouter":
        return new OpenRouterProvider(config, this.logger);
      default:
        this.logger.warn(`Unknown provider: ${name}`);
        return null;
    }
  }

  get(name: string): Provider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Provider not found: ${name}. Available: ${Array.from(this.providers.keys()).join(", ")}`
      );
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [name, provider] of this.providers) {
      try {
        await provider.healthCheck();
        results.set(name, true);
      } catch {
        results.set(name, false);
      }
    }

    return results;
  }

  updateConfig(newConfig: Record<string, ProviderConfig>) {
    // Reinitialize providers with new config
    this.providers.clear();
    this.initializeProviders(newConfig);
  }
}
```

---

## 4. Data Models

### 4.1 Configuration Types

```typescript
// src/types.ts

// ============ Configuration Types ============

export interface Config {
  version: string;
  defaults: DefaultConfig;
  roles: Record<string, RoleConfig>;
  providers: Record<string, ProviderConfig>;
}

export interface DefaultConfig {
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
}

export interface RoleConfig {
  provider: string;
  model: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  fallback?: FallbackConfig;
}

export interface FallbackConfig {
  provider: string;
  model: string;
}

export interface ProviderConfig {
  api_key?: string;
  base_url?: string;
  organization?: string;
  project?: string;
  location?: string;
  headers?: Record<string, string>;
}

// ============ Agent Types ============

export interface AgentConfig {
  provider: string;
  model: string;
  system_prompt?: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  fallback?: FallbackConfig;
}

export interface InvokeAgentInput {
  role: string;
  task: string;
  context?: string;
  tools?: Tool[];
}

export interface AgentResponse {
  role: string;
  provider: string;
  model: string;
  content: ContentBlock[];
  usage?: UsageInfo;
  metadata: {
    traceId: string;
    durationMs: number;
  };
}

// ============ Message Types ============

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

// ============ Tool Types ============

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============ Provider Types ============

export interface CompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  tools?: Tool[];
  stream?: boolean;
}

export interface CompletionResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  usage?: UsageInfo;
}

export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface Provider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  completeStream(request: CompletionRequest): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<void>;
}

export interface StreamChunk {
  type: "content_block_start" | "content_block_delta" | "message_stop";
  index?: number;
  content_block?: ContentBlock;
  delta?: { type: string; text?: string };
}
```

### 4.2 JSON Schema for Configuration

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://agent-router.dev/schema/config.json",
  "title": "AgentRouter Configuration",
  "type": "object",
  "required": ["version", "roles", "providers"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$",
      "description": "Configuration schema version"
    },
    "defaults": {
      "type": "object",
      "properties": {
        "temperature": {
          "type": "number",
          "minimum": 0,
          "maximum": 2,
          "default": 0.7
        },
        "max_tokens": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200000,
          "default": 4096
        },
        "timeout_ms": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 600000,
          "default": 60000
        }
      }
    },
    "roles": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/definitions/RoleConfig"
      }
    },
    "providers": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/definitions/ProviderConfig"
      }
    }
  },
  "definitions": {
    "RoleConfig": {
      "type": "object",
      "required": ["provider", "model"],
      "properties": {
        "provider": {
          "type": "string",
          "description": "Provider name (must match a key in providers)"
        },
        "model": {
          "type": "string",
          "description": "Model identifier"
        },
        "system_prompt": {
          "type": "string",
          "description": "System prompt / persona for this role"
        },
        "temperature": {
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "max_tokens": {
          "type": "integer",
          "minimum": 1
        },
        "timeout_ms": {
          "type": "integer",
          "minimum": 1000
        },
        "fallback": {
          "$ref": "#/definitions/FallbackConfig"
        }
      }
    },
    "FallbackConfig": {
      "type": "object",
      "required": ["provider", "model"],
      "properties": {
        "provider": { "type": "string" },
        "model": { "type": "string" }
      }
    },
    "ProviderConfig": {
      "type": "object",
      "properties": {
        "api_key": {
          "type": "string",
          "description": "API key (supports ${ENV_VAR} interpolation)"
        },
        "base_url": {
          "type": "string",
          "format": "uri"
        },
        "organization": { "type": "string" },
        "project": { "type": "string" },
        "location": { "type": "string" },
        "headers": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
      }
    }
  }
}
```

---

## 5. API Specifications

### 5.1 MCP Tool: invoke_agent

```typescript
// src/mcp/tools/invoke-agent.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { RouterEngine } from "../../router/engine.js";
import { Logger } from "../../observability/logger.js";

export function registerInvokeAgentTool(
  server: Server,
  router: RouterEngine,
  logger: Logger
) {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "invoke_agent") {
      return undefined; // Let other handlers process
    }

    const { role, task, context } = request.params.arguments as {
      role: string;
      task: string;
      context?: string;
    };

    logger.info("invoke_agent called", { role, taskLength: task.length });

    const response = await router.invokeAgent({ role, task, context });

    // Format response for MCP
    return {
      content: [
        {
          type: "text",
          text: formatAgentResponse(response),
        },
      ],
    };
  });
}

function formatAgentResponse(response: AgentResponse): string {
  const header = `## ${response.role.toUpperCase()} Agent Response\n`;
  const meta = `*Provider: ${response.provider} | Model: ${response.model} | Duration: ${response.metadata.durationMs}ms*\n\n`;
  
  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return header + meta + content;
}
```

**Tool Definition:**
```json
{
  "name": "invoke_agent",
  "description": "Invoke a specialized AI agent for a specific task. Available roles: coder (code generation), critic (plan review, assumption challenging), designer (UI/UX feedback), researcher (fact-finding), reviewer (code review).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "role": {
        "type": "string",
        "description": "The agent role to invoke. Use 'critic' for plan/PRD review, 'designer' for UI/UX feedback, 'reviewer' for code review.",
        "enum": ["coder", "critic", "designer", "researcher", "reviewer"]
      },
      "task": {
        "type": "string",
        "description": "The task description or question for the agent"
      },
      "context": {
        "type": "string",
        "description": "Optional additional context from the current conversation"
      }
    },
    "required": ["role", "task"]
  }
}
```

### 5.2 MCP Tool: compare_agents

```typescript
// src/mcp/tools/compare-agents.ts
export function registerCompareAgentsTool(
  server: Server,
  router: RouterEngine,
  logger: Logger
) {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "compare_agents") {
      return undefined;
    }

    const { roles, task } = request.params.arguments as {
      roles: string[];
      task: string;
    };

    logger.info("compare_agents called", { roles, taskLength: task.length });

    const results = await router.compareAgents(roles, task);

    return {
      content: [
        {
          type: "text",
          text: formatComparisonResults(results),
        },
      ],
    };
  });
}

function formatComparisonResults(results: Map<string, AgentResponse>): string {
  let output = "# Agent Comparison Results\n\n";

  for (const [role, response] of results) {
    output += `## ${role.toUpperCase()} (${response.provider}/${response.model})\n`;
    output += `*Duration: ${response.metadata.durationMs}ms*\n\n`;
    output += response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    output += "\n\n---\n\n";
  }

  return output;
}
```

### 5.3 MCP Tool: critique_plan (Shorthand)

```typescript
// src/mcp/tools/critique-plan.ts
export function registerCritiquePlanTool(
  server: Server,
  router: RouterEngine,
  logger: Logger
) {
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "critique_plan") {
      return undefined;
    }

    const { plan, focus_areas } = request.params.arguments as {
      plan: string;
      focus_areas?: string[];
    };

    // Build enhanced task with focus areas
    let task = `Please critically review the following plan:\n\n${plan}`;
    
    if (focus_areas?.length) {
      task += `\n\nPay particular attention to:\n${focus_areas.map((a) => `- ${a}`).join("\n")}`;
    }

    const response = await router.invokeAgent({
      role: "critic",
      task,
    });

    return {
      content: [
        {
          type: "text",
          text: formatCritiqueResponse(response),
        },
      ],
    };
  });
}
```

**Tool Definition:**
```json
{
  "name": "critique_plan",
  "description": "Get critical feedback on a plan, PRD, or technical design. The critic agent will challenge assumptions, identify risks, and push for improvements.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "plan": {
        "type": "string",
        "description": "The plan, PRD, or technical design to critique"
      },
      "focus_areas": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional specific areas to focus the critique on"
      }
    },
    "required": ["plan"]
  }
}
```

---

## 6. Translation Layer

### 6.1 Message Format Translation

```typescript
// src/translation/messages.ts

/**
 * Translates messages between Anthropic and OpenAI formats
 */
export class MessageTranslator {
  /**
   * Convert Anthropic messages to OpenAI format
   */
  anthropicToOpenAI(messages: AnthropicMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role,
          content: msg.content,
        };
      }

      // Handle content blocks
      const parts: OpenAIMessagePart[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          // OpenAI uses function_call or tool_calls
          return {
            role: "assistant",
            tool_calls: [
              {
                id: block.id,
                type: "function",
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              },
            ],
          };
        } else if (block.type === "tool_result") {
          return {
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: block.content,
          };
        }
      }

      return {
        role: msg.role,
        content: parts.length === 1 ? parts[0].text : parts,
      };
    });
  }

  /**
   * Convert OpenAI messages to Anthropic format
   */
  openAIToAnthropic(messages: OpenAIMessage[]): AnthropicMessage[] {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        };
      }

      if (msg.tool_calls) {
        return {
          role: "assistant",
          content: msg.tool_calls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        };
      }

      return {
        role: msg.role as "user" | "assistant",
        content: typeof msg.content === "string" 
          ? msg.content 
          : this.openAIContentToAnthropic(msg.content),
      };
    });
  }

  /**
   * Convert Anthropic messages to Gemini format
   */
  anthropicToGemini(messages: AnthropicMessage[]): GeminiContent[] {
    return messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: this.anthropicContentToGeminiParts(msg.content),
    }));
  }

  private anthropicContentToGeminiParts(
    content: string | AnthropicContentBlock[]
  ): GeminiPart[] {
    if (typeof content === "string") {
      return [{ text: content }];
    }

    return content.map((block) => {
      if (block.type === "text") {
        return { text: block.text };
      } else if (block.type === "tool_use") {
        return {
          functionCall: {
            name: block.name,
            args: block.input,
          },
        };
      } else if (block.type === "tool_result") {
        return {
          functionResponse: {
            name: block.tool_use_id, // Gemini needs the function name
            response: { content: block.content },
          },
        };
      }
      return { text: "" };
    });
  }
}
```

### 6.2 Tool Schema Translation

```typescript
// src/translation/tools.ts

/**
 * Translates tool/function schemas between providers
 */
export class ToolTranslator {
  /**
   * Convert Anthropic tool schema to OpenAI function schema
   */
  anthropicToOpenAI(tools: AnthropicTool[]): OpenAIFunction[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema, // Schema format is compatible
      },
    }));
  }

  /**
   * Convert OpenAI function schema to Anthropic tool schema
   */
  openAIToAnthropic(functions: OpenAIFunction[]): AnthropicTool[] {
    return functions.map((fn) => ({
      name: fn.function.name,
      description: fn.function.description,
      input_schema: fn.function.parameters,
    }));
  }

  /**
   * Convert Anthropic tool schema to Gemini function declaration
   */
  anthropicToGemini(tools: AnthropicTool[]): GeminiFunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.convertSchemaToGemini(tool.input_schema),
    }));
  }

  private convertSchemaToGemini(schema: JSONSchema): GeminiSchema {
    // Gemini uses a subset of JSON Schema
    // Convert type names, handle nested objects, etc.
    return {
      type: this.geminiType(schema.type),
      description: schema.description,
      properties: schema.properties
        ? Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [
              key,
              this.convertSchemaToGemini(value as JSONSchema),
            ])
          )
        : undefined,
      required: schema.required,
      items: schema.items
        ? this.convertSchemaToGemini(schema.items as JSONSchema)
        : undefined,
    };
  }

  private geminiType(type: string | string[]): string {
    const typeMap: Record<string, string> = {
      string: "STRING",
      number: "NUMBER",
      integer: "INTEGER",
      boolean: "BOOLEAN",
      array: "ARRAY",
      object: "OBJECT",
    };
    const t = Array.isArray(type) ? type[0] : type;
    return typeMap[t] || "STRING";
  }
}
```

### 6.3 Streaming Translation

```typescript
// src/translation/streaming.ts

/**
 * Translates streaming events between providers
 */
export class StreamTranslator {
  /**
   * Convert OpenAI stream chunks to Anthropic format
   */
  async *openAIToAnthropic(
    stream: AsyncIterable<OpenAIChatCompletionChunk>
  ): AsyncIterable<AnthropicStreamEvent> {
    let contentIndex = 0;
    let started = false;

    for await (const chunk of stream) {
      if (!started) {
        yield {
          type: "message_start",
          message: {
            id: chunk.id,
            type: "message",
            role: "assistant",
            content: [],
            model: chunk.model,
            usage: null,
          },
        };
        started = true;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta.content) {
        if (contentIndex === 0) {
          yield {
            type: "content_block_start",
            index: contentIndex,
            content_block: { type: "text", text: "" },
          };
        }

        yield {
          type: "content_block_delta",
          index: contentIndex,
          delta: { type: "text_delta", text: choice.delta.content },
        };
      }

      if (choice.delta.tool_calls) {
        for (const toolCall of choice.delta.tool_calls) {
          yield {
            type: "content_block_start",
            index: toolCall.index,
            content_block: {
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function?.name || "",
              input: {},
            },
          };

          if (toolCall.function?.arguments) {
            yield {
              type: "content_block_delta",
              index: toolCall.index,
              delta: {
                type: "input_json_delta",
                partial_json: toolCall.function.arguments,
              },
            };
          }
        }
      }

      if (choice.finish_reason) {
        yield { type: "content_block_stop", index: contentIndex };
        yield {
          type: "message_delta",
          delta: { stop_reason: this.mapStopReason(choice.finish_reason) },
          usage: chunk.usage
            ? {
                output_tokens: chunk.usage.completion_tokens,
              }
            : undefined,
        };
        yield { type: "message_stop" };
      }
    }
  }

  private mapStopReason(
    openAIReason: string
  ): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
    const map: Record<string, any> = {
      stop: "end_turn",
      length: "max_tokens",
      tool_calls: "tool_use",
      content_filter: "end_turn",
    };
    return map[openAIReason] || "end_turn";
  }
}
```

---

## 7. Configuration System

### 7.1 Config Manager

```typescript
// src/config/manager.ts
import { EventEmitter } from "events";
import { watch } from "fs";
import { readFile } from "fs/promises";
import { parse as parseYAML } from "yaml";
import { join } from "path";
import { homedir } from "os";
import { ConfigValidator } from "./validator.js";
import { ConfigMerger } from "./merger.js";
import { defaultConfig } from "./defaults.js";
import type { Config } from "../types.js";

export class ConfigManager extends EventEmitter {
  private config: Config;
  private validator: ConfigValidator;
  private merger: ConfigMerger;
  private configPaths: string[];

  private constructor() {
    super();
    this.validator = new ConfigValidator();
    this.merger = new ConfigMerger();
    this.configPaths = this.getConfigPaths();
  }

  static async load(): Promise<ConfigManager> {
    const manager = new ConfigManager();
    await manager.loadConfig();
    manager.watchConfig();
    return manager;
  }

  private getConfigPaths(): string[] {
    return [
      // Project-level config (highest priority)
      join(process.cwd(), ".agent-router.yaml"),
      join(process.cwd(), ".agent-router.yml"),
      // User-level config
      join(homedir(), ".config", "agent-router", "config.yaml"),
      join(homedir(), ".config", "agent-router", "config.yml"),
      // System-level config (lowest priority)
      "/etc/agent-router/config.yaml",
    ];
  }

  private async loadConfig(): Promise<void> {
    let merged = { ...defaultConfig };

    // Load configs in reverse priority order (lowest first)
    for (const configPath of [...this.configPaths].reverse()) {
      try {
        const content = await readFile(configPath, "utf-8");
        const parsed = parseYAML(content);
        
        // Interpolate environment variables
        const interpolated = this.interpolateEnv(parsed);
        
        // Validate
        this.validator.validate(interpolated);
        
        // Merge
        merged = this.merger.merge(merged, interpolated);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Warning: Failed to load config from ${configPath}:`, error);
        }
      }
    }

    this.config = merged;
  }

  private interpolateEnv(obj: any): any {
    if (typeof obj === "string") {
      // Replace ${ENV_VAR} with actual env value
      return obj.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
        const value = process.env[envVar];
        if (value === undefined) {
          throw new Error(`Environment variable ${envVar} is not set`);
        }
        return value;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateEnv(item));
    }

    if (typeof obj === "object" && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key,
          this.interpolateEnv(value),
        ])
      );
    }

    return obj;
  }

  private watchConfig(): void {
    for (const configPath of this.configPaths) {
      try {
        watch(configPath, async (eventType) => {
          if (eventType === "change") {
            console.log(`Config file changed: ${configPath}`);
            try {
              await this.loadConfig();
              this.emit("change", this.config);
            } catch (error) {
              console.error("Failed to reload config:", error);
            }
          }
        });
      } catch {
        // File doesn't exist, that's okay
      }
    }
  }

  get(): Config {
    return this.config;
  }

  getRoles(): Record<string, RoleConfig> {
    return this.config.roles;
  }

  getProviders(): Record<string, ProviderConfig> {
    return this.config.providers;
  }

  getDefaults(): DefaultConfig {
    return this.config.defaults;
  }
}
```

### 7.2 Default Configuration

```typescript
// src/config/defaults.ts
import type { Config } from "../types.js";

export const defaultConfig: Config = {
  version: "1.0",
  
  defaults: {
    temperature: 0.7,
    max_tokens: 4096,
    timeout_ms: 60000,
  },

  roles: {
    coder: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      system_prompt: `You are an expert software engineer. Write clean, efficient, well-documented code.
Follow best practices, use appropriate design patterns, and consider edge cases.
Provide explanations for complex logic.`,
    },

    critic: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.3,
      system_prompt: `You are a skeptical senior architect and technical reviewer. Your job is to:

1. **Challenge Assumptions**: Don't accept claims at face value. Ask "Why?" and "What if?"
2. **Identify Risks**: Find failure modes, edge cases, and potential issues
3. **Question Scope**: Is the solution over-engineered? Under-specified?
4. **Check Completeness**: What's missing? What hasn't been considered?
5. **Push for Excellence**: "Good enough" isn't good enough. Find ways to improve.

Be constructive but rigorous. Your goal is to make plans better, not to tear them down.
Provide specific, actionable feedback.`,
      fallback: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      },
    },

    designer: {
      provider: "google",
      model: "gemini-2.5-pro",
      system_prompt: `You are a senior UI/UX designer and frontend architect. Focus on:

1. **User Experience**: Is it intuitive? Accessible? Delightful?
2. **Visual Hierarchy**: Does the layout guide the user's eye?
3. **Component Architecture**: Are components reusable? Maintainable?
4. **Design Systems**: Does it follow established patterns?
5. **Responsive Design**: How does it work across devices?
6. **Accessibility**: WCAG compliance, keyboard navigation, screen readers

Provide specific feedback with examples and alternatives where applicable.`,
    },

    researcher: {
      provider: "google",
      model: "gemini-2.5-pro",
      system_prompt: `You are a research analyst. Provide well-researched, factual information.
When possible, cite sources or indicate confidence levels.
If you're uncertain, say so. Prefer accuracy over completeness.`,
    },

    reviewer: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.2,
      system_prompt: `You are a senior code reviewer. Review code for:

1. **Correctness**: Does it work? Are there bugs?
2. **Security**: SQL injection, XSS, auth issues, data exposure
3. **Performance**: N+1 queries, unnecessary computations, memory leaks
4. **Maintainability**: Is it readable? Well-structured? Documented?
5. **Best Practices**: Follows language/framework conventions?
6. **Testing**: Is it testable? Are there missing tests?

Be specific. Reference line numbers. Suggest improvements with code examples.`,
    },
  },

  providers: {
    anthropic: {
      api_key: "${ANTHROPIC_API_KEY}",
      base_url: "https://api.anthropic.com",
    },
    openai: {
      api_key: "${OPENAI_API_KEY}",
      base_url: "https://api.openai.com/v1",
    },
    google: {
      api_key: "${GEMINI_API_KEY}",
    },
    zai: {
      api_key: "${ZAI_API_KEY}",
      base_url: "https://api.z.ai/api/anthropic",
    },
    ollama: {
      base_url: "http://localhost:11434",
    },
  },
};
```

---
## 8. MCP Integration

### 8.1 Tool Registration

```typescript
// src/mcp/tools/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { RouterEngine } from "../../router/engine.js";
import { Logger } from "../../observability/logger.js";
import { registerInvokeAgentTool } from "./invoke-agent.js";
import { registerCompareAgentsTool } from "./compare-agents.js";
import { registerCritiquePlanTool } from "./critique-plan.js";
import { registerReviewCodeTool } from "./review-code.js";
import { registerDesignFeedbackTool } from "./design-feedback.js";

export function registerTools(
  server: Server,
  router: RouterEngine,
  logger: Logger
) {
  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "invoke_agent",
        description:
          "Invoke a specialized AI agent for a specific task. Available roles: coder, critic, designer, researcher, reviewer.",
        inputSchema: {
          type: "object",
          properties: {
            role: {
              type: "string",
              description: "The agent role to invoke",
              enum: ["coder", "critic", "designer", "researcher", "reviewer"],
            },
            task: {
              type: "string",
              description: "The task or question for the agent",
            },
            context: {
              type: "string",
              description: "Optional context from the current conversation",
            },
          },
          required: ["role", "task"],
        },
      },
      {
        name: "compare_agents",
        description:
          "Run the same task through multiple agents and compare their responses",
        inputSchema: {
          type: "object",
          properties: {
            roles: {
              type: "array",
              items: { type: "string" },
              description: "List of agent roles to compare",
            },
            task: {
              type: "string",
              description: "The task to send to all agents",
            },
          },
          required: ["roles", "task"],
        },
      },
      {
        name: "critique_plan",
        description:
          "Get critical feedback on a plan, PRD, or technical design from the critic agent",
        inputSchema: {
          type: "object",
          properties: {
            plan: {
              type: "string",
              description: "The plan or document to critique",
            },
            focus_areas: {
              type: "array",
              items: { type: "string" },
              description: "Specific areas to focus the critique on",
            },
          },
          required: ["plan"],
        },
      },
      {
        name: "review_code",
        description:
          "Get code review feedback from the reviewer agent",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The code to review",
            },
            language: {
              type: "string",
              description: "Programming language",
            },
            focus: {
              type: "array",
              items: { type: "string" },
              description: "Specific aspects to focus on (security, performance, etc.)",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "design_feedback",
        description:
          "Get UI/UX design feedback from the designer agent",
        inputSchema: {
          type: "object",
          properties: {
            design: {
              type: "string",
              description: "Description of the design, component, or UI",
            },
            context: {
              type: "string",
              description: "Context about the application and users",
            },
          },
          required: ["design"],
        },
      },
      {
        name: "list_agents",
        description: "List all available agent roles and their configurations",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  // Register individual tool handlers
  registerInvokeAgentTool(server, router, logger);
  registerCompareAgentsTool(server, router, logger);
  registerCritiquePlanTool(server, router, logger);
  registerReviewCodeTool(server, router, logger);
  registerDesignFeedbackTool(server, router, logger);
}
```

### 8.2 Claude Code Configuration

To integrate AgentRouter with Claude Code, users add to their `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agent-router": {
      "command": "npx",
      "args": ["-y", "@hive/agent-router"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "GEMINI_API_KEY": "..."
      }
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "agent-router": {
      "command": "node",
      "args": ["/path/to/agent-router/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "GEMINI_API_KEY": "..."
      }
    }
  }
}
```

---

## 9. Orchestration Patterns

### 9.1 Pattern Executor

```typescript
// src/router/pattern-executor.ts
import { RouterEngine } from "./engine.js";
import type { AgentResponse, OrchestrationResult } from "../types.js";

export class PatternExecutor {
  constructor(private router: RouterEngine) {}

  /**
   * Sequential Pipeline: A → B → C
   * Each agent's output becomes input to the next
   */
  async sequential(
    steps: Array<{ role: string; transform?: (input: string) => string }>
  , initialInput: string): Promise<OrchestrationResult> {
    const results: AgentResponse[] = [];
    let currentInput = initialInput;

    for (const step of steps) {
      const input = step.transform 
        ? step.transform(currentInput) 
        : currentInput;

      const response = await this.router.invokeAgent({
        role: step.role,
        task: input,
      });

      results.push(response);
      
      // Extract text content for next step
      currentInput = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    return {
      pattern: "sequential",
      steps: results,
      finalOutput: currentInput,
    };
  }

  /**
   * Parallel Comparison: Run same task through multiple agents
   */
  async parallel(
    roles: string[],
    task: string
  ): Promise<OrchestrationResult> {
    const promises = roles.map((role) =>
      this.router.invokeAgent({ role, task })
    );

    const results = await Promise.allSettled(promises);

    const responses: AgentResponse[] = [];
    const errors: Array<{ role: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        responses.push(result.value);
      } else {
        errors.push({
          role: roles[index],
          error: result.reason?.message || "Unknown error",
        });
      }
    });

    return {
      pattern: "parallel",
      responses,
      errors,
    };
  }

  /**
   * Generator-Critic Loop: Generate → Critique → Improve
   */
  async criticLoop(
    generatorRole: string,
    criticRole: string,
    task: string,
    maxIterations: number = 3
  ): Promise<OrchestrationResult> {
    const iterations: Array<{
      generation: AgentResponse;
      critique: AgentResponse;
    }> = [];

    let currentTask = task;

    for (let i = 0; i < maxIterations; i++) {
      // Generate
      const generation = await this.router.invokeAgent({
        role: generatorRole,
        task: currentTask,
      });

      const generatedContent = this.extractText(generation);

      // Critique
      const critique = await this.router.invokeAgent({
        role: criticRole,
        task: `Please critique the following and identify any issues or improvements:\n\n${generatedContent}`,
      });

      iterations.push({ generation, critique });

      const critiqueContent = this.extractText(critique);

      // Check if critique indicates satisfaction
      if (this.isSatisfied(critiqueContent)) {
        break;
      }

      // Prepare next iteration task
      currentTask = `Based on this feedback:\n\n${critiqueContent}\n\nPlease improve your previous response:\n\n${generatedContent}`;
    }

    return {
      pattern: "critic-loop",
      iterations,
      finalOutput: this.extractText(iterations[iterations.length - 1].generation),
    };
  }

  /**
   * Consensus Building: Propose → Vote → Synthesize
   */
  async consensus(
    roles: string[],
    question: string,
    synthesizeRole: string = "coder"
  ): Promise<OrchestrationResult> {
    // Phase 1: Collect proposals
    const proposals = await this.parallel(roles, question);

    // Phase 2: Have each agent vote/comment on others' proposals
    const proposalText = proposals.responses
      .map((r, i) => `## Proposal ${i + 1} (${r.role})\n${this.extractText(r)}`)
      .join("\n\n");

    const votes = await this.parallel(
      roles,
      `Given these proposals:\n\n${proposalText}\n\nWhich approach do you think is best and why? You may also suggest combining elements.`
    );

    // Phase 3: Synthesize
    const votesText = votes.responses
      .map((r) => `### ${r.role}'s assessment:\n${this.extractText(r)}`)
      .join("\n\n");

    const synthesis = await this.router.invokeAgent({
      role: synthesizeRole,
      task: `Based on the following proposals and assessments, synthesize a final recommendation:\n\n${proposalText}\n\n${votesText}`,
    });

    return {
      pattern: "consensus",
      proposals: proposals.responses,
      votes: votes.responses,
      synthesis,
      finalOutput: this.extractText(synthesis),
    };
  }

  private extractText(response: AgentResponse): string {
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  private isSatisfied(critique: string): boolean {
    const satisfactionIndicators = [
      "looks good",
      "no major issues",
      "well done",
      "satisfied",
      "approved",
      "no changes needed",
      "ready for",
    ];
    const lower = critique.toLowerCase();
    return satisfactionIndicators.some((indicator) => lower.includes(indicator));
  }
}
```

### 9.2 Pattern Tool Definitions

```typescript
// Additional MCP tools for orchestration patterns

{
  name: "run_critic_loop",
  description: "Run a generator-critic improvement loop. Generator creates, critic reviews, generator improves. Repeats until satisfied or max iterations.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the generator"
      },
      generator_role: {
        type: "string",
        default: "coder",
        description: "Role for generation"
      },
      critic_role: {
        type: "string", 
        default: "critic",
        description: "Role for critique"
      },
      max_iterations: {
        type: "integer",
        default: 3,
        description: "Maximum improvement iterations"
      }
    },
    required: ["task"]
  }
}

{
  name: "build_consensus",
  description: "Get multiple agents to propose solutions, evaluate each other's proposals, then synthesize a final recommendation",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question or decision to reach consensus on"
      },
      roles: {
        type: "array",
        items: { type: "string" },
        default: ["coder", "critic", "designer"],
        description: "Roles to participate in consensus"
      }
    },
    required: ["question"]
  }
}
```

---

## 10. Error Handling

### 10.1 Error Types

```typescript
// src/errors.ts

export class AgentRouterError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AgentRouterError";
  }
}

export class ConfigurationError extends AgentRouterError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFIGURATION_ERROR", details);
    this.name = "ConfigurationError";
  }
}

export class ProviderError extends AgentRouterError {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message, "PROVIDER_ERROR", { ...details, provider, statusCode });
    this.name = "ProviderError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    provider: string,
    public retryAfter?: number,
    details?: Record<string, unknown>
  ) {
    super(`Rate limited by ${provider}`, provider, 429, {
      ...details,
      retryAfter,
    });
    this.name = "RateLimitError";
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: string, details?: Record<string, unknown>) {
    super(`Authentication failed for ${provider}`, provider, 401, details);
    this.name = "AuthenticationError";
  }
}

export class TimeoutError extends AgentRouterError {
  constructor(
    public provider: string,
    public timeoutMs: number,
    details?: Record<string, unknown>
  ) {
    super(
      `Request to ${provider} timed out after ${timeoutMs}ms`,
      "TIMEOUT_ERROR",
      { ...details, provider, timeoutMs }
    );
    this.name = "TimeoutError";
  }
}

export class TranslationError extends AgentRouterError {
  constructor(
    message: string,
    public sourceFormat: string,
    public targetFormat: string,
    details?: Record<string, unknown>
  ) {
    super(message, "TRANSLATION_ERROR", {
      ...details,
      sourceFormat,
      targetFormat,
    });
    this.name = "TranslationError";
  }
}
```

### 10.2 Circuit Breaker

```typescript
// src/utils/circuit-breaker.ts

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number = 0;
  private lastFailure: number = 0;
  private halfOpenSuccesses: number = 0;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenRequests: 3,
    }
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure >= this.config.resetTimeoutMs) {
        this.state = "half-open";
        this.halfOpenSuccesses = 0;
      } else {
        throw new Error(`Circuit breaker ${this.name} is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenRequests) {
        this.state = "closed";
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

### 10.3 Retry Logic

```typescript
// src/utils/retry.ts

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryableErrors = ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR"],
  } = config;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      const isRetryable =
        error instanceof AgentRouterError &&
        retryableErrors.includes(error.code);

      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs
      );

      // Add jitter
      const jitter = delay * 0.1 * Math.random();

      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 11. Security

### 11.1 API Key Management

```typescript
// src/utils/credentials.ts
import { execSync } from "child_process";
import { platform } from "os";

export class CredentialManager {
  /**
   * Retrieve API key from secure storage or environment
   */
  static getApiKey(provider: string): string | undefined {
    // 1. Check environment variable
    const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
    if (envKey) return envKey;

    // 2. Try system keychain (macOS)
    if (platform() === "darwin") {
      try {
        const result = execSync(
          `security find-generic-password -a "agent-router" -s "${provider}" -w`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
        );
        return result.trim();
      } catch {
        // Key not found in keychain
      }
    }

    // 3. Try system credential manager (Windows)
    if (platform() === "win32") {
      // Windows credential manager integration
      // ...
    }

    return undefined;
  }

  /**
   * Store API key in secure storage
   */
  static setApiKey(provider: string, key: string): void {
    if (platform() === "darwin") {
      execSync(
        `security add-generic-password -a "agent-router" -s "${provider}" -w "${key}" -U`,
        { stdio: "pipe" }
      );
    }
    // Windows implementation...
  }
}
```

### 11.2 Request Sanitization

```typescript
// src/utils/sanitize.ts

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
  // Remove potential prompt injection patterns
  const patterns = [
    /ignore previous instructions/gi,
    /disregard all prior/gi,
    /system:\s*override/gi,
    /\[INST\].*?\[\/INST\]/gs,
    /<\|im_start\|>.*?<\|im_end\|>/gs,
  ];

  let sanitized = input;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  return sanitized;
}

/**
 * Ensure API keys are never logged
 */
export function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") {
    // Redact API key patterns
    return obj
      .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***REDACTED***")
      .replace(/sk-ant-[a-zA-Z0-9-]{20,}/g, "sk-ant-***REDACTED***")
      .replace(/AIza[a-zA-Z0-9_-]{35}/g, "AIza***REDACTED***");
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSecrets);
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/key|secret|token|password|credential/i.test(key)) {
        result[key] = "***REDACTED***";
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }

  return obj;
}
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

```typescript
// tests/unit/router/role-resolver.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { RoleResolver } from "../../../src/router/role-resolver.js";

describe("RoleResolver", () => {
  let resolver: RoleResolver;

  beforeEach(() => {
    resolver = new RoleResolver({
      version: "1.0",
      defaults: { temperature: 0.7, max_tokens: 4096, timeout_ms: 60000 },
      roles: {
        coder: { provider: "anthropic", model: "claude-sonnet-4" },
        critic: {
          provider: "openai",
          model: "gpt-4o",
          temperature: 0.3,
          system_prompt: "Be critical",
        },
      },
      providers: {},
    });
  });

  it("should resolve a valid role", () => {
    const config = resolver.resolve("coder");
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4");
    expect(config.temperature).toBe(0.7); // Uses default
  });

  it("should apply role-specific overrides", () => {
    const config = resolver.resolve("critic");
    expect(config.temperature).toBe(0.3);
    expect(config.system_prompt).toBe("Be critical");
  });

  it("should throw for unknown role", () => {
    expect(() => resolver.resolve("unknown")).toThrow("Unknown role: unknown");
  });

  it("should list available roles", () => {
    expect(resolver.listRoles()).toEqual(["coder", "critic"]);
  });
});
```

### 12.2 Integration Tests

```typescript
// tests/integration/providers/openai.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { OpenAIProvider } from "../../../src/providers/openai.js";
import { Logger } from "../../../src/observability/logger.js";

describe("OpenAI Provider Integration", () => {
  let provider: OpenAIProvider;

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY required for integration tests");
    }

    provider = new OpenAIProvider(
      { api_key: process.env.OPENAI_API_KEY },
      new Logger({ level: "silent" })
    );
  });

  it("should complete a simple request", async () => {
    const response = await provider.complete({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hello" }],
      max_tokens: 50,
    });

    expect(response.content).toBeDefined();
    expect(response.content[0].type).toBe("text");
    expect(response.usage).toBeDefined();
  });

  it("should handle streaming", async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.completeStream({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Count to 3" }],
      max_tokens: 50,
    })) {
      if (chunk.delta?.text) {
        chunks.push(chunk.delta.text);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should handle tool calls", async () => {
    const response = await provider.complete({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is 2 + 2?" }],
      tools: [
        {
          name: "calculator",
          description: "Perform calculations",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
      max_tokens: 100,
    });

    // Model may or may not use the tool
    expect(response.content).toBeDefined();
  });
});
```

### 12.3 E2E Tests

```typescript
// tests/e2e/full-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("E2E: Full Agent Flow", () => {
  let serverProcess: ChildProcess;
  let client: Client;

  beforeAll(async () => {
    // Start the MCP server
    serverProcess = spawn("node", ["dist/index.js"], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Connect MCP client
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
    });

    client = new Client({ name: "test-client", version: "1.0.0" }, {});
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    serverProcess.kill();
  });

  it("should invoke critic agent via MCP", async () => {
    const result = await client.callTool({
      name: "invoke_agent",
      arguments: {
        role: "critic",
        task: "Review this plan: Build a REST API with Node.js",
      },
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("critic");
  });

  it("should compare multiple agents", async () => {
    const result = await client.callTool({
      name: "compare_agents",
      arguments: {
        roles: ["coder", "critic"],
        task: "What is the best way to handle errors in JavaScript?",
      },
    });

    expect(result.content[0].text).toContain("CODER");
    expect(result.content[0].text).toContain("CRITIC");
  });

  it("should list available tools", async () => {
    const tools = await client.listTools();
    
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("invoke_agent");
    expect(toolNames).toContain("compare_agents");
    expect(toolNames).toContain("critique_plan");
  });
});
```

### 12.4 Test Coverage Requirements

| Component | Minimum Coverage |
|-----------|-----------------|
| Router Engine | 90% |
| Role Resolver | 95% |
| Config Manager | 85% |
| Providers | 80% |
| Translation | 90% |
| MCP Tools | 85% |
| **Overall** | **85%** |

---

## 13. Deployment

### 13.1 NPM Package

```json
// package.json
{
  "name": "@hive/agent-router",
  "version": "1.0.0",
  "description": "Multi-agent orchestration for Claude Code",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "agent-router": "dist/cli.js"
  },
  "files": [
    "dist",
    "config"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src",
    "prepublishOnly": "npm run build && npm run test"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "yaml": "^2.3.4",
    "pino": "^8.17.2",
    "undici": "^6.6.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0",
    "tsx": "^4.7.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0"
  }
}
```

### 13.2 Docker

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/config ./config
RUN npm ci --omit=dev

ENV NODE_ENV=production

# MCP servers use stdio, so we don't expose ports
# Instead, this is meant to be run with docker exec or as a sidecar

ENTRYPOINT ["node", "dist/index.js"]
```

### 13.3 CLI

```typescript
// src/cli.ts
#!/usr/bin/env node
import { parseArgs } from "util";
import { createServer } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigManager } from "./config/manager.js";

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    config: { type: "string", short: "c" },
    init: { type: "boolean" },
    "list-roles": { type: "boolean" },
    "validate-config": { type: "boolean" },
  },
});

async function main() {
  if (values.help) {
    console.log(`
AgentRouter - Multi-agent orchestration for Claude Code

Usage:
  agent-router              Start MCP server (stdio)
  agent-router --init       Initialize configuration
  agent-router --list-roles List configured agent roles
  agent-router --validate-config
                           Validate configuration file

Options:
  -c, --config <path>      Config file path
  -h, --help              Show this help
  -v, --version           Show version
`);
    process.exit(0);
  }

  if (values.version) {
    const pkg = await import("../package.json", { assert: { type: "json" } });
    console.log(pkg.default.version);
    process.exit(0);
  }

  if (values.init) {
    await initConfig();
    process.exit(0);
  }

  if (values["list-roles"]) {
    const config = await ConfigManager.load();
    console.log("Configured roles:");
    for (const [name, role] of Object.entries(config.getRoles())) {
      console.log(`  ${name}: ${role.provider}/${role.model}`);
    }
    process.exit(0);
  }

  if (values["validate-config"]) {
    try {
      await ConfigManager.load();
      console.log("✓ Configuration is valid");
      process.exit(0);
    } catch (error) {
      console.error("✗ Configuration error:", error);
      process.exit(1);
    }
  }

  // Default: start MCP server
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

---

## 14. Implementation Plan

### Phase 1: Foundation (Weeks 1-2)

**Week 1: Core Infrastructure**
- [ ] Project setup (TypeScript, Vitest, ESLint)
- [ ] Configuration system (loader, validator, defaults)
- [ ] Basic MCP server with stdio transport
- [ ] `invoke_agent` tool implementation

**Week 2: Provider Integration**
- [ ] Provider interface and base class
- [ ] Anthropic provider (direct passthrough)
- [ ] OpenAI provider with message translation
- [ ] Google Gemini provider with message translation
- [ ] Basic error handling and retry logic

**Deliverable**: Working MCP server that can invoke agents on Anthropic, OpenAI, and Gemini.

### Phase 2: Translation Layer (Weeks 3-4)

**Week 3: Message & Tool Translation**
- [ ] Message format translation (Anthropic ↔ OpenAI ↔ Gemini)
- [ ] Tool schema translation
- [ ] Tool result handling across formats
- [ ] Unit tests for all translation paths

**Week 4: Streaming & Edge Cases**
- [ ] Streaming response translation
- [ ] Error format normalization
- [ ] Handle provider-specific edge cases
- [ ] Integration tests with real APIs

**Deliverable**: Full bidirectional translation with streaming support.

### Phase 3: Enhanced Features (Weeks 5-6)

**Week 5: Orchestration Patterns**
- [ ] PatternExecutor implementation
- [ ] Sequential pipeline pattern
- [ ] Parallel comparison pattern
- [ ] Critic-generator loop pattern

**Week 6: Tools & UX**
- [ ] `compare_agents` tool
- [ ] `critique_plan` shorthand tool
- [ ] `review_code` shorthand tool
- [ ] CLI with init, list-roles, validate commands

**Deliverable**: Full orchestration patterns and developer-friendly CLI.

### Phase 4: Production Readiness (Weeks 7-8)

**Week 7: Reliability**
- [ ] Circuit breaker implementation
- [ ] Fallback provider logic
- [ ] Hot reload configuration
- [ ] Comprehensive logging and metrics

**Week 8: Distribution**
- [ ] NPM package publishing
- [ ] Docker image
- [ ] Homebrew formula
- [ ] Documentation and examples

**Deliverable**: Production-ready v1.0.0 release.

### Success Criteria

| Milestone | Criteria |
|-----------|----------|
| Phase 1 Complete | Can invoke agents on 3 providers via MCP |
| Phase 2 Complete | All translation tests pass, streaming works |
| Phase 3 Complete | All orchestration patterns implemented |
| Phase 4 Complete | Published to npm, 85% test coverage |

---

## Appendix A: Provider Comparison

| Feature | Anthropic | OpenAI | Gemini |
|---------|-----------|--------|--------|
| Message Format | `messages[]` with content blocks | `messages[]` with content string | `contents[]` with parts |
| System Prompt | `system` parameter | `role: "system"` message | `systemInstruction` |
| Tool Schema | `input_schema` | `parameters` | `parameters` |
| Tool Use | `tool_use` content block | `tool_calls` array | `functionCall` part |
| Tool Result | `tool_result` content block | `role: "tool"` message | `functionResponse` part |
| Streaming | SSE with delta events | SSE with choices delta | SSE with candidates |

## Appendix B: Configuration Examples

### Cost-Optimized Config
```yaml
roles:
  coder:
    provider: ollama
    model: codellama:34b
  critic:
    provider: openai
    model: gpt-4o-mini
  designer:
    provider: google
    model: gemini-2.0-flash
```

### Performance Config
```yaml
roles:
  coder:
    provider: anthropic
    model: claude-sonnet-4
  critic:
    provider: openai
    model: gpt-4o
  designer:
    provider: google
    model: gemini-2.5-pro
```

### Privacy-First Config
```yaml
roles:
  coder:
    provider: ollama
    model: deepseek-coder:33b
  critic:
    provider: ollama
    model: llama3:70b
  designer:
    provider: ollama
    model: llama3:70b
```

---

*Document Status: Draft - Pending Review*
