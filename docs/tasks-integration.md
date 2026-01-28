# AgentRouter + Claude Code Tasks Integration

## Quick Start Guide

This guide walks you through integrating AgentRouter with Claude Code's native Tasks system for powerful multi-provider workflows.

---

## Prerequisites

- **Claude Code** v2.1.19 or later
- **AgentRouter** v3.0.0 or later
- At least one provider configured (OpenAI, Gemini, DeepSeek, etc.)

---

## What's New in v3.0

AgentRouter v3.0 adds **full integration** with Claude Code's Tasks system:

| Feature | Description |
|---------|-------------|
| **Task-Aware Tools** | Execute Claude Code tasks through AgentRouter's routing |
| **Pipeline Execution** | Create multi-step workflows with dependencies |
| **Worker Mode** | Background agents that process task queues |
| **Pre-Built Skills** | Ready-to-use patterns for common workflows |

---

## Installation

### 1. Update AgentRouter

```bash
npm update mcp-agent-router
```

### 2. Enable Tasks Integration

Add to your `agent-router.yaml`:

```yaml
tasks:
  enabled: true
  defaults:
    autoComplete: true
    timeoutMs: 300000
```

### 3. Install Skills (Optional)

```bash
agent-router install-skills
```

This copies skill files to `~/.claude/skills/agent-router/`.

### 4. Restart Claude Code

The new MCP tools will be available after restart.

---

## New MCP Tools

### execute_task

Execute a Claude Code task using AgentRouter's routing:

```
execute_task({
  taskId: "1",
  role: "coder"  // Routes to your configured coder provider
})
```

**What it does:**
1. Claims the task (sets status to `in_progress`)
2. Routes to the provider configured for the role
3. Executes the task
4. Returns instructions to mark complete

### create_routed_task

Create a task pre-configured for AgentRouter:

```
create_routed_task({
  subject: "Implement auth middleware",
  description: "Add JWT validation to API routes",
  role: "coder",
  blockedBy: ["1"]  // Depends on task #1
})
```

### execute_pipeline

Create a full multi-step workflow:

```
execute_pipeline({
  name: "feature-build",
  steps: [
    { name: "research", subject: "Research best practices", role: "researcher" },
    { name: "design", subject: "Design architecture", role: "designer", dependsOn: ["research"] },
    { name: "implement", subject: "Implement feature", role: "coder", dependsOn: ["design"] },
    { name: "review", subject: "Review code", role: "reviewer", dependsOn: ["implement"] }
  ],
  context: "Build a rate limiting system"
})
```

### claim_next_task

For worker subagents to claim available tasks:

```
claim_next_task({
  workerName: "worker-1",
  roles: ["coder", "reviewer"]  // Only these roles
})
```

### get_pipeline_status

Monitor pipeline progress:

```
get_pipeline_status({ pipelineName: "feature-build" })
```

---

## Pre-Built Skills

### /multi-provider-build

Full feature development with specialized providers:

```
/multi-provider-build Add user authentication with JWT and refresh tokens
```

**Pipeline:**
1. **Research** (Gemini) → Best practices
2. **Design** (Claude) → Architecture
3. **Implement** (DeepSeek) → Code
4. **Review** (OpenAI) → Bug check
5. **Critique** (GPT-5) → Security check

### /parallel-review

Get reviews from multiple providers simultaneously:

```
/parallel-review [paste code]
```

Returns perspectives from reviewer, critic, and coder roles in parallel.

### /research-implement

Research-first development:

```
/research-implement Create a WebSocket server with reconnection
```

1. **Research** → Survey best practices
2. **Implement** → Build with research context
3. **Verify** (optional) → Check alignment

### /spawn-workers

Process task queues in parallel:

```
/spawn-workers Review all files in src/ for security issues
```

Spawns background workers that claim and execute tasks.

---

## Example Workflow

### Building a Feature with Multi-Provider Pipeline

**Step 1: User Request**
```
Build a caching layer for our API with Redis
```

**Step 2: Create Pipeline**
```javascript
execute_pipeline({
  name: "cache-layer",
  steps: [
    {
      name: "research",
      subject: "Research Redis caching patterns",
      role: "researcher"
    },
    {
      name: "design", 
      subject: "Design cache architecture",
      role: "designer",
      dependsOn: ["research"]
    },
    {
      name: "implement",
      subject: "Implement caching layer",
      role: "coder",
      dependsOn: ["design"]
    },
    {
      name: "review",
      subject: "Review implementation",
      role: "reviewer",
      dependsOn: ["implement"]
    }
  ]
})
```

**Step 3: Pipeline Creates Tasks**

```
TaskCreate({ subject: "Research Redis caching patterns", metadata: { role: "researcher" }}) → #1
TaskCreate({ subject: "Design cache architecture", blockedBy: ["1"], metadata: { role: "designer" }}) → #2
TaskCreate({ subject: "Implement caching layer", blockedBy: ["2"], metadata: { role: "coder" }}) → #3
TaskCreate({ subject: "Review implementation", blockedBy: ["3"], metadata: { role: "reviewer" }}) → #4
```

**Step 4: Execute Steps**

```javascript
// Step 1: Research (routes to Gemini)
execute_task({ taskId: "1" })
// → Gemini 3 Pro researches caching patterns
// → Returns findings, marks task complete

// Step 2: Design (routes to Claude)
execute_task({ taskId: "2" })
// → Claude Sonnet designs architecture
// → Returns design, marks task complete

// Step 3: Implement (routes to DeepSeek)
execute_task({ taskId: "3" })
// → DeepSeek Reasoner writes code
// → Returns implementation, marks task complete

// Step 4: Review (routes to OpenAI)
execute_task({ taskId: "4" })
// → OpenAI o3 reviews code
// → Returns feedback, marks task complete
```

**Step 5: Results**

All results available in task history and returned to orchestrator.

---

## Provider Routing

Each role routes to your configured provider:

```yaml
# agent-router.yaml
roles:
  researcher:
    provider: google
    model: gemini-3-pro
    
  designer:
    provider: anthropic
    model: claude-sonnet-4-5
    
  coder:
    provider: deepseek
    model: deepseek-reasoner
    
  reviewer:
    provider: openai
    model: o3
    
  critic:
    provider: openai
    model: gpt-5.2
```

**Why different providers?**
- **Gemini**: Large context, great for research synthesis
- **Claude**: Clear communication, good for design docs
- **DeepSeek**: Strong reasoning, excellent for complex code
- **OpenAI o3**: Logical analysis, thorough reviews
- **GPT-5**: Broad knowledge, security awareness

---

## Tips for Best Results

1. **Be specific in task descriptions** - Include requirements, constraints, context
2. **Use meaningful step names** - Makes dependency graphs clear
3. **Add global context** - Context is passed to all steps
4. **Monitor with get_pipeline_status** - Track progress and token usage
5. **Review intermediate results** - Check research/design before implement

---

## Troubleshooting

### Task not executing
- Check task status with `TaskList()`
- Verify blockedBy dependencies are complete
- Ensure role is configured in AgentRouter

### Provider errors
- Check API key configuration
- Verify provider is reachable
- Check rate limits

### Worker not claiming tasks
- Verify task metadata.role matches worker's allowed roles
- Check for stuck in_progress tasks (may need release)
- Ensure tasks have status=pending and no owner

---

## Next Steps

- Read the [full design document](design/CLAUDE_CODE_TASKS_INTEGRATION.md)
- Explore the [skill templates](../skills/)
- Configure providers in [Configuration Guide](configuration.md)
- See [API Reference](api-reference.md) for all tool schemas
