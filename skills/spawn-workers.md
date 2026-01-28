---
name: spawn-workers
description: Spawn multiple background workers to process a task queue in parallel. Workers use AgentRouter to route tasks to appropriate providers based on role metadata. Ideal for batch processing, large refactoring tasks, or any work that can be parallelized across multiple AI agents.
allowed-tools: Task, TaskCreate, TaskUpdate, TaskList, Teammate, claim_next_task, execute_task, get_pipeline_status
model: inherit
---

# Spawn Worker Swarm

Create a team of background workers that process tasks in parallel. Each worker independently claims tasks from a shared queue and routes them through AgentRouter to the appropriate provider.

## Configuration

> **$ARGUMENTS**

Default: 3 workers processing any role

---

## Why Worker Swarms?

For large workloads, sequential processing is slow. Worker swarms enable:

- **Parallel execution** - Multiple tasks processed simultaneously
- **Fault tolerance** - If one worker fails, others continue
- **Load balancing** - Workers claim tasks as they become available
- **Provider diversity** - Different workers can use different providers

**Example use cases:**
- Reviewing 50 files across a codebase
- Refactoring services to a new pattern
- Generating documentation for multiple modules
- Running security scans on multiple components

---

## Step 1: Create Task Queue

First, create tasks for the work to be processed. Each task should have `metadata.role` to specify which AgentRouter role will execute it.

**Example: Multi-file review**
```javascript
// Create review tasks for each file
const files = ["auth.ts", "user.ts", "api.ts", "db.ts", "cache.ts"];

for (const file of files) {
  TaskCreate({
    subject: `Review ${file}`,
    description: `Perform code review on ${file}. Check for bugs, security issues, and improvements.`,
    activeForm: `Reviewing ${file}...`,
    metadata: {
      role: "reviewer",
      file: file,
      batch: "code-review-batch"
    }
  });
}
```

**Example: Multi-component refactoring**
```javascript
const components = ["UserService", "AuthService", "PaymentService"];

for (const component of components) {
  TaskCreate({
    subject: `Refactor ${component}`,
    description: `Refactor ${component} to use the new BaseService pattern.`,
    metadata: {
      role: "coder",
      component: component
    }
  });
}
```

---

## Step 2: Create Worker Team

```javascript
Teammate({ 
  operation: "spawnTeam", 
  team_name: "task-workers" 
})
```

---

## Step 3: Spawn Workers

Spawn multiple workers that will process the task queue:

```javascript
// Worker 1
Task({
  team_name: "task-workers",
  name: "worker-1",
  subagent_type: "general-purpose",
  prompt: `You are a task worker using AgentRouter.

## Your Mission
Process tasks from the queue until none remain.

## Work Loop

1. **Check for tasks:**
   Use claim_next_task({ workerName: "worker-1" })
   
2. **Follow the claim instructions** to:
   - Call TaskList() to see available tasks
   - Find a task with status="pending" and no owner
   - Claim it with TaskUpdate({ taskId: X, status: "in_progress", owner: "worker-1" })
   
3. **Execute the task:**
   Use execute_task({ taskId: X })
   This routes to the appropriate provider based on metadata.role
   
4. **On completion:**
   execute_task auto-marks the task complete
   
5. **Loop:**
   Go back to step 1

6. **When no tasks remain:**
   Request shutdown: Teammate({ operation: "requestShutdown" })

## Important Rules
- Only claim tasks with status="pending" and owner=null
- If a task fails, release it so another worker can retry
- Report critical errors to the team lead via Teammate write
- Keep working until the queue is empty`,
  run_in_background: true
})

// Worker 2
Task({
  team_name: "task-workers",
  name: "worker-2",
  subagent_type: "general-purpose",
  prompt: `[Same prompt as worker-1, but with workerName: "worker-2"]`,
  run_in_background: true
})

// Worker 3
Task({
  team_name: "task-workers",
  name: "worker-3", 
  subagent_type: "general-purpose",
  prompt: `[Same prompt as worker-1, but with workerName: "worker-3"]`,
  run_in_background: true
})
```

---

## Step 4: Monitor Progress

Track the swarm's progress:

```javascript
// Check task status
TaskList()

// Check pipeline status (if using execute_pipeline)
get_pipeline_status({ pipelineName: "task-workers" })

// Read worker messages
Teammate({ operation: "read" })
```

**Status indicators:**
- `pending` + `owner: null` = Available for claiming
- `in_progress` + `owner: worker-X` = Being processed
- `completed` = Done
- `pending` + `owner: worker-X` = Released after failure (retry available)

---

## Step 5: Handle Completion

When all tasks complete:

1. Workers request shutdown when queue is empty
2. Approve shutdowns: `Teammate({ operation: "approveShutdown", target_agent_id: "worker-1" })`
3. Clean up: `Teammate({ operation: "cleanup" })`
4. Review results from completed tasks

---

## Advanced Patterns

### Role-Specific Workers

Spawn workers that only handle specific roles:

```javascript
// Coder worker - only handles coding tasks
Task({
  team_name: "task-workers",
  name: "coder-worker",
  prompt: `...claim_next_task({ workerName: "coder-worker", roles: ["coder"] })...`,
  run_in_background: true
})

// Reviewer worker - only handles review tasks  
Task({
  team_name: "task-workers",
  name: "review-worker",
  prompt: `...claim_next_task({ workerName: "review-worker", roles: ["reviewer", "critic"] })...`,
  run_in_background: true
})
```

### Priority Processing

Use priority metadata and claim highest priority first:

```javascript
TaskCreate({
  subject: "Critical fix",
  metadata: { role: "coder", priority: 1 }  // Highest
})

TaskCreate({
  subject: "Nice to have",
  metadata: { role: "coder", priority: 3 }  // Lower
})

// Workers claim highest priority first
claim_next_task({ workerName: "worker-1", priority: "highest" })
```

### Error Recovery

Workers should release failed tasks for retry:

```javascript
// In worker prompt:
`If execute_task fails:
1. Release the task: TaskUpdate({ taskId: X, status: "pending", owner: null })
2. Report error: Teammate({ operation: "write", target_agent_id: "team-lead", value: "Task X failed: <error>" })
3. Continue to next task`
```

---

## Example: Full Codebase Review

```
/spawn-workers Review all TypeScript files in src/ for security issues
```

This will:
1. Create a task for each .ts file
2. Spawn 3 workers
3. Each worker claims files and runs security review via AgentRouter
4. Results aggregated when complete

---

## Scaling Guidelines

| Tasks | Workers | Expected Time |
|-------|---------|---------------|
| 5-10 | 2-3 | Minutes |
| 10-25 | 3-5 | 10-20 min |
| 25-50 | 5-8 | 20-40 min |
| 50+ | 8-10 | Varies |

More workers = faster completion but higher provider costs and rate limit risk.
