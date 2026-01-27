/**
 * MCP Tool Registry
 *
 * Registers all AgentRouter tools with the MCP server.
 * Each tool provides access to specialized agent capabilities.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCompareAgentsTool } from "./compare-agents.js";
import { registerCritiquePlanTool } from "./critique-plan.js";
import { registerDesignFeedbackTool } from "./design-feedback.js";
import { registerInvokeAgentTool } from "./invoke-agent.js";
import { registerReviewCodeTool } from "./review-code.js";

import type { Logger } from "../../observability/logger.js";
import type { RouterEngine } from "../../router/engine.js";

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers all AgentRouter tools with the MCP server.
 *
 * Tools registered:
 * - invoke_agent: Invoke a specialized agent by role
 * - list_agents: List all available agent roles
 * - compare_agents: Run same task through multiple agents
 * - review_code: Get code review feedback
 * - design_feedback: Get UI/UX design feedback
 * - critique_plan: Get critical feedback on plans (shorthand for critic role)
 *
 * @param server - The MCP server instance
 * @param router - The router engine for agent invocation
 * @param logger - Logger for tool operations
 */
export function registerTools(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  logger.info("Registering AgentRouter tools");

  // Register invoke_agent tool
  registerInvokeAgentTool(server, router, logger);

  // Register list_agents tool
  registerListAgentsTool(server, router, logger);

  // Register compare_agents tool
  registerCompareAgentsTool(server, router, logger);

  // Register review_code tool
  registerReviewCodeTool(server, router, logger);

  // Register design_feedback tool
  registerDesignFeedbackTool(server, router, logger);

  // Register critique_plan tool
  registerCritiquePlanTool(server, router, logger);

  logger.info("AgentRouter tools registered successfully", {
    tools: [
      "invoke_agent",
      "list_agents",
      "compare_agents",
      "review_code",
      "design_feedback",
      "critique_plan",
    ],
  });
}

// ============================================================================
// list_agents Tool Implementation
// ============================================================================

/**
 * Registers the list_agents tool.
 *
 * This tool returns a list of all available agent roles with their
 * configurations, including provider, model, and fallback status.
 *
 * @param server - MCP server instance
 * @param router - RouterEngine for role information
 * @param logger - Logger instance for structured logging
 */
function registerListAgentsTool(
  server: McpServer,
  router: RouterEngine,
  logger: Logger
): void {
  server.registerTool(
    "list_agents",
    {
      title: "List Agents",
      description:
        "List all available agent roles and their configurations. " +
        "Returns role names, providers, models, and whether fallbacks are configured.",
      inputSchema: {},
    },
    async () => {
      logger.debug("Executing list_agents tool");

      try {
        // Get role information from the router
        const roles = router.listRoles();
        const roleConfigs = roles.map((roleName) => {
          const config = router.resolveRole(roleName);
          return {
            name: roleName,
            provider: config.provider,
            model: config.model,
            hasFallback: !!config.fallback,
            description: getRoleDescription(roleName),
          };
        });

        logger.debug("list_agents completed", { roleCount: roles.length });

        // Format the response as readable text
        const formattedList = roleConfigs
          .map(
            (role) =>
              `- **${role.name}**: ${role.description}\n` +
              `  Provider: ${role.provider} | Model: ${role.model}` +
              (role.hasFallback ? " | Fallback: configured" : "")
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text:
                `# Available Agent Roles\n\n${formattedList}\n\n` +
                `---\n*Total: ${roles.length} agents configured*`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error("list_agents failed", { errorMessage });

        return {
          content: [
            {
              type: "text",
              text: `## Error Listing Agents\n\n${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  logger.debug("Registered list_agents tool");
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a human-readable description for a role.
 * These are predefined descriptions for the standard roles.
 */
function getRoleDescription(role: string): string {
  const descriptions: Record<string, string> = {
    coder:
      "Expert software engineer for code generation and implementation tasks",
    critic:
      "Skeptical senior architect for reviewing plans and challenging assumptions",
    designer:
      "UI/UX specialist for design feedback and user experience evaluation",
    researcher:
      "Research specialist for fact-finding and information gathering",
    reviewer: "Code review expert for quality, security, and best practices",
  };

  return descriptions[role] ?? "Custom agent role";
}

// ============================================================================
// Exports
// ============================================================================

export { registerInvokeAgentTool } from "./invoke-agent.js";
export { registerCompareAgentsTool } from "./compare-agents.js";
export { registerCritiquePlanTool } from "./critique-plan.js";
export { registerDesignFeedbackTool } from "./design-feedback.js";
export { registerReviewCodeTool } from "./review-code.js";
