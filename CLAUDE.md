# AgentRouter - Claude Code Multi-Agent Extension

## Project Overview

AgentRouter is an MCP server that extends Claude Code with multi-agent orchestration capabilities. It allows invoking specialized AI agents (coder, critic, designer, researcher, reviewer) backed by different LLM providers (Anthropic, OpenAI, Gemini, Ollama).

**Vision**: "One orchestrator, many specialists—always using the best tool for the job."

## Quick Reference

### Tech Stack
- **Runtime**: Node.js 20+ with TypeScript 5.x
- **MCP SDK**: @modelcontextprotocol/sdk
- **Config**: YAML with JSON Schema validation
- **Testing**: Vitest
- **Logging**: pino

### Key Commands
```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm run dev          # Development with watch
npm test             # Run tests
npm run lint         # Lint code
```

## Architecture

```
Claude Code (MCP Client)
    ↓ stdio / MCP Protocol
AgentRouter MCP Server
    ├─ MCP Transport Layer (stdio)
    ├─ Tool Handler (invoke_agent, compare_agents, critique_plan, etc.)
    ├─ Router Engine (Role Resolver, Pattern Executor)
    ├─ Config Manager (YAML loader, hot reload, env interpolation)
    ├─ Provider Manager (Anthropic, OpenAI, Gemini, Ollama adapters)
    └─ Translation Layer (message/tool/streaming format conversion)
        ↓
    External APIs (Anthropic, OpenAI, Gemini, Ollama)
```

## Directory Structure

```
agent-router/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server setup
│   ├── mcp/
│   │   ├── tools/               # MCP tool implementations
│   │   │   ├── index.ts         # Tool registry
│   │   │   ├── invoke-agent.ts
│   │   │   ├── compare-agents.ts
│   │   │   ├── critique-plan.ts
│   │   │   ├── review-code.ts
│   │   │   └── design-feedback.ts
│   │   └── transport/
│   │       └── stdio.ts
│   ├── router/
│   │   ├── engine.ts            # Main routing logic
│   │   ├── role-resolver.ts     # Role → config resolution
│   │   ├── pattern-executor.ts  # Orchestration patterns
│   │   └── context-manager.ts
│   ├── config/
│   │   ├── manager.ts           # Config loading, watching
│   │   ├── schema.ts            # JSON Schema definitions
│   │   ├── validator.ts
│   │   ├── merger.ts
│   │   └── defaults.ts
│   ├── providers/
│   │   ├── base.ts              # Provider interface
│   │   ├── manager.ts           # Provider registry
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   └── ollama.ts
│   ├── translation/
│   │   ├── index.ts
│   │   ├── messages.ts          # Message format translation
│   │   ├── tools.ts             # Tool schema translation
│   │   ├── streaming.ts         # SSE event translation
│   │   └── errors.ts
│   ├── observability/
│   │   ├── logger.ts
│   │   └── metrics.ts
│   └── utils/
│       ├── env.ts
│       ├── retry.ts
│       └── circuit-breaker.ts
├── config/
│   ├── default.yaml
│   └── schema.json
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── PRD.md                       # Product Requirements
├── TDD.md                       # Technical Design
├── package.json
├── tsconfig.json
└── README.md
```

## Core Concepts

### Roles
Predefined agent roles that map to provider/model configurations:
- `coder` - Code generation, implementation
- `critic` - Plan review, assumption challenging
- `designer` - UI/UX feedback
- `researcher` - Fact-finding, research
- `reviewer` - Code review

### MCP Tools
- `invoke_agent` - Invoke a specialized agent by role
- `compare_agents` - Run same task through multiple agents
- `critique_plan` - Shorthand for critic review
- `review_code` - Shorthand for code review
- `design_feedback` - Shorthand for UI/UX feedback
- `list_agents` - List available roles

### Orchestration Patterns
1. **Sequential Pipeline**: A → B → C (output feeds next)
2. **Parallel Comparison**: Same task to multiple agents
3. **Critic-Generator Loop**: Generate → Critique → Improve
4. **Consensus Building**: Propose → Vote → Synthesize

## Configuration Format

```yaml
# ~/.config/agent-router/config.yaml
version: "1.0"

defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

roles:
  coder:
    provider: anthropic
    model: claude-sonnet-4-20250514
    system_prompt: |
      You are an expert software engineer...
    fallback:
      provider: openai
      model: gpt-4o
      
  critic:
    provider: openai
    model: gpt-4o
    temperature: 0.3
    system_prompt: |
      You are a skeptical senior architect...

providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  openai:
    api_key: ${OPENAI_API_KEY}
  google:
    api_key: ${GEMINI_API_KEY}
  ollama:
    base_url: http://localhost:11434
```

## Translation Layer

The system translates between provider formats:

| Feature | Anthropic | OpenAI | Gemini |
|---------|-----------|--------|--------|
| Messages | `messages[]` with content blocks | `messages[]` with content string | `contents[]` with parts |
| System Prompt | `system` parameter | `role: "system"` message | `systemInstruction` |
| Tool Schema | `input_schema` | `parameters` | `parameters` |
| Tool Use | `tool_use` content block | `tool_calls` array | `functionCall` part |
| Tool Result | `tool_result` content block | `role: "tool"` message | `functionResponse` part |

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] Project setup (TypeScript, Vitest, ESLint)
- [ ] Configuration system
- [ ] Basic MCP server with stdio
- [ ] `invoke_agent` tool
- [ ] Anthropic, OpenAI, Gemini providers

### Phase 2: Translation (Weeks 3-4)
- [ ] Message format translation
- [ ] Tool schema translation
- [ ] Streaming response translation
- [ ] Error handling

### Phase 3: Orchestration (Weeks 5-6)
- [ ] PatternExecutor
- [ ] Sequential, parallel, critic-loop patterns
- [ ] `compare_agents`, `critique_plan`, `review_code` tools
- [ ] CLI

### Phase 4: Production (Weeks 7-8)
- [ ] Circuit breaker, fallbacks
- [ ] Hot reload config
- [ ] Logging, metrics
- [ ] NPM publish, Docker, docs

## Testing Requirements

- **Unit tests**: 95% coverage for role-resolver, config validation, translation
- **Integration tests**: Real API calls to providers
- **E2E tests**: Full MCP client → server → provider flow
- **Overall coverage target**: 85%

## Key Files to Reference

- `PRD.md` - Full product requirements
- `TDD.md` - Detailed technical specification
- `config/schema.json` - Configuration JSON Schema

## Development Notes

- Use `tsx watch` for development
- Provider adapters should implement the `Provider` interface
- All provider calls go through the translation layer
- Config supports `${ENV_VAR}` interpolation
- Hot reload watches config files for changes

## Error Handling

Custom error types:
- `ConfigurationError` - Invalid config
- `ProviderError` - API failures
- `RateLimitError` - 429 responses
- `AuthenticationError` - 401 responses
- `TimeoutError` - Request timeouts
- `TranslationError` - Format conversion failures

Circuit breaker pattern for provider resilience.
