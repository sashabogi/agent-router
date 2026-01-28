/**
 * Task Tools Index
 *
 * Exports all task-related MCP tool registration functions.
 * These tools enable Claude Code task integration with AgentRouter.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Logger } from "../../../observability/logger.js";
import type { RouterEngine } from "../../../router/engine.js";
import type { TaskCoordinator } from "../../../tasks/coordinator.js";
import type { PipelineManager } from "../../../tasks/pipeline-manager.js";

import { registerClaimNextTaskTool } from "./claim-next-task.js";
import { registerCreateRoutedTaskTool } from "./create-routed-task.js";
import { registerExecutePipelineTool } from "./execute-pipeline.js";
import { registerExecuteTaskTool } from "./execute-task.js";
import { registerGetPipelineStatusTool } from "./get-pipeline-status.js";

// ============================================================================
// Convenience Registration
// ============================================================================

/**
 * Registers all task-related tools with the MCP server.
 *
 * Tools registered:
 * - execute_task: Execute a Claude Code task using AgentRouter
 * - create_routed_task: Generate TaskCreate instructions for routed tasks
 * - execute_pipeline: Create multi-provider task pipelines with dependency resolution
 * - claim_next_task: Generate instructions for workers to claim available tasks
 * - get_pipeline_status: Query the execution status of a pipeline
 *
 * @param server - The MCP server instance
 * @param router - The router engine for agent invocation
 * @param coordinator - TaskCoordinator for task lifecycle management
 * @param pipelineManager - PipelineManager for pipeline validation and execution
 * @param logger - Logger for tool operations
 */
export function registerTaskTools(
  server: McpServer,
  router: RouterEngine,
  coordinator: TaskCoordinator,
  pipelineManager: PipelineManager,
  logger: Logger
): void {
  logger.info("Registering task tools");

  // Register execute_task tool
  registerExecuteTaskTool(server, router, coordinator, logger);

  // Register create_routed_task tool
  registerCreateRoutedTaskTool(server, logger);

  // Register execute_pipeline tool
  registerExecutePipelineTool(server, pipelineManager, logger);

  // Register claim_next_task tool
  registerClaimNextTaskTool(server, logger);

  // Register get_pipeline_status tool
  registerGetPipelineStatusTool(server, pipelineManager, logger);

  logger.info("Task tools registered successfully", {
    tools: [
      "execute_task",
      "create_routed_task",
      "execute_pipeline",
      "claim_next_task",
      "get_pipeline_status",
    ],
  });
}

// ============================================================================
// Exports
// ============================================================================

export { registerExecuteTaskTool } from "./execute-task.js";
export { registerCreateRoutedTaskTool } from "./create-routed-task.js";
export { registerExecutePipelineTool } from "./execute-pipeline.js";
export { registerClaimNextTaskTool } from "./claim-next-task.js";
export { registerGetPipelineStatusTool } from "./get-pipeline-status.js";
