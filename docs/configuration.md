# Configuration Reference

Complete reference for AgentRouter configuration options.

---

## Configuration File Location

AgentRouter searches for configuration in this order:

1. `--config` flag value (if provided)
2. `.agent-router.yaml` in current directory
3. `~/.config/agent-router/config.yaml` (Linux/macOS)
4. `%APPDATA%\agent-router\config.yaml` (Windows)

---

## Configuration Schema

```yaml
# AgentRouter Configuration v2
version: "2.0"

# Global defaults applied to all providers
defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

# Provider configurations
providers:
  <provider_name>:
    access_mode: api | subscription
    api_key: string
    base_url: string
    default_model: string
    timeout_ms: number
    max_retries: number

# Role configurations
roles:
  <role_name>:
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

## Top-Level Options

### `version`

**Type:** `string`  
**Required:** Yes  
**Default:** `"2.0"`

Configuration schema version. Currently `"2.0"`.

```yaml
version: "2.0"
```

---

## Defaults Section

Global defaults applied to all providers and roles.

### `defaults.temperature`

**Type:** `number`  
**Range:** `0.0` - `2.0`  
**Default:** `0.7`

Controls randomness in model outputs. Lower values are more deterministic.

```yaml
defaults:
  temperature: 0.7
```

### `defaults.max_tokens`

**Type:** `number`  
**Default:** `4096`

Maximum tokens in model response.

```yaml
defaults:
  max_tokens: 4096
```

### `defaults.timeout_ms`

**Type:** `number`  
**Default:** `60000`

Request timeout in milliseconds.

```yaml
defaults:
  timeout_ms: 60000
```

---

## Providers Section

Configure each AI provider.

### Provider Names

| Name | Provider |
|------|----------|
| `anthropic` | Anthropic Claude |
| `openai` | OpenAI GPT |
| `google` | Google Gemini |
| `deepseek` | DeepSeek |
| `zai` | Z.AI (GLM) |
| `ollama` | Ollama (local) |

### Provider Options

#### `access_mode`

**Type:** `"api"` | `"subscription"`  
**Default:** `"api"`

How to access this provider:
- `api` – Use API key for programmatic access
- `subscription` – Use CLI subscription (orchestrator only)

```yaml
providers:
  anthropic:
    access_mode: subscription
```

> **Note:** Subscription mode only works for the orchestrator provider and only when running from that provider's CLI tool.

#### `api_key`

**Type:** `string`  
**Required:** When `access_mode: api`

API key for authentication. Supports environment variable interpolation.

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
```

#### `base_url`

**Type:** `string`  
**Required:** No

Custom API endpoint URL. Usually not needed unless using a proxy or custom deployment.

```yaml
providers:
  openai:
    base_url: https://api.openai.com/v1
```

#### `default_model`

**Type:** `string`  
**Required:** Yes

Default model to use for this provider.

```yaml
providers:
  anthropic:
    default_model: claude-sonnet-4-5-20250929
```

#### `timeout_ms`

**Type:** `number`  
**Default:** Inherits from `defaults.timeout_ms`

Provider-specific timeout in milliseconds.

```yaml
providers:
  deepseek:
    timeout_ms: 120000  # Longer timeout for reasoning models
```

#### `max_retries`

**Type:** `number`  
**Default:** `3`

Number of retry attempts on transient failures.

```yaml
providers:
  openai:
    max_retries: 5
```

---

## Roles Section

Configure agent roles and their assigned providers.

### Available Roles

| Role | Purpose |
|------|---------|
| `orchestrator` | Main coordinator, routes tasks to other agents |
| `coder` | Writes, refactors, implements code |
| `critic` | Challenges assumptions, finds flaws |
| `reviewer` | Code review for bugs, security, performance |
| `designer` | UI/UX feedback and design review |
| `researcher` | Fact-finding and research tasks |

### Role Options

#### `provider`

**Type:** `string`  
**Required:** Yes

Which provider to use for this role. Must be configured in `providers` section.

```yaml
roles:
  critic:
    provider: deepseek
```

#### `model`

**Type:** `string`  
**Required:** Yes

Which model to use. Must be valid for the specified provider.

```yaml
roles:
  critic:
    provider: deepseek
    model: deepseek-reasoner
```

#### `temperature`

**Type:** `number`  
**Range:** `0.0` - `2.0`  
**Default:** Inherits from `defaults.temperature`

Role-specific temperature setting.

```yaml
roles:
  reviewer:
    temperature: 0.2  # More deterministic for code review
```

#### `max_tokens`

**Type:** `number`  
**Default:** Inherits from `defaults.max_tokens`

Maximum tokens for this role's responses.

```yaml
roles:
  researcher:
    max_tokens: 8192  # Allow longer research responses
```

#### `system_prompt`

**Type:** `string`  
**Required:** No

Custom system prompt for this role. Overrides the default role prompt.

```yaml
roles:
  reviewer:
    system_prompt: |
      You are a security-focused code reviewer.
      Focus especially on:
      1. Authentication/authorization vulnerabilities
      2. SQL injection risks
      3. XSS vulnerabilities
      4. Data exposure risks
```

#### `fallback`

**Type:** `object`  
**Required:** No

Fallback provider/model if primary fails.

```yaml
roles:
  coder:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    fallback:
      provider: openai
      model: gpt-5.1
```

---

## Environment Variable Interpolation

Use `${VAR_NAME}` syntax to reference environment variables:

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
  
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
```

### Setting Environment Variables

**Bash/Zsh:**
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Add to shell profile for persistence:**
```bash
echo 'export OPENAI_API_KEY="sk-..."' >> ~/.zshrc
source ~/.zshrc
```

---

## Complete Example

```yaml
# AgentRouter Configuration v2
# ~/.config/agent-router/config.yaml

version: "2.0"

defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

providers:
  anthropic:
    access_mode: subscription
    default_model: claude-sonnet-4-5-20250929
    
  openai:
    access_mode: api
    api_key: ${OPENAI_API_KEY}
    base_url: https://api.openai.com/v1
    default_model: gpt-5.1
    timeout_ms: 90000
    
  deepseek:
    access_mode: api
    api_key: ${DEEPSEEK_API_KEY}
    base_url: https://api.deepseek.com
    default_model: deepseek-reasoner
    timeout_ms: 120000  # Reasoning takes longer
    
  google:
    access_mode: api
    api_key: ${GEMINI_API_KEY}
    base_url: https://generativelanguage.googleapis.com/v1beta
    default_model: gemini-2.5-pro

roles:
  orchestrator:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.3
    system_prompt: |
      You are the orchestrating AI agent. Your role is to:
      1. Understand the user's intent and break down complex tasks
      2. Route tasks to specialized agents
      3. Synthesize results from multiple agents
      4. Maintain context across the conversation
    
  coder:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.2
    fallback:
      provider: openai
      model: gpt-5.1
    
  critic:
    provider: deepseek
    model: deepseek-reasoner
    temperature: 0.3
    system_prompt: |
      You are a skeptical senior architect.
      Challenge assumptions, find flaws, identify risks.
      Be constructive but rigorous.
    
  reviewer:
    provider: openai
    model: gpt-5.1
    temperature: 0.2
    max_tokens: 8192
    
  designer:
    provider: google
    model: gemini-2.5-pro
    temperature: 0.5
    
  researcher:
    provider: google
    model: gemini-2.5-pro
    temperature: 0.7
    max_tokens: 16384
```

---

## Validation

Validate your configuration:

```bash
agent-router validate
```

This checks:
- YAML syntax
- Required fields
- Provider references in roles
- Model validity
- Environment variable presence

---

## Configuration Precedence

Settings are applied in this order (later overrides earlier):

1. Built-in defaults
2. `defaults` section
3. Provider-specific settings
4. Role-specific settings
5. CLI flags (for some options)

---

## CLI Options

Some options can be set via CLI flags:

| Flag | Description |
|------|-------------|
| `--config, -c` | Custom config file path |
| `--profile, -p` | Profile name |
| `--verbose, -v` | Enable verbose logging |

```bash
agent-router start --config ./custom-config.yaml --verbose
```
