/**
 * Integration tests for execute_task MCP Tool
 *
 * Tests the full execution flow including:
 * - Router invocation with correct parameters
 * - Task coordinator lifecycle tracking
 * - Response formatting with completion instructions
 * - Error handling and task release
 * - Optional parameter handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { registerExecuteTaskTool } from '../../src/mcp/tools/tasks/execute-task.js';
import { TaskCoordinator } from '../../src/tasks/coordinator.js';
import type { RouterEngine } from '../../src/router/engine.js';
import type { Logger } from '../../src/observability/logger.js';
import type { AgentResponse } from '../../src/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock logger for testing
 */
const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  }) as unknown as Logger;

/**
 * Create a mock AgentResponse for successful invocations
 */
const createMockAgentResponse = (role: string, text: string): AgentResponse => ({
  role,
  provider: 'openai',
  model: 'gpt-4o',
  content: [{ type: 'text', text }],
  metadata: {
    traceId: 'test-trace-123',
    durationMs: 1500,
  },
  usage: {
    input_tokens: 100,
    output_tokens: 200,
  },
});

/**
 * Create a mock RouterEngine with configurable behavior
 */
const createMockRouterEngine = (
  invokeAgentFn: (input: { role: string; task: string; context?: string }) => Promise<AgentResponse>
): RouterEngine =>
  ({
    invokeAgent: invokeAgentFn,
    listRoles: vi.fn(() => ['coder', 'critic', 'designer', 'researcher', 'reviewer']),
    hasRole: vi.fn((role: string) =>
      ['coder', 'critic', 'designer', 'researcher', 'reviewer'].includes(role)
    ),
  }) as unknown as RouterEngine;

/**
 * Set up MCP server with execute_task tool and return client
 */
async function setupMcpServerAndClient(
  router: RouterEngine,
  coordinator: TaskCoordinator,
  logger: Logger
): Promise<{ server: McpServer; client: Client }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerExecuteTaskTool(server, router, coordinator, logger);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { server, client };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('execute_task Integration Tests', () => {
  let mockLogger: Logger;
  let coordinator: TaskCoordinator;

  beforeEach(() => {
    mockLogger = createMockLogger();
    coordinator = new TaskCoordinator(mockLogger);
  });

  // ==========================================================================
  // Successful Execution Flow
  // ==========================================================================

  describe('Successful Execution Flow', () => {
    it('should call router.invokeAgent with correct role and task', async () => {
      const invokeAgentSpy = vi.fn().mockResolvedValue(
        createMockAgentResponse('coder', 'Implementation complete')
      );
      const router = createMockRouterEngine(invokeAgentSpy);
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-123',
          role: 'coder',
        },
      });

      expect(invokeAgentSpy).toHaveBeenCalledTimes(1);
      expect(invokeAgentSpy).toHaveBeenCalledWith({
        role: 'coder',
        task: 'task-123',
      });
    });

    it('should return formatted response with completion instructions', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Task done successfully'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-456',
          role: 'coder',
        },
      });

      expect(result.content).toHaveLength(1);
      const textContent = result.content[0];
      expect(textContent).toHaveProperty('type', 'text');
      expect(textContent).toHaveProperty('text');

      const responseText = (textContent as { type: string; text: string }).text;

      // Verify header
      expect(responseText).toContain('## Task Execution Complete');

      // Verify metadata
      expect(responseText).toContain('**Task ID:** task-456');
      expect(responseText).toContain('**Role:** coder');
      expect(responseText).toContain('**Provider:** openai');
      expect(responseText).toContain('**Model:** gpt-4o');

      // Verify TaskUpdate instruction for completion
      expect(responseText).toContain('TaskUpdate({ taskId: "task-456", status: "completed" })');

      // Verify agent response content
      expect(responseText).toContain('Task done successfully');
    });

    it('should include TaskUpdate instruction for completed status by default', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('reviewer', 'Code review complete'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-789',
          role: 'reviewer',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;
      expect(responseText).toContain('TaskUpdate({ taskId: "task-789", status: "completed" })');
    });

    it('should track execution in TaskCoordinator', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('designer', 'Design feedback provided'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      // Before execution, no active tasks
      expect(coordinator.hasActiveExecutions()).toBe(false);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-track',
          role: 'designer',
        },
      });

      // After execution, the task should be tracked (may be completed but still in map)
      const execution = coordinator.getExecution('task-track');
      expect(execution).toBeDefined();
      expect(execution?.status).toBe('completed');
      expect(execution?.role).toBe('designer');
    });
  });

  // ==========================================================================
  // Failure Handling
  // ==========================================================================

  describe('Failure Handling', () => {
    it('should return error response when router.invokeAgent throws', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockRejectedValue(new Error('Provider unavailable'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-fail',
          role: 'coder',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;

      expect(responseText).toContain('## Task Execution Failed');
      expect(responseText).toContain('**Task ID:** task-fail');
      expect(responseText).toContain('**Role:** coder');
      expect(responseText).toContain('Provider unavailable');
    });

    it('should include TaskUpdate instruction to release task on failure', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockRejectedValue(new Error('API timeout'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-release',
          role: 'critic',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;
      expect(responseText).toContain(
        'TaskUpdate({ taskId: "task-release", status: "pending", owner: null })'
      );
    });

    it('should log error details on failure', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockRejectedValue(new Error('Rate limit exceeded'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-log-error',
          role: 'researcher',
        },
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'execute_task failed',
        expect.objectContaining({
          taskId: 'task-log-error',
          role: 'researcher',
          errorMessage: 'Rate limit exceeded',
        })
      );
    });

    it('should handle non-Error throws gracefully', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockRejectedValue('String error message')
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-string-error',
          role: 'coder',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;
      expect(responseText).toContain('String error message');
    });
  });

  // ==========================================================================
  // Optional Parameters
  // ==========================================================================

  describe('Optional Parameters', () => {
    it('should pass context to router.invokeAgent when provided', async () => {
      const invokeAgentSpy = vi.fn().mockResolvedValue(
        createMockAgentResponse('coder', 'Done with context')
      );
      const router = createMockRouterEngine(invokeAgentSpy);
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-ctx',
          role: 'coder',
          context: 'This is additional context for the task',
        },
      });

      expect(invokeAgentSpy).toHaveBeenCalledWith({
        role: 'coder',
        task: 'task-ctx',
        context: 'This is additional context for the task',
      });
    });

    it('should not include context in invokeAgent when not provided', async () => {
      const invokeAgentSpy = vi.fn().mockResolvedValue(
        createMockAgentResponse('coder', 'Done without context')
      );
      const router = createMockRouterEngine(invokeAgentSpy);
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-no-ctx',
          role: 'coder',
        },
      });

      expect(invokeAgentSpy).toHaveBeenCalledWith({
        role: 'coder',
        task: 'task-no-ctx',
      });
      // Should not have context key at all
      expect(invokeAgentSpy.mock.calls[0][0]).not.toHaveProperty('context');
    });

    it('should respect autoComplete=false (no completion instruction)', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Task complete'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-manual',
          role: 'coder',
          autoComplete: false,
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;

      // Should NOT contain completion instruction
      expect(responseText).not.toContain('TaskUpdate({ taskId: "task-manual", status: "completed" })');
      // Should contain manual completion message
      expect(responseText).toContain('Manual completion required');
    });

    it('should include completion instruction when autoComplete=true (explicit)', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Task complete'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-auto',
          role: 'coder',
          autoComplete: true,
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;
      expect(responseText).toContain('TaskUpdate({ taskId: "task-auto", status: "completed" })');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle missing role gracefully', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Done'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-no-role',
          // role is not provided
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;

      expect(responseText).toContain('## Error Executing Task');
      expect(responseText).toContain('Role is required');
      expect(responseText).toContain('coder, critic, designer, researcher, or reviewer');
    });

    it('should log warning when role is missing', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Done'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-warn-role',
        },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith('execute_task called without role', {
        taskId: 'task-warn-role',
      });
    });

    it('should handle agent response with multiple content blocks', async () => {
      const multiBlockResponse: AgentResponse = {
        role: 'coder',
        provider: 'openai',
        model: 'gpt-4o',
        content: [
          { type: 'text', text: 'First paragraph of response.' },
          { type: 'text', text: 'Second paragraph of response.' },
          { type: 'tool_use', id: 'tool-1', name: 'some_tool', input: {} },
        ],
        metadata: {
          traceId: 'trace-multi',
          durationMs: 2000,
        },
      };

      const router = createMockRouterEngine(vi.fn().mockResolvedValue(multiBlockResponse));
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-multi',
          role: 'coder',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;

      // Should include both text blocks
      expect(responseText).toContain('First paragraph of response.');
      expect(responseText).toContain('Second paragraph of response.');
      // Should not include tool_use blocks (filtered out)
    });

    it('should handle empty task ID', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Done'))
      );

      // The server validates empty strings via zod schema
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      // Empty taskId should return validation error (MCP returns error response, not rejection)
      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: '',
          role: 'coder',
        },
      });

      // MCP SDK returns isError: true for validation failures
      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as { type: string; text: string }).text;
      expect(errorText).toContain('validation error');
      expect(errorText).toContain('taskId');
    });

    it('should log execution lifecycle events', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Done'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-log-lifecycle',
          role: 'coder',
        },
      });

      // Should log the start
      expect(mockLogger.info).toHaveBeenCalledWith(
        'execute_task called',
        expect.objectContaining({
          taskId: 'task-log-lifecycle',
          role: 'coder',
        })
      );

      // Should log completion
      expect(mockLogger.info).toHaveBeenCalledWith(
        'execute_task completed',
        expect.objectContaining({
          taskId: 'task-log-lifecycle',
          role: 'coder',
          provider: 'openai',
          model: 'gpt-4o',
        })
      );
    });

    it('should include duration in response', async () => {
      const router = createMockRouterEngine(
        vi.fn().mockResolvedValue(createMockAgentResponse('coder', 'Done'))
      );
      const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

      const result = await client.callTool({
        name: 'execute_task',
        arguments: {
          taskId: 'task-duration',
          role: 'coder',
        },
      });

      const responseText = (result.content[0] as { type: string; text: string }).text;

      // Should contain duration field (with some number of ms)
      expect(responseText).toMatch(/\*\*Duration:\*\* \d+ms/);
    });
  });

  // ==========================================================================
  // Role Validation
  // ==========================================================================

  describe('Role Validation', () => {
    it.each(['coder', 'critic', 'designer', 'researcher', 'reviewer'] as const)(
      'should accept valid role: %s',
      async (role) => {
        const invokeAgentSpy = vi.fn().mockResolvedValue(
          createMockAgentResponse(role, `${role} response`)
        );
        const router = createMockRouterEngine(invokeAgentSpy);
        const { client } = await setupMcpServerAndClient(router, coordinator, mockLogger);

        const result = await client.callTool({
          name: 'execute_task',
          arguments: {
            taskId: `task-${role}`,
            role,
          },
        });

        expect(invokeAgentSpy).toHaveBeenCalledTimes(1);
        const responseText = (result.content[0] as { type: string; text: string }).text;
        expect(responseText).toContain('## Task Execution Complete');
      }
    );
  });
});
