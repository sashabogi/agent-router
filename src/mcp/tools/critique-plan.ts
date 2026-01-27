/**
 * critique_plan MCP Tool
 *
 * Convenience tool for getting critical review of a plan, PRD, or technical
 * design from a skeptical architect. This is a shorthand for invoking the
 * critic agent with a structured task.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Logger } from "../../observability/logger.js";
import type { RouterEngine } from "../../router/engine.js";
import type { AgentResponse } from "../../types.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Tool description for critique_plan
 */
const TOOL_DESCRIPTION =
  "Get critical review of a plan, PRD, or technical design from a skeptical architect. " +
  "The critic will challenge assumptions, identify risks, and suggest improvements.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for critique_plan input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const critiquePlanInputSchemaShape = {
  plan: z
    .string()
    .min(1)
    .describe("The plan, PRD, or technical design document to critique"),
  focus: z
    .string()
    .optional()
    .describe(
      "Optional focus areas for the critique (e.g., 'security', 'scalability', 'cost', 'maintainability')"
    ),
};

/**
 * Interface for validated critique_plan input
 */
interface CritiquePlanInput {
  plan: string;
  focus?: string;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats an AgentResponse for MCP text output
 *
 * @param response - The response from the agent invocation
 * @returns Formatted string with header, metadata, and critique content
 */
function formatCritiqueResponse(response: AgentResponse): string {
  const header = `## Plan Critique (CRITIC Agent)\n`;
  const meta = `*Provider: ${response.provider} | Model: ${response.model} | Duration: ${String(response.metadata.durationMs)}ms*\n\n`;

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  return header + meta + content;
}

/**
 * Builds the task string for the critic agent
 *
 * @param plan - The plan document to critique
 * @param focus - Optional focus areas
 * @returns Formatted task string
 */
function buildCritiqueTask(plan: string, focus?: string): string {
  let task = `Please provide a critical review of the following plan or technical design.\n\n`;

  if (focus !== undefined && focus !== "") {
    task += `Focus particularly on: ${focus}\n\n`;
  }

  task += `Analyze for:\n`;
  task += `- Hidden assumptions and unstated dependencies\n`;
  task += `- Potential risks and failure modes\n`;
  task += `- Scalability and performance concerns\n`;
  task += `- Security vulnerabilities\n`;
  task += `- Missing requirements or edge cases\n`;
  task += `- Alternative approaches worth considering\n\n`;
  task += `<plan>\n${plan}\n</plan>`;

  return task;
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the critique_plan tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '0.1.0' });
 * const router = new RouterEngine(config, providers, logger);
 * registerCritiquePlanTool(server, router, logger);
 * ```
 */
export function registerCritiquePlanTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = critiquePlanInputSchemaShape;

  server.registerTool(
    "critique_plan",
    {
      title: "Critique Plan",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { plan, focus } = args as CritiquePlanInput;

      logger.info("critique_plan called", {
        planLength: plan.length,
        hasFocus: focus !== undefined,
        focus: focus,
      });

      try {
        const startTime = Date.now();

        // Build the task string with optional focus areas
        const task = buildCritiqueTask(plan, focus);

        // Invoke the critic agent
        const response = await router.invokeAgent({
          role: "critic",
          task,
        });

        const durationMs = Date.now() - startTime;

        logger.info("critique_plan completed", {
          provider: response.provider,
          model: response.model,
          durationMs,
          traceId: response.metadata.traceId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatCritiqueResponse(response),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("critique_plan failed", {
            error,
            errorMessage,
          });
        } else {
          logger.error("critique_plan failed", {
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Critiquing Plan\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered critique_plan tool");
}
