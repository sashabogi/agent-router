# AgentRouter Architecture

This document describes the architecture of AgentRouter v2.

---

## Overview

AgentRouter is an MCP (Model Context Protocol) server that enables multi-agent orchestration across different AI providers. It acts as a middleware layer between Claude Code (or other MCP clients) and various AI provider APIs.

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client                               │
│              (Claude Code, etc.)                             │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP Protocol (stdio)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    AgentRouter                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ MCP Server  │  │   Router    │  │ Provider Adapters   │ │
│  │             │◄─┤             │──┤                     │ │
│  │  - Tools    │  │  - Roles    │  │ - Anthropic         │ │
│  │  - Resources│  │  - Fallback │  │ - OpenAI            │ │
│  └─────────────┘  └─────────────┘  │ - Gemini            │ │
│                                     │ - DeepSeek          │ │
│  ┌─────────────┐  ┌─────────────┐  │ - Z.AI              │ │
│  │   Config    │  │ Translation │  │ - Ollama            │ │
│  │   Manager   │  │    Layer    │  └─────────────────────┘ │
│  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┬─────────────┐
        ▼             ▼             ▼             ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
   │Anthropic│  │ OpenAI  │  │ Gemini  │  │DeepSeek │
   │   API   │  │   API   │  │   API   │  │   API   │
   └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

---

## Core Components

### 1. MCP Server (`src/mcp/`)

Implements the Model Context Protocol specification:

- **Tools**: Exposes agent invocation capabilities
- **Resources**: Provides configuration and status information
- **Transport**: Uses stdio for communication with MCP clients

### 2. Router (`src/router/`)

Handles request routing logic:

- Maps role names to provider configurations
- Implements fallback logic when primary provider fails
- Manages request queuing and rate limiting
- Tracks metrics and observability data

### 3. Provider Adapters (`src/providers/`)

Abstracts provider-specific API differences:

- Each provider has its own adapter class
- Implements common `Provider` interface
- Handles authentication, request formatting, response parsing
- Manages provider-specific error handling

### 4. Translation Layer (`src/translation/`)

Normalizes API differences:

- Converts between different message formats
- Handles tool/function calling differences
- Normalizes streaming responses
- Translates error codes

### 5. Config Manager (`src/config/`)

Manages configuration:

- Loads and validates YAML configuration
- Supports environment variable interpolation
- Watches for configuration changes
- Provides configuration schema validation

---

## Access Modes

AgentRouter v2 introduced the concept of "access modes":

### API Mode (`access_mode: api`)

Standard programmatic access using API keys:

```yaml
providers:
  openai:
    access_mode: api
    api_key: ${OPENAI_API_KEY}
    base_url: https://api.openai.com/v1
```

- Works for all providers
- Pay-per-token pricing
- Requires API key setup

### Subscription Mode (`access_mode: subscription`)

Passthrough to CLI subscription:

```yaml
providers:
  anthropic:
    access_mode: subscription
    default_model: claude-sonnet-4-5-20250929
```

- **Only works for the orchestrator role**
- **Only works when running FROM that provider's CLI**
- Uses existing subscription (no additional API costs)

#### Subscription Mode Constraints

| Running From | Can Use Subscription For |
|--------------|--------------------------|
| Claude Code | Anthropic only |
| Codex CLI | OpenAI only |
| Gemini CLI | Google only |

**Important**: Subscription mode for non-orchestrator agent roles is not possible. All agent roles (coder, critic, reviewer, etc.) require API access because they are called programmatically by the orchestrator.

---

## Agent Roles

Roles define specialized AI agents:

```yaml
roles:
  orchestrator:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.3
    system_prompt: "..."
    
  critic:
    provider: deepseek
    model: deepseek-reasoner
    temperature: 0.3
    system_prompt: "..."
```

### Built-in Roles

| Role | Purpose | Default Provider |
|------|---------|------------------|
| `orchestrator` | Coordinates agents, routes tasks | Anthropic |
| `coder` | Writes and implements code | Anthropic |
| `critic` | Challenges assumptions | DeepSeek |
| `reviewer` | Code review | OpenAI |
| `designer` | UI/UX feedback | Google |
| `researcher` | Research tasks | Google |

### Role Resolution

1. Request comes in with role name
2. Router looks up role configuration
3. Gets provider and model from config
4. Creates provider adapter instance
5. Applies role-specific settings (temp, system prompt)
6. Executes request
7. If failure and fallback configured, retry with fallback

---

## Request Flow

```
1. MCP Client sends tool invocation
   │
   ▼
2. MCP Server receives request
   │
   ▼
3. Router resolves role → provider/model
   │
   ▼
4. Translation layer formats request
   │
   ▼
5. Provider adapter executes API call
   │
   ▼
6. Response translated to common format
   │
   ▼
7. MCP Server returns response
```

### Example Flow

```typescript
// 1. MCP tool invocation
{
  "name": "agent_invoke",
  "arguments": {
    "role": "critic",
    "task": "Review this architecture"
  }
}

// 2. Router resolution
const roleConfig = config.roles['critic'];
// → { provider: 'deepseek', model: 'deepseek-reasoner', ... }

// 3. Provider execution
const provider = providers.get('deepseek');
const response = await provider.complete({
  model: 'deepseek-reasoner',
  messages: [
    { role: 'system', content: roleConfig.systemPrompt },
    { role: 'user', content: task }
  ],
  temperature: roleConfig.temperature
});

// 4. Response returned
{
  "content": [{ "type": "text", "text": "..." }],
  "metadata": { ... }
}
```

---

## Provider Adapters

Each provider adapter implements:

```typescript
interface Provider {
  name: string;
  
  // Execute a completion request
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  
  // Test connectivity
  testConnection(): Promise<ConnectionTestResult>;
  
  // Get available models
  listModels(): Promise<string[]>;
}
```

### Adapter Responsibilities

1. **Authentication**: Handle API keys, headers
2. **Request formatting**: Convert to provider's API format
3. **Response parsing**: Normalize response structure
4. **Error handling**: Translate provider-specific errors
5. **Rate limiting**: Respect and report limits
6. **Streaming**: Handle streaming responses if supported

---

## Configuration Schema

```yaml
version: "2.0"

defaults:
  temperature: number
  max_tokens: number
  timeout_ms: number

providers:
  [provider_name]:
    access_mode: "api" | "subscription"
    api_key: string
    base_url: string
    default_model: string
    timeout_ms: number
    max_retries: number

roles:
  [role_name]:
    provider: string
    model: string
    temperature: number
    max_tokens: number
    system_prompt: string
    fallback:
      provider: string
      model: string
```

---

## Error Handling

### Error Types

| Type | Description | Recovery |
|------|-------------|----------|
| `PROVIDER_ERROR` | API returned error | Retry/fallback |
| `TIMEOUT` | Request timed out | Retry with longer timeout |
| `RATE_LIMITED` | Rate limit hit | Wait and retry |
| `INVALID_ROLE` | Role not configured | Fail immediately |
| `CONFIG_ERROR` | Configuration issue | Fail immediately |

### Fallback Logic

```typescript
async function invokeWithFallback(role, request) {
  try {
    return await invoke(role.provider, role.model, request);
  } catch (error) {
    if (role.fallback && isRetryableError(error)) {
      return await invoke(
        role.fallback.provider, 
        role.fallback.model, 
        request
      );
    }
    throw error;
  }
}
```

---

## Observability

### Metrics Collected

- Request count by role/provider
- Latency (p50, p95, p99)
- Token usage (input/output)
- Error count by type
- Rate limit events

### Logging

Uses Pino for structured logging:

```json
{
  "level": "info",
  "time": 1706789012345,
  "role": "critic",
  "provider": "deepseek",
  "model": "deepseek-reasoner",
  "latencyMs": 1234,
  "tokensIn": 523,
  "tokensOut": 1247
}
```

---

## Security Considerations

1. **API Key Storage**: Keys stored in environment variables, not config
2. **Key Masking**: Setup wizard masks key input
3. **No Key Logging**: Keys never appear in logs
4. **Local Option**: Ollama for air-gapped environments
5. **Subscription Mode**: Reduces key exposure for orchestrator

---

## Future Considerations

- WebSocket API for real-time streaming
- Plugin system for custom providers
- Multi-tenant support
- Provider health monitoring
- Cost tracking and budgets
- A/B testing for model comparisons
