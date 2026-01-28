/**
 * Integration tests for Task Tools
 *
 * Tests the task-related MCP tools integration including:
 * - Tool registration with MCP server
 * - create_routed_task output format
 * - execute_pipeline DAG validation and phase computation
 * - claim_next_task instruction generation
 * - get_pipeline_status error handling and status display
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerTools } from '../../src/mcp/tools/index.js';
import { TaskCoordinator } from '../../src/tasks/coordinator.js';
import { PipelineManager } from '../../src/tasks/pipeline-manager.js';
import type { Logger } from '../../src/observability/logger.js';
import type { RouterEngine } from '../../src/router/engine.js';
import type { AgentConfig, Config, AgentResponse } from '../../src/types.js';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Creates a mock Logger with all methods as vi.fn()
 */
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

/**
 * Creates a mock RouterEngine with configurable roles
 */
function createMockRouterEngine(roles: string[] = ['coder', 'critic', 'reviewer']): RouterEngine {
  const agentConfigs: Record<string, AgentConfig> = {
    coder: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      max_tokens: 4096,
      timeout_ms: 60000,
    },
    critic: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: 4096,
      timeout_ms: 60000,
    },
    reviewer: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0.5,
      max_tokens: 4096,
      timeout_ms: 60000,
    },
  };

  return {
    listRoles: vi.fn(() => roles),
    hasRole: vi.fn((role: string) => roles.includes(role)),
    resolveRole: vi.fn((role: string) => {
      const config = agentConfigs[role];
      if (!config) {
        throw new Error(`Unknown role: ${role}`);
      }
      return config;
    }),
    invokeAgent: vi.fn(async () => ({
      role: 'coder',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text' as const, text: 'Mock response' }],
      metadata: { traceId: 'trace-123', durationMs: 100 },
    })),
    updateConfig: vi.fn(),
    compareAgents: vi.fn(),
  } as unknown as RouterEngine;
}

/**
 * Tracks registered tools from McpServer
 */
interface RegisteredTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema: unknown;
  };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Creates a mock McpServer that captures registered tools
 */
function createMockMcpServer(): { server: McpServer; registeredTools: Map<string, RegisteredTool> } {
  const registeredTools = new Map<string, RegisteredTool>();

  const server = {
    registerTool: vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      registeredTools.set(name, { name, config, handler });
    }),
  } as unknown as McpServer;

  return { server, registeredTools };
}

// ============================================================================
// Tool Registration Tests
// ============================================================================

describe('Task Tools Registration', () => {
  let mockLogger: Logger;
  let mockRouter: RouterEngine;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRouter = createMockRouterEngine();
  });

  describe('when taskCoordinator and pipelineManager are provided', () => {
    it('should register all 5 task tools', () => {
      const { server, registeredTools } = createMockMcpServer();
      const coordinator = new TaskCoordinator(mockLogger);
      const pipelineManager = new PipelineManager(mockLogger);

      registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);

      // Verify task tools are registered
      expect(registeredTools.has('execute_task')).toBe(true);
      expect(registeredTools.has('create_routed_task')).toBe(true);
      expect(registeredTools.has('execute_pipeline')).toBe(true);
      expect(registeredTools.has('claim_next_task')).toBe(true);
      expect(registeredTools.has('get_pipeline_status')).toBe(true);
    });

    it('should also register core tools', () => {
      const { server, registeredTools } = createMockMcpServer();
      const coordinator = new TaskCoordinator(mockLogger);
      const pipelineManager = new PipelineManager(mockLogger);

      registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);

      // Verify core tools are also registered
      expect(registeredTools.has('invoke_agent')).toBe(true);
      expect(registeredTools.has('list_agents')).toBe(true);
      expect(registeredTools.has('compare_agents')).toBe(true);
    });
  });

  describe('when taskCoordinator and pipelineManager are undefined', () => {
    it('should NOT register task tools', () => {
      const { server, registeredTools } = createMockMcpServer();

      registerTools(server, mockRouter, mockLogger, undefined, undefined);

      // Task tools should NOT be registered
      expect(registeredTools.has('execute_task')).toBe(false);
      expect(registeredTools.has('create_routed_task')).toBe(false);
      expect(registeredTools.has('execute_pipeline')).toBe(false);
      expect(registeredTools.has('claim_next_task')).toBe(false);
      expect(registeredTools.has('get_pipeline_status')).toBe(false);
    });

    it('should still register core tools', () => {
      const { server, registeredTools } = createMockMcpServer();

      registerTools(server, mockRouter, mockLogger, undefined, undefined);

      // Core tools should still be registered
      expect(registeredTools.has('invoke_agent')).toBe(true);
      expect(registeredTools.has('list_agents')).toBe(true);
      expect(registeredTools.has('compare_agents')).toBe(true);
    });
  });
});

// ============================================================================
// create_routed_task Integration Tests
// ============================================================================

describe('create_routed_task Integration', () => {
  let mockLogger: Logger;
  let mockRouter: RouterEngine;
  let registeredTools: Map<string, RegisteredTool>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRouter = createMockRouterEngine();
    const { server, registeredTools: tools } = createMockMcpServer();
    registeredTools = tools;

    const coordinator = new TaskCoordinator(mockLogger);
    const pipelineManager = new PipelineManager(mockLogger);
    registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);
  });

  it('should return TaskCreate instruction string with correct format', async () => {
    const tool = registeredTools.get('create_routed_task');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      subject: 'Implement user authentication',
      role: 'coder',
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    expect(text).toContain('## Create Routed Task');
    expect(text).toContain('TaskCreate({');
    expect(text).toContain('subject: "Implement user authentication"');
    expect(text).toContain('activeForm: "Awaiting coder agent..."');
  });

  it('should include agentRouter metadata', async () => {
    const tool = registeredTools.get('create_routed_task');

    const result = await tool!.handler({
      subject: 'Review code changes',
      role: 'reviewer',
    });

    const text = result.content[0].text;
    expect(text).toContain('agentRouter: true');
    expect(text).toContain('role: "reviewer"');
  });

  it('should include blockedBy when provided', async () => {
    const tool = registeredTools.get('create_routed_task');

    const result = await tool!.handler({
      subject: 'Test implementation',
      role: 'coder',
      blockedBy: ['task-1', 'task-2'],
    });

    const text = result.content[0].text;
    expect(text).toContain('blockedBy:');
    expect(text).toContain('"task-1"');
    expect(text).toContain('"task-2"');
  });

  it('should include description when provided', async () => {
    const tool = registeredTools.get('create_routed_task');

    const result = await tool!.handler({
      subject: 'Build feature',
      description: 'Implement the new dashboard feature with charts',
      role: 'coder',
    });

    const text = result.content[0].text;
    expect(text).toContain('description: "Implement the new dashboard feature with charts"');
  });

  it('should include priority when provided', async () => {
    const tool = registeredTools.get('create_routed_task');

    const result = await tool!.handler({
      subject: 'Critical fix',
      role: 'coder',
      priority: 1,
    });

    const text = result.content[0].text;
    expect(text).toContain('priority: 1');
  });

  it('should include execute_task guidance after TaskCreate', async () => {
    const tool = registeredTools.get('create_routed_task');

    const result = await tool!.handler({
      subject: 'Test task',
      role: 'critic',
    });

    const text = result.content[0].text;
    expect(text).toContain('execute_task({ taskId: <new_id>, role: "critic" })');
  });
});

// ============================================================================
// execute_pipeline Integration Tests
// ============================================================================

describe('execute_pipeline Integration', () => {
  let mockLogger: Logger;
  let mockRouter: RouterEngine;
  let registeredTools: Map<string, RegisteredTool>;
  let pipelineManager: PipelineManager;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRouter = createMockRouterEngine();
    const { server, registeredTools: tools } = createMockMcpServer();
    registeredTools = tools;

    const coordinator = new TaskCoordinator(mockLogger);
    pipelineManager = new PipelineManager(mockLogger);
    registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);
  });

  describe('DAG validation', () => {
    it('should reject pipelines with cycles', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'cyclic-pipeline',
        steps: [
          { name: 'step-a', subject: 'Step A', role: 'coder', dependsOn: ['step-b'] },
          { name: 'step-b', subject: 'Step B', role: 'reviewer', dependsOn: ['step-a'] },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('Error Creating Pipeline');
      expect(text).toContain('circular dependencies');
    });

    it('should reject pipelines with missing dependencies', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'invalid-pipeline',
        steps: [
          { name: 'step-a', subject: 'Step A', role: 'coder', dependsOn: ['nonexistent'] },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('Error Creating Pipeline');
      expect(text).toContain('unknown step');
    });

    it('should reject pipelines with duplicate step names', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'duplicate-pipeline',
        steps: [
          { name: 'step-a', subject: 'First Step A', role: 'coder' },
          { name: 'step-a', subject: 'Duplicate Step A', role: 'reviewer' },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('Error Creating Pipeline');
      expect(text).toContain('duplicate');
    });
  });

  describe('phase computation', () => {
    it('should compute correct phases for linear pipeline', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'linear-pipeline',
        steps: [
          { name: 'step-1', subject: 'First step', role: 'coder' },
          { name: 'step-2', subject: 'Second step', role: 'reviewer', dependsOn: ['step-1'] },
          { name: 'step-3', subject: 'Third step', role: 'critic', dependsOn: ['step-2'] },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('## Execution Plan');
      expect(text).toContain('**Total Phases**: 3');
      expect(text).toContain('### Phase 1');
      expect(text).toContain('### Phase 2');
      expect(text).toContain('### Phase 3');
    });

    it('should compute correct phases for diamond pattern', async () => {
      const tool = registeredTools.get('execute_pipeline');

      // Diamond pattern:
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const result = await tool!.handler({
        name: 'diamond-pipeline',
        steps: [
          { name: 'step-a', subject: 'Start', role: 'coder' },
          { name: 'step-b', subject: 'Branch B', role: 'reviewer', dependsOn: ['step-a'] },
          { name: 'step-c', subject: 'Branch C', role: 'critic', dependsOn: ['step-a'] },
          { name: 'step-d', subject: 'Merge', role: 'coder', dependsOn: ['step-b', 'step-c'] },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('## Execution Plan');
      expect(text).toContain('**Total Phases**: 3');
      // Phase 1: step-a
      // Phase 2: step-b, step-c (parallel)
      // Phase 3: step-d
      expect(text).toContain('2 steps in parallel');
    });

    it('should handle independent parallel steps', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'parallel-pipeline',
        steps: [
          { name: 'step-a', subject: 'Independent A', role: 'coder' },
          { name: 'step-b', subject: 'Independent B', role: 'reviewer' },
          { name: 'step-c', subject: 'Independent C', role: 'critic' },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('**Total Phases**: 1');
      expect(text).toContain('3 steps in parallel');
    });
  });

  describe('TaskCreate instructions', () => {
    it('should return TaskCreate instructions for all steps', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'test-pipeline',
        steps: [
          { name: 'step-1', subject: 'First step', role: 'coder' },
          { name: 'step-2', subject: 'Second step', role: 'reviewer', dependsOn: ['step-1'] },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('## TaskCreate Instructions');
      expect(text).toContain('TaskCreate({');
      expect(text).toContain('subject: "First step"');
      expect(text).toContain('subject: "Second step"');
    });

    it('should include pipeline metadata in TaskCreate', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'metadata-pipeline',
        steps: [
          { name: 'my-step', subject: 'Test step', role: 'coder' },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('"pipeline":"metadata-pipeline"');
      expect(text).toContain('"stepName":"my-step"');
      expect(text).toContain('"role":"coder"');
    });

    it('should include blockedBy references for dependent steps', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'deps-pipeline',
        steps: [
          { name: 'step-1', subject: 'First', role: 'coder' },
          { name: 'step-2', subject: 'Second', role: 'reviewer', dependsOn: ['step-1'] },
        ],
      });

      const text = result.content[0].text;
      // The second step should have blockedBy referencing step-1's index (1)
      expect(text).toContain('blockedBy: ["1"]');
    });
  });

  describe('pipeline ID tracking', () => {
    it('should return pipeline ID in response', async () => {
      const tool = registeredTools.get('execute_pipeline');

      const result = await tool!.handler({
        name: 'tracked-pipeline',
        steps: [
          { name: 'step-1', subject: 'Test', role: 'coder' },
        ],
      });

      const text = result.content[0].text;
      expect(text).toContain('**Pipeline ID**:');
    });
  });
});

// ============================================================================
// claim_next_task Integration Tests
// ============================================================================

describe('claim_next_task Integration', () => {
  let mockLogger: Logger;
  let mockRouter: RouterEngine;
  let registeredTools: Map<string, RegisteredTool>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRouter = createMockRouterEngine();
    const { server, registeredTools: tools } = createMockMcpServer();
    registeredTools = tools;

    const coordinator = new TaskCoordinator(mockLogger);
    const pipelineManager = new PipelineManager(mockLogger);
    registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);
  });

  it('should return markdown protocol instructions', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
    });

    const text = result.content[0].text;
    expect(text).toContain('## Claim Next Task');
    expect(text).toContain('### Search Criteria');
    expect(text).toContain('### Instructions');
    expect(text).toContain('Worker: worker-1');
  });

  it('should include TaskList instruction', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
    });

    const text = result.content[0].text;
    expect(text).toContain('TaskList()');
  });

  it('should include TaskUpdate claim instruction', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'test-worker',
    });

    const text = result.content[0].text;
    expect(text).toContain('TaskUpdate({');
    expect(text).toContain('status: "in_progress"');
    expect(text).toContain('owner: "test-worker"');
  });

  it('should include role filter when provided', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
      roles: ['coder', 'reviewer'],
    });

    const text = result.content[0].text;
    expect(text).toContain('Roles: coder, reviewer');
    expect(text).toContain('metadata.role IN ["coder", "reviewer"]');
  });

  it('should include excludeTaskIds when provided', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
      excludeTaskIds: ['task-123', 'task-456'],
    });

    const text = result.content[0].text;
    expect(text).toContain('id NOT IN [task-123, task-456]');
  });

  it('should include execute_task instruction', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
    });

    const text = result.content[0].text;
    expect(text).toContain('execute_task({ taskId: <found_id> })');
  });

  it('should include priority strategy description', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
      priority: 'highest',
    });

    const text = result.content[0].text;
    expect(text).toContain('Priority: highest');
    expect(text).toContain('highest priority value first');
  });

  it('should default to fifo priority', async () => {
    const tool = registeredTools.get('claim_next_task');

    const result = await tool!.handler({
      workerName: 'worker-1',
    });

    const text = result.content[0].text;
    expect(text).toContain('Priority: fifo');
    expect(text).toContain('first in, first out');
  });
});

// ============================================================================
// get_pipeline_status Integration Tests
// ============================================================================

describe('get_pipeline_status Integration', () => {
  let mockLogger: Logger;
  let mockRouter: RouterEngine;
  let registeredTools: Map<string, RegisteredTool>;
  let pipelineManager: PipelineManager;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRouter = createMockRouterEngine();
    const { server, registeredTools: tools } = createMockMcpServer();
    registeredTools = tools;

    const coordinator = new TaskCoordinator(mockLogger);
    pipelineManager = new PipelineManager(mockLogger);
    registerTools(server, mockRouter, mockLogger, coordinator, pipelineManager);
  });

  it('should return error for unknown pipeline', async () => {
    const tool = registeredTools.get('get_pipeline_status');

    const result = await tool!.handler({
      pipelineName: 'nonexistent-pipeline',
    });

    const text = result.content[0].text;
    expect(text).toContain('Pipeline Not Found');
    expect(text).toContain('nonexistent-pipeline');
  });

  it('should return status table for active pipeline', async () => {
    // First create a pipeline via execute_pipeline
    const executeTool = registeredTools.get('execute_pipeline');
    await executeTool!.handler({
      name: 'active-pipeline',
      steps: [
        { name: 'step-1', subject: 'First step', role: 'coder' },
        { name: 'step-2', subject: 'Second step', role: 'reviewer', dependsOn: ['step-1'] },
      ],
    });

    // Now get its status
    const statusTool = registeredTools.get('get_pipeline_status');
    const result = await statusTool!.handler({
      pipelineName: 'active-pipeline',
    });

    const text = result.content[0].text;
    expect(text).toContain('## Pipeline Status: active-pipeline');
    expect(text).toContain('### Step Status');
    expect(text).toContain('| Step | Role | Status | Provider | Duration |');
    expect(text).toContain('step-1');
    expect(text).toContain('step-2');
  });

  it('should show dependency graph', async () => {
    // Create a pipeline with dependencies
    const executeTool = registeredTools.get('execute_pipeline');
    await executeTool!.handler({
      name: 'graph-pipeline',
      steps: [
        { name: 'start', subject: 'Start', role: 'coder' },
        { name: 'middle', subject: 'Middle', role: 'reviewer', dependsOn: ['start'] },
        { name: 'end', subject: 'End', role: 'critic', dependsOn: ['middle'] },
      ],
    });

    const statusTool = registeredTools.get('get_pipeline_status');
    const result = await statusTool!.handler({
      pipelineName: 'graph-pipeline',
    });

    const text = result.content[0].text;
    expect(text).toContain('### Dependency Graph');
  });

  it('should show progress percentage', async () => {
    const executeTool = registeredTools.get('execute_pipeline');
    await executeTool!.handler({
      name: 'progress-pipeline',
      steps: [
        { name: 'step-1', subject: 'First', role: 'coder' },
        { name: 'step-2', subject: 'Second', role: 'reviewer' },
      ],
    });

    const statusTool = registeredTools.get('get_pipeline_status');
    const result = await statusTool!.handler({
      pipelineName: 'progress-pipeline',
    });

    const text = result.content[0].text;
    expect(text).toContain('0/2 steps complete (0%)');
  });

  it('should list active pipelines when querying unknown pipeline', async () => {
    // Create a known pipeline first
    const executeTool = registeredTools.get('execute_pipeline');
    await executeTool!.handler({
      name: 'known-pipeline',
      steps: [
        { name: 'step-1', subject: 'Test', role: 'coder' },
      ],
    });

    // Query for unknown pipeline
    const statusTool = registeredTools.get('get_pipeline_status');
    const result = await statusTool!.handler({
      pipelineName: 'unknown-pipeline',
    });

    const text = result.content[0].text;
    expect(text).toContain('Pipeline Not Found');
    expect(text).toContain('Active pipelines:');
    expect(text).toContain('known-pipeline');
  });
});
