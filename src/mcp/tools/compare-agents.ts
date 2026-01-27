/**
 * compare_agents MCP Tool
 *
 * Runs the same task through multiple agents and compares their responses.
 * Useful for getting different perspectives or finding the best approach.
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
 * Tool description for compare_agents
 */
const TOOL_DESCRIPTION =
  "Run the same task through multiple agents and compare their responses. Useful for getting different perspectives from specialized agents (coder, critic, designer, researcher, reviewer).";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for compare_agents input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const compareAgentsInputSchemaShape = {
  roles: z
    .array(z.string())
    .min(2)
    .describe("List of agent roles to compare (minimum 2 required)"),
  task: z.string().min(1).describe("The task to send to all agents"),
};

/**
 * Interface for validated compare_agents input
 */
interface CompareAgentsInput {
  roles: string[];
  task: string;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats a single agent response for the comparison output
 *
 * @param response - The response from the agent invocation
 * @returns Formatted string with header, metadata, and content
 */
function formatSingleAgentResponse(response: AgentResponse): string {
  const header = `### ${response.role.toUpperCase()} Agent\n`;
  const meta = `*Provider: ${response.provider} | Model: ${response.model} | Duration: ${String(response.metadata.durationMs)}ms*\n\n`;

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  return header + meta + content;
}

/**
 * Formats the comparison results for MCP text output
 *
 * @param results - Map of role names to their responses
 * @param failedRoles - Array of roles that failed to respond
 * @param totalDurationMs - Total time taken for the comparison
 * @returns Formatted string with all agent responses side by side
 */
function formatComparisonResponse(
  results: Map<string, AgentResponse>,
  failedRoles: string[],
  totalDurationMs: number
): string {
  const sections: string[] = [];

  // Header
  sections.push("## Agent Comparison Results\n");
  sections.push(
    `*Compared ${String(results.size)} agents | Total duration: ${String(totalDurationMs)}ms*\n`
  );

  // Separator
  sections.push("---\n");

  // Individual agent responses
  for (const [_role, response] of results) {
    sections.push(formatSingleAgentResponse(response));
    sections.push("\n---\n");
  }

  // Failed roles (if any)
  if (failedRoles.length > 0) {
    sections.push("### Failed Agents\n");
    sections.push(`The following agents failed to respond: ${failedRoles.join(", ")}\n`);
  }

  return sections.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the compare_agents tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '0.1.0' });
 * const router = new RouterEngine(config, providers, logger);
 * registerCompareAgentsTool(server, router, logger);
 * ```
 */
export function registerCompareAgentsTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = compareAgentsInputSchemaShape;

  server.registerTool(
    "compare_agents",
    {
      title: "Compare Agents",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { roles, task } = args as CompareAgentsInput;

      logger.info("compare_agents called", {
        roles,
        roleCount: roles.length,
        taskLength: task.length,
      });

      // Validate that all roles exist
      const invalidRoles = roles.filter((role) => !router.hasRole(role));
      if (invalidRoles.length > 0) {
        const errorMessage = `Unknown roles: ${invalidRoles.join(", ")}. Available roles: ${router.listRoles().join(", ")}`;

        logger.warn("compare_agents called with invalid roles", {
          invalidRoles,
          availableRoles: router.listRoles(),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Comparing Agents\n\n${errorMessage}`,
            },
          ],
        };
      }

      try {
        const startTime = Date.now();
        const results = await router.compareAgents(roles, task);
        const durationMs = Date.now() - startTime;

        // Determine which roles failed
        const failedRoles = roles.filter((role) => !results.has(role));

        logger.info("compare_agents completed", {
          roles,
          successfulRoles: Array.from(results.keys()),
          failedRoles,
          durationMs,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatComparisonResponse(results, failedRoles, durationMs),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("compare_agents failed", {
            roles,
            error,
            errorMessage,
          });
        } else {
          logger.error("compare_agents failed", {
            roles,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Comparing Agents\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered compare_agents tool");
}
