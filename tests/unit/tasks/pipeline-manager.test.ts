/**
 * Unit tests for PipelineManager
 *
 * Tests the pipeline management including:
 * - DAG validation and cycle detection
 * - Pipeline execution creation and tracking
 * - Step readiness determination
 * - Context building for steps
 * - Phase computation (topological order)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineManager } from '../../../src/tasks/pipeline-manager.js';
import type {
  PipelineDefinition,
  PipelineExecution,
  PipelineStep,
  AgentResponse,
} from '../../../src/types.js';
import type { Logger } from '../../../src/observability/logger.js';

// Mock logger
const createMockLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
});

describe('PipelineManager', () => {
  let manager: PipelineManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    manager = new PipelineManager(mockLogger);
  });

  // Helper to create a valid pipeline definition
  const createDefinition = (
    steps: PipelineStep[],
    name = 'test-pipeline'
  ): PipelineDefinition => ({
    name,
    steps,
    globalContext: 'Test global context',
  });

  // Helper to create a step
  const createStep = (
    name: string,
    dependsOn?: string[],
    role = 'coder'
  ): PipelineStep => ({
    name,
    subject: `Execute ${name}`,
    description: `Description for ${name}`,
    role,
    dependsOn,
  });

  // Helper to create mock AgentResponse
  const createAgentResponse = (
    role: string,
    text: string
  ): AgentResponse => ({
    role,
    provider: 'test-provider',
    model: 'test-model',
    content: [{ type: 'text', text }],
    metadata: {
      traceId: 'test-trace-id',
      durationMs: 100,
    },
  });

  describe('validateDefinition()', () => {
    it('should pass validation for a valid DAG', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
        createStep('step3', ['step1']),
        createStep('step4', ['step2', 'step3']),
      ]);

      // Should not throw
      expect(() => manager.validateDefinition(definition)).not.toThrow();
    });

    it('should pass validation for empty pipeline', () => {
      const definition = createDefinition([]);

      // Should not throw - empty pipelines are technically valid DAGs
      expect(() => manager.validateDefinition(definition)).not.toThrow();
    });

    it('should pass validation for single step pipeline', () => {
      const definition = createDefinition([createStep('only-step')]);

      expect(() => manager.validateDefinition(definition)).not.toThrow();
    });

    it('should pass validation for linear pipeline (A->B->C)', () => {
      const definition = createDefinition([
        createStep('A'),
        createStep('B', ['A']),
        createStep('C', ['B']),
      ]);

      expect(() => manager.validateDefinition(definition)).not.toThrow();
    });

    it('should throw for cycle detection (A->B->C->A)', () => {
      const definition = createDefinition([
        createStep('A', ['C']),
        createStep('B', ['A']),
        createStep('C', ['B']),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should throw for self-referential cycle (A->A)', () => {
      const definition = createDefinition([createStep('A', ['A'])]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should throw for two-step cycle (A->B->A)', () => {
      const definition = createDefinition([
        createStep('A', ['B']),
        createStep('B', ['A']),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should throw for missing dependency reference', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['nonexistent']),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Step "step2" depends on unknown step "nonexistent"'
      );
    });

    it('should throw for duplicate step names', () => {
      const definition = createDefinition([
        createStep('duplicate'),
        createStep('duplicate'),
      ]);

      expect(() => manager.validateDefinition(definition)).toThrow(
        'Pipeline contains duplicate step names'
      );
    });
  });

  describe('createExecution()', () => {
    it('should create PipelineExecution with unique pipelineId', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
      ]);

      const execution1 = manager.createExecution(definition);
      const execution2 = manager.createExecution(definition);

      expect(execution1.pipelineId).toBeDefined();
      expect(execution2.pipelineId).toBeDefined();
      expect(execution1.pipelineId).not.toBe(execution2.pipelineId);
    });

    it('should set status to pending', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);

      expect(execution.status).toBe('pending');
    });

    it('should initialize empty taskIdMap', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);

      expect(execution.taskIdMap).toBeInstanceOf(Map);
      expect(execution.taskIdMap.size).toBe(0);
    });

    it('should initialize empty completedSteps', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);

      expect(execution.completedSteps).toBeInstanceOf(Set);
      expect(execution.completedSteps.size).toBe(0);
    });

    it('should initialize empty results', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);

      expect(execution.results).toBeInstanceOf(Map);
      expect(execution.results.size).toBe(0);
    });

    it('should set startTime', () => {
      const definition = createDefinition([createStep('step1')]);

      const before = Date.now();
      const execution = manager.createExecution(definition);
      const after = Date.now();

      expect(execution.startTime).toBeGreaterThanOrEqual(before);
      expect(execution.startTime).toBeLessThanOrEqual(after);
    });

    it('should store definition reference', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);

      expect(execution.definition).toBe(definition);
    });

    it('should throw for invalid definition (with cycle)', () => {
      const definition = createDefinition([
        createStep('A', ['B']),
        createStep('B', ['A']),
      ]);

      expect(() => manager.createExecution(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });

    it('should log pipeline creation', () => {
      const definition = createDefinition([createStep('step1')]);

      manager.createExecution(definition);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Pipeline execution created',
        expect.objectContaining({
          name: 'test-pipeline',
          stepCount: 1,
        })
      );
    });
  });

  describe('generatePipelineCreation()', () => {
    it('should return task creation instructions for each step', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      expect(instructions).toContain('TaskCreate');
      expect(instructions).toContain('Execute step1');
      expect(instructions).toContain('Execute step2');
    });

    it('should include pipeline metadata with stepName', () => {
      const definition = createDefinition([createStep('my-step')]);

      const instructions = manager.generatePipelineCreation(definition);

      expect(instructions).toContain('"stepName":"my-step"');
    });

    it('should include pipeline name in metadata', () => {
      const definition = createDefinition([createStep('step1')], 'my-pipeline');

      const instructions = manager.generatePipelineCreation(definition);

      expect(instructions).toContain('"pipeline":"my-pipeline"');
    });

    it('should apply role from step config in metadata', () => {
      const definition = createDefinition([
        createStep('step1', undefined, 'critic'),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      expect(instructions).toContain('"role":"critic"');
    });

    it('should include blockedBy for steps with dependencies', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      // step2 should have blockedBy referencing step1's index (1)
      expect(instructions).toContain('blockedBy');
      expect(instructions).toContain('"1"');
    });

    it('should not include blockedBy for steps without dependencies', () => {
      const definition = createDefinition([createStep('step1')]);

      const instructions = manager.generatePipelineCreation(definition);

      // Should not contain blockedBy for independent steps
      const step1Section = instructions.split('TaskCreate')[1];
      expect(step1Section).not.toContain('blockedBy');
    });

    it('should handle multiple dependencies correctly', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2'),
        createStep('step3', ['step1', 'step2']),
      ]);

      const instructions = manager.generatePipelineCreation(definition);

      // step3 should reference both step1 (index 1) and step2 (index 2)
      expect(instructions).toContain('blockedBy: ["1", "2"]');
    });

    it('should throw for invalid definition', () => {
      const definition = createDefinition([
        createStep('A', ['B']),
        createStep('B', ['A']),
      ]);

      expect(() => manager.generatePipelineCreation(definition)).toThrow(
        'Pipeline contains circular dependencies'
      );
    });
  });

  describe('getReadySteps()', () => {
    it('should return steps with no dependencies first', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
        createStep('step3'),
      ]);

      const execution = manager.createExecution(definition);
      const readySteps = manager.getReadySteps(execution);

      const readyNames = readySteps.map((s) => s.name);
      expect(readyNames).toContain('step1');
      expect(readyNames).toContain('step3');
      expect(readyNames).not.toContain('step2');
    });

    it('should return steps whose dependencies are all completed', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
        createStep('step3', ['step1', 'step2']),
      ]);

      const execution = manager.createExecution(definition);

      // Initially only step1 is ready
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['step1']);

      // Complete step1
      execution.completedSteps.add('step1');
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['step2']);

      // Complete step2
      execution.completedSteps.add('step2');
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['step3']);
    });

    it('should return empty array when all steps complete', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
      ]);

      const execution = manager.createExecution(definition);
      execution.completedSteps.add('step1');
      execution.completedSteps.add('step2');

      const readySteps = manager.getReadySteps(execution);

      expect(readySteps).toEqual([]);
    });

    it('should not return already completed steps', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2'),
      ]);

      const execution = manager.createExecution(definition);
      execution.completedSteps.add('step1');

      const readySteps = manager.getReadySteps(execution);

      expect(readySteps.map((s) => s.name)).toEqual(['step2']);
    });

    it('should handle diamond pattern correctly', () => {
      // A -> B, A -> C, B -> D, C -> D
      const definition = createDefinition([
        createStep('A'),
        createStep('B', ['A']),
        createStep('C', ['A']),
        createStep('D', ['B', 'C']),
      ]);

      const execution = manager.createExecution(definition);

      // Initially only A is ready
      let readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['A']);

      // After A completes, B and C are ready
      execution.completedSteps.add('A');
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name).sort()).toEqual(['B', 'C']);

      // After B completes (but not C), D is still not ready
      execution.completedSteps.add('B');
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['C']);

      // After C completes, D is ready
      execution.completedSteps.add('C');
      readySteps = manager.getReadySteps(execution);
      expect(readySteps.map((s) => s.name)).toEqual(['D']);
    });

    it('should return empty array for empty pipeline', () => {
      const definition = createDefinition([]);
      const execution = manager.createExecution(definition);

      const readySteps = manager.getReadySteps(execution);

      expect(readySteps).toEqual([]);
    });
  });

  describe('buildStepContext()', () => {
    it('should include globalContext', () => {
      const definition: PipelineDefinition = {
        name: 'test',
        steps: [createStep('step1')],
        globalContext: 'This is the global context',
      };

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      const context = manager.buildStepContext(execution, step);

      expect(context).toContain('## Project Context');
      expect(context).toContain('This is the global context');
    });

    it('should include step-specific context', () => {
      const step: PipelineStep = {
        name: 'step1',
        subject: 'Test step',
        role: 'coder',
        context: 'This is step-specific context',
      };
      const definition: PipelineDefinition = {
        name: 'test',
        steps: [step],
      };

      const execution = manager.createExecution(definition);
      const context = manager.buildStepContext(execution, step);

      expect(context).toContain('## Task Context');
      expect(context).toContain('This is step-specific context');
    });

    it('should include results from completed dependencies', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2', ['step1']),
      ]);

      const execution = manager.createExecution(definition);
      execution.completedSteps.add('step1');
      execution.results.set(
        'step1',
        createAgentResponse('coder', 'Result from step1')
      );

      const step2 = definition.steps[1];
      const context = manager.buildStepContext(execution, step2);

      expect(context).toContain('## Previous Step Results');
      expect(context).toContain('### step1');
      expect(context).toContain('Result from step1');
    });

    it('should include results from multiple dependencies', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2'),
        createStep('step3', ['step1', 'step2']),
      ]);

      const execution = manager.createExecution(definition);
      execution.completedSteps.add('step1');
      execution.completedSteps.add('step2');
      execution.results.set(
        'step1',
        createAgentResponse('coder', 'Result from step1')
      );
      execution.results.set(
        'step2',
        createAgentResponse('reviewer', 'Result from step2')
      );

      const step3 = definition.steps[2];
      const context = manager.buildStepContext(execution, step3);

      expect(context).toContain('### step1');
      expect(context).toContain('Result from step1');
      expect(context).toContain('### step2');
      expect(context).toContain('Result from step2');
    });

    it('should handle no dependencies case', () => {
      const definition = createDefinition([createStep('step1')]);

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      const context = manager.buildStepContext(execution, step);

      // Should not contain "Previous Step Results" section
      expect(context).not.toContain('## Previous Step Results');
    });

    it('should truncate if over MAX_CONTEXT_LENGTH', () => {
      const longContext = 'X'.repeat(60000);
      const definition: PipelineDefinition = {
        name: 'test',
        steps: [createStep('step1')],
        globalContext: longContext,
      };

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      const context = manager.buildStepContext(execution, step);

      // MAX_CONTEXT_LENGTH is 50000
      expect(context.length).toBeLessThanOrEqual(50000);
      expect(context).toContain('...[Context truncated due to length]...');
    });

    it('should log warning when context is truncated', () => {
      const longContext = 'X'.repeat(60000);
      const definition: PipelineDefinition = {
        name: 'test',
        steps: [createStep('step1')],
        globalContext: longContext,
      };

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      manager.buildStepContext(execution, step);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Step context truncated',
        expect.objectContaining({
          stepName: 'step1',
        })
      );
    });

    it('should handle missing globalContext', () => {
      const definition: PipelineDefinition = {
        name: 'test',
        steps: [createStep('step1')],
        // No globalContext
      };

      const execution = manager.createExecution(definition);
      const step = definition.steps[0];
      const context = manager.buildStepContext(execution, step);

      expect(context).not.toContain('## Project Context');
    });

    it('should include role in dependency result header', () => {
      const definition = createDefinition([
        createStep('step1', undefined, 'critic'),
        createStep('step2', ['step1']),
      ]);

      const execution = manager.createExecution(definition);
      execution.completedSteps.add('step1');
      execution.results.set(
        'step1',
        createAgentResponse('critic', 'Critique result')
      );

      const step2 = definition.steps[1];
      const context = manager.buildStepContext(execution, step2);

      expect(context).toContain('### step1 (critic)');
    });
  });

  describe('getExecution()', () => {
    it('should return execution by pipelineId', () => {
      const definition = createDefinition([createStep('step1')]);
      const created = manager.createExecution(definition);

      const retrieved = manager.getExecution(created.pipelineId);

      expect(retrieved).toBe(created);
    });

    it('should return undefined for unknown pipelineId', () => {
      const retrieved = manager.getExecution('nonexistent-id');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('registerTaskIds()', () => {
    it('should update taskIdMap in execution', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2'),
      ]);
      const execution = manager.createExecution(definition);

      const taskIdMap = new Map([
        ['step1', 'task-1'],
        ['step2', 'task-2'],
      ]);
      manager.registerTaskIds(execution.pipelineId, taskIdMap);

      expect(execution.taskIdMap.get('step1')).toBe('task-1');
      expect(execution.taskIdMap.get('step2')).toBe('task-2');
    });

    it('should set status to running', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);

      manager.registerTaskIds(execution.pipelineId, new Map([['step1', 'task-1']]));

      expect(execution.status).toBe('running');
    });

    it('should throw for unknown pipelineId', () => {
      expect(() =>
        manager.registerTaskIds('nonexistent', new Map())
      ).toThrow('Unknown pipeline: nonexistent');
    });
  });

  describe('completeStep()', () => {
    it('should mark step as completed', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);

      manager.completeStep(
        execution.pipelineId,
        'step1',
        createAgentResponse('coder', 'Done')
      );

      expect(execution.completedSteps.has('step1')).toBe(true);
    });

    it('should store result', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);
      const response = createAgentResponse('coder', 'Done');

      manager.completeStep(execution.pipelineId, 'step1', response);

      expect(execution.results.get('step1')).toBe(response);
    });

    it('should set status to completed when all steps done', () => {
      const definition = createDefinition([
        createStep('step1'),
        createStep('step2'),
      ]);
      const execution = manager.createExecution(definition);

      manager.completeStep(
        execution.pipelineId,
        'step1',
        createAgentResponse('coder', 'Done 1')
      );
      expect(execution.status).not.toBe('completed');

      manager.completeStep(
        execution.pipelineId,
        'step2',
        createAgentResponse('coder', 'Done 2')
      );
      expect(execution.status).toBe('completed');
    });

    it('should throw for unknown pipelineId', () => {
      expect(() =>
        manager.completeStep(
          'nonexistent',
          'step1',
          createAgentResponse('coder', 'Done')
        )
      ).toThrow('Unknown pipeline: nonexistent');
    });
  });

  describe('failStep()', () => {
    it('should set status to failed', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);

      manager.failStep(execution.pipelineId, 'step1', new Error('Test error'));

      expect(execution.status).toBe('failed');
    });

    it('should log the failure', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);

      manager.failStep(execution.pipelineId, 'step1', new Error('Test error'));

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Pipeline step failed',
        expect.objectContaining({
          pipelineId: execution.pipelineId,
          stepName: 'step1',
        })
      );
    });

    it('should throw for unknown pipelineId', () => {
      expect(() =>
        manager.failStep('nonexistent', 'step1', new Error('Test'))
      ).toThrow('Unknown pipeline: nonexistent');
    });
  });

  describe('getActiveExecutions()', () => {
    it('should return pending and running executions', () => {
      const definition = createDefinition([createStep('step1')]);

      const pending = manager.createExecution(definition);
      const running = manager.createExecution(definition);
      manager.registerTaskIds(running.pipelineId, new Map([['step1', 'task-1']]));

      const active = manager.getActiveExecutions();

      expect(active).toContain(pending);
      expect(active).toContain(running);
    });

    it('should not return completed executions', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);
      manager.registerTaskIds(execution.pipelineId, new Map([['step1', 'task-1']]));
      manager.completeStep(
        execution.pipelineId,
        'step1',
        createAgentResponse('coder', 'Done')
      );

      const active = manager.getActiveExecutions();

      expect(active).not.toContain(execution);
    });

    it('should not return failed executions', () => {
      const definition = createDefinition([createStep('step1')]);
      const execution = manager.createExecution(definition);
      manager.failStep(execution.pipelineId, 'step1', new Error('Failed'));

      const active = manager.getActiveExecutions();

      expect(active).not.toContain(execution);
    });
  });
});
