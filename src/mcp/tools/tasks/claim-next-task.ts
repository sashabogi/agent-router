/**
 * claim_next_task MCP Tool
 *
 * Generates instructions for workers to claim available tasks.
 * Workers use these instructions to find, claim, and execute pending tasks.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../../observability/logger.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Available agent roles (same as invoke-agent)
 */
const AGENT_ROLES = ["coder", "critic", "designer", "researcher", "reviewer"] as const;

/**
 * Task selection priority strategies
 */
const PRIORITY_STRATEGIES = ["highest", "lowest", "fifo"] as const;

/**
 * Tool description for claim_next_task
 */
const TOOL_DESCRIPTION =
  "Generate instructions for a worker to claim and execute the next available task. " +
  "Returns markdown instructions that guide the worker through the claim protocol.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for claim_next_task input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const claimNextTaskInputSchemaShape = {
  workerName: z
    .string()
    .min(1)
    .describe("Worker identifier for ownership tracking"),
  roles: z
    .array(z.enum(AGENT_ROLES))
    .optional()
    .describe("Only claim tasks for these roles. If not specified, claims tasks for any role."),
  priority: z
    .enum(PRIORITY_STRATEGIES)
    .default("fifo")
    .describe(
      "Task selection strategy: 'highest' (highest priority first), 'lowest' (lowest priority first), 'fifo' (first in, first out)"
    ),
  excludeTaskIds: z
    .array(z.string())
    .optional()
    .describe("Task IDs to skip (e.g., previously failed tasks)"),
};

/**
 * Interface for validated claim_next_task input
 */
interface ClaimNextTaskInput {
  workerName: string;
  roles?: (typeof AGENT_ROLES)[number][];
  priority: (typeof PRIORITY_STRATEGIES)[number];
  excludeTaskIds?: string[];
}

// ============================================================================
// Instruction Generator
// ============================================================================

/**
 * Generates markdown instructions for the worker claim protocol.
 *
 * @param input - The validated input parameters
 * @returns Formatted markdown instructions
 */
function generateClaimInstructions(input: ClaimNextTaskInput): string {
  const { workerName, roles, priority, excludeTaskIds } = input;

  const rolesDisplay = roles?.length ? roles.join(", ") : "any";
  const roleFilter = roles?.length
    ? `metadata.role IN [${roles.map((r) => `"${r}"`).join(", ")}]`
    : "any role";
  const excludeClause = excludeTaskIds?.length
    ? `   - id NOT IN [${excludeTaskIds.join(", ")}]`
    : "";

  return `## Claim Next Task

### Search Criteria
- Worker: ${workerName}
- Roles: ${rolesDisplay}
- Priority: ${priority}

### Instructions

1. First, get current tasks:
\`TaskList()\`

2. Find a task matching:
   - status = "pending"
   - owner = null (unclaimed)
   - blockedBy is empty OR all blockers completed
   - ${roleFilter}
${excludeClause}

3. If found, claim it:
\`TaskUpdate({ taskId: <found_id>, status: "in_progress", owner: "${workerName}" })\`

4. Then execute:
\`execute_task({ taskId: <found_id> })\`

5. On completion, loop back to step 1.

6. If no tasks match, worker can exit:
\`Teammate({ operation: "requestShutdown" })\`

### Notes
- If a claim fails (another worker claimed first), add the taskId to excludeTaskIds and retry
- Priority "${priority}" means: ${getPriorityDescription(priority)}
- The execute_task tool automatically marks tasks complete on success
- If execution fails, the task is released for retry
`;
}

/**
 * Get human-readable description for a priority strategy.
 */
function getPriorityDescription(priority: (typeof PRIORITY_STRATEGIES)[number]): string {
  switch (priority) {
    case "highest":
      return "select the task with the highest priority value first";
    case "lowest":
      return "select the task with the lowest priority value first";
    case "fifo":
      return "select the oldest pending task first (first in, first out)";
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the claim_next_task tool with the MCP server.
 *
 * @param server - MCP server instance
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '3.0.0' });
 * registerClaimNextTaskTool(server, logger);
 * ```
 */
export function registerClaimNextTaskTool(
  server: McpServer,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = claimNextTaskInputSchemaShape;

  server.registerTool(
    "claim_next_task",
    {
      title: "Claim Next Task",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const input = args as ClaimNextTaskInput;

      // Apply default for priority if not provided
      const normalizedInput: ClaimNextTaskInput = {
        ...input,
        priority: input.priority ?? "fifo",
      };

      logger.info("claim_next_task called", {
        workerName: normalizedInput.workerName,
        roles: normalizedInput.roles,
        priority: normalizedInput.priority,
        excludeCount: normalizedInput.excludeTaskIds?.length ?? 0,
      });

      try {
        const instructions = generateClaimInstructions(normalizedInput);

        logger.debug("claim_next_task instructions generated", {
          workerName: normalizedInput.workerName,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: instructions,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("claim_next_task failed", {
            workerName: normalizedInput.workerName,
            error,
            errorMessage,
          });
        } else {
          logger.error("claim_next_task failed", {
            workerName: normalizedInput.workerName,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Generating Claim Instructions\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered claim_next_task tool", {
    roles: AGENT_ROLES,
    priorities: PRIORITY_STRATEGIES,
  });
}
