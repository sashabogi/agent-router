/**
 * Integration tests for Pipeline Flow
 *
 * Tests end-to-end pipeline execution through:
 * - execute_pipeline tool creating PipelineExecution
 * - PipelineManager step completion and status tracking
 * - get_pipeline_status tool querying execution state
 *
 * These tests verify the integration between MCP tools and PipelineManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineManager } from '../../src/tasks/pipeline-manager.js';
import type {
  PipelineDefinition,
  PipelineStep,
  AgentResponse,
} from '../../src/types.js';
import type { Logger } from '../../src/observability/logger.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock logger for tests
 */
const createMockLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
});

/**
 * Create a pipeline step
 */
const createStep = (
  name: string,
  options: {
    dependsOn?: string[];
    role?: string;
    subject?: string;
    description?: string;
    context?: string;
  } = {}
): PipelineStep => ({
  name,
  subject: options.subject ?? `Execute ${name}`,
  description: options.description ?? `Description for ${name}`,
  role: options.role ?? 'coder',
  dependsOn: options.dependsOn,
  context: options.context,
});

/**
 * Create a pipeline definition
 */
const createDefinition = (
  steps: PipelineStep[],
  options: { name?: string; globalContext?: string } = {}
): PipelineDefinition => ({
  name: options.name ?? 'test-pipeline',
  steps,
  globalContext: options.globalContext,
});

/**
 * Create a mock agent response
 */
const createAgentResponse = (
  role: string,
  text: string,
  durationMs = 100
): AgentResponse => ({
  role,
  provider: 'test-provider',
  model: 'test-model',
  content: [{ type: 'text', text }],
  metadata: {
    traceId: `trace-${Date.now()}`,
    durationMs,
  },
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Pipeline Flow Integration', () => {
  let manager: PipelineManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    manager = new PipelineManager(mockLogger);
  });

  describe('End-to-End Pipeline Flow', () => {
    it('should create pipeline, complete steps, and track status correctly', () => {
      // 1. Create pipeline with execute_pipeline-like flow
      const definition = createDefinition([
        createStep('research', { role: 'researcher' }),
        createStep('implement', { role: 'coder', dependsOn: ['research'] }),
        createStep('review', { role: 'reviewer', dependsOn: ['implement'] }),
      ]);

      // 2. Validate and create execution (simulates execute_pipeline)
      manager.validateDefinition(definition);
      const execution = manager.createExecution(definition);

      expect(execution.pipelineId).toBeDefined();
      expect(execution.status).toBe('pending');
      expect(execution.completedSteps.size).toBe(0);

      // 3. Register task IDs (simulates Claude creating tasks)
      const taskIdMap = new Map([
        ['research', 'task-1'],
        ['implement', 'task-2'],
        ['review', 'task-3'],
      ]);
      manager.registerTaskIds(execution.pipelineId, taskIdMap);

      expect(execution.status).toBe('running');

      // 4. Verify initial ready steps
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['research']);

      // 5. Complete research step
      manager.completeStep(
        execution.pipelineId,
        'research',
        createAgentResponse('researcher', 'Research findings: ...')
      );

      expect(execution.completedSteps.has('research')).toBe(true);
      expect(execution.results.has('research')).toBe(true);

      // 6. Verify implement is now ready
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['implement']);

      // 7. Complete implement step
      manager.completeStep(
        execution.pipelineId,
        'implement',
        createAgentResponse('coder', 'Implementation complete')
      );

      // 8. Verify review is now ready
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['review']);

      // 9. Complete review step
      manager.completeStep(
        execution.pipelineId,
        'review',
        createAgentResponse('reviewer', 'LGTM')
      );

      // 10. Verify pipeline is complete
      expect(execution.status).toBe('completed');
      expect(execution.completedSteps.size).toBe(3);
      expect(manager.getReadySteps(execution)).toEqual([]);

      // 11. Query status (simulates get_pipeline_status)
      const retrievedExecution = manager.getExecution(execution.pipelineId);
      expect(retrievedExecution).toBe(execution);
      expect(retrievedExecution?.status).toBe('completed');
    });

    it('should be queryable via getActiveExecutions during execution', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', { dependsOn: ['step1'] }),
      ]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([
        ['step1', 'task-1'],
        ['step2', 'task-2'],
      ]));

      // Should be in active executions while running
      let active = manager.getActiveExecutions();
      expect(active).toContain(execution);

      // Complete all steps
      manager.completeStep(
        execution.pipelineId,
        'step1',
        createAgentResponse('coder', 'Done 1')
      );
      manager.completeStep(
        execution.pipelineId,
        'step2',
        createAgentResponse('coder', 'Done 2')
      );

      // Should no longer be in active executions
      active = manager.getActiveExecutions();
      expect(active).not.toContain(execution);
    });
  });

  describe('Linear Pipeline (A -> B -> C)', () => {
    it('should execute steps sequentially with each blocked by previous', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A'] }),
        createStep('C', { dependsOn: ['B'] }),
      ]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([
        ['A', 'task-A'],
        ['B', 'task-B'],
        ['C', 'task-C'],
      ]));

      // Phase 1: Only A is ready
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['A']);

      manager.completeStep(
        execution.pipelineId,
        'A',
        createAgentResponse('coder', 'A result')
      );

      // Phase 2: Only B is ready after A completes
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['B']);

      manager.completeStep(
        execution.pipelineId,
        'B',
        createAgentResponse('coder', 'B result')
      );

      // Phase 3: Only C is ready after B completes
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['C']);

      manager.completeStep(
        execution.pipelineId,
        'C',
        createAgentResponse('coder', 'C result')
      );

      // All done
      expect(execution.status).toBe('completed');
      expect(manager.getReadySteps(execution)).toEqual([]);
    });

    it('should include previous step results in context', () => {
      const definition = createDefinition(
        [
          createStep('A'),
          createStep('B', { dependsOn: ['A'] }),
          createStep('C', { dependsOn: ['B'] }),
        ],
        { globalContext: 'Global project context' }
      );

      const execution = manager.createExecution(definition);

      // Complete A
      execution.completedSteps.add('A');
      execution.results.set('A', createAgentResponse('coder', 'Result from A'));

      // Check B's context includes A's result
      const stepB = definition.steps.find((s) => s.name === 'B')!;
      const contextB = manager.buildStepContext(execution, stepB);

      expect(contextB).toContain('Global project context');
      expect(contextB).toContain('## Previous Step Results');
      expect(contextB).toContain('### A');
      expect(contextB).toContain('Result from A');

      // Complete B
      execution.completedSteps.add('B');
      execution.results.set('B', createAgentResponse('coder', 'Result from B'));

      // Check C's context includes B's result (but not A's directly since C only depends on B)
      const stepC = definition.steps.find((s) => s.name === 'C')!;
      const contextC = manager.buildStepContext(execution, stepC);

      expect(contextC).toContain('### B');
      expect(contextC).toContain('Result from B');
    });
  });

  describe('Diamond Pipeline (A -> B, A -> C, B -> D, C -> D)', () => {
    it('should allow B and C to run in parallel after A completes', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A'] }),
        createStep('C', { dependsOn: ['A'] }),
        createStep('D', { dependsOn: ['B', 'C'] }),
      ]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([
        ['A', 'task-A'],
        ['B', 'task-B'],
        ['C', 'task-C'],
        ['D', 'task-D'],
      ]));

      // Phase 1: Only A is ready
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['A']);

      manager.completeStep(
        execution.pipelineId,
        'A',
        createAgentResponse('coder', 'A result')
      );

      // Phase 2: B and C are both ready (can run in parallel)
      readySteps = manager.getReadySteps(execution);
      const readyNames = readySteps.map((s) => s.name).sort();
      expect(readyNames).toEqual(['B', 'C']);

      // Complete B first
      manager.completeStep(
        execution.pipelineId,
        'B',
        createAgentResponse('coder', 'B result')
      );

      // D still not ready (waiting for C)
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['C']);

      // Complete C
      manager.completeStep(
        execution.pipelineId,
        'C',
        createAgentResponse('coder', 'C result')
      );

      // Phase 3: D is now ready
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['D']);

      manager.completeStep(
        execution.pipelineId,
        'D',
        createAgentResponse('coder', 'D result')
      );

      expect(execution.status).toBe('completed');
    });

    it('should include results from both B and C in D context', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A'], role: 'researcher' }),
        createStep('C', { dependsOn: ['A'], role: 'critic' }),
        createStep('D', { dependsOn: ['B', 'C'] }),
      ]);

      const execution = manager.createExecution(definition);

      // Complete A, B, and C
      execution.completedSteps.add('A');
      execution.completedSteps.add('B');
      execution.completedSteps.add('C');
      execution.results.set('A', createAgentResponse('coder', 'A result'));
      execution.results.set('B', createAgentResponse('researcher', 'Research from B'));
      execution.results.set('C', createAgentResponse('critic', 'Critique from C'));

      // D's context should include both B and C results
      const stepD = definition.steps.find((s) => s.name === 'D')!;
      const contextD = manager.buildStepContext(execution, stepD);

      expect(contextD).toContain('## Previous Step Results');
      expect(contextD).toContain('### B (researcher)');
      expect(contextD).toContain('Research from B');
      expect(contextD).toContain('### C (critic)');
      expect(contextD).toContain('Critique from C');
    });

    it('should handle completing steps in either order (B then C or C then B)', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A'] }),
        createStep('C', { dependsOn: ['A'] }),
        createStep('D', { dependsOn: ['B', 'C'] }),
      ]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([
        ['A', 'task-A'],
        ['B', 'task-B'],
        ['C', 'task-C'],
        ['D', 'task-D'],
      ]));

      // Complete A
      manager.completeStep(
        execution.pipelineId,
        'A',
        createAgentResponse('coder', 'A result')
      );

      // Complete C first (instead of B)
      manager.completeStep(
        execution.pipelineId,
        'C',
        createAgentResponse('coder', 'C result')
      );

      // D not ready yet - still waiting for B
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['B']);

      // Complete B
      manager.completeStep(
        execution.pipelineId,
        'B',
        createAgentResponse('coder', 'B result')
      );

      // Now D is ready
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['D']);
    });
  });

  describe('Cycle Detection', () => {
    it('should throw error for A -> B -> C -> A cycle', () => {
      const definition = createDefinition([
        createStep('A', { dependsOn: ['C'] }),
        createStep('B', { dependsOn: ['A'] }),
        createStep('C', { dependsOn: ['B'] }),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should throw error for A -> B -> A cycle', () => {
      const definition = createDefinition([
        createStep('A', { dependsOn: ['B'] }),
        createStep('B', { dependsOn: ['A'] }),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should throw error for self-referential A -> A cycle', () => {
      const definition = createDefinition([
        createStep('A', { dependsOn: ['A'] }),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should prevent execution creation for cyclic pipeline', () => {
      const definition = createDefinition([
        createStep('A', { dependsOn: ['B'] }),
        createStep('B', { dependsOn: ['C'] }),
        createStep('C', { dependsOn: ['A'] }),
      ]);

      expect(() => manager.createExecution(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should detect cycle in complex graph with valid branch', () => {
      // D is valid (depends on A), but B -> C -> B is a cycle
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A', 'C'] }),
        createStep('C', { dependsOn: ['B'] }),
        createStep('D', { dependsOn: ['A'] }),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });
  });

  describe('Context Propagation', () => {
    it('should include global context in all steps', () => {
      const globalContext = 'This is a project about building a task manager.';
      const definition = createDefinition(
        [
          createStep('step1'),
          createStep('step2', { dependsOn: ['step1'] }),
          createStep('step3', { dependsOn: ['step2'] }),
        ],
        { globalContext }
      );

      const execution = manager.createExecution(definition);

      // Check context for each step
      for (const step of definition.steps) {
        const context = manager.buildStepContext(execution, step);
        expect(context).toContain('## Project Context');
        expect(context).toContain(globalContext);
      }
    });

    it('should propagate step results to dependent steps', () => {
      const definition = createDefinition([
        createStep('research', { role: 'researcher' }),
        createStep('plan', { role: 'coder', dependsOn: ['research'] }),
        createStep('implement', { role: 'coder', dependsOn: ['plan'] }),
      ]);

      const execution = manager.createExecution(definition);

      // Complete research
      const researchResult = 'Found 3 approaches: A, B, C';
      execution.completedSteps.add('research');
      execution.results.set(
        'research',
        createAgentResponse('researcher', researchResult)
      );

      // Plan should see research result
      const planStep = definition.steps.find((s) => s.name === 'plan')!;
      const planContext = manager.buildStepContext(execution, planStep);
      expect(planContext).toContain(researchResult);

      // Complete plan
      const planResult = 'Chose approach B. Implementation steps: 1, 2, 3';
      execution.completedSteps.add('plan');
      execution.results.set(
        'plan',
        createAgentResponse('coder', planResult)
      );

      // Implement should see plan result
      const implementStep = definition.steps.find((s) => s.name === 'implement')!;
      const implementContext = manager.buildStepContext(execution, implementStep);
      expect(implementContext).toContain(planResult);
    });

    it('should truncate context when over MAX_CONTEXT_LENGTH', () => {
      const MAX_CONTEXT_LENGTH = 50000;

      // Create a very long global context
      const longContext = 'X'.repeat(60000);
      const definition = createDefinition(
        [createStep('step1')],
        { globalContext: longContext }
      );

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      const context = manager.buildStepContext(execution, step);

      // Should be truncated
      expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
      expect(context).toContain('...[Context truncated due to length]...');
    });

    it('should log warning when context is truncated', () => {
      const longContext = 'Y'.repeat(60000);
      const definition = createDefinition(
        [createStep('truncation-test')],
        { globalContext: longContext }
      );

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      manager.buildStepContext(execution, step);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Step context truncated',
        expect.objectContaining({
          stepName: 'truncation-test',
        })
      );
    });

    it('should handle step-specific context combined with global and dependencies', () => {
      const definition = createDefinition(
        [
          createStep('step1', { context: 'Step 1 specific instructions' }),
          createStep('step2', {
            dependsOn: ['step1'],
            context: 'Step 2 specific instructions',
          }),
        ],
        { globalContext: 'Global instructions for all steps' }
      );

      const execution = manager.createExecution(definition);

      // Complete step1
      execution.completedSteps.add('step1');
      execution.results.set(
        'step1',
        createAgentResponse('coder', 'Step 1 output')
      );

      // Check step2 context has all three: global, step-specific, and dependency result
      const step2 = definition.steps.find((s) => s.name === 'step2')!;
      const context = manager.buildStepContext(execution, step2);

      expect(context).toContain('## Project Context');
      expect(context).toContain('Global instructions for all steps');
      expect(context).toContain('## Task Context');
      expect(context).toContain('Step 2 specific instructions');
      expect(context).toContain('## Previous Step Results');
      expect(context).toContain('Step 1 output');
    });
  });

  describe('Multiple Pipeline Executions', () => {
    it('should track multiple pipelines independently', () => {
      const definition1 = createDefinition(
        [createStep('A'), createStep('B', { dependsOn: ['A'] })],
        { name: 'pipeline-1' }
      );

      const definition2 = createDefinition(
        [createStep('X'), createStep('Y', { dependsOn: ['X'] })],
        { name: 'pipeline-2' }
      );

      const execution1 = manager.createExecution(definition1);
      const execution2 = manager.createExecution(definition2);

      expect(execution1.pipelineId).not.toBe(execution2.pipelineId);

      // Register and run pipeline 1
      manager.registerTaskIds(execution1.pipelineId, new Map([
        ['A', 'task-1A'],
        ['B', 'task-1B'],
      ]));

      // Register pipeline 2
      manager.registerTaskIds(execution2.pipelineId, new Map([
        ['X', 'task-2X'],
        ['Y', 'task-2Y'],
      ]));

      // Both should be active
      let active = manager.getActiveExecutions();
      expect(active.length).toBe(2);

      // Complete pipeline 1
      manager.completeStep(
        execution1.pipelineId,
        'A',
        createAgentResponse('coder', 'A done')
      );
      manager.completeStep(
        execution1.pipelineId,
        'B',
        createAgentResponse('coder', 'B done')
      );

      expect(execution1.status).toBe('completed');
      expect(execution2.status).toBe('running');

      // Only pipeline 2 should be active now
      active = manager.getActiveExecutions();
      expect(active.length).toBe(1);
      expect(active[0].definition.name).toBe('pipeline-2');

      // Complete pipeline 2
      manager.completeStep(
        execution2.pipelineId,
        'X',
        createAgentResponse('coder', 'X done')
      );
      manager.completeStep(
        execution2.pipelineId,
        'Y',
        createAgentResponse('coder', 'Y done')
      );

      expect(execution2.status).toBe('completed');
      active = manager.getActiveExecutions();
      expect(active.length).toBe(0);
    });

    it('should query specific pipeline by ID', () => {
      const definition = createDefinition([createStep('step1')], { name: 'test-query' });

      const execution = manager.createExecution(definition);
      const retrieved = manager.getExecution(execution.pipelineId);

      expect(retrieved).toBe(execution);
      expect(retrieved?.definition.name).toBe('test-query');
    });

    it('should return undefined for unknown pipeline ID', () => {
      const retrieved = manager.getExecution('nonexistent-pipeline-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Pipeline Failure Handling', () => {
    it('should mark pipeline as failed when step fails', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', { dependsOn: ['A'] }),
      ]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([
        ['A', 'task-A'],
        ['B', 'task-B'],
      ]));

      // Complete A
      manager.completeStep(
        execution.pipelineId,
        'A',
        createAgentResponse('coder', 'A done')
      );

      // Fail B
      manager.failStep(execution.pipelineId, 'B', new Error('Provider timeout'));

      expect(execution.status).toBe('failed');
    });

    it('should remove failed pipeline from active executions', () => {
      const definition = createDefinition([createStep('A')]);

      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([['A', 'task-A']]));

      // Should be active initially
      let active = manager.getActiveExecutions();
      expect(active).toContain(execution);

      // Fail the step
      manager.failStep(execution.pipelineId, 'A', new Error('Failed'));

      // Should no longer be active
      active = manager.getActiveExecutions();
      expect(active).not.toContain(execution);
    });

    it('should log error when step fails', () => {
      const definition = createDefinition([createStep('failing-step')]);
      const execution = manager.createExecution(definition);

      const error = new Error('Test failure message');
      manager.failStep(execution.pipelineId, 'failing-step', error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Pipeline step failed',
        expect.objectContaining({
          pipelineId: execution.pipelineId,
          stepName: 'failing-step',
          error,
        })
      );
    });
  });

  describe('TaskCreate Instructions Generation', () => {
    it('should generate valid TaskCreate instructions with dependencies', () => {
      const definition = createDefinition([
        createStep('research', { role: 'researcher', subject: 'Research topic' }),
        createStep('implement', {
          role: 'coder',
          subject: 'Implement solution',
          dependsOn: ['research'],
        }),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      // Should contain TaskCreate for both steps
      expect(instructions).toContain('TaskCreate');
      expect(instructions).toContain('"Research topic"');
      expect(instructions).toContain('"Implement solution"');

      // Should have metadata
      expect(instructions).toContain('"pipeline":"test-pipeline"');
      expect(instructions).toContain('"role":"researcher"');
      expect(instructions).toContain('"role":"coder"');
      expect(instructions).toContain('"stepName":"research"');
      expect(instructions).toContain('"stepName":"implement"');

      // implement should have blockedBy reference to research (index 1)
      expect(instructions).toContain('blockedBy: ["1"]');
    });

    it('should handle multiple dependencies in TaskCreate', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B'),
        createStep('C', { dependsOn: ['A', 'B'] }),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      // C should reference both A (index 1) and B (index 2)
      expect(instructions).toContain('blockedBy: ["1", "2"]');
    });

    it('should not include blockedBy for independent steps', () => {
      const definition = createDefinition([
        createStep('independent'),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      // Should not contain blockedBy since step has no dependencies
      expect(instructions).not.toContain('blockedBy');
    });
  });
});
