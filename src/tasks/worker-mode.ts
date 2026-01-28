/**
 * Worker Mode
 *
 * Enables background task processing via Claude Code subagents.
 * Workers claim tasks, execute them via AgentRouter, and loop until done.
 */

import type { Logger } from "../observability/logger.js";
import type { AgentRole, WorkerConfig, WorkerState } from "../types.js";

/** Default worker configuration values */
const DEFAULTS = {
  maxConcurrent: 1,
  heartbeatMs: 30000,
  idleTimeoutMs: 300000,
} as const;

export class WorkerMode {
  private state: WorkerState;
  private config: Required<Omit<WorkerConfig, "allowedRoles">> & { allowedRoles: AgentRole[] | undefined };
  private logger: Logger;
  private lastActivityTime: number;

  constructor(config: WorkerConfig, logger: Logger) {
    this.config = {
      name: config.name,
      allowedRoles: config.allowedRoles ?? undefined,
      maxConcurrent: config.maxConcurrent ?? DEFAULTS.maxConcurrent,
      heartbeatMs: config.heartbeatMs ?? DEFAULTS.heartbeatMs,
      idleTimeoutMs: config.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
    };

    this.state = {
      name: config.name,
      status: "idle",
      completedCount: 0,
      failedCount: 0,
      lastHeartbeat: Date.now(),
      excludeTaskIds: [],
    };

    this.lastActivityTime = Date.now();
    this.logger = logger;

    this.logger.info("Worker mode initialized", {
      name: config.name,
      allowedRoles: config.allowedRoles,
      maxConcurrent: this.config.maxConcurrent,
    });
  }

  /**
   * Generate instructions for the subagent on how to claim and execute tasks.
   * Returns markdown that tells the subagent the worker claim protocol.
   */
  generateClaimInstructions(): string {
    const roleFilter = this.config.allowedRoles?.length
      ? `metadata.role IN [${this.config.allowedRoles.map(r => `"${r}"`).join(", ")}]`
      : "any role";

    const excludeClause = this.state.excludeTaskIds?.length
      ? `   - id NOT IN [${this.state.excludeTaskIds.join(", ")}]`
      : "";

    return `
## Worker Task Claim Protocol

**Worker:** ${this.state.name}
**Allowed Roles:** ${this.config.allowedRoles?.join(", ") ?? "any"}
**Status:** ${this.state.status}
**Completed:** ${this.state.completedCount} | **Failed:** ${this.state.failedCount}

### Instructions

1. **Get current tasks:**
   \`TaskList()\`

2. **Find a task matching:**
   - status = "pending"
   - owner = null (unclaimed)
   - blockedBy is empty OR all blockers completed
   - ${roleFilter}
${excludeClause}

3. **If found, claim it:**
   \`TaskUpdate({ taskId: <found_id>, status: "in_progress", owner: "${this.state.name}" })\`

4. **Execute via AgentRouter:**
   \`execute_task({ taskId: <found_id> })\`

5. **On completion, loop back to step 1.**

6. **If no tasks match, worker can exit:**
   \`Teammate({ operation: "requestShutdown" })\`

### Notes
- If a claim fails (another worker claimed first), add the taskId to excludeTaskIds and retry
- The execute_task tool automatically marks tasks complete on success
- If execution fails, the task is released for retry
`;
  }

  /**
   * Update worker state.
   */
  updateState(updates: Partial<WorkerState>): void {
    Object.assign(this.state, updates);
    this.state.lastHeartbeat = Date.now();
  }

  /**
   * Get current worker status.
   */
  getStatus(): WorkerState {
    return { ...this.state };
  }

  /**
   * Mark that the worker is starting work on a task.
   */
  markTaskStarted(taskId: string): void {
    this.state.status = "working";
    this.state.currentTask = taskId;
    this.lastActivityTime = Date.now();
    this.state.lastHeartbeat = Date.now();

    this.logger.debug("Worker starting task", {
      worker: this.state.name,
      taskId,
    });
  }

  /**
   * Mark that the worker completed a task successfully.
   */
  markTaskCompleted(taskId: string): void {
    this.state.status = "idle";
    delete this.state.currentTask;
    this.state.completedCount++;
    this.lastActivityTime = Date.now();
    this.state.lastHeartbeat = Date.now();

    this.logger.info("Worker completed task", {
      worker: this.state.name,
      taskId,
      completedCount: this.state.completedCount,
    });
  }

  /**
   * Mark that the worker failed a task.
   */
  markTaskFailed(taskId: string, error?: Error): void {
    this.state.status = "idle";
    delete this.state.currentTask;
    this.state.failedCount++;
    this.lastActivityTime = Date.now();
    this.state.lastHeartbeat = Date.now();

    // Add to exclude list to avoid retrying immediately
    if (!this.state.excludeTaskIds) {
      this.state.excludeTaskIds = [];
    }
    this.state.excludeTaskIds.push(taskId);

    this.logger.warn("Worker failed task", {
      worker: this.state.name,
      taskId,
      failedCount: this.state.failedCount,
      error: error?.message,
    });
  }

  /**
   * Add a task ID to the exclusion list (e.g., after failed claim due to race).
   */
  excludeTask(taskId: string): void {
    if (!this.state.excludeTaskIds) {
      this.state.excludeTaskIds = [];
    }
    if (!this.state.excludeTaskIds.includes(taskId)) {
      this.state.excludeTaskIds.push(taskId);
    }
  }

  /**
   * Record a heartbeat (keeps the worker alive).
   */
  heartbeat(): void {
    this.state.lastHeartbeat = Date.now();
  }

  /**
   * Check if the worker should shut down due to idle timeout.
   */
  shouldShutdown(): boolean {
    const idleTime = Date.now() - this.lastActivityTime;
    const shouldStop = idleTime > this.config.idleTimeoutMs;

    if (shouldStop) {
      this.logger.info("Worker idle timeout reached", {
        worker: this.state.name,
        idleTimeMs: idleTime,
        idleTimeoutMs: this.config.idleTimeoutMs,
      });
    }

    return shouldStop;
  }

  /**
   * Mark the worker as shut down.
   */
  shutdown(): void {
    this.state.status = "shutdown";
    this.logger.info("Worker shutdown", {
      worker: this.state.name,
      completedCount: this.state.completedCount,
      failedCount: this.state.failedCount,
    });
  }

  /**
   * Get the worker name.
   */
  getName(): string {
    return this.state.name;
  }

  /**
   * Check if the worker is currently working.
   */
  isWorking(): boolean {
    return this.state.status === "working";
  }
}
