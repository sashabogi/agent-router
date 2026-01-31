/**
 * invoke_agent MCP Tool
 *
 * Invokes a specialized AI agent for a specific task.
 * Available roles: coder, critic, designer, researcher, reviewer
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
 * Available agent roles
 */
const AGENT_ROLES = ["coder", "critic", "designer", "orchestrator", "researcher", "reviewer"] as const;

/**
 * Tool description for invoke_agent
 */
const TOOL_DESCRIPTION =
  "Invoke a specialized AI agent for a specific task. Available roles: coder (code generation), critic (plan review, assumption challenging), designer (UI/UX feedback), orchestrator (task synthesis, document improvement), researcher (fact-finding), reviewer (code review).";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for invoke_agent input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const invokeAgentInputSchemaShape = {
  role: z
    .enum(AGENT_ROLES)
    .describe(
      "The agent role to invoke. Use 'critic' for plan/PRD review, 'designer' for UI/UX feedback, 'reviewer' for code review."
    ),
  task: z.string().min(1).describe("The task description or question for the agent"),
  context: z
    .string()
    .optional()
    .describe("Optional additional context from the current conversation"),
};

/**
 * Interface for validated invoke_agent input
 */
interface InvokeAgentInput {
  role: (typeof AGENT_ROLES)[number];
  task: string;
  context?: string;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats an AgentResponse for MCP text output
 *
 * @param response - The response from the agent invocation
 * @returns Formatted string with header, metadata, and content
 */
function formatAgentResponse(response: AgentResponse): string {
  const header = `## ${response.role.toUpperCase()} Agent Response\n`;
  const meta = `*Provider: ${response.provider} | Model: ${response.model} | Duration: ${String(response.metadata.durationMs)}ms*\n\n`;

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  return header + meta + content;
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the invoke_agent tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '0.1.0' });
 * const router = new RouterEngine(config, providers, logger);
 * registerInvokeAgentTool(server, router, logger);
 * ```
 */
export function registerInvokeAgentTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = invokeAgentInputSchemaShape;

  server.registerTool(
    "invoke_agent",
    {
      title: "Invoke Agent",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { role, task, context } = args as InvokeAgentInput;

      logger.info("invoke_agent called", {
        role,
        taskLength: task.length,
        hasContext: context !== undefined,
      });

      try {
        const startTime = Date.now();
        // Build input with optional context only if provided
        const invokeInput = context !== undefined ? { role, task, context } : { role, task };
        const response = await router.invokeAgent(invokeInput);
        const durationMs = Date.now() - startTime;

        logger.info("invoke_agent completed", {
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
              text: formatAgentResponse(response),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("invoke_agent failed", {
            role,
            error,
            errorMessage,
          });
        } else {
          logger.error("invoke_agent failed", {
            role,
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Invoking ${role.toUpperCase()} Agent\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered invoke_agent tool", { roles: AGENT_ROLES });
}
