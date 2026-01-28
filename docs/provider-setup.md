# Provider Setup Guide

This guide covers how to set up each supported AI provider with AgentRouter.

---

## Table of Contents

- [Anthropic (Claude)](#anthropic-claude)
- [OpenAI](#openai)
- [Google Gemini](#google-gemini)
- [DeepSeek](#deepseek)
- [Z.AI (GLM)](#zai-glm)
- [Ollama (Local)](#ollama-local)

---

## Anthropic (Claude)

### Overview

| Feature | Details |
|---------|---------|
| **Models** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 |
| **Access Modes** | Subscription (Claude Code) or API |
| **Best For** | Orchestration, complex coding, code review |
| **Pricing** | Sonnet: ~$3/$15 per 1M tokens |

### Subscription Mode (Recommended)

If you're running AgentRouter from within Claude Code, you can use your existing subscription:

1. Select **Anthropic** as your orchestrator in setup
2. Choose **"Use my subscription (no API key)"**
3. Requests pass through your Claude Code session

**Benefits:**
- No additional API costs
- Uses your Max/Pro subscription allowance
- Simplest setup

**Limitations:**
- Only works when running FROM Claude Code
- Cannot be used for non-orchestrator agent roles

### API Mode

For programmatic access or using Claude as an agent role:

1. Get your API key from [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Run `agent-router setup` and select API mode
3. Enter your API key (masked input)

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

### Available Models

| Model | ID | Use Case |
|-------|-------|----------|
| Claude Opus 4.5 | `claude-opus-4-5-20251101` | Most intelligent, complex tasks |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` | Best balance (recommended) |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fast, cost-efficient |

---

## OpenAI

### Overview

| Feature | Details |
|---------|---------|
| **Models** | GPT-5.2, GPT-5.1, GPT-5, o3 |
| **Access Mode** | API only |
| **Best For** | Code review, critiques, general coding |
| **Pricing** | GPT-5.1: ~$2/$8 per 1M tokens |

### Setup

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Run `agent-router setup`
3. Select OpenAI when adding agent providers
4. Enter your API key

```bash
export OPENAI_API_KEY="sk-proj-..."
```

### Available Models

| Model | ID | Use Case |
|-------|-------|----------|
| GPT-5.2 | `gpt-5.2` | Most advanced frontier model |
| GPT-5.1 | `gpt-5.1` | Best for coding (adaptive reasoning) |
| GPT-5 | `gpt-5` | Strong coding, 400K context |
| GPT-5 Mini | `gpt-5-mini` | Cost-effective |
| GPT-4.1 | `gpt-4.1` | Previous gen, 1M context |
| o3 | `o3` | Advanced reasoning (slower) |

### Deprecated Models

- `gpt-4.5-preview` - Deprecated April 2025
- `o1-preview`, `o1-mini` - Replaced by o3/o4 series

---

## Google Gemini

### Overview

| Feature | Details |
|---------|---------|
| **Models** | Gemini 3 Pro/Flash, 2.5 Pro/Flash |
| **Access Mode** | API |
| **Best For** | Research, multimodal tasks, design |
| **Pricing** | 2.5 Flash: ~$0.075/$0.30 per 1M tokens |

### Setup

1. Get your API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Run `agent-router setup`
3. Select Google Gemini when adding agent providers
4. Enter your API key

```bash
export GEMINI_API_KEY="AIza..."
```

### Available Models

| Model | ID | Use Case |
|-------|-------|----------|
| Gemini 3 Pro | `gemini-3-pro-preview` | Most advanced reasoning (preview) |
| Gemini 3 Flash | `gemini-3-flash-preview` | Fast frontier performance (preview) |
| Gemini 2.5 Pro | `gemini-2.5-pro` | Stable, high capability |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Fast, balanced |
| Gemini 2.5 Flash Lite | `gemini-2.5-flash-lite` | High-throughput, cheap |

### Notes

- Gemini 2.0 models deprecated March 2026
- Gemini 3 models are in preview but very capable

---

## DeepSeek

### Overview

| Feature | Details |
|---------|---------|
| **Models** | V3.2 Reasoner, V3.2 Chat |
| **Access Mode** | API only |
| **Best For** | Critiques, reasoning, cost-effective coding |
| **Pricing** | $0.28/$0.42 per 1M tokens (cache: $0.028) |

### Setup

1. Get your API key from [DeepSeek Platform](https://platform.deepseek.com)
2. Run `agent-router setup`
3. Select DeepSeek when adding agent providers
4. Enter your API key

```bash
export DEEPSEEK_API_KEY="sk-..."
```

### Available Models

| Model | ID | Use Case |
|-------|-------|----------|
| V3.2 Reasoner | `deepseek-reasoner` | Best reasoning (thinking mode) |
| V3.2 Chat | `deepseek-chat` | Fast, non-thinking mode |

### Why DeepSeek?

DeepSeek V3.2 offers outstanding reasoning capabilities at approximately **1/10th the cost** of comparable models. The Reasoner model is excellent for:

- Critiquing code and architecture
- Finding flaws in designs
- Complex problem solving
- Mathematical reasoning

---

## Z.AI (GLM)

### Overview

| Feature | Details |
|---------|---------|
| **Models** | GLM-4.7, GLM-4.7 FlashX, GLM-4.7 Flash |
| **Access Mode** | API |
| **Best For** | Agentic coding, tool use |
| **Pricing** | ~$0.40-0.60 per 1M input (Flash: FREE) |

### Setup

1. Get your API key from [Z.AI API Keys](https://z.ai/manage-apikey/apikey-list)
2. Run `agent-router setup`
3. Select Z.AI (GLM) when adding agent providers
4. Enter your API key

```bash
export ZAI_API_KEY="..."
```

### Available Models

| Model | ID | Use Case |
|-------|-------|----------|
| GLM-4.7 | `glm-4.7` | Flagship, 200K context, 128K output |
| GLM-4.7 FlashX | `glm-4.7-flashx` | Fast, affordable |
| GLM-4.7 Flash | `glm-4.7-flash` | **Completely FREE** |

### Why GLM-4.7?

GLM-4.7 has exceptional tool use capabilities:
- **84.7%** on τ²-Bench (surpasses Claude Sonnet 4.5)
- Enhanced agentic coding with "think before acting"
- Interleaved thinking mode
- Very affordable pricing

---

## Ollama (Local)

### Overview

| Feature | Details |
|---------|---------|
| **Models** | Llama 3.2, Qwen, CodeLlama, DeepSeek-Coder, etc. |
| **Access Mode** | Local HTTP |
| **Best For** | Privacy, offline use, cost savings |
| **Pricing** | FREE |

### Setup

1. Install Ollama from [ollama.ai](https://ollama.ai)

```bash
# macOS
brew install ollama

# Start Ollama server
ollama serve
```

2. Pull models you want to use:

```bash
ollama pull llama3.2
ollama pull qwen2.5-coder:7b
ollama pull deepseek-coder-v2
```

3. Run `agent-router setup` and select Ollama
4. Confirm the base URL (default: `http://localhost:11434`)

### Available Models

Popular models for coding tasks:

| Model | Command | Use Case |
|-------|---------|----------|
| Llama 3.2 | `ollama pull llama3.2` | General purpose |
| Qwen 2.5 Coder | `ollama pull qwen2.5-coder:7b` | Code generation |
| DeepSeek Coder v2 | `ollama pull deepseek-coder-v2` | Coding tasks |
| CodeLlama | `ollama pull codellama` | Code completion |

### Benefits

- **100% Private** – All processing stays local
- **Free** – No API costs
- **Offline** – Works without internet
- **Fast** – No network latency (with good hardware)

### Requirements

- Sufficient RAM for model size (7B models ~8GB, 13B ~16GB)
- GPU recommended for faster inference

---

## Provider Comparison

| Provider | Speed | Quality | Cost | Best Role |
|----------|-------|---------|------|-----------|
| Anthropic | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | $$$ | Orchestrator, Coder |
| OpenAI | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | $$$ | Reviewer, Coder |
| Gemini | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | $$ | Designer, Researcher |
| DeepSeek | ⚡⚡ | ⭐⭐⭐⭐⭐ | $ | Critic |
| Z.AI GLM | ⚡⚡⚡ | ⭐⭐⭐⭐ | $ | Coder (agentic) |
| Ollama | ⚡⚡ | ⭐⭐⭐ | Free | Local tasks |

---

## Recommended Configurations

### Budget-Conscious

```yaml
providers:
  anthropic:
    access_mode: subscription  # Free with Claude Code
  deepseek:
    default_model: deepseek-reasoner  # $0.28/1M
  zai:
    default_model: glm-4.7-flash  # FREE

roles:
  orchestrator: anthropic
  coder: anthropic
  critic: deepseek
  reviewer: zai
```

### Maximum Quality

```yaml
providers:
  anthropic:
    default_model: claude-opus-4-5-20251101
  openai:
    default_model: gpt-5.2

roles:
  orchestrator: anthropic
  coder: anthropic
  critic: openai
  reviewer: openai
```

### Privacy-First (Local Only)

```yaml
providers:
  ollama:
    default_model: qwen2.5-coder:7b

roles:
  orchestrator: ollama
  coder: ollama
  critic: ollama
  reviewer: ollama
```

---

## Troubleshooting

### Connection Failures

```
Error: Failed to connect to [provider]
```

1. Verify your API key is correct
2. Check your internet connection
3. Ensure the provider's API is not experiencing outages
4. Check rate limits on your account

### Invalid API Key

```
Error: 401 Unauthorized
```

1. Regenerate your API key
2. Ensure you're using the correct key format
3. Check that billing is set up on your account

### Ollama Not Running

```
Error: ECONNREFUSED localhost:11434
```

1. Start Ollama: `ollama serve`
2. Check if port 11434 is available
3. Verify Ollama installation: `ollama --version`

---

## API Endpoints Reference

| Provider | Base URL |
|----------|----------|
| Anthropic | `https://api.anthropic.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| DeepSeek | `https://api.deepseek.com` |
| Z.AI | `https://api.z.ai/api/paas/v4` |
| Ollama | `http://localhost:11434` |
