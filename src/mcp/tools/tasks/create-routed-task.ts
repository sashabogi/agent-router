/**
 * create_routed_task MCP Tool
 *
 * Generates TaskCreate instruction strings for tasks pre-configured for AgentRouter.
 * This tool outputs the TaskCreate syntax that can be executed to create tasks
 * that will be routed to specific agent roles.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../../observability/logger.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Available agent roles for task routing
 */
const AGENT_ROLES = ["coder", "critic", "designer", "researcher", "reviewer"] as const;

/**
 * Tool description for create_routed_task
 */
const TOOL_DESCRIPTION =
  "Generate a TaskCreate instruction string for a task pre-configured for AgentRouter. " +
  "The output contains the TaskCreate syntax to execute, which will create a task " +
  "routed to a specific agent role (coder, critic, designer, researcher, reviewer).";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for create_routed_task input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const createRoutedTaskInputSchemaShape = {
  subject: z
    .string()
    .min(1)
    .describe("Short task title in imperative form (e.g., 'Implement user authentication')"),
  description: z
    .string()
    .optional()
    .describe("Detailed description of the task requirements and context"),
  role: z
    .enum(AGENT_ROLES)
    .describe(
      "AgentRouter role for execution: coder (implementation), critic (plan review), " +
        "designer (UI/UX), researcher (fact-finding), reviewer (code review)"
    ),
  blockedBy: z
    .array(z.string())
    .optional()
    .describe("Array of task IDs that this task depends on (must complete first)"),
  priority: z
    .number()
    .optional()
    .describe("Priority level where 1 is highest priority"),
};

/**
 * Interface for validated create_routed_task input
 */
interface CreateRoutedTaskInput {
  subject: string;
  description?: string;
  role: (typeof AGENT_ROLES)[number];
  blockedBy?: string[];
  priority?: number;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats the TaskCreate instruction response
 *
 * @param input - The validated input parameters
 * @returns Formatted string with TaskCreate instruction
 */
function formatTaskCreateResponse(input: CreateRoutedTaskInput): string {
  const { subject, description, role, blockedBy, priority } = input;

  // Build the metadata object
  const metadataEntries = [
    "    agentRouter: true",
    `    role: "${role}"`,
  ];
  if (priority !== undefined) {
    metadataEntries.push(`    priority: ${String(priority)}`);
  }

  // Build the TaskCreate parameters
  const taskCreateLines = [
    `  subject: "${escapeString(subject)}"`,
  ];

  if (description !== undefined) {
    taskCreateLines.push(`  description: "${escapeString(description)}"`);
  }

  taskCreateLines.push(`  activeForm: "Awaiting ${role} agent..."`);
  taskCreateLines.push(`  metadata: {\n${metadataEntries.join(",\n")}\n  }`);

  if (blockedBy !== undefined && blockedBy.length > 0) {
    const blockedByStr = blockedBy.map((id) => `"${escapeString(id)}"`).join(", ");
    taskCreateLines.push(`  blockedBy: [${blockedByStr}]`);
  }

  const taskCreateBody = taskCreateLines.join(",\n");

  return `## Create Routed Task

Execute this to create the task:

\`\`\`
TaskCreate({
${taskCreateBody}
})
\`\`\`

After creation, execute with:
\`execute_task({ taskId: <new_id>, role: "${role}" })\``;
}

/**
 * Escapes special characters in strings for safe inclusion in generated code
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the create_routed_task tool with the MCP server
 *
 * @param server - MCP server instance
 * @param logger - Logger instance for structured logging
 */
export function registerCreateRoutedTaskTool(server: McpServer, logger: Logger): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = createRoutedTaskInputSchemaShape;

  server.registerTool(
    "create_routed_task",
    {
      title: "Create Routed Task",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const input = args as CreateRoutedTaskInput;

      logger.info("create_routed_task called", {
        subject: input.subject,
        role: input.role,
        hasDescription: input.description !== undefined,
        hasBlockedBy: input.blockedBy !== undefined && input.blockedBy.length > 0,
        priority: input.priority,
      });

      try {
        const responseText = formatTaskCreateResponse(input);

        logger.info("create_routed_task completed", {
          role: input.role,
          subject: input.subject,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: responseText,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof Error) {
          logger.error("create_routed_task failed", {
            error,
            errorMessage,
          });
        } else {
          logger.error("create_routed_task failed", {
            errorMessage,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Creating Routed Task\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered create_routed_task tool", { roles: AGENT_ROLES });
}
