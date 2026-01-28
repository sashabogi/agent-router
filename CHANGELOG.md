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
