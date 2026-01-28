/**
 * execute_pipeline MCP Tool
 *
 * Creates multi-provider task pipelines with dependency resolution.
 * Validates DAG structure and generates TaskCreate instructions for Claude.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../../observability/logger.js";
import { PipelineManager } from "../../../tasks/pipeline-manager.js";
import type { PipelineDefinition, PipelineStep } from "../../../types.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Available agent roles for pipeline steps
 */
const AGENT_ROLES = ["coder", "critic", "designer", "researcher", "reviewer"] as const;

/**
 * Tool description for execute_pipeline
 */
const TOOL_DESCRIPTION =
  "Create a multi-provider task pipeline with dependency resolution. " +
  "Validates the DAG structure (no cycles, valid dependencies) and generates " +
  "TaskCreate instructions for Claude to execute. Steps can run in parallel " +
  "when their dependencies are satisfied.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for execute_pipeline input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const executePipelineInputSchemaShape = {
  name: z.string().min(1).describe("Pipeline name for identification"),
  steps: z
    .array(
      z.object({
        name: z.string().min(1).describe("Unique step identifier within the pipeline"),
        subject: z.string().min(1).describe("Task subject line (imperative form)"),
        description: z.string().optional().describe("Detailed task description"),
        role: z.enum(AGENT_ROLES).describe("Agent role for this step"),
        dependsOn: z
          .array(z.string())
          .optional()
          .describe("Names of steps this step depends on"),
      })
    )
    .min(1)
    .describe("Pipeline steps with dependencies"),
  context: z
    .string()
    .optional()
    .describe("Global context passed to all steps in the pipeline"),
  parallel: z
    .boolean()
    .default(true)
    .describe("Execute independent steps in parallel (default: true)"),
};

/**
 * Interface for validated execute_pipeline input
 */
interface ExecutePipelineInput {
  name: string;
  steps: Array<{
    name: string;
    subject: string;
    description?: string;
    role: (typeof AGENT_ROLES)[number];
    dependsOn?: string[];
  }>;
  context?: string;
  parallel?: boolean;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Computes execution phases for the pipeline based on dependencies.
 * Steps in the same phase can run in parallel.
 *
 * @param steps - Pipeline steps with dependencies
 * @returns Array of phases, each containing step names that can run in parallel
 */
function computeExecutionPhases(steps: PipelineStep[]): string[][] {
  const phases: string[][] = [];
  const completed = new Set<string>();
  const remaining = new Set(steps.map((s) => s.name));

  while (remaining.size > 0) {
    const phase: string[] = [];

    for (const step of steps) {
      if (!remaining.has(step.name)) continue;

      const depsComplete =
        step.dependsOn?.every((dep) => completed.has(dep)) ?? true;

      if (depsComplete) {
        phase.push(step.name);
      }
    }

    if (phase.length === 0) {
      // This shouldn't happen if validation passed, but handle gracefully
      break;
    }

    for (const stepName of phase) {
      remaining.delete(stepName);
      completed.add(stepName);
    }

    phases.push(phase);
  }

  return phases;
}

/**
 * Formats the execution plan showing phases and parallelism.
 *
 * @param definition - The pipeline definition
 * @param phases - Computed execution phases
 * @param parallel - Whether parallel execution is enabled
 * @returns Formatted execution plan string
 */
function formatExecutionPlan(
  definition: PipelineDefinition,
  phases: string[][],
  parallel: boolean
): string {
  const lines: string[] = [];

  lines.push(`## Execution Plan: ${definition.name}`);
  lines.push("");
  lines.push(`**Mode**: ${parallel ? "Parallel" : "Sequential"}`);
  lines.push(`**Total Steps**: ${definition.steps.length}`);
  lines.push(`**Total Phases**: ${phases.length}`);
  lines.push("");

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i] ?? [];
    const parallelNote =
      parallel && phase.length > 1 ? ` (${phase.length} steps in parallel)` : "";

    lines.push(`### Phase ${i + 1}${parallelNote}`);

    for (const stepName of phase) {
      const step = definition.steps.find((s) => s.name === stepName);
      if (step) {
        const deps =
          step.dependsOn?.length ? ` [depends on: ${step.dependsOn.join(", ")}]` : "";
        lines.push(`- **${stepName}** (${step.role}): ${step.subject}${deps}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats the complete pipeline response including plan, instructions, and guidance.
 *
 * @param definition - The pipeline definition
 * @param execution - The created execution tracker
 * @param taskInstructions - Generated TaskCreate instructions
 * @param phases - Computed execution phases
 * @param parallel - Whether parallel execution is enabled
 * @returns Complete formatted response
 */
function formatPipelineResponse(
  definition: PipelineDefinition,
  pipelineId: string,
  taskInstructions: string,
  phases: string[][],
  parallel: boolean
): string {
  const lines: string[] = [];

  // Execution plan
  lines.push(formatExecutionPlan(definition, phases, parallel));

  // TaskCreate instructions
  lines.push("---");
  lines.push("");
  lines.push("## TaskCreate Instructions");
  lines.push("");
  lines.push("Execute the following to create all pipeline tasks:");
  lines.push("");
  lines.push("```");
  lines.push(taskInstructions);
  lines.push("```");
  lines.push("");

  // Next steps guidance
  lines.push("---");
  lines.push("");
  lines.push("## Next Steps");
  lines.push("");

  const readySteps = phases[0] ?? [];
  if (parallel && readySteps.length > 1) {
    lines.push(
      `1. Execute TaskCreate for all steps above to create the task items`
    );
    lines.push(
      `2. Start Phase 1 steps in parallel: ${readySteps.join(", ")}`
    );
    lines.push(`3. As each phase completes, its dependent steps become ready`);
  } else if (readySteps.length > 0) {
    lines.push(`1. Execute TaskCreate for all steps above to create the task items`);
    lines.push(`2. Start with the first step: **${readySteps[0]}**`);
    lines.push(`3. Proceed through steps as dependencies are satisfied`);
  } else {
    lines.push(`1. Execute TaskCreate for all steps above to create the task items`);
    lines.push(`2. Proceed through steps as dependencies are satisfied`);
  }

  lines.push("");
  lines.push(`**Pipeline ID**: \`${pipelineId}\``);
  lines.push(
    `*Use this ID to track execution status and complete step results*`
  );

  return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the execute_pipeline tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param pipelineManager - PipelineManager for validation and execution tracking
 * @param logger - Logger instance for structured logging
 */
export function registerExecutePipelineTool(
  server: McpServer,
  pipelineManager: PipelineManager,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = executePipelineInputSchemaShape;

  server.registerTool(
    "execute_pipeline",
    {
      title: "Execute Pipeline",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { name, steps, context, parallel = true } = args as ExecutePipelineInput;

      logger.info("execute_pipeline called", {
        name,
        stepCount: steps.length,
        hasContext: context !== undefined,
        parallel,
      });

      try {
        // Build the pipeline definition
        // Use explicit property assignment to handle exactOptionalPropertyTypes
        const pipelineSteps: PipelineStep[] = steps.map((step) => {
          const pipelineStep: PipelineStep = {
            name: step.name,
            subject: step.subject,
            role: step.role,
          };
          if (step.description !== undefined) {
            pipelineStep.description = step.description;
          }
          if (step.dependsOn !== undefined) {
            pipelineStep.dependsOn = step.dependsOn;
          }
          return pipelineStep;
        });

        const definition: PipelineDefinition = {
          name,
          steps: pipelineSteps,
        };
        if (context !== undefined) {
          definition.globalContext = context;
        }

        // Validate the definition (throws on error)
        pipelineManager.validateDefinition(definition);

        // Generate TaskCreate instructions
        const taskInstructions =
          pipelineManager.generatePipelineCreation(definition);

        // Create the execution tracker
        const execution = pipelineManager.createExecution(definition);

        // Compute execution phases for the plan
        const phases = computeExecutionPhases(definition.steps);

        logger.info("execute_pipeline completed", {
          name,
          pipelineId: execution.pipelineId,
          stepCount: steps.length,
          phaseCount: phases.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatPipelineResponse(
                definition,
                execution.pipelineId,
                taskInstructions,
                phases,
                parallel
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof Error) {
          logger.error("execute_pipeline failed", {
            name,
            error,
            errorMessage,
          });
        } else {
          logger.error("execute_pipeline failed", {
            name,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Creating Pipeline\n\n**Pipeline**: ${name}\n**Error**: ${errorMessage}\n\n` +
                `Common issues:\n` +
                `- Duplicate step names\n` +
                `- Missing dependency (step depends on non-existent step)\n` +
                `- Circular dependencies`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered execute_pipeline tool", { roles: AGENT_ROLES });
}
