/**
 * design_feedback MCP Tool
 *
 * Convenience tool for getting UI/UX design feedback on components,
 * layouts, or user flows. This is a shorthand for invoking the
 * designer role with a structured design review task.
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
 * Design review types supported by this tool
 */
const DESIGN_REVIEW_TYPES = ["component", "layout", "flow", "accessibility"] as const;

/**
 * Tool description for design_feedback
 */
const TOOL_DESCRIPTION =
  "Get UI/UX design feedback on components, layouts, or user flows. Use this to get expert design critique and improvement suggestions from the designer agent.";

// ============================================================================
// Input Schema
// ============================================================================

/**
 * Zod schema shape for design_feedback input validation.
 * Uses raw shape format as expected by MCP SDK's registerTool.
 */
const designFeedbackInputSchemaShape = {
  design: z
    .string()
    .min(1)
    .describe("Description of the design, component, or user flow to review"),
  type: z
    .enum(DESIGN_REVIEW_TYPES)
    .optional()
    .describe(
      "Type of design review: 'component' for UI components, 'layout' for page layouts, 'flow' for user flows, 'accessibility' for a11y review"
    ),
  context: z
    .string()
    .optional()
    .describe("Additional context such as target users, platform, or design constraints"),
};

/**
 * Interface for validated design_feedback input
 */
interface DesignFeedbackInput {
  design: string;
  type?: (typeof DESIGN_REVIEW_TYPES)[number];
  context?: string;
}

// ============================================================================
// Task Builder
// ============================================================================

/**
 * Builds a structured task string for the designer agent
 *
 * @param input - Validated design feedback input
 * @returns Formatted task string for the designer role
 */
function buildDesignTask(input: DesignFeedbackInput): string {
  const typeLabel = input.type ?? "general";
  const typeDescriptions: Record<string, string> = {
    component: "UI component",
    layout: "page layout",
    flow: "user flow",
    accessibility: "accessibility (a11y)",
    general: "design",
  };

  const reviewType = typeDescriptions[typeLabel] ?? "design";

  let task = `Please provide a detailed ${reviewType} review for the following:\n\n${input.design}`;

  if (input.type === "accessibility") {
    task += `\n\nFocus your review on:
- WCAG compliance (AA or AAA)
- Screen reader compatibility
- Keyboard navigation
- Color contrast and visual accessibility
- Focus states and indicators
- Accessible naming and labels`;
  } else if (input.type === "component") {
    task += `\n\nFocus your review on:
- Visual hierarchy and composition
- Interaction patterns and states
- Consistency with design system principles
- Responsive behavior
- Edge cases and error states`;
  } else if (input.type === "layout") {
    task += `\n\nFocus your review on:
- Visual hierarchy and information architecture
- Spacing, alignment, and grid usage
- Responsive design considerations
- Content prioritization
- Navigation patterns`;
  } else if (input.type === "flow") {
    task += `\n\nFocus your review on:
- User journey clarity
- Number of steps and cognitive load
- Error handling and recovery paths
- Progressive disclosure
- Call-to-action effectiveness`;
  }

  return task;
}

// ============================================================================
// Response Formatter
// ============================================================================

/**
 * Formats an AgentResponse for MCP text output
 *
 * @param response - The response from the agent invocation
 * @param reviewType - The type of design review performed
 * @returns Formatted string with header, metadata, and content
 */
function formatDesignFeedbackResponse(
  response: AgentResponse,
  reviewType: string | undefined
): string {
  const typeLabel = reviewType !== undefined && reviewType !== "" ? ` (${reviewType})` : "";
  const header = `## Design Feedback${typeLabel}\n`;
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
 * Registers the design_feedback tool with the MCP server
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for agent invocation
 * @param logger - Logger instance for structured logging
 *
 * @example
 * ```typescript
 * const server = new McpServer({ name: 'agent-router', version: '0.1.0' });
 * const router = new RouterEngine(config, providers, logger);
 * registerDesignFeedbackTool(server, router, logger);
 * ```
 */
export function registerDesignFeedbackTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  // Use type assertion to work around Zod version compatibility issues
  // between zod 3.25+ and the MCP SDK's ZodRawShapeCompat type
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
  const inputSchema: any = designFeedbackInputSchemaShape;

  server.registerTool(
    "design_feedback",
    {
      title: "Design Feedback",
      description: TOOL_DESCRIPTION,
      inputSchema,
    },
    /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
    async (args: unknown) => {
      // Type-safe access with explicit casting after validation
      const { design, type, context } = args as DesignFeedbackInput;

      logger.info("design_feedback called", {
        reviewType: type ?? "general",
        designLength: design.length,
        hasContext: context !== undefined,
      });

      try {
        const startTime = Date.now();

        // Build input object, only including optional properties if defined
        // (required by exactOptionalPropertyTypes)
        const buildInput: DesignFeedbackInput = { design };
        if (type !== undefined) {
          buildInput.type = type;
        }
        if (context !== undefined) {
          buildInput.context = context;
        }

        // Build the task string for the designer agent
        const task = buildDesignTask(buildInput);

        // Invoke the designer role with optional context
        const invokeInput = context !== undefined
          ? { role: "designer", task, context }
          : { role: "designer", task };

        const response = await router.invokeAgent(invokeInput);
        const durationMs = Date.now() - startTime;

        logger.info("design_feedback completed", {
          reviewType: type ?? "general",
          provider: response.provider,
          model: response.model,
          durationMs,
          traceId: response.metadata.traceId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: formatDesignFeedbackResponse(response, type),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Only pass error to logger if it's an Error instance
        if (error instanceof Error) {
          logger.error("design_feedback failed", {
            reviewType: type ?? "general",
            error,
            errorMessage,
          });
        } else {
          logger.error("design_feedback failed", {
            reviewType: type ?? "general",
            errorMessage,
          });
        }

        // Return error as text content for MCP compatibility
        return {
          content: [
            {
              type: "text" as const,
              text: `## Error Getting Design Feedback\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered design_feedback tool", { reviewTypes: DESIGN_REVIEW_TYPES });
}
