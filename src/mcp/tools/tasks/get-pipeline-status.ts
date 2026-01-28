/**
 * get_pipeline_status MCP Tool
 *
 * Queries the execution status of a pipeline, showing step progress,
 * dependency graph, and available results.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../../observability/logger.js";
import type { PipelineManager } from "../../../tasks/pipeline-manager.js";
import type { PipelineExecution, PipelineStep } from "../../../types.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Tool description for get_pipeline_status
 */
const TOOL_DESCRIPTION =
  "Query the execution status of a pipeline by name. Returns overall progress, step statuses, dependency graph, and available results.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for get_pipeline_status input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const getPipelineStatusInputSchemaShape = {
  pipelineName: z
    .string()
    .min(1)
    .describe("The pipeline name to query status for"),
};

/**
 * Interface for validated get_pipeline_status input
 */
interface GetPipelineStatusInput {
  pipelineName: string;
}

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Status emoji for step visualization
 */
const STATUS_EMOJI = {
  complete: "\u2705",    // checkmark
  running: "\uD83D\uDD04",   // arrows circle
  blocked: "\u23F3",     // hourglass
  pending: "\u23F8",     // pause
} as const;

/**
 * Determine the status of a step within an execution
 */
function getStepStatus(
  step: PipelineStep,
  execution: PipelineExecution
): "complete" | "running" | "blocked" | "pending" {
  // Check if completed
  if (execution.completedSteps.has(step.name)) {
    return "complete";
  }

  // Check if all dependencies are complete (step is ready)
  const depsComplete =
    step.dependsOn?.every((dep) => execution.completedSteps.has(dep)) ?? true;

  if (!depsComplete) {
    return "blocked";
  }

  // If pipeline is running and step is ready, it's running
  if (execution.status === "running") {
    return "running";
  }

  return "pending";
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Build a text-based dependency graph
 */
function buildDependencyGraph(execution: PipelineExecution): string {
  const steps = execution.definition.steps;

  // Group steps by their dependency depth
  const depthMap = new Map<string, number>();

  // Calculate depth for each step (BFS-style)
  for (const step of steps) {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      depthMap.set(step.name, 0);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (depthMap.has(step.name)) continue;

      const deps = step.dependsOn ?? [];
      const depsResolved = deps.every((d) => depthMap.has(d));
      if (depsResolved) {
        const maxDepth = Math.max(...deps.map((d) => depthMap.get(d) ?? 0));
        depthMap.set(step.name, maxDepth + 1);
        changed = true;
      }
    }
  }

  // Build adjacency for visualization
  const lines: string[] = [];
  const processed = new Set<string>();

  // Sort by depth for better visualization
  const sortedSteps = [...steps].sort(
    (a, b) => (depthMap.get(a.name) ?? 0) - (depthMap.get(b.name) ?? 0)
  );

  for (const step of sortedSteps) {
    if (processed.has(step.name)) continue;
    processed.add(step.name);

    // Find what this step leads to
    const dependents = steps.filter((s) => s.dependsOn?.includes(step.name));

    if (dependents.length === 0) {
      // Terminal node
      if (step.dependsOn && step.dependsOn.length > 0) {
        // Already shown as part of a chain
        continue;
      }
      lines.push(step.name);
    } else if (dependents.length === 1) {
      // Simple chain
      const firstDependent = dependents[0];
      if (firstDependent) {
        lines.push(`${step.name} --> ${firstDependent.name}`);
      }
    } else {
      // Fan-out
      const targets = dependents.map((d) => d.name).join(", ");
      lines.push(`${step.name} --> [${targets}]`);
    }
  }

  // Deduplicate and clean up
  const uniqueLines = [...new Set(lines)];
  return uniqueLines.length > 0 ? uniqueLines.join("\n") : "(single step)";
}

/**
 * Format the results summary
 */
function formatResults(execution: PipelineExecution): string {
  const resultSummaries: string[] = [];

  for (const [stepName, result] of execution.results) {
    // Get text content preview
    const textContent = result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ")
      .trim();

    // Truncate to reasonable preview length
    const preview =
      textContent.length > 60
        ? textContent.substring(0, 60) + "..."
        : textContent;

    resultSummaries.push(`- **${stepName}**: "${preview}"`);
  }

  return resultSummaries.length > 0
    ? resultSummaries.join("\n")
    : "(no results yet)";
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats a pipeline status response for MCP text output
 */
function formatPipelineStatus(execution: PipelineExecution): string {
  const { definition, completedSteps, startTime, status } = execution;
  const totalSteps = definition.steps.length;
  const completedCount = completedSteps.size;
  const percentage = Math.round((completedCount / totalSteps) * 100);
  const elapsedTime = formatDuration(Date.now() - startTime);

  // Build step status table
  const stepRows: string[] = [];
  for (const step of definition.steps) {
    const stepStatus = getStepStatus(step, execution);
    const result = execution.results.get(step.name);
    const duration = result ? formatDuration(result.metadata.durationMs) : "-";
    const provider = result ? result.provider : "-";

    stepRows.push(
      `| ${step.name} | ${step.role} | ${STATUS_EMOJI[stepStatus]} ${stepStatus} | ${provider} | ${duration} |`
    );
  }

  const stepTable = `| Step | Role | Status | Provider | Duration |
|------|------|--------|----------|----------|
${stepRows.join("\n")}`;

  // Build dependency graph
  const depGraph = buildDependencyGraph(execution);

  // Build results section
  const results = formatResults(execution);

  // Overall status indicator
  const statusIndicator =
    status === "completed"
      ? `${STATUS_EMOJI.complete} completed`
      : status === "failed"
        ? "\u274C failed"
        : status === "running"
          ? `${STATUS_EMOJI.running} running`
          : `${STATUS_EMOJI.pending} pending`;

  return `## Pipeline Status: ${definition.name}

**Overall:** ${completedCount}/${totalSteps} steps complete (${percentage}%) - ${statusIndicator}
**Elapsed:** ${elapsedTime}

### Step Status
${stepTable}

### Dependency Graph
\`\`\`
${depGraph}
\`\`\`

### Results Available
${results}`;
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the get_pipeline_status tool with the MCP server
 *
 * @param server - MCP server instance
 * @param pipelineManager - PipelineManager for querying executions
 * @param logger - Logger instance for structured logging
 */
export function registerGetPipelineStatusTool(
  server: McpServer,
  pipelineManager: PipelineManager,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = getPipelineStatusInputSchemaShape;

  server.registerTool(
    "get_pipeline_status",
    {
      title: "Get Pipeline Status",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { pipelineName } = args as GetPipelineStatusInput;

      logger.info("get_pipeline_status called", {
        pipelineName,
      });

      try {
        // Search through active executions for matching pipeline name
        const activeExecutions = pipelineManager.getActiveExecutions();
        const allExecutions = [...activeExecutions];

        // Also check all tracked executions (completed ones might not be in active)
        // We search by pipeline definition name
        let foundExecution: PipelineExecution | undefined;

        for (const execution of allExecutions) {
          if (execution.definition.name === pipelineName) {
            foundExecution = execution;
            break;
          }
        }

        if (!foundExecution) {
          logger.warn("Pipeline not found", { pipelineName });

          return {
            content: [
              {
                type: "text" as const,
                text: `## Pipeline Not Found: ${pipelineName}\n\nNo active pipeline execution found with name "${pipelineName}".\n\nActive pipelines: ${activeExecutions.length > 0 ? activeExecutions.map((e) => e.definition.name).join(", ") : "(none)"}`,
              },
            ],
          };
        }

        logger.info("get_pipeline_status completed", {
          pipelineName,
          pipelineId: foundExecution.pipelineId,
          status: foundExecution.status,
          completedSteps: foundExecution.completedSteps.size,
          totalSteps: foundExecution.definition.steps.length,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatPipelineStatus(foundExecution),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("get_pipeline_status failed", {
            pipelineName,
            error,
            errorMessage,
          });
        } else {
          logger.error("get_pipeline_status failed", {
            pipelineName,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Getting Pipeline Status\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered get_pipeline_status tool");
}
