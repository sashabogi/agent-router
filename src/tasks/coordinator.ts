/**
 * Task Coordinator
 *
 * Bridges AgentRouter execution with Claude Code Tasks.
 * Since MCP tools cannot directly invoke Claude Code tools,
 * the coordinator returns INSTRUCTIONS for Claude to execute.
 */

import { randomUUID } from "node:crypto";

import type { Logger } from "../observability/logger.js";
import type {
  AgentResponse,
  ClaimInstructions,
  CompletionResult,
  FailureResult,
  TaskExecution,
} from "../types.js";

export class TaskCoordinator {
  private activeExecutions: Map<string, TaskExecution> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

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
   * Start tracking a task execution.
   */
  startExecution(taskId: string, role: string, traceId?: string): TaskExecution {
    const execution: TaskExecution = {
      taskId,
      role,
      traceId: traceId ?? randomUUID(),
      startTime: Date.now(),
      status: "running",
    };

    this.activeExecutions.set(taskId, execution);
    this.logger.debug("Task execution started", { taskId, role, traceId: execution.traceId });

    return execution;
  }

  /**
   * Get an active execution by task ID.
   */
  getExecution(taskId: string): TaskExecution | undefined {
    return this.activeExecutions.get(taskId);
  }

  /**
   * Mark execution complete and generate completion instructions.
   */
  completeExecution(taskId: string, result: AgentResponse): CompletionResult {
    const execution = this.activeExecutions.get(taskId);
    if (!execution) {
      throw new Error(`No active execution for task ${taskId}`);
    }

    execution.status = "completed";
    execution.endTime = Date.now();
    execution.result = result;

    const durationMs = execution.endTime - execution.startTime;
    this.logger.info("Task execution completed", {
      taskId,
      role: execution.role,
      durationMs,
      provider: result.provider,
      model: result.model,
    });

    return {
      execution,
      instructions: `TaskUpdate({ taskId: "${taskId}", status: "completed" })`,
      result,
    };
  }

  /**
   * Mark execution failed and generate failure instructions.
   */
  failExecution(taskId: string, error: Error): FailureResult {
    const execution = this.activeExecutions.get(taskId);
    if (!execution) {
      throw new Error(`No active execution for task ${taskId}`);
    }

    execution.status = "failed";
    execution.endTime = Date.now();
    execution.error = error;

    const durationMs = execution.endTime - execution.startTime;
    this.logger.error("Task execution failed", {
      taskId,
      role: execution.role,
      durationMs,
      error,
    });

    // Release the task so it can be retried
    return {
      execution,
      instructions: `TaskUpdate({ taskId: "${taskId}", status: "pending", owner: null })`,
      error,
    };
  }

  /**
   * Clear a completed/failed execution from tracking.
   */
  clearExecution(taskId: string): void {
    this.activeExecutions.delete(taskId);
  }

  /**
   * Get all active executions.
   */
  getActiveExecutions(): TaskExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Check if there are any active executions.
   */
  hasActiveExecutions(): boolean {
    return this.activeExecutions.size > 0;
  }
}
