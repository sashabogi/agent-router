# Changelog

All notable changes to AgentRouter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Comprehensive documentation (README, provider setup, configuration reference, API reference)
- CONTRIBUTING.md with development guidelines
- LICENSE file (MIT)

---

## [3.0.0] - 2026-01-28

### Added

#### Claude Code Tasks Integration
- Full integration with Claude Code's native Tasks system (v2.1+)
- 5 new MCP tools for task management:
  - `execute_task` - Execute a Claude Code task using AgentRouter routing
  - `create_routed_task` - Create a task pre-configured for a specific role
  - `execute_pipeline` - Create multi-step DAG workflows with dependencies
  - `claim_next_task` - Worker protocol for background task processing
  - `get_pipeline_status` - Query pipeline execution status

#### Task Infrastructure
- `TaskCoordinator` - Bridges AgentRouter with Claude Code Tasks lifecycle
- `PipelineManager` - DAG validation (Kahn's algorithm), phase computation, context propagation
- `WorkerMode` - Background task processing with heartbeat and idle timeout

#### Pre-Built Skills
- `/multi-provider-build` - 5-stage feature development pipeline
- `/parallel-review` - Simultaneous reviews from multiple providers
- `/research-implement` - Research-first development pattern
- `/spawn-workers` - Background worker swarm for batch processing

#### CLI
- `agent-router install-skills` - Install skills to ~/.claude/skills/

#### Configuration
- New `tasks` configuration section:
  - `tasks.enabled` - Enable task-aware tools
  - `tasks.defaults.autoComplete` - Auto-mark tasks complete
  - `tasks.defaults.timeoutMs` - Execution timeout
  - `tasks.worker.*` - Worker mode settings
  - `tasks.pipeline.*` - Pipeline settings

### Changed
- Package renamed from `@sashabogi/agent-router` to `mcp-agent-router`
- Updated `registerTools()` to accept optional TaskCoordinator and PipelineManager

### Testing
- 148 new unit tests for task modules
- 82 new integration tests for task tools
- Total: 322 tests passing

---

## [0.1.0] - 2026-01-28

### Added

#### Core Features
- Multi-agent orchestration via MCP protocol
- Support for 6 AI providers:
  - Anthropic (Claude Opus/Sonnet/Haiku 4.5)
  - OpenAI (GPT-5.2, GPT-5.1, GPT-5, o3)
  - Google Gemini (Gemini 3/2.5 Pro/Flash)
  - DeepSeek (V3.2 Reasoner/Chat)
  - Z.AI (GLM-4.7, GLM-4.7 FlashX/Flash)
  - Ollama (local models)

#### Agent Roles
- Orchestrator - Main coordinator
- Coder - Code implementation
- Critic - Critical analysis
- Reviewer - Code review
- Designer - UI/UX feedback
- Researcher - Research tasks

#### Access Modes
- API mode - Standard API key access
- Subscription mode - Claude Code passthrough for orchestrator

#### CLI
- Interactive setup wizard with step-by-step flow
- API key masking during input
- Connection testing for all providers
- Provider management commands (`add`, `test`, `list`)
- Configuration validation
- Role listing

#### Configuration
- YAML-based configuration
- Environment variable interpolation
- Role-specific settings (temperature, max_tokens, system_prompt)
- Fallback provider support
- Profile support

### Changed
- Restructured setup wizard flow:
  1. Choose orchestrator (with subscription option)
  2. Add agent providers (API keys required)
  3. Configure API keys
  4. Assign roles

### Fixed
- API keys now masked in setup wizard (were previously visible)
- Subscription mode correctly limited to orchestrator only

### Security
- API keys stored in environment variables
- Keys never logged or exposed in configuration
- Masked input for all sensitive data

---

## [0.0.1] - 2026-01-15

### Added
- Initial project structure
- Basic MCP server implementation
- OpenAI and Gemini provider support
- Simple configuration system

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 3.0.0 | 2026-01-28 | Claude Code Tasks integration, pipelines, workers, pre-built skills |
| 0.1.0 | 2026-01-28 | Full v2 architecture, 6 providers, subscription mode |
| 0.0.1 | 2026-01-15 | Initial prototype |

---

## Migration Guide

### From 0.0.x to 0.1.0

1. **Configuration format changed**:
   ```yaml
   # Old format
   providers:
     openai:
       api_key: "..."
   
   # New format (v2)
   providers:
     openai:
       access_mode: api
       api_key: ${OPENAI_API_KEY}
   ```

2. **New roles available**:
   - `coder` role added
   - `orchestrator` role now configurable

3. **Re-run setup wizard**:
   ```bash
   agent-router setup
   ```
   Your existing config will be backed up automatically.

### From 0.1.x to 3.0.0

1. **Package renamed**:
   ```bash
   # Old
   npm install @sashabogi/agent-router

   # New
   npm install mcp-agent-router
   ```

2. **Update MCP config** (claude_desktop_config.json):
   ```json
   {
     "mcpServers": {
       "agent-router": {
         "command": "npx",
         "args": ["mcp-agent-router"]
       }
     }
   }
   ```

3. **Add tasks configuration** (optional):
   ```yaml
   # ~/.config/agent-router/config.yaml
   tasks:
     enabled: true
     defaults:
       autoComplete: true
       timeoutMs: 300000
     worker:
       heartbeatIntervalMs: 30000
       idleTimeoutMs: 60000
     pipeline:
       maxConcurrentPhases: 3
       contextPropagation: true
   ```

4. **Install pre-built skills** (optional):
   ```bash
   agent-router install-skills
   ```
   This installs skills to `~/.claude/skills/agent-router/`

5. **New MCP tools available**:
   - `execute_task` - Run tasks through AgentRouter
   - `create_routed_task` - Create role-specific tasks
   - `execute_pipeline` - Multi-step DAG workflows
   - `claim_next_task` - Background worker processing
   - `get_pipeline_status` - Pipeline status queries

6. **Breaking changes**:
   - `registerTools()` signature changed - now accepts optional `TaskCoordinator` and `PipelineManager`
   - If you extended AgentRouter programmatically, update your imports
