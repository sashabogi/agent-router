# 🔀 AgentRouter

**Multi-Agent AI Orchestration for Claude Code and Beyond**

AgentRouter is an MCP (Model Context Protocol) server that enables multi-agent orchestration across different AI providers. Get second opinions from GPT-5, DeepSeek, Gemini, and more—all from within Claude Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)

---

## ✨ Features

- **Multi-Provider Support** – Route tasks to OpenAI, Anthropic, Google Gemini, DeepSeek, Z.AI, and local Ollama models
- **Specialized Agent Roles** – Dedicated agents for coding, code review, critique, design, and research
- **Subscription Mode** – Use your Claude Code subscription as the orchestrator (no API key needed)
- **Smart Routing** – Automatically route tasks to the best-suited agent based on role
- **Cost Optimization** – Mix premium and budget models strategically
- **MCP Native** – Integrates seamlessly with Claude Code and other MCP-compatible tools

---

## 🚀 Quick Start

### Installation

```bash
# Install globally
npm install -g @sashabogi/agent-router

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
| **Coder** | Writes, refactors, implements code | Anthropic, OpenAI |
| **Critic** | Challenges assumptions, finds flaws | DeepSeek Reasoner |
| **Reviewer** | Code review for bugs, security, performance | Anthropic, OpenAI |
| **Designer** | UI/UX feedback and design review | Google Gemini |
| **Researcher** | Fact-finding and research tasks | Google Gemini |

---

## ⚙️ Configuration

Configuration is stored at `~/.config/agent-router/config.yaml`

### Example Configuration

```yaml
# AgentRouter Configuration v2
version: "2.0"

defaults:
  temperature: 0.7
  max_tokens: 4096
  timeout_ms: 60000

providers:
  anthropic:
    access_mode: subscription  # Uses Claude Code session
    default_model: claude-sonnet-4-5-20250929
    
  openai:
    access_mode: api
    api_key: ${OPENAI_API_KEY}
    base_url: https://api.openai.com/v1
    default_model: gpt-5.1
    
  deepseek:
    access_mode: api
    api_key: ${DEEPSEEK_API_KEY}
    base_url: https://api.deepseek.com
    default_model: deepseek-reasoner

roles:
  orchestrator:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.3
    
  coder:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    temperature: 0.2
    
  critic:
    provider: deepseek
    model: deepseek-reasoner
    temperature: 0.3
    
  reviewer:
    provider: openai
    model: gpt-5.1
    temperature: 0.2
```

### Environment Variables

API keys can be set as environment variables:

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

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                    (Your Interface)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP Protocol
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     AgentRouter                              │
│                   (Orchestrator)                             │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Coder  │  │  Critic │  │Reviewer │  │Designer │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
└───────┼────────────┼────────────┼────────────┼──────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
   │Anthropic│  │DeepSeek │  │ OpenAI  │  │ Gemini  │
   │  API    │  │   API   │  │   API   │  │   API   │
   └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

1. You interact with Claude Code as usual
2. AgentRouter intercepts requests and routes them to specialized agents
3. Each agent uses the optimal provider/model for its role
4. Results are synthesized and returned to Claude Code

---

## 💡 Usage Examples

### Get a Code Review

```
You: Can you have the reviewer check this function for issues?

AgentRouter: Routing to reviewer (openai/gpt-5.1)...

Reviewer: I found 3 issues in your function:
1. Line 15: Potential SQL injection vulnerability...
2. Line 23: Missing null check could cause NPE...
3. Line 31: O(n²) complexity could be reduced...
```

### Challenge a Design Decision

```
You: Have the critic review my database schema design.

AgentRouter: Routing to critic (deepseek/deepseek-reasoner)...

Critic: I have concerns about this schema:
1. The `users` table lacks proper indexing for the email lookup...
2. Storing JSON in the `metadata` column will make querying difficult...
3. Consider: Why not use a separate table for user preferences?
```

### Research a Topic

```
You: Can the researcher find best practices for WebSocket authentication?

AgentRouter: Routing to researcher (google/gemini-2.5-pro)...

Researcher: Based on current best practices:
1. Use token-based authentication during the handshake...
2. Implement connection-level heartbeats...
3. Consider using Socket.IO's built-in authentication middleware...
```

---

## 🔒 Security

- **API keys are masked** during setup wizard input
- **Keys stored in shell profile** are not committed to version control
- **Environment variable interpolation** keeps secrets out of config files
- **Local Ollama option** for air-gapped/private environments

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

# Linting
npm run lint
npm run lint:fix

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
│   ├── translation/      # API translation layer
│   └── types.ts          # TypeScript type definitions
├── docs/                 # Documentation
├── tests/                # Test suites
└── config/               # Default configurations
```

---

## 📚 Documentation

- [Architecture Overview](docs/v2-architecture-update.md)
- [Provider Setup Guide](docs/provider-setup.md)
- [Configuration Reference](docs/configuration.md)
- [API Reference](docs/api-reference.md)

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

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
