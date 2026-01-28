# 🔀 AgentRouter

**Multi-Agent AI Orchestration for Claude Code and Beyond**

AgentRouter is an MCP (Model Context Protocol) server that enables multi-agent orchestration across different AI providers. Get second opinions from GPT-5, DeepSeek, Gemini, and more—all from within Claude Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)

---

## ✨ Features

- **Multi-Provider Support** – Route tasks to OpenAI, Anthropic, Google Gemini, DeepSeek, Z.AI, and local Ollama models
- **Specialized Agent Roles** – Dedicated agents for coding, code review, critique, design, and research
- **Claude Code Tasks Integration** – Full integration with Claude Code's native task system (v2.1+) 🆕
- **Multi-Provider Pipelines** – Create task DAGs where each stage uses a different provider 🆕
- **Background Workers** – Spawn worker swarms to process task queues in parallel 🆕
- **Pre-Built Skills** – Ready-to-use patterns for common multi-provider workflows 🆕
- **Subscription Mode** – Use your Claude Code subscription as the orchestrator (no API key needed)
- **Smart Routing** – Automatically route tasks to the best-suited agent based on role
- **Cost Optimization** – Mix premium and budget models strategically
- **MCP Native** – Integrates seamlessly with Claude Code and other MCP-compatible tools

---

## 🚀 Quick Start

### Installation

```bash
# Install globally
npm install -g mcp-agent-router

# Or clone and build locally
git clone https://github.com/sashabogi/agent-router.git
cd agent-router
npm install
npm run build
npm link
```

### Setup

Run the interactive setup wizard:

```bash
agent-router setup
```

The wizard guides you through:
1. **Choosing your orchestrator** – Select which AI coordinates your agents
2. **Adding agent providers** – Configure API keys for other providers
3. **Assigning roles** – Map providers to specialized agent roles

### Connect to Claude Code

Add AgentRouter to your Claude Code MCP settings:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Code to activate.

---

## 🔗 Claude Code Tasks Integration (v3.0)

AgentRouter v3.0 fully integrates with Claude Code's native **Tasks** system (v2.1+). This enables:

### Task-Aware Tools

| Tool | Description |
|------|-------------|
| `execute_task` | Execute a Claude Code task with AgentRouter routing |
| `create_routed_task` | Create a task pre-configured for a specific role |
| `execute_pipeline` | Create multi-step workflows with dependencies |
| `claim_next_task` | Worker pattern: claim and process task queues |
| `get_pipeline_status` | Monitor pipeline progress and results |

### Multi-Provider Pipelines

Create task workflows where each stage uses the optimal provider:

```
execute_pipeline({
  name: "feature-build",
  steps: [
    { name: "research", subject: "Research patterns", role: "researcher" },    → Gemini 3 Pro
    { name: "design", subject: "Design architecture", role: "designer", dependsOn: ["research"] },    → Claude Sonnet
    { name: "implement", subject: "Implement feature", role: "coder", dependsOn: ["design"] },    → DeepSeek Reasoner
    { name: "review", subject: "Review code", role: "reviewer", dependsOn: ["implement"] }    → OpenAI o3
  ]
})
```

### Pre-Built Skills

Install with `agent-router install-skills`:

| Skill | Description |
|-------|-------------|
| `/multi-provider-build` | Full feature development with 5-stage pipeline |
| `/parallel-review` | Get code reviews from multiple providers simultaneously |
| `/research-implement` | Research-first development pattern |
| `/spawn-workers` | Create worker swarms for batch processing |

### Example: Multi-Provider Feature Build

```
You: /multi-provider-build Add JWT authentication with refresh tokens

AgentRouter creates pipeline:
├── Research (Gemini 3 Pro) → Best practices survey
├── Design (Claude Sonnet) → Architecture design  
├── Implement (DeepSeek Reasoner) → Code implementation
├── Review (OpenAI o3) → Bug detection
└── Critique (GPT-5.2) → Security analysis

Each step routes to its configured provider automatically.
```

📖 **[Full Tasks Integration Guide →](docs/tasks-integration.md)**

---

## 📦 Supported Providers

| Provider | Models | Access Mode | Cost |
|----------|--------|-------------|------|
| **Anthropic** | Claude Opus/Sonnet/Haiku 4.5 | Subscription or API | $$$ |
| **OpenAI** | GPT-5.2, GPT-5.1, GPT-5, o3 | API | $$$ |
| **Google Gemini** | Gemini 3 Pro/Flash, 2.5 Pro/Flash | API | $$ |
| **DeepSeek** | V3.2 Reasoner, V3.2 Chat | API | $ |
| **Z.AI (GLM)** | GLM-4.7, GLM-4.7 FlashX/Flash | API | $ |
| **Ollama** | Llama 3.2, Qwen, CodeLlama, etc. | Local | Free |

### Model Highlights (January 2026)

- **Claude Sonnet 4.5** – Best for orchestration and complex coding tasks
- **GPT-5.1** – Excellent for code review with adaptive reasoning
- **DeepSeek V3.2 Reasoner** – Outstanding reasoning at 1/10th the cost
- **GLM-4.7** – Strong agentic coding, 84.7% on τ²-Bench
- **Gemini 3 Pro** – Great for research and multimodal tasks

---

## 🎭 Agent Roles

AgentRouter supports these specialized roles:

| Role | Purpose | Recommended Provider |
|------|---------|---------------------|
| **Orchestrator** | Coordinates all agents, routes tasks | Anthropic (subscription) |
| **Coder** | Writes, refactors, implements code | DeepSeek, Anthropic |
| **Critic** | Challenges assumptions, finds flaws | DeepSeek Reasoner |
| **Reviewer** | Code review for bugs, security, performance | OpenAI o3 |
| **Designer** | UI/UX feedback and design review | Claude Sonnet |
| **Researcher** | Fact-finding and research tasks | Google Gemini |

---

## ⚙️ Configuration

Configuration is stored at `~/.config/agent-router/config.yaml`

### Example Configuration (v3.0)

```yaml
# AgentRouter Configuration v3
version: "3.0"

defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

# NEW: Tasks integration settings
tasks:
  enabled: true
  defaults:
    autoComplete: true
    timeoutMs: 300000

providers:
  anthropic:
    access_mode: subscription  # Uses Claude Code session
    default_model: claude-sonnet-4-5-20250929
    
  openai:
    access_mode: api
    api_key: ${OPENAI_API_KEY}
    default_model: gpt-5.1
    
  google:
    access_mode: api
    api_key: ${GEMINI_API_KEY}
    default_model: gemini-3-pro
    
  deepseek:
    access_mode: api
    api_key: ${DEEPSEEK_API_KEY}
    default_model: deepseek-reasoner

roles:
  orchestrator:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    
  coder:
    provider: deepseek
    model: deepseek-reasoner
    
  critic:
    provider: deepseek
    model: deepseek-reasoner
    
  reviewer:
    provider: openai
    model: o3
    
  designer:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    
  researcher:
    provider: google
    model: gemini-3-pro
```

### Environment Variables

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="AIza..."
export DEEPSEEK_API_KEY="sk-..."
export ZAI_API_KEY="..."
```

---

## 🖥️ CLI Commands

```bash
# Interactive setup wizard
agent-router setup

# Start the MCP server
agent-router start

# Install skills to Claude Code
agent-router install-skills

# Create default config file
agent-router init

# Validate configuration
agent-router validate

# List configured roles
agent-router list-roles

# Provider management
agent-router provider add [name]   # Add a provider
agent-router provider test [name]  # Test connection
agent-router provider list         # List providers

# Help
agent-router --help
agent-router --version
```

---

## 🔄 How It Works

### Basic Routing

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                    (Your Interface)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP Protocol
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     AgentRouter                              │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Coder  │  │  Critic │  │Reviewer │  │Designer │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
└───────┼────────────┼────────────┼────────────┼──────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
   │DeepSeek │  │DeepSeek │  │ OpenAI  │  │ Claude  │
   └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

### With Tasks Integration (v3.0)

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code v2.1+                         │
│     ┌─────────────────────────────────────────────┐         │
│     │  TaskCreate → TaskUpdate → TaskList          │         │
│     │           Native Task State                  │         │
│     └──────────────────┬──────────────────────────┘         │
└────────────────────────┼────────────────────────────────────┘
                         │ MCP Protocol
                         ▼
┌────────────────────────────────────────────────────────────┐
│                    AgentRouter v3.0                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Task Integration Layer                      │  │
│  │  execute_task | execute_pipeline | claim_next_task   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Router Engine + Providers               │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 💡 Usage Examples

### Simple: Get a Code Review

```
You: Can you have the reviewer check this function for issues?

AgentRouter: Routing to reviewer (openai/o3)...

Reviewer: I found 3 issues in your function:
1. Line 15: Potential SQL injection vulnerability...
```

### Intermediate: Compare Multiple Providers

```
You: Compare how different providers would approach this refactoring.

AgentRouter: Running compare_agents with coder, reviewer, critic...

Results from 3 providers:
- DeepSeek Reasoner: Focus on algorithmic optimization...
- OpenAI o3: Suggests architectural changes...
- DeepSeek Reasoner: Questions the fundamental approach...
```

### Advanced: Multi-Provider Pipeline

```
You: /multi-provider-build Add rate limiting with Redis

AgentRouter: Creating 5-step pipeline...

Step 1/5: Research (Gemini 3 Pro)
  └── Surveyed rate limiting patterns: token bucket, sliding window...

Step 2/5: Design (Claude Sonnet)
  └── Architecture: middleware + Redis sorted sets + configuration...

Step 3/5: Implement (DeepSeek Reasoner)
  └── Created rate-limiter.ts, redis-store.ts, middleware.ts...

Step 4/5: Review (OpenAI o3)
  └── Found edge case in concurrent request handling...

Step 5/5: Critique (GPT-5.2)
  └── Security OK. Suggested: add request logging for compliance...

Pipeline complete! All files in ./src/rate-limiting/
```

---

## 🔒 Security

- **API keys are masked** during setup wizard input
- **Environment variable interpolation** keeps secrets out of config files
- **Local Ollama option** for air-gapped/private environments
- **Task isolation** – each pipeline execution is scoped

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Development mode (watch)
npm run dev
```

### Project Structure

```
agent-router/
├── src/
│   ├── cli/              # CLI commands and setup wizard
│   ├── config/           # Configuration management
│   ├── mcp/              # MCP protocol implementation
│   ├── providers/        # Provider integrations
│   ├── router/           # Request routing logic
│   ├── tasks/            # Task integration layer (v3.0)
│   ├── translation/      # API translation layer
│   └── types.ts          # TypeScript type definitions
├── docs/                 # Documentation
├── skills/               # Pre-built Claude Code skills
├── tests/                # Test suites
└── config/               # Default configurations
```

---

## 📚 Documentation

- [Tasks Integration Guide](docs/tasks-integration.md) 🆕
- [Full Design Document](docs/design/CLAUDE_CODE_TASKS_INTEGRATION.md) 🆕
- [Architecture Overview](docs/architecture.md)
- [Provider Setup Guide](docs/provider-setup.md)
- [Configuration Reference](docs/configuration.md)
- [API Reference](docs/api-reference.md)

---

## 🤝 Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com) for Claude and the MCP protocol
- [Model Context Protocol](https://modelcontextprotocol.io) specification
- All the AI providers making this multi-agent future possible

---

**Built with ❤️ by [Sasha Bogojevic](https://github.com/sashabogi)**
