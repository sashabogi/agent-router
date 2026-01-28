# API Reference

AgentRouter exposes its functionality through the Model Context Protocol (MCP). This document covers the MCP tools and resources available.

---

## MCP Overview

AgentRouter runs as an MCP server that Claude Code (or other MCP clients) can connect to. It provides tools for invoking specialized AI agents.

### Connection

AgentRouter communicates via stdio (standard input/output) when launched by an MCP client.

```json
{
  "mcpServers": {
    "agent-router": {
      "command": "agent-router",
      "args": ["start"]
    }
  }
}
```

---

## Tools

### `agent_invoke`

Invoke a specific agent role with a task.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `role` | string | Yes | Agent role to invoke |
| `task` | string | Yes | Task description/prompt |
| `context` | string | No | Additional context |
| `options` | object | No | Override options |

**Example:**

```json
{
  "name": "agent_invoke",
  "arguments": {
    "role": "critic",
    "task": "Review this database schema design for potential issues",
    "context": "We're building a multi-tenant SaaS application",
    "options": {
      "temperature": 0.5
    }
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "I have several concerns about this schema:\n\n1. **Tenant Isolation**..."
    }
  ],
  "metadata": {
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "role": "critic",
    "latency_ms": 2341,
    "tokens": {
      "input": 523,
      "output": 1247
    }
  }
}
```

---

### `agent_list_roles`

List all configured agent roles.

**Parameters:** None

**Example:**

```json
{
  "name": "agent_list_roles",
  "arguments": {}
}
```

**Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Available roles:\n- orchestrator (anthropic/claude-sonnet-4-5)\n- coder (anthropic/claude-sonnet-4-5)\n- critic (deepseek/deepseek-reasoner)\n- reviewer (openai/gpt-5.1)"
    }
  ],
  "roles": [
    {
      "name": "orchestrator",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "description": "Main coordinator - routes tasks to other agents"
    },
    {
      "name": "coder",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "description": "Write, refactor, and implement code"
    }
  ]
}
```

---

### `agent_review_code`

Specialized tool for code review tasks.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Code to review |
| `language` | string | No | Programming language |
| `focus` | array | No | Areas to focus on |

**Focus Options:**
- `security` - Security vulnerabilities
- `performance` - Performance issues
- `bugs` - Logic errors and bugs
- `style` - Code style and readability
- `testing` - Test coverage and testability

**Example:**

```json
{
  "name": "agent_review_code",
  "arguments": {
    "code": "function getUser(id) {\n  return db.query(`SELECT * FROM users WHERE id = ${id}`);\n}",
    "language": "javascript",
    "focus": ["security", "bugs"]
  }
}
```

---

### `agent_critique`

Get a critical analysis of an idea, plan, or design.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | What to critique |
| `context` | string | No | Background information |
| `severity` | string | No | How critical to be |

**Severity Levels:**
- `gentle` - Constructive, encouraging
- `balanced` - Fair but thorough (default)
- `rigorous` - No-holds-barred criticism

**Example:**

```json
{
  "name": "agent_critique",
  "arguments": {
    "subject": "We should use MongoDB for our financial transaction system",
    "context": "Building a payment processing platform",
    "severity": "rigorous"
  }
}
```

---

### `agent_research`

Research a topic and provide findings.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | Yes | What to research |
| `depth` | string | No | Research depth |
| `format` | string | No | Output format |

**Depth Levels:**
- `quick` - Brief overview
- `standard` - Balanced depth (default)
- `deep` - Comprehensive analysis

**Format Options:**
- `prose` - Natural paragraphs (default)
- `bullets` - Bullet points
- `structured` - Sections with headers

**Example:**

```json
{
  "name": "agent_research",
  "arguments": {
    "topic": "Best practices for WebSocket authentication in 2026",
    "depth": "deep",
    "format": "structured"
  }
}
```

---

### `agent_design_review`

Get UI/UX design feedback.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | Yes | Design to review |
| `type` | string | No | Type of design |
| `criteria` | array | No | Evaluation criteria |

**Type Options:**
- `ui` - User interface
- `ux` - User experience flow
- `component` - Component architecture
- `system` - Design system

**Example:**

```json
{
  "name": "agent_design_review",
  "arguments": {
    "description": "A modal dialog with a form for adding payment methods...",
    "type": "ui",
    "criteria": ["accessibility", "mobile", "consistency"]
  }
}
```

---

## Resources

### `config://current`

Get the current configuration.

**URI:** `config://current`

**Returns:** Current AgentRouter configuration (sanitized, no API keys)

---

### `providers://status`

Get provider connection status.

**URI:** `providers://status`

**Returns:** Status of all configured providers

```json
{
  "providers": [
    {
      "name": "anthropic",
      "status": "connected",
      "access_mode": "subscription",
      "default_model": "claude-sonnet-4-5-20250929"
    },
    {
      "name": "openai",
      "status": "connected",
      "access_mode": "api",
      "default_model": "gpt-5.1"
    }
  ]
}
```

---

### `roles://list`

List all configured roles.

**URI:** `roles://list`

**Returns:** All role configurations

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Failed to connect to provider",
    "details": {
      "provider": "openai",
      "status": 401,
      "reason": "Invalid API key"
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_ROLE` | Requested role not configured |
| `PROVIDER_ERROR` | Provider API error |
| `TIMEOUT` | Request timed out |
| `RATE_LIMITED` | Rate limit exceeded |
| `CONFIG_ERROR` | Configuration problem |
| `VALIDATION_ERROR` | Invalid parameters |

---

## Rate Limiting

AgentRouter respects provider rate limits and implements:

- **Automatic retry** with exponential backoff
- **Queue management** for concurrent requests
- **Per-provider** rate limit tracking

---

## Streaming

For long-running requests, AgentRouter supports streaming responses:

```json
{
  "name": "agent_invoke",
  "arguments": {
    "role": "researcher",
    "task": "Comprehensive analysis of...",
    "options": {
      "stream": true
    }
  }
}
```

Streaming responses return partial content as it's generated.

---

## TypeScript Types

For TypeScript projects, types are exported:

```typescript
import type {
  AgentRole,
  ProviderConfig,
  RoleConfig,
  InvokeOptions,
  AgentResponse
} from '@sashabogi/agent-router';
```

### Key Types

```typescript
interface AgentRole {
  name: string;
  provider: string;
  model: string;
  description: string;
  systemPrompt?: string;
  temperature?: number;
}

interface InvokeOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  stream?: boolean;
}

interface AgentResponse {
  content: string;
  metadata: {
    provider: string;
    model: string;
    role: string;
    latencyMs: number;
    tokens: {
      input: number;
      output: number;
    };
  };
}
```

---

## Programmatic Usage

AgentRouter can also be used programmatically:

```typescript
import { AgentRouter } from '@sashabogi/agent-router';

const router = new AgentRouter({
  configPath: './config.yaml'
});

await router.initialize();

const response = await router.invoke('critic', {
  task: 'Review this architecture decision',
  context: 'Building a microservices platform'
});

console.log(response.content);
```

---

## WebSocket API (Planned)

Future versions will support WebSocket connections for real-time streaming:

```
ws://localhost:3000/agent-router
```

---

## Metrics & Observability

AgentRouter exposes metrics via the `metrics://` resource:

**URI:** `metrics://summary`

```json
{
  "requests": {
    "total": 1523,
    "byRole": {
      "critic": 423,
      "reviewer": 312,
      "coder": 788
    }
  },
  "latency": {
    "p50": 1234,
    "p95": 3456,
    "p99": 5678
  },
  "tokens": {
    "input": 523456,
    "output": 1234567
  },
  "errors": {
    "total": 12,
    "byType": {
      "TIMEOUT": 5,
      "RATE_LIMITED": 7
    }
  }
}
```
