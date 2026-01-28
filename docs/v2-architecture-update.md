# AgentRouter v2 Architecture Update - January 2026

## Summary of Changes

### Files Modified

1. **`src/cli/setup-wizard.ts`** (replaced with v2)
   - Added Anthropic as a configurable provider
   - Added access mode selection (API vs Subscription) for supported providers
   - Updated all model lists to January 2026 versions
   - Added orchestrator role for full flexibility
   - Updated pricing and documentation links

2. **`src/cli/test-connection.ts`**
   - Added `testAnthropicConnection()` function
   - Updated header comments

3. **`src/types.ts`**
   - Added `AccessMode` type (`"api" | "subscription"`)
   - Added `access_mode` field to `ProviderConfig`
   - Added `'deepseek'` to `ProviderType`

### Backup Created
- `src/cli/setup-wizard.ts.backup` - Original v1 wizard

---

## Verified Provider Information (January 2026)

### Anthropic (Claude)
| Model | ID | Notes |
|-------|------|-------|
| Claude Opus 4.5 | `claude-opus-4-5-20251101` | Most intelligent |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` | Best balance |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fastest, cheapest |

**Access Modes:**
- **API**: `ANTHROPIC_API_KEY` from https://console.anthropic.com/settings/keys
- **Subscription**: Claude Code (Max $100/mo, Pro $20/mo)

---

### OpenAI (GPT-5 Series)
| Model | ID | Notes |
|-------|------|-------|
| GPT-5.2 | `gpt-5.2` | Most advanced frontier |
| GPT-5.1 | `gpt-5.1` | Best for coding, adaptive reasoning |
| GPT-5 | `gpt-5` | Strong coding, 400K context |
| GPT-5 Mini | `gpt-5-mini` | Cost-effective |
| GPT-4.1 | `gpt-4.1` | Previous gen, 1M context |
| o3 | `o3` | Advanced reasoning |

**Access Modes:**
- **API**: `OPENAI_API_KEY` from https://platform.openai.com/api-keys
- **Subscription**: Codex CLI (`npm install -g @openai/codex`) with ChatGPT Plus/Pro

**Note:** GPT-4.5-preview deprecated April 2025, o1 series replaced by o3/o4

---

### Google Gemini
| Model | ID | Notes |
|-------|------|-------|
| Gemini 3 Pro (Preview) | `gemini-3-pro-preview` | Most advanced reasoning |
| Gemini 3 Flash (Preview) | `gemini-3-flash-preview` | Fast frontier performance |
| Gemini 2.5 Pro | `gemini-2.5-pro` | Stable, high capability |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Fast, balanced |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | Cheapest |

**Access Modes:**
- **API**: `GEMINI_API_KEY` from https://aistudio.google.com/apikey
- **Subscription**: Gemini CLI (`npm install -g @google/gemini-cli`)
  - **FREE**: 60 req/min, 1000 req/day with Google account login!

**Note:** Gemini 2.0 deprecated March 2026

---

### DeepSeek (V3.2)
| Model | ID | Notes |
|-------|------|-------|
| DeepSeek Reasoner | `deepseek-reasoner` | V3.2 with thinking mode |
| DeepSeek Chat | `deepseek-chat` | V3.2 non-thinking |

**Pricing:** $0.28/1M input, $0.42/1M output (cache hit: $0.028/1M)

**Access Modes:**
- **API only**: `DEEPSEEK_API_KEY` from https://platform.deepseek.com/api_keys

---

### Z.AI (GLM-4.7)
| Model | ID | Notes |
|-------|------|-------|
| GLM-4.7 | `glm-4.7` | Flagship, 200K context, 128K output |
| GLM-4.7 FlashX | `glm-4.7-flashx` | Fast, affordable |
| GLM-4.7 Flash | `glm-4.7-flash` | Free tier |

**Features:**
- Thinking mode (interleaved, preserved, turn-level)
- Enhanced agentic coding
- Tool invocation: 84.7 on τ²-Bench (beats Claude Sonnet 4.5)

**Access Modes:**
- **API**: `ZAI_API_KEY` from https://z.ai/manage-apikey/apikey-list
- **Subscription**: GLM Coding Plan ($3/month)

**API Endpoint:** `https://api.z.ai/api/paas/v4`

---

### Ollama (Local)
| Model | ID | Notes |
|-------|------|-------|
| Llama 3.2 | `llama3.2` | Default local model |
| Qwen 3 32B | `qwen3:32b` | Strong reasoning |
| CodeLlama | `codellama` | Code-focused |
| DeepSeek Coder V2 | `deepseek-coder-v2` | Excellent for code |

**Access Modes:**
- **Local only**: No API key needed
- Install: https://ollama.ai
- Run: `ollama serve`

---

## CLI Tools Summary

| Provider | CLI Tool | Cost | Install |
|----------|----------|------|---------|
| Anthropic | Claude Code | Max $100/mo, Pro $20/mo | Built-in |
| OpenAI | Codex CLI | ChatGPT Plus $20/mo, Pro $200/mo | `npm i -g @openai/codex` |
| Google | Gemini CLI | **FREE** (60/min, 1000/day) | `npm i -g @google/gemini-cli` |
| Z.AI | GLM Coding Plan | $3/month | Works with existing tools |
| DeepSeek | — | API only | — |
| Ollama | Local | Free | `brew install ollama` |

---

## Example Configuration (v2)

```yaml
# AgentRouter Configuration v2
version: "2.0"

defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

providers:
  anthropic:
    access_mode: subscription  # Using Claude Code
    default_model: claude-sonnet-4-5-20250929
    
  openai:
    access_mode: api
    api_key: ${OPENAI_API_KEY}
    base_url: https://api.openai.com/v1
    default_model: gpt-5.1
    
  google:
    access_mode: subscription  # Using Gemini CLI (FREE!)
    default_model: gemini-2.5-flash
    
  deepseek:
    access_mode: api
    api_key: ${DEEPSEEK_API_KEY}
    base_url: https://api.deepseek.com
    default_model: deepseek-reasoner
    
  zai:
    access_mode: api
    api_key: ${ZAI_API_KEY}
    base_url: https://api.z.ai/api/paas/v4
    default_model: glm-4.7-flash

roles:
  orchestrator:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.3
    
  critic:
    provider: deepseek
    model: deepseek-reasoner
    temperature: 0.3
    
  reviewer:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.2
    
  designer:
    provider: google
    model: gemini-2.5-pro
    
  researcher:
    provider: google
    model: gemini-2.5-pro
```

---

## Research Sources
- OpenAI: https://platform.openai.com/docs/models
- Anthropic: https://docs.anthropic.com/en/docs/about-claude/models/overview
- Google: https://ai.google.dev/gemini-api/docs/models
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
- Z.AI: https://docs.z.ai/guides/llm/glm-4.7
- Gemini CLI: https://github.com/google-gemini/gemini-cli
