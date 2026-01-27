/**
 * review_code MCP Tool
 *
 * Convenience tool for getting code review feedback.
 * This is a shorthand for invoking the 'reviewer' role with code-specific formatting.
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
 * Tool description for review_code
 */
const TOOL_DESCRIPTION =
  "Get code review feedback on code snippets or files. " +
  "Analyzes code for quality, security, performance, and best practices.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for review_code input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const reviewCodeInputSchemaShape = {
  code: z.string().min(1).describe("The code to review"),
  language: z
    .string()
    .optional()
    .describe("Programming language (optional, will be auto-detected if not provided)"),
  context: z
    .string()
    .optional()
    .describe("Additional context about the code (optional) - e.g., purpose, constraints, or areas of concern"),
};

/**
 * Interface for validated review_code input
 * Note: Optional properties use | undefined for exactOptionalPropertyTypes compliance
 */
interface ReviewCodeInput {
  code: string;
  language?: string | undefined;
  context?: string | undefined;
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
function formatCodeReviewResponse(response: AgentResponse): string {
  const header = `## Code Review Feedback\n`;
  const meta = `*Provider: ${response.provider} | Model: ${response.model} | Duration: ${String(response.metadata.durationMs)}ms*\n\n`;

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

  return header + meta + content;
}

// ============================================================================
// Task Builder
// ============================================================================

/**
 * Builds the task string for the reviewer agent.
 *
 * @param input - The validated input parameters
 * @returns Formatted task string with code block and context
 */
function buildReviewTask(input: ReviewCodeInput): string {
  const parts: string[] = [];

  // Add review instruction
  parts.push("Please review the following code for quality, security, performance, and best practices.");

  // Add context if provided
  if (input.context !== undefined && input.context !== "") {
    parts.push(`\n**Context:** ${input.context}`);
  }

  // Add language hint if provided
  const languageHint = input.language ?? "";

  // Add code block
  parts.push(`\n\`\`\`${languageHint}\n${input.code}\n\`\`\``);

  // Add review guidance
  parts.push("\nProvide feedback on:");
  parts.push("- Code quality and readability");
  parts.push("- Potential bugs or edge cases");
  parts.push("- Security concerns");
  parts.push("- Performance considerations");
  parts.push("- Best practices and improvements");

  return parts.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers the review_code tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '0.1.0' });
 * const router = new RouterEngine(config, providers, logger);
 * registerReviewCodeTool(server, router, logger);
 * ```
 */
export function registerReviewCodeTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = reviewCodeInputSchemaShape;

  server.registerTool(
    "review_code",
    {
      title: "Review Code",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { code, language, context } = args as ReviewCodeInput;

      logger.info("review_code called", {
        codeLength: code.length,
        language: language ?? "auto-detect",
        hasContext: context !== undefined,
      });

      try {
        const startTime = Date.now();

        // Build the task string for the reviewer agent
        const taskString = buildReviewTask({ code, language, context });

        // Invoke the reviewer agent
        const response = await router.invokeAgent({
          role: "reviewer",
          task: taskString,
        });

        const durationMs = Date.now() - startTime;

        logger.info("review_code completed", {
          provider: response.provider,
          model: response.model,
          durationMs,
          traceId: response.metadata.traceId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatCodeReviewResponse(response),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("review_code failed", {
            error,
            errorMessage,
          });
        } else {
          logger.error("review_code failed", {
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Getting Code Review\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered review_code tool");
}
