/**
 * execute_task MCP Tool
 *
 * Executes a Claude Code task using AgentRouter.
 * Coordinates with TaskCoordinator for lifecycle management.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../../observability/logger.js";
import type { RouterEngine } from "../../../router/engine.js";
import type { TaskCoordinator } from "../../../tasks/coordinator.js";
import type { AgentResponse } from "../../../types.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Available agent roles
 */
const AGENT_ROLES = ["coder", "critic", "designer", "researcher", "reviewer"] as const;

/**
 * Tool description for execute_task
 */
const TOOL_DESCRIPTION =
  "Execute a Claude Code task using AgentRouter. Claims the task, invokes the appropriate agent, and returns completion instructions.";

/**
 * Default worker name for task claims
 */
const DEFAULT_WORKER_NAME = "agent-router";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for execute_task input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const executeTaskInputSchemaShape = {
  taskId: z.string().min(1).describe("The Claude Code task ID to execute"),
  role: z
    .enum(AGENT_ROLES)
    .optional()
    .describe(
      "The agent role to use. If not provided, must be specified in task metadata."
    ),
  context: z
    .string()
    .optional()
    .describe("Optional additional context for the agent"),
  autoComplete: z
    .boolean()
    .default(true)
    .describe("Automatically mark the task as complete on success (default: true)"),
};

/**
 * Interface for validated execute_task input
 */
interface ExecuteTaskInput {
  taskId: string;
  role?: (typeof AGENT_ROLES)[number];
  context?: string;
  autoComplete: boolean;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats the task execution response for MCP text output
 *
 * @param taskId - The Claude Code task ID
 * @param role - The agent role used
 * @param response - The agent response
 * @param durationMs - Execution duration in milliseconds
 * @param autoComplete - Whether to include auto-complete instructions
 * @returns Formatted string with execution details and instructions
 */
function formatTaskExecutionResponse(
  taskId: string,
  role: string,
  response: AgentResponse,
  durationMs: number,
  autoComplete: boolean
): string {
  const header = `## Task Execution Complete\n\n`;
  const meta =
    `**Task ID:** ${taskId}\n` +
    `**Role:** ${role}\n` +
    `**Provider:** ${response.provider} | **Model:** ${response.model}\n` +
    `**Duration:** ${String(durationMs)}ms\n\n`;

  const instructions =
    `### Instructions for Claude\n` +
    (autoComplete
      ? `TaskUpdate({ taskId: "${taskId}", status: "completed" })\n\n`
      : `Manual completion required\n\n`);

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  const agentResponse = `### Agent Response\n${content}`;

  return header + meta + instructions + agentResponse;
}

/**
 * Formats an error response for task execution failure
 *
 * @param taskId - The Claude Code task ID
 * @param role - The agent role attempted
 * @param errorMessage - The error message
 * @returns Formatted error string with release instructions
 */
function formatTaskErrorResponse(
  taskId: string,
  role: string,
  errorMessage: string
): string {
  return (
    `## Task Execution Failed\n\n` +
    `**Task ID:** ${taskId}\n` +
    `**Role:** ${role}\n\n` +
    `### Instructions for Claude\n` +
    `TaskUpdate({ taskId: "${taskId}", status: "pending", owner: null })\n\n` +
    `### Error\n${errorMessage}`
  );
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the execute_task tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param coordinator - TaskCoordinator for task lifecycle management
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '3.0.0' });
 * const router = new RouterEngine(config, providers, logger);
 * const coordinator = new TaskCoordinator(logger);
 * registerExecuteTaskTool(server, router, coordinator, logger);
 * ```
 */
export function registerExecuteTaskTool(
  server: McpServer,
  router: RouterEngine,
  coordinator: TaskCoordinator,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = executeTaskInputSchemaShape;

  server.registerTool(
    "execute_task",
    {
      title: "Execute Task",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { taskId, role, context, autoComplete } = args as ExecuteTaskInput;

      // Role must be provided either in args or will need to come from task metadata
      // For now, we require it in args
      if (!role) {
        logger.warn("execute_task called without role", { taskId });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `## Error Executing Task\n\n` +
                `**Task ID:** ${taskId}\n\n` +
                `Role is required. Please specify a role: coder, critic, designer, researcher, or reviewer.`,
            },
          ],
        };
      }

      logger.info("execute_task called", {
        taskId,
        role,
        hasContext: context !== undefined,
        autoComplete,
      });

      try {
        // Generate claim instructions (for logging/reference)
        const claimInstructions = coordinator.generateClaimInstructions(
          taskId,
          DEFAULT_WORKER_NAME
        );

        logger.debug("Task claim instructions generated", {
          taskId,
          preExecution: claimInstructions.preExecution,
        });

        // Start tracking the execution
        coordinator.startExecution(taskId, role);

        const startTime = Date.now();

        // Build input with optional context only if provided
        const invokeInput =
          context !== undefined ? { role, task: taskId, context } : { role, task: taskId };

        // Invoke the agent through the router
        const response = await router.invokeAgent(invokeInput);

        const durationMs = Date.now() - startTime;

        // Mark execution complete
        coordinator.completeExecution(taskId, response);

        logger.info("execute_task completed", {
          taskId,
          role,
          provider: response.provider,
          model: response.model,
          durationMs,
          traceId: response.metadata.traceId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatTaskExecutionResponse(
                taskId,
                role,
                response,
                durationMs,
                autoComplete
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Mark execution failed and generate release instructions
        try {
          coordinator.failExecution(taskId, error instanceof Error ? error : new Error(errorMessage));
        } catch {
          // Execution may not exist if it failed before startExecution
          logger.debug("Could not mark execution as failed", { taskId });
        }

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("execute_task failed", {
            taskId,
            role,
            error,
            errorMessage,
          });
        } else {
          logger.error("execute_task failed", {
            taskId,
            role,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: formatTaskErrorResponse(taskId, role, errorMessage),
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered execute_task tool", { roles: AGENT_ROLES });
}
