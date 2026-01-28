# Contributing to AgentRouter

Thank you for your interest in contributing to AgentRouter! This document provides guidelines and information for contributors.

---

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something cool together.

---

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/sashabogi/agent-router.git
cd agent-router

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

---

## Development Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes

Example: `feature/add-azure-openai-provider`

### Commit Messages

Follow conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting, no code change
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance tasks

Examples:
```
feat(providers): add Azure OpenAI provider support
fix(router): handle timeout correctly for slow providers
docs(readme): add troubleshooting section
```

---

## Project Structure

```
agent-router/
├── src/
│   ├── cli/              # CLI commands and setup wizard
│   │   ├── setup-wizard.ts
│   │   └── test-connection.ts
│   ├── config/           # Configuration management
│   │   ├── defaults.ts
│   │   ├── manager.ts
│   │   └── schema.ts
│   ├── mcp/              # MCP protocol implementation
│   │   └── server.ts
│   ├── providers/        # Provider integrations
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   ├── deepseek.ts
│   │   ├── zai.ts
│   │   └── ollama.ts
│   ├── router/           # Request routing logic
│   │   └── router.ts
│   ├── translation/      # API translation layer
│   │   └── translator.ts
│   ├── cli.ts            # CLI entry point
│   ├── server.ts         # Server entry point
│   ├── index.ts          # Library exports
│   └── types.ts          # TypeScript types
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/                 # Documentation
└── config/               # Default configurations
```

---

## Adding a New Provider

1. **Create provider file** in `src/providers/`

```typescript
// src/providers/newprovider.ts
import { ProviderConfig, CompletionRequest, CompletionResponse } from '../types.js';

export class NewProvider {
  constructor(private config: ProviderConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Implementation
  }

  async testConnection(): Promise<boolean> {
    // Test API connectivity
  }
}
```

2. **Add to provider factory** in `src/providers/index.ts`

3. **Add connection test** in `src/cli/test-connection.ts`

4. **Add to setup wizard** in `src/cli/setup-wizard.ts`

5. **Add documentation** in `docs/provider-setup.md`

6. **Add tests** in `tests/`

---

## Testing

### Run All Tests

```bash
npm test
```

### Run Specific Tests

```bash
# Unit tests only
npm test -- --grep "unit"

# Integration tests
npm test -- --grep "integration"

# Single file
npm test -- src/providers/openai.test.ts
```

### Coverage

```bash
npm run test:coverage
```

---

## Code Style

We use ESLint and Prettier for code formatting.

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix
```

### TypeScript Guidelines

- Use strict mode
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Document public APIs with JSDoc

```typescript
/**
 * Invokes an agent with the specified role.
 * 
 * @param role - The agent role to invoke
 * @param task - The task to perform
 * @returns The agent's response
 * @throws {InvalidRoleError} If role is not configured
 */
async function invoke(role: string, task: string): Promise<AgentResponse> {
  // ...
}
```

---

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Test** thoroughly
5. **Submit** a pull request

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow convention
- [ ] PR description explains the change

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Tests pass
- [ ] Linting passes
- [ ] Documentation updated
```

---

## Reporting Issues

### Bug Reports

Include:
- AgentRouter version
- Node.js version
- Operating system
- Steps to reproduce
- Expected behavior
- Actual behavior
- Error messages/logs

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternatives considered

---

## Documentation

Documentation lives in `/docs`. When adding features:

1. Update relevant docs
2. Add examples
3. Update README if needed

### Building Docs Locally

Documentation is Markdown-based and renders on GitHub.

---

## Release Process

(For maintainers)

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create release commit
4. Tag release
5. Push to npm

```bash
npm version patch|minor|major
git push --tags
npm publish
```

---

## Getting Help

- Open an issue for bugs/features
- Start a discussion for questions
- Join our Discord (coming soon)

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉
