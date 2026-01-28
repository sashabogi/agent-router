# AgentRouter + Claude Code Tasks Integration

## Design Document v1.0

**Author:** Sasha Bogojevic  
**Date:** January 28, 2026  
**Status:** Design Phase  
**Claude Code Version:** 2.1.19+  
**AgentRouter Version:** 2.0.x → 3.0.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Background](#2-background)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Architecture Overview](#4-architecture-overview)
5. [Detailed Design](#5-detailed-design)
6. [New MCP Tools](#6-new-mcp-tools)
7. [Skills & Commands](#7-skills--commands)
8. [Task Lifecycle](#8-task-lifecycle)
9. [Configuration Changes](#9-configuration-changes)
10. [Migration Guide](#10-migration-guide)
11. [Testing Strategy](#11-testing-strategy)
12. [Security Considerations](#12-security-considerations)
13. [Future Enhancements](#13-future-enhancements)

---

## 1. Executive Summary

### The Problem

Claude Code v2.1+ introduced a native **Tasks** system (TaskCreate, TaskUpdate, TaskList) that replaces the ephemeral Todos system. This enables persistent, dependency-aware task management with multi-agent coordination. However, AgentRouter currently operates independently of this system, missing opportunities for:

- **Seamless task lifecycle integration** - Agent invocations don't update Claude Code task state
- **Multi-provider task pipelines** - No native way to route different pipeline stages to different LLM providers
- **Parallel provider execution** - Background workers can't leverage AgentRouter's routing
- **Unified orchestration** - Two separate coordination systems instead of one

### The Solution

Full integration of AgentRouter with Claude Code's Tasks system through:

1. **Task-aware MCP tools** that bridge routing to task lifecycle
2. **Pre-built skills** for common multi-provider patterns
3. **Worker-mode execution** for background task processing
4. **Unified observability** across both systems

### Expected Outcomes

- **50% reduction** in orchestration complexity for multi-provider workflows
- **Native integration** with Claude Code's `/tasks` UI
- **Automatic progress tracking** - no manual status updates
- **Reusable patterns** via skills for common workflows

---

## 2. Background

### 2.1 Claude Code Tasks System (v2.1+)

The new Tasks system replaces the session-bound Todos with persistent, team-aware tasks:

```typescript
// OLD: TodoWrite (session-only, no dependencies)
TodoWrite({
  todos: [
    { id: "1", content: "Research auth", status: "pending" },
    { id: "2", content: "Implement auth", status: "pending" }
  ]
})

// NEW: TaskCreate/TaskUpdate (persistent, with dependencies)
TaskCreate({
  subject: "Research auth patterns",
  description: "Survey current auth best practices for APIs",
  activeForm: "Researching auth patterns...",  // Spinner text
  metadata: { phase: "research", priority: 1 }
})

TaskCreate({
  subject: "Implement auth middleware",
  description: "Build JWT validation middleware",
  blockedBy: ["1"]  // Depends on task #1
})
```

**Key Capabilities:**
| Feature | Description |
|---------|-------------|
| `TaskCreate` | Create tasks with subject, description, metadata, dependencies |
| `TaskUpdate` | Update status, owner, add/remove dependencies, delete |
| `TaskList` | Query all tasks with current state |
| `blockedBy` | Task dependencies (DAG) |
| `owner` | Agent/worker ownership for claiming |
| `activeForm` | Dynamic spinner text during execution |
| `metadata` | Arbitrary key-value storage |

### 2.2 Team Coordination (Teammate Tool)

For multi-agent swarms:

```typescript
// Create a team
Teammate({ operation: "spawnTeam", team_name: "feature-build" })

// Spawn workers into the team
Task({
  team_name: "feature-build",
  name: "worker-1",
  subagent_type: "general-purpose",
  prompt: "Claim and execute tasks from the list",
  run_in_background: true
})

// Workers communicate
Teammate({ operation: "write", target_agent_id: "worker-2", value: "Found a bug in file X" })
Teammate({ operation: "read" })  // Read messages for me
```

### 2.3 Current AgentRouter Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentRouter MCP Server                   │
├─────────────────────────────────────────────────────────────┤
│  MCP Tools:                                                 │
│  ├── invoke_agent(role, task, context?)                    │
│  ├── compare_agents(roles[], task)                         │
│  ├── critique_plan(plan)                                   │
│  ├── review_code(code, context?)                           │
│  └── design_feedback(design)                               │
├─────────────────────────────────────────────────────────────┤
│  Router Engine:                                             │
│  ├── RoleResolver: role → AgentConfig                      │
│  ├── ProviderManager: manages provider connections         │
│  └── Fallback handling                                      │
├─────────────────────────────────────────────────────────────┤
│  Providers:                                                 │
│  ├── Anthropic (API mode)                                  │
│  ├── OpenAI (GPT-5.x, o3)                                  │
│  ├── Google Gemini (2.5/3 Pro/Flash)                       │
│  ├── DeepSeek (V3.2 Reasoner/Chat)                         │
│  ├── Z.AI (GLM-4.7)                                        │
│  └── Ollama (local)                                        │
└─────────────────────────────────────────────────────────────┘
```

**Gap:** No awareness of Claude Code's task state. Each `invoke_agent` call is stateless.

---

## 3. Goals & Non-Goals

### 3.1 Goals

1. **G1: Task-Aware Routing**  
   AgentRouter tools can claim, execute, and complete Claude Code tasks automatically.

2. **G2: Multi-Provider Pipelines**  
   Create task DAGs where each stage routes to a different provider based on role.

3. **G3: Background Worker Support**  
   Enable spawned subagents to use AgentRouter for task execution.

4. **G4: Unified Observability**  
   Task progress, provider responses, and timing all visible in one place.

5. **G5: Pre-Built Patterns**  
   Ship skills for common workflows (research-then-code, parallel-review, etc.)

6. **G6: Backward Compatibility**  
   Existing `invoke_agent`, `compare_agents`, etc. continue working unchanged.

### 3.2 Non-Goals

- **NG1:** Replacing Claude Code's native Task tools (we enhance, not replace)
- **NG2:** Managing task persistence (Claude Code handles this)
- **NG3:** Supporting pre-2.1 Claude Code versions
- **NG4:** Automatic task creation from natural language (user explicitly creates pipelines)

---

## 4. Architecture Overview

### 4.1 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Claude Code v2.1+                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ TaskCreate  │  │ TaskUpdate  │  │  TaskList   │  │    Task     │        │
│  │             │  │             │  │             │  │ (subagent)  │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │                │
│  ┌──────▼────────────────▼────────────────▼────────────────▼──────────┐    │
│  │                    Native Task State                                │    │
│  │  Tasks: [{id, subject, status, owner, blockedBy, blocks, ...}]     │    │
│  └────────────────────────────────┬───────────────────────────────────┘    │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                              MCP Protocol
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                      AgentRouter MCP Server v3.0                            │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    NEW: Task Integration Layer                         │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │ │
│  │  │  TaskCoordinator │  │  PipelineManager │  │   WorkerMode     │     │ │
│  │  │                  │  │                  │  │                  │     │ │
│  │  │  - claimTask()   │  │  - createDAG()   │  │  - claimNext()   │     │ │
│  │  │  - completeTask()│  │  - executeStep() │  │  - executeLoop() │     │ │
│  │  │  - failTask()    │  │  - checkDeps()   │  │  - heartbeat()   │     │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    NEW: Task-Aware MCP Tools                           │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │ │
│  │  │  execute_task  │  │ create_routed_ │  │   execute_     │           │ │
│  │  │                │  │     task       │  │   pipeline     │           │ │
│  │  └────────────────┘  └────────────────┘  └────────────────┘           │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │ │
│  │  │ claim_next_    │  │ get_pipeline_  │  │ worker_status  │           │ │
│  │  │     task       │  │    status      │  │                │           │ │
│  │  └────────────────┘  └────────────────┘  └────────────────┘           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    EXISTING: Core Tools (unchanged)                    │ │
│  │  invoke_agent | compare_agents | critique_plan | review_code | ...    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Router Engine + Providers                           │ │
│  │  RoleResolver → ProviderManager → [Anthropic|OpenAI|Gemini|...]       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow: Task Execution

```
User: "Build auth feature with multi-provider pipeline"
                    │
                    ▼
          Claude Code Orchestrator
                    │
    ┌───────────────┴───────────────┐
    │                               │
    ▼                               ▼
TaskCreate(research)           TaskCreate(implement)
TaskCreate(review)             TaskCreate(critique)
    │                               │
    └───────────────┬───────────────┘
                    │
                    ▼
        execute_pipeline({ ... })
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
 Step 1:         Step 2:         Step 3:
 Research        Implement        Review
    │               │               │
    ▼               ▼               ▼
 TaskUpdate      TaskUpdate      TaskUpdate
 (claim #1)      (claim #2)      (claim #3)
    │               │               │
    ▼               ▼               ▼
 invoke_agent    invoke_agent    invoke_agent
 (researcher)    (coder)         (reviewer)
    │               │               │
    ▼               ▼               ▼
 Gemini 3        DeepSeek        OpenAI o3
 Pro             Reasoner        
    │               │               │
    ▼               ▼               ▼
 TaskUpdate      TaskUpdate      TaskUpdate
 (complete #1)   (complete #2)   (complete #3)
    │               │               │
    └───────────────┴───────────────┘
                    │
                    ▼
         Results aggregated &
         returned to orchestrator
```

---

## 5. Detailed Design

### 5.1 Task Coordinator

The **TaskCoordinator** bridges AgentRouter with Claude Code's task state. Since MCP tools can't directly call Claude Code's native tools, the coordinator works through **tool output instructions** that tell Claude what to do.

```typescript
// src/tasks/coordinator.ts

/**
 * Coordinates AgentRouter execution with Claude Code Tasks.
 * 
 * IMPORTANT: Since MCP tools cannot directly invoke Claude Code tools,
 * the coordinator returns INSTRUCTIONS for Claude to execute.
 */
export class TaskCoordinator {
  private activeExecutions: Map<string, TaskExecution>;
  private logger: Logger;
  
  /**
   * Generate instructions for Claude to claim a task before execution.
   */
  generateClaimInstructions(taskId: string, workerName: string): ClaimInstructions {
    return {
      preExecution: `TaskUpdate({ taskId: "${taskId}", status: "in_progress", owner: "${workerName}" })`,
      onSuccess: `TaskUpdate({ taskId: "${taskId}", status: "completed" })`,
      onFailure: `TaskUpdate({ taskId: "${taskId}", status: "pending", owner: null })`,
    };
  }
  
  /**
   * Track an execution in progress.
   */
  startExecution(taskId: string, role: string, traceId: string): TaskExecution {
    const execution: TaskExecution = {
      taskId,
      role,
      traceId,
      startTime: Date.now(),
      status: 'running',
    };
    this.activeExecutions.set(taskId, execution);
    return execution;
  }
  
  /**
   * Mark execution complete and generate completion instructions.
   */
  completeExecution(taskId: string, result: AgentResponse): CompletionResult {
    const execution = this.activeExecutions.get(taskId);
    if (!execution) {
      throw new Error(`No active execution for task ${taskId}`);
    }
    
    execution.status = 'completed';
    execution.endTime = Date.now();
    execution.result = result;
    
    return {
      execution,
      instructions: `TaskUpdate({ taskId: "${taskId}", status: "completed" })`,
      result,
    };
  }
}

interface TaskExecution {
  taskId: string;
  role: string;
  traceId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  result?: AgentResponse;
  error?: Error;
}

interface ClaimInstructions {
  preExecution: string;
  onSuccess: string;
  onFailure: string;
}
```

### 5.2 Pipeline Manager

Manages multi-step task DAGs with dependency resolution:

```typescript
// src/tasks/pipeline-manager.ts

export interface PipelineStep {
  name: string;           // Unique step identifier
  subject: string;        // Task subject line
  description?: string;   // Detailed task description
  role: AgentRole;        // AgentRouter role for execution
  dependsOn?: string[];   // Names of steps this depends on
  context?: string;       // Additional context for the agent
}

export interface PipelineDefinition {
  name: string;
  steps: PipelineStep[];
  globalContext?: string;  // Context passed to all steps
}

export interface PipelineExecution {
  pipelineId: string;
  definition: PipelineDefinition;
  taskIdMap: Map<string, string>;  // stepName → Claude Code taskId
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  completedSteps: Set<string>;
  results: Map<string, AgentResponse>;
}

export class PipelineManager {
  private executions: Map<string, PipelineExecution>;
  private coordinator: TaskCoordinator;
  
  /**
   * Generate TaskCreate instructions for all pipeline steps.
   * Returns instructions for Claude to execute.
   */
  generatePipelineCreation(definition: PipelineDefinition): string {
    const instructions: string[] = [];
    const stepToIndex = new Map<string, number>();
    
    // Create tasks in dependency order
    definition.steps.forEach((step, index) => {
      stepToIndex.set(step.name, index + 1); // 1-indexed for readability
      
      const metadata = {
        pipeline: definition.name,
        role: step.role,
        stepName: step.name,
      };
      
      const blockedBy = step.dependsOn?.map(dep => {
        const depIndex = stepToIndex.get(dep);
        if (!depIndex) throw new Error(`Unknown dependency: ${dep}`);
        return `"${depIndex}"`;
      }).join(', ');
      
      instructions.push(`
TaskCreate({
  subject: "${step.subject}",
  description: "${step.description ?? ''}",
  activeForm: "Executing ${step.role} agent...",
  metadata: ${JSON.stringify(metadata)}${blockedBy ? `,
  blockedBy: [${blockedBy}]` : ''}
})`);
    });
    
    return instructions.join('\n');
  }
  
  /**
   * Determine which steps are ready to execute (dependencies met).
   */
  getReadySteps(execution: PipelineExecution): PipelineStep[] {
    return execution.definition.steps.filter(step => {
      // Skip already completed
      if (execution.completedSteps.has(step.name)) return false;
      
      // Check all dependencies are complete
      const depsComplete = step.dependsOn?.every(dep => 
        execution.completedSteps.has(dep)
      ) ?? true;
      
      return depsComplete;
    });
  }
  
  /**
   * Build context for a step, including results from dependencies.
   */
  buildStepContext(execution: PipelineExecution, step: PipelineStep): string {
    const parts: string[] = [];
    
    // Global context
    if (execution.definition.globalContext) {
      parts.push(`## Project Context\n${execution.definition.globalContext}`);
    }
    
    // Step-specific context
    if (step.context) {
      parts.push(`## Task Context\n${step.context}`);
    }
    
    // Results from dependencies
    if (step.dependsOn?.length) {
      parts.push('## Previous Step Results');
      for (const depName of step.dependsOn) {
        const depResult = execution.results.get(depName);
        if (depResult) {
          const content = depResult.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n');
          parts.push(`### ${depName} (${depResult.role})\n${content}`);
        }
      }
    }
    
    return parts.join('\n\n');
  }
}
```

### 5.3 Worker Mode

For background task processing via subagents:

```typescript
// src/tasks/worker-mode.ts

export interface WorkerConfig {
  name: string;              // Worker identifier
  allowedRoles?: AgentRole[];  // Only claim tasks for these roles
  maxConcurrent?: number;    // Max parallel executions (default: 1)
  heartbeatMs?: number;      // Heartbeat interval (default: 30000)
  idleTimeoutMs?: number;    // Shutdown after idle (default: 300000)
}

export interface WorkerState {
  name: string;
  status: 'idle' | 'working' | 'shutdown';
  currentTask?: string;
  completedCount: number;
  failedCount: number;
  lastHeartbeat: number;
}

/**
 * Worker mode enables AgentRouter to act as a task consumer.
 * 
 * Usage in a Claude Code subagent:
 * 1. Start worker: worker_status({ action: 'start', config: {...} })
 * 2. Claim task: claim_next_task({ roles: ['coder'] })
 * 3. Execute: (AgentRouter routes to provider)
 * 4. Complete: task marked done automatically
 * 5. Loop until no tasks remain
 */
export class WorkerMode {
  private state: WorkerState;
  private config: Required<WorkerConfig>;
  private router: RouterEngine;
  private coordinator: TaskCoordinator;
  
  /**
   * Generate claim_next_task behavior instructions.
   * Returns what the subagent should do to claim work.
   */
  generateClaimInstructions(): string {
    const roleFilter = this.config.allowedRoles?.length
      ? `metadata.role IN [${this.config.allowedRoles.map(r => `"${r}"`).join(', ')}]`
      : 'any';
      
    return `
## Worker Task Claim Protocol

1. Call TaskList() to get all tasks
2. Find a task where:
   - status = "pending"
   - owner = null
   - blockedBy is empty (or all blockers completed)
   - ${roleFilter}
3. Claim it: TaskUpdate({ taskId: X, status: "in_progress", owner: "${this.state.name}" })
4. Execute via AgentRouter: execute_task({ taskId: X, role: <from metadata> })
5. On completion, execute_task auto-marks it done
6. Repeat from step 1

If no tasks match criteria, worker can shut down.
`;
  }
  
  /**
   * Get current worker status for monitoring.
   */
  getStatus(): WorkerState {
    return { ...this.state };
  }
}
```

---

## 6. New MCP Tools

### 6.1 execute_task

Execute a Claude Code task using AgentRouter's routing.

```typescript
// Tool: execute_task
{
  name: "execute_task",
  description: "Execute a Claude Code task using AgentRouter. Claims the task, routes to the appropriate provider based on role, and marks complete on success.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "The Claude Code task ID to execute"
      },
      role: {
        type: "string",
        enum: ["coder", "critic", "designer", "researcher", "reviewer"],
        description: "The AgentRouter role to use. If task has metadata.role, this can be omitted."
      },
      context: {
        type: "string",
        description: "Optional additional context for the agent"
      },
      autoComplete: {
        type: "boolean",
        default: true,
        description: "Automatically mark task complete on success"
      }
    },
    required: ["taskId"]
  }
}

// Response format
{
  content: [{
    type: "text",
    text: `## Task Execution Complete

**Task ID:** ${taskId}
**Role:** ${role}
**Provider:** ${provider} | **Model:** ${model}
**Duration:** ${durationMs}ms

### Instructions for Claude
${autoComplete ? `TaskUpdate({ taskId: "${taskId}", status: "completed" })` : 'Manual completion required'}

### Agent Response
${agentResponse}`
  }]
}
```

### 6.2 create_routed_task

Create a Claude Code task pre-configured for AgentRouter.

```typescript
// Tool: create_routed_task
{
  name: "create_routed_task",
  description: "Create a Claude Code task that's pre-configured for AgentRouter execution. Returns TaskCreate instructions with role metadata.",
  inputSchema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Short task title (imperative form: 'Implement X', 'Review Y')"
      },
      description: {
        type: "string",
        description: "Detailed task description with requirements"
      },
      role: {
        type: "string",
        enum: ["coder", "critic", "designer", "researcher", "reviewer"],
        description: "AgentRouter role that will execute this task"
      },
      blockedBy: {
        type: "array",
        items: { type: "string" },
        description: "Task IDs this task depends on"
      },
      priority: {
        type: "number",
        description: "Priority level (1=highest)"
      }
    },
    required: ["subject", "role"]
  }
}

// Response format
{
  content: [{
    type: "text",
    text: `## Create Routed Task

Execute this to create the task:

\`\`\`
TaskCreate({
  subject: "${subject}",
  description: "${description}",
  activeForm: "Awaiting ${role} agent...",
  metadata: {
    agentRouter: true,
    role: "${role}",
    priority: ${priority}
  }${blockedBy?.length ? `,
  blockedBy: [${blockedBy.map(id => `"${id}"`).join(', ')}]` : ''}
})
\`\`\`

After creation, execute with:
\`execute_task({ taskId: <new_id>, role: "${role}" })\``
  }]
}
```

### 6.3 execute_pipeline

Create and execute a multi-step task pipeline.

```typescript
// Tool: execute_pipeline
{
  name: "execute_pipeline",
  description: "Create and execute a multi-provider task pipeline. Each step is routed to a different provider based on role. Dependencies are automatically managed.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Pipeline name for identification"
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Unique step identifier" },
            subject: { type: "string", description: "Task subject line" },
            description: { type: "string", description: "Task details" },
            role: { 
              type: "string",
              enum: ["coder", "critic", "designer", "researcher", "reviewer"]
            },
            dependsOn: {
              type: "array",
              items: { type: "string" },
              description: "Step names this depends on"
            }
          },
          required: ["name", "subject", "role"]
        },
        description: "Pipeline steps in execution order"
      },
      context: {
        type: "string",
        description: "Global context passed to all steps"
      },
      parallel: {
        type: "boolean",
        default: true,
        description: "Execute independent steps in parallel"
      }
    },
    required: ["name", "steps"]
  }
}

// Response includes full execution plan
{
  content: [{
    type: "text",
    text: `## Pipeline: ${name}

### Execution Plan

#### Phase 1 (parallel)
| Step | Role | Provider | Depends On |
|------|------|----------|------------|
| research | researcher | Gemini 3 Pro | - |
| design | designer | Claude Sonnet 4.5 | - |

#### Phase 2 (after Phase 1)
| Step | Role | Provider | Depends On |
|------|------|----------|------------|
| implement | coder | DeepSeek Reasoner | research, design |

#### Phase 3 (after Phase 2)
| Step | Role | Provider | Depends On |
|------|------|----------|------------|
| review | reviewer | OpenAI o3 | implement |
| critique | critic | GPT-5.2 | implement |

### Create Tasks
Execute these commands to set up the pipeline:

${taskCreateInstructions}

### Execute
Once tasks are created, execute ready steps:
\`execute_task({ taskId: "1", role: "researcher" })\`
\`execute_task({ taskId: "2", role: "designer" })\`

(Continue with subsequent steps as dependencies complete)`
  }]
}
```

### 6.4 claim_next_task

Worker pattern: claim the next available task matching criteria.

```typescript
// Tool: claim_next_task
{
  name: "claim_next_task",
  description: "For worker subagents: find and claim the next available task matching the specified criteria. Use in a loop for background processing.",
  inputSchema: {
    type: "object",
    properties: {
      workerName: {
        type: "string",
        description: "Name to use when claiming (for ownership tracking)"
      },
      roles: {
        type: "array",
        items: {
          type: "string",
          enum: ["coder", "critic", "designer", "researcher", "reviewer"]
        },
        description: "Only claim tasks for these roles. Empty = any role."
      },
      priority: {
        type: "string",
        enum: ["highest", "lowest", "fifo"],
        default: "fifo",
        description: "Task selection strategy"
      },
      excludeTaskIds: {
        type: "array",
        items: { type: "string" },
        description: "Task IDs to skip (e.g., already attempted)"
      }
    },
    required: ["workerName"]
  }
}

// Response
{
  content: [{
    type: "text",
    text: `## Claim Next Task

### Search Criteria
- Worker: ${workerName}
- Roles: ${roles?.join(', ') || 'any'}
- Priority: ${priority}

### Instructions

1. First, get current tasks:
\`TaskList()\`

2. Find a task matching:
   - status = "pending"
   - owner = null (unclaimed)
   - blockedBy is empty OR all blockers completed
   - metadata.role IN [${roles?.join(', ') || 'any'}]
   ${excludeTaskIds?.length ? `- id NOT IN [${excludeTaskIds.join(', ')}]` : ''}

3. If found, claim it:
\`TaskUpdate({ taskId: <found_id>, status: "in_progress", owner: "${workerName}" })\`

4. Then execute:
\`execute_task({ taskId: <found_id> })\`

5. On completion, loop back to step 1.

6. If no tasks match, worker can exit:
\`Teammate({ operation: "requestShutdown" })\``
  }]
}
```

### 6.5 get_pipeline_status

Query pipeline execution status.

```typescript
// Tool: get_pipeline_status
{
  name: "get_pipeline_status",
  description: "Get the current status of a pipeline execution, including completed steps and pending work.",
  inputSchema: {
    type: "object",
    properties: {
      pipelineName: {
        type: "string",
        description: "Name of the pipeline to query"
      }
    },
    required: ["pipelineName"]
  }
}

// Response
{
  content: [{
    type: "text",
    text: `## Pipeline Status: ${pipelineName}

**Overall:** 3/5 steps complete (60%)
**Elapsed:** 4m 32s

### Step Status
| Step | Role | Status | Provider | Duration | Tokens |
|------|------|--------|----------|----------|--------|
| research | researcher | ✅ complete | Gemini 3 Pro | 45s | 8,234 |
| design | designer | ✅ complete | Claude Sonnet | 62s | 12,451 |
| implement | coder | 🔄 running | DeepSeek | 2m 15s | - |
| review | reviewer | ⏳ blocked | OpenAI o3 | - | - |
| critique | critic | ⏳ blocked | GPT-5.2 | - | - |

### Dependency Graph
\`\`\`
research ──┬──→ implement ──┬──→ review
design ────┘               └──→ critique
\`\`\`

### Results Available
- research: "Found 3 auth patterns: JWT, OAuth2, Session-based..."
- design: "Recommended architecture: middleware + token service..."`
  }]
}
```

---

## 7. Skills & Commands

### 7.1 Skill: /multi-provider-build

Full feature development with specialized providers.

```markdown
---
name: multi-provider-build
description: Build a feature using multiple AI providers for specialized tasks. Uses researcher for discovery, designer for architecture, coder for implementation, and reviewer/critic for quality.
allowed-tools: Task, TaskCreate, TaskUpdate, TaskList, invoke_agent, execute_task, execute_pipeline, get_pipeline_status
model: inherit
---

# Multi-Provider Feature Build

Build the requested feature using the best AI provider for each stage.

## Feature Request
$ARGUMENTS

## Step 1: Create Pipeline

Use `execute_pipeline` to create the task structure:

```
execute_pipeline({
  name: "feature-$TIMESTAMP",
  steps: [
    {
      name: "research",
      subject: "Research: $FEATURE_TITLE",
      description: "Research best practices, existing solutions, and potential approaches for: $ARGUMENTS",
      role: "researcher"
    },
    {
      name: "design",
      subject: "Design: $FEATURE_TITLE architecture",
      description: "Design the technical architecture based on research findings",
      role: "designer",
      dependsOn: ["research"]
    },
    {
      name: "implement",
      subject: "Implement: $FEATURE_TITLE",
      description: "Implement the feature according to the design",
      role: "coder",
      dependsOn: ["design"]
    },
    {
      name: "review",
      subject: "Review: $FEATURE_TITLE implementation",
      description: "Review the implementation for bugs, edge cases, and improvements",
      role: "reviewer",
      dependsOn: ["implement"]
    },
    {
      name: "critique",
      subject: "Critique: $FEATURE_TITLE security & assumptions",
      description: "Critique the implementation for security issues and invalid assumptions",
      role: "critic",
      dependsOn: ["implement"]
    }
  ],
  context: "$ARGUMENTS"
})
```

## Step 2: Execute and Monitor

Execute the pipeline instructions returned by `execute_pipeline`.
Use `get_pipeline_status` to monitor progress.
Present results from each stage to the user.

## Step 3: Synthesize Results

After all steps complete:
1. Summarize findings from research
2. Present the design decisions
3. Show the implementation
4. List review feedback
5. Report security/assumption critiques
6. Recommend any final changes
```

### 7.2 Skill: /parallel-review

Get code reviews from multiple providers simultaneously.

```markdown
---
name: parallel-review
description: Get parallel code reviews from multiple AI providers for diverse perspectives. Great for critical code paths or security-sensitive changes.
allowed-tools: compare_agents, invoke_agent, TaskCreate, TaskUpdate
---

# Parallel Multi-Provider Code Review

Get code reviewed by multiple AI providers simultaneously for comprehensive feedback.

## Code to Review
$ARGUMENTS

## Execution

Use `compare_agents` to get parallel reviews:

```
compare_agents({
  roles: ["reviewer", "critic", "coder"],
  task: "Review this code for bugs, security issues, and improvements:\n\n$ARGUMENTS"
})
```

## Output Format

Present reviews grouped by provider:

### 🔍 Code Reviewer (Provider: X)
[Review findings]

### 🎯 Critic (Provider: Y)  
[Security and assumption analysis]

### 💡 Coder (Provider: Z)
[Implementation suggestions]

### Summary
Consolidate all feedback into actionable items:
1. Critical issues (all providers agree)
2. Recommended changes (majority agree)
3. Suggestions (single provider)
```

### 7.3 Skill: /research-implement

Research with one provider, implement with another.

```markdown
---
name: research-implement
description: Two-phase development - research best practices with one provider, then implement with a specialized coder. Great for unfamiliar domains.
allowed-tools: invoke_agent, execute_task, TaskCreate, TaskUpdate
---

# Research Then Implement

Research the topic thoroughly, then implement based on findings.

## Request
$ARGUMENTS

## Phase 1: Research

```
invoke_agent({
  role: "researcher",
  task: "Research best practices, common patterns, and potential pitfalls for: $ARGUMENTS. Provide specific, actionable recommendations.",
  context: "This research will inform implementation. Be thorough and cite sources where possible."
})
```

Present research findings to user.

## Phase 2: Implement

After presenting research, use findings as context for implementation:

```
invoke_agent({
  role: "coder", 
  task: "Implement $ARGUMENTS following the researched best practices.",
  context: "[Insert research findings from Phase 1]"
})
```

## Phase 3: Verify

Optionally, have critic verify the implementation follows research:

```
invoke_agent({
  role: "critic",
  task: "Verify this implementation follows the researched best practices",
  context: "Research: [findings]\n\nImplementation: [code]"
})
```
```

### 7.4 Command: /spawn-workers

Spawn background workers for task processing.

```markdown
---
name: spawn-workers
description: Spawn multiple background workers to process a task queue in parallel. Each worker claims and executes tasks independently.
allowed-tools: Task, TaskCreate, TaskList, Teammate, claim_next_task
---

# Spawn Worker Swarm

Create a team of background workers to process tasks in parallel.

## Configuration
$ARGUMENTS

Default: 3 workers, any role

## Setup

1. Create team:
```
Teammate({ operation: "spawnTeam", team_name: "task-workers" })
```

2. Spawn workers:
```
Task({
  team_name: "task-workers",
  name: "worker-1",
  subagent_type: "general-purpose",
  prompt: `You are a task worker using AgentRouter.

Your job:
1. Use claim_next_task({ workerName: "worker-1" })
2. Follow the returned instructions to claim a task
3. Execute the task with execute_task
4. Loop until no tasks remain
5. Request shutdown when done

Available roles for routing: coder, critic, designer, researcher, reviewer`,
  run_in_background: true
})
```

Repeat for worker-2, worker-3, etc.

3. Monitor with TaskList() and get_pipeline_status().
```

---

## 8. Task Lifecycle

### 8.1 State Machine

```
                                    ┌─────────────┐
                                    │   CREATED   │
                                    │  (pending)  │
                                    └──────┬──────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                              ▼                         ▼
                       Has Dependencies?            No Dependencies
                              │                         │
                              ▼                         │
                        ┌─────────┐                     │
                        │ BLOCKED │                     │
                        │(pending)│                     │
                        └────┬────┘                     │
                             │                          │
               Dependencies complete                    │
                             │                          │
                             └──────────┬───────────────┘
                                        │
                                        ▼
                                 ┌─────────────┐
                                 │   READY     │
                                 │  (pending)  │
                                 └──────┬──────┘
                                        │
                              claim_next_task() or
                               execute_task()
                                        │
                                        ▼
                                 ┌─────────────┐
                        ┌────────│   CLAIMED   │────────┐
                        │        │(in_progress)│        │
                        │        │ owner: X    │        │
                        │        └──────┬──────┘        │
                        │               │               │
                   Timeout/          invoke_agent()    Worker
                   Failure          routes to          crashed
                        │            provider          │
                        │               │              │
                        ▼               ▼              ▼
                 ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                 │   FAILED    │ │  EXECUTING  │ │  RELEASED   │
                 │             │ │(in_progress)│ │  (pending)  │
                 └─────────────┘ └──────┬──────┘ │  owner:null │
                                        │        └─────────────┘
                                        │              │
                                 Provider returns     │
                                        │             │
                               ┌────────┴────────┐    │
                               │                 │    │
                               ▼                 ▼    │
                        ┌─────────────┐   ┌─────────────┐
                        │  COMPLETED  │   │   FAILED    │
                        │             │   │             │
                        └──────┬──────┘   └─────────────┘
                               │
                        Unblocks dependents
                               │
                               ▼
                        Next tasks become READY
```

### 8.2 Status Transitions by Tool

| Tool | From Status | To Status | Notes |
|------|-------------|-----------|-------|
| `TaskCreate` | - | pending | Initial state |
| `execute_task` (claim) | pending | in_progress | Sets owner |
| `execute_task` (success) | in_progress | completed | Clears owner, unblocks deps |
| `execute_task` (failure) | in_progress | pending | Clears owner, retry available |
| `claim_next_task` | pending | in_progress | Sets owner |
| `TaskUpdate` (delete) | any | - | Removes task |
| Worker crash | in_progress | pending | Heartbeat timeout releases |

---

## 9. Configuration Changes

### 9.1 New Config Section: tasks

```yaml
# agent-router.yaml (v3.0)

version: "3.0"

# ... existing config ...

# NEW: Task integration settings
tasks:
  # Enable task-aware tools
  enabled: true
  
  # Default behavior for execute_task
  defaults:
    autoComplete: true     # Mark tasks done automatically
    autoRelease: true      # Release on failure for retry
    timeoutMs: 300000      # 5 min max per task
    
  # Worker mode settings  
  worker:
    heartbeatMs: 30000     # Heartbeat interval
    idleTimeoutMs: 300000  # Shutdown after 5 min idle
    maxRetries: 2          # Retry failed tasks
    
  # Pipeline settings
  pipeline:
    maxParallel: 5         # Max concurrent steps
    defaultParallel: true  # Execute independent steps in parallel
```

### 9.2 Role Metadata Enhancement

Roles can now include task-related metadata:

```yaml
roles:
  coder:
    provider: deepseek
    model: deepseek-reasoner
    system_prompt: "You are an expert programmer..."
    # NEW: Task hints
    task_hints:
      typical_duration_ms: 120000   # Expected ~2 min
      priority_boost: 1             # Higher priority for coding tasks
      
  researcher:
    provider: google
    model: gemini-3-pro
    task_hints:
      typical_duration_ms: 60000    # Expected ~1 min
      parallel_safe: true           # Can run multiple research tasks
```

---

## 10. Migration Guide

### 10.1 From v2.x to v3.0

**Breaking Changes:** None - all existing tools continue to work.

**New Features:**
1. Task-aware tools available when `tasks.enabled: true`
2. Skills directory: `.claude/skills/agent-router/`
3. New config section: `tasks:`

**Upgrade Steps:**

```bash
# 1. Update package
npm update @sashabogi/agent-router

# 2. Add task config (optional)
# In your agent-router.yaml:
tasks:
  enabled: true

# 3. Install skills (optional)
agent-router install-skills

# 4. Restart Claude Code to load new MCP tools
```

### 10.2 Gradual Adoption

You can adopt task integration gradually:

| Phase | What to Enable | Benefit |
|-------|----------------|---------|
| 1 | Just upgrade | New tools available but not required |
| 2 | Use `execute_task` | Auto status updates for manual tasks |
| 3 | Use `create_routed_task` | Consistent task metadata |
| 4 | Use `execute_pipeline` | Full multi-provider workflows |
| 5 | Use skills | Pre-built patterns |
| 6 | Use workers | Background parallel processing |

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
// tests/unit/tasks/coordinator.test.ts
describe('TaskCoordinator', () => {
  it('generates correct claim instructions', () => {
    const coordinator = new TaskCoordinator();
    const instructions = coordinator.generateClaimInstructions('task-1', 'worker-1');
    
    expect(instructions.preExecution).toContain('TaskUpdate');
    expect(instructions.preExecution).toContain('task-1');
    expect(instructions.preExecution).toContain('in_progress');
  });
  
  it('tracks active executions', () => {
    const coordinator = new TaskCoordinator();
    const execution = coordinator.startExecution('task-1', 'coder', 'trace-123');
    
    expect(execution.status).toBe('running');
    expect(execution.taskId).toBe('task-1');
  });
});

// tests/unit/tasks/pipeline-manager.test.ts
describe('PipelineManager', () => {
  it('resolves dependencies correctly', () => {
    const manager = new PipelineManager();
    const execution = createTestExecution({
      steps: [
        { name: 'a', role: 'researcher' },
        { name: 'b', role: 'coder', dependsOn: ['a'] },
        { name: 'c', role: 'reviewer', dependsOn: ['b'] },
      ],
      completedSteps: new Set(['a']),
    });
    
    const ready = manager.getReadySteps(execution);
    expect(ready.map(s => s.name)).toEqual(['b']);
  });
  
  it('handles parallel independent steps', () => {
    const manager = new PipelineManager();
    const execution = createTestExecution({
      steps: [
        { name: 'a', role: 'researcher' },
        { name: 'b', role: 'designer' },  // No deps
        { name: 'c', role: 'coder', dependsOn: ['a', 'b'] },
      ],
      completedSteps: new Set(),
    });
    
    const ready = manager.getReadySteps(execution);
    expect(ready.map(s => s.name)).toEqual(['a', 'b']);
  });
});
```

### 11.2 Integration Tests

```typescript
// tests/integration/task-tools.test.ts
describe('Task-Aware Tools', () => {
  let mcpServer: McpServer;
  let router: RouterEngine;
  
  beforeEach(async () => {
    // Set up test MCP server with mocked providers
    mcpServer = createTestMcpServer();
    router = createMockRouter();
    registerTaskTools(mcpServer, router, testLogger);
  });
  
  it('execute_task returns provider response with instructions', async () => {
    const result = await mcpServer.callTool('execute_task', {
      taskId: 'test-1',
      role: 'coder',
    });
    
    expect(result.content[0].text).toContain('TaskUpdate');
    expect(result.content[0].text).toContain('completed');
    expect(result.content[0].text).toContain('Provider:');
  });
  
  it('execute_pipeline creates correct task structure', async () => {
    const result = await mcpServer.callTool('execute_pipeline', {
      name: 'test-pipeline',
      steps: [
        { name: 'step1', subject: 'First', role: 'researcher' },
        { name: 'step2', subject: 'Second', role: 'coder', dependsOn: ['step1'] },
      ],
    });
    
    expect(result.content[0].text).toContain('TaskCreate');
    expect(result.content[0].text).toContain('blockedBy');
  });
});
```

### 11.3 E2E Tests (in Claude Code)

Manual testing checklist:

- [ ] `execute_task` claims and completes a task
- [ ] `create_routed_task` generates valid TaskCreate
- [ ] `execute_pipeline` creates correct dependency chain
- [ ] `claim_next_task` finds and claims available tasks
- [ ] `get_pipeline_status` shows accurate progress
- [ ] `/multi-provider-build` skill executes full workflow
- [ ] `/parallel-review` returns multiple provider reviews
- [ ] Background workers process task queue
- [ ] Failed tasks release ownership correctly
- [ ] Dependent tasks unblock when blockers complete

---

## 12. Security Considerations

### 12.1 Task Ownership

- Tasks can only be claimed if `owner` is null
- Workers should release tasks on failure to prevent starvation
- Heartbeat timeout prevents zombie ownership

### 12.2 Provider Credentials

- No change from existing AgentRouter security model
- API keys still use environment variable interpolation
- Task metadata should not contain secrets

### 12.3 Pipeline Isolation

- Each pipeline execution has a unique ID
- Results are scoped to the pipeline
- Workers can only claim tasks matching their allowed roles

### 12.4 Rate Limiting

- Pipeline execution respects individual provider rate limits
- Workers can be configured with max concurrency
- Backoff is handled per-provider

---

## 13. Future Enhancements

### 13.1 Short Term (v3.1)

- **Checkpoint/Resume**: Save pipeline state for long-running workflows
- **Cost Tracking**: Aggregate token costs per pipeline
- **Webhook Notifications**: Alert on pipeline completion/failure

### 13.2 Medium Term (v3.2)

- **Conditional Steps**: Skip steps based on previous results
- **Dynamic Routing**: Route based on task content, not just role
- **A/B Testing**: Compare providers for the same task over time

### 13.3 Long Term (v4.0)

- **Learning Loop**: Track success rates and auto-tune routing
- **Custom Providers**: Plugin architecture for new LLMs
- **Team Templates**: Shareable pipeline configurations

---

## Appendix A: Full Tool Schemas

[See separate file: tool-schemas.ts]

## Appendix B: Skill Templates

[See separate directory: .claude/skills/agent-router/]

## Appendix C: Example Configurations

[See separate file: example-configs.yaml]
