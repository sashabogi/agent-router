/**
 * Pipeline Manager
 *
 * Manages multi-step task DAGs with dependency resolution.
 * Generates TaskCreate instructions for Claude to execute.
 */

import { randomUUID } from "node:crypto";

import type { Logger } from "../observability/logger.js";
import type {
  AgentResponse,
  PipelineDefinition,
  PipelineExecution,
  PipelineStep,
} from "../types.js";

/** Maximum context length before truncation */
const MAX_CONTEXT_LENGTH = 50000;

export class PipelineManager {
  private executions: Map<string, PipelineExecution> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validate pipeline definition for cycles and missing dependencies.
   * Uses topological sort (Kahn's algorithm) to detect cycles.
   * @throws Error if validation fails
   */
  validateDefinition(definition: PipelineDefinition): void {
    const stepNames = new Set(definition.steps.map((s) => s.name));

    // Check for duplicate step names
    if (stepNames.size !== definition.steps.length) {
      throw new Error("Pipeline contains duplicate step names");
    }

    // Check all dependencies exist
    for (const step of definition.steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!stepNames.has(dep)) {
          throw new Error(
            `Step "${step.name}" depends on unknown step "${dep}"`
          );
        }
      }
    }

    // Check for cycles using topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const step of definition.steps) {
      inDegree.set(step.name, step.dependsOn?.length ?? 0);
      adjacency.set(step.name, []);
    }

    for (const step of definition.steps) {
      for (const dep of step.dependsOn ?? []) {
        adjacency.get(dep)!.push(step.name);
      }
    }

    // Find all nodes with no incoming edges
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    let processedCount = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      processedCount++;

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (processedCount !== definition.steps.length) {
      throw new Error("Pipeline contains circular dependencies");
    }
  }

  /**
   * Generate TaskCreate instructions for all pipeline steps.
   * Returns a string with all the TaskCreate calls Claude should execute.
   */
  generatePipelineCreation(definition: PipelineDefinition): string {
    this.validateDefinition(definition);

    const instructions: string[] = [];
    const stepToIndex = new Map<string, number>();

    // First pass: assign indices
    definition.steps.forEach((step, index) => {
      stepToIndex.set(step.name, index + 1);
    });

    // Second pass: generate TaskCreate instructions
    for (const step of definition.steps) {
      const metadata = {
        pipeline: definition.name,
        role: step.role,
        stepName: step.name,
      };

      const blockedByIndices = step.dependsOn?.map(
        (dep) => stepToIndex.get(dep)!
      );

      let instruction = `TaskCreate({
  subject: ${JSON.stringify(step.subject)},
  description: ${JSON.stringify(step.description ?? "")},
  activeForm: "Executing ${step.role} agent...",
  metadata: ${JSON.stringify(metadata)}`;

      if (blockedByIndices?.length) {
        instruction += `,
  blockedBy: [${blockedByIndices.map((i) => `"${i}"`).join(", ")}]`;
      }

      instruction += `
})`;

      instructions.push(instruction);
    }

    return instructions.join("\n\n");
  }

  /**
   * Create a new pipeline execution tracker.
   */
  createExecution(definition: PipelineDefinition): PipelineExecution {
    this.validateDefinition(definition);

    const execution: PipelineExecution = {
      pipelineId: randomUUID(),
      definition,
      taskIdMap: new Map(),
      status: "pending",
      startTime: Date.now(),
      completedSteps: new Set(),
      results: new Map(),
    };

    this.executions.set(execution.pipelineId, execution);
    this.logger.info("Pipeline execution created", {
      pipelineId: execution.pipelineId,
      name: definition.name,
      stepCount: definition.steps.length,
    });

    return execution;
  }

  /**
   * Get a pipeline execution by ID.
   */
  getExecution(pipelineId: string): PipelineExecution | undefined {
    return this.executions.get(pipelineId);
  }

  /**
   * Register task IDs after Claude creates the tasks.
   */
  registerTaskIds(pipelineId: string, taskIdMap: Map<string, string>): void {
    const execution = this.executions.get(pipelineId);
    if (!execution) {
      throw new Error(`Unknown pipeline: ${pipelineId}`);
    }
    execution.taskIdMap = taskIdMap;
    execution.status = "running";
  }

  /**
   * Determine which steps are ready to execute (all dependencies complete).
   */
  getReadySteps(execution: PipelineExecution): PipelineStep[] {
    return execution.definition.steps.filter((step) => {
      // Skip already completed
      if (execution.completedSteps.has(step.name)) return false;

      // Check all dependencies are complete
      const depsComplete =
        step.dependsOn?.every((dep) => execution.completedSteps.has(dep)) ??
        true;

      return depsComplete;
    });
  }

  /**
   * Mark a step as completed with its result.
   */
  completeStep(
    pipelineId: string,
    stepName: string,
    result: AgentResponse
  ): void {
    const execution = this.executions.get(pipelineId);
    if (!execution) {
      throw new Error(`Unknown pipeline: ${pipelineId}`);
    }

    execution.completedSteps.add(stepName);
    execution.results.set(stepName, result);

    this.logger.debug("Pipeline step completed", { pipelineId, stepName });

    // Check if pipeline is complete
    if (execution.completedSteps.size === execution.definition.steps.length) {
      execution.status = "completed";
      this.logger.info("Pipeline completed", {
        pipelineId,
        name: execution.definition.name,
        durationMs: Date.now() - execution.startTime,
      });
    }
  }

  /**
   * Mark a step as failed.
   */
  failStep(pipelineId: string, stepName: string, error: Error): void {
    const execution = this.executions.get(pipelineId);
    if (!execution) {
      throw new Error(`Unknown pipeline: ${pipelineId}`);
    }

    execution.status = "failed";
    this.logger.error("Pipeline step failed", { pipelineId, stepName, error });
  }

  /**
   * Build context for a step, including results from completed dependencies.
   * Truncates if total context exceeds MAX_CONTEXT_LENGTH.
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
      parts.push("## Previous Step Results");
      for (const depName of step.dependsOn) {
        const depResult = execution.results.get(depName);
        if (depResult) {
          const content = depResult.content
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("\n");

          parts.push(`### ${depName} (${depResult.role})\n${content}`);
        }
      }
    }

    let fullContext = parts.join("\n\n");

    // Truncate if too long
    if (fullContext.length > MAX_CONTEXT_LENGTH) {
      fullContext =
        fullContext.slice(0, MAX_CONTEXT_LENGTH - 100) +
        "\n\n...[Context truncated due to length]...";
      this.logger.warn("Step context truncated", {
        stepName: step.name,
        originalLength: parts.join("\n\n").length,
        truncatedLength: fullContext.length,
      });
    }

    return fullContext;
  }

  /**
   * Get all active pipeline executions.
   */
  getActiveExecutions(): PipelineExecution[] {
    return Array.from(this.executions.values()).filter(
      (e) => e.status === "running" || e.status === "pending"
    );
  }
}
