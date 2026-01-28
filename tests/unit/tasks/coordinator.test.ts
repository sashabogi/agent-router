/**
 * Unit tests for TaskCoordinator
 *
 * Tests the task coordination logic including:
 * - Generating claim instructions for task lifecycle
 * - Starting task executions with tracking
 * - Completing executions with success results
 * - Failing executions with error handling
 * - Getting and managing active executions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskCoordinator } from '../../../src/tasks/coordinator.js';
import type { Logger } from '../../../src/observability/logger.js';
import type { AgentResponse } from '../../../src/types.js';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => createMockLogger()),
});

describe('TaskCoordinator', () => {
  let coordinator: TaskCoordinator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    coordinator = new TaskCoordinator(mockLogger);
  });

  describe('generateClaimInstructions()', () => {
    it('should return preExecution with TaskUpdate for in_progress', () => {
      const instructions = coordinator.generateClaimInstructions('task-123', 'agentRouter:coder');

      expect(instructions.preExecution).toBe(
        'TaskUpdate({ taskId: "task-123", status: "in_progress", owner: "agentRouter:coder" })'
      );
    });

    it('should return onSuccess with TaskUpdate for completed', () => {
      const instructions = coordinator.generateClaimInstructions('task-123', 'agentRouter:critic');

      expect(instructions.onSuccess).toBe(
        'TaskUpdate({ taskId: "task-123", status: "completed" })'
      );
    });

    it('should return onFailure with TaskUpdate for pending', () => {
      const instructions = coordinator.generateClaimInstructions('task-456', 'agentRouter:reviewer');

      expect(instructions.onFailure).toBe(
        'TaskUpdate({ taskId: "task-456", status: "pending", owner: null })'
      );
    });

    it('should set owner in preExecution instruction', () => {
      const instructions = coordinator.generateClaimInstructions('task-789', 'agentRouter:designer');

      expect(instructions.preExecution).toContain('owner: "agentRouter:designer"');
    });

    it('should include correct taskId in all instructions', () => {
      const taskId = 'unique-task-id-42';
      const instructions = coordinator.generateClaimInstructions(taskId, 'worker');

      expect(instructions.preExecution).toContain(`taskId: "${taskId}"`);
      expect(instructions.onSuccess).toContain(`taskId: "${taskId}"`);
      expect(instructions.onFailure).toContain(`taskId: "${taskId}"`);
    });
  });

  describe('startExecution()', () => {
    it('should create TaskExecution with correct fields', () => {
      const execution = coordinator.startExecution('task-123', 'coder');

      expect(execution.taskId).toBe('task-123');
      expect(execution.role).toBe('coder');
      expect(execution.status).toBe('running');
      expect(execution.startTime).toBeDefined();
      expect(execution.startTime).toBeGreaterThan(0);
    });

    it('should generate unique traceId when not provided', () => {
      const execution1 = coordinator.startExecution('task-1', 'coder');
      const execution2 = coordinator.startExecution('task-2', 'critic');

      expect(execution1.traceId).toBeDefined();
      expect(execution2.traceId).toBeDefined();
      expect(execution1.traceId).not.toBe(execution2.traceId);
    });

    it('should use provided traceId when specified', () => {
      const customTraceId = 'custom-trace-id-xyz';
      const execution = coordinator.startExecution('task-123', 'coder', customTraceId);

      expect(execution.traceId).toBe(customTraceId);
    });

    it('should set status to running', () => {
      const execution = coordinator.startExecution('task-123', 'reviewer');

      expect(execution.status).toBe('running');
    });

    it('should store execution in activeExecutions map', () => {
      coordinator.startExecution('task-123', 'coder');

      const stored = coordinator.getExecution('task-123');
      expect(stored).toBeDefined();
      expect(stored?.taskId).toBe('task-123');
    });

    it('should log debug message when starting execution', () => {
      coordinator.startExecution('task-123', 'coder');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Task execution started',
        expect.objectContaining({
          taskId: 'task-123',
          role: 'coder',
        })
      );
    });
  });

  describe('completeExecution()', () => {
    const mockAgentResponse: AgentResponse = {
      role: 'coder',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'Task completed successfully' }],
      metadata: {
        traceId: 'trace-123',
        durationMs: 1500,
      },
    };

    it('should return CompletionResult with instructions', () => {
      coordinator.startExecution('task-123', 'coder');

      const result = coordinator.completeExecution('task-123', mockAgentResponse);

      expect(result.instructions).toBe(
        'TaskUpdate({ taskId: "task-123", status: "completed" })'
      );
    });

    it('should set status to completed', () => {
      coordinator.startExecution('task-123', 'coder');

      const result = coordinator.completeExecution('task-123', mockAgentResponse);

      expect(result.execution.status).toBe('completed');
    });

    it('should set endTime', () => {
      const execution = coordinator.startExecution('task-123', 'coder');
      const startTime = execution.startTime;

      const result = coordinator.completeExecution('task-123', mockAgentResponse);

      expect(result.execution.endTime).toBeDefined();
      expect(result.execution.endTime).toBeGreaterThanOrEqual(startTime);
    });

    it('should store result in execution', () => {
      coordinator.startExecution('task-123', 'coder');

      const result = coordinator.completeExecution('task-123', mockAgentResponse);

      expect(result.execution.result).toBe(mockAgentResponse);
      expect(result.result).toBe(mockAgentResponse);
    });

    it('should throw error for unknown taskId', () => {
      expect(() => coordinator.completeExecution('unknown-task', mockAgentResponse)).toThrow(
        'No active execution for task unknown-task'
      );
    });

    it('should log info message with execution details', () => {
      coordinator.startExecution('task-123', 'coder');
      coordinator.completeExecution('task-123', mockAgentResponse);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Task execution completed',
        expect.objectContaining({
          taskId: 'task-123',
          role: 'coder',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        })
      );
    });
  });

  describe('failExecution()', () => {
    it('should return FailureResult with instructions', () => {
      coordinator.startExecution('task-123', 'coder');
      const error = new Error('Provider timeout');

      const result = coordinator.failExecution('task-123', error);

      expect(result.instructions).toBe(
        'TaskUpdate({ taskId: "task-123", status: "pending", owner: null })'
      );
    });

    it('should set status to failed', () => {
      coordinator.startExecution('task-123', 'coder');
      const error = new Error('API error');

      const result = coordinator.failExecution('task-123', error);

      expect(result.execution.status).toBe('failed');
    });

    it('should set endTime', () => {
      const execution = coordinator.startExecution('task-123', 'coder');
      const startTime = execution.startTime;
      const error = new Error('Network failure');

      const result = coordinator.failExecution('task-123', error);

      expect(result.execution.endTime).toBeDefined();
      expect(result.execution.endTime).toBeGreaterThanOrEqual(startTime);
    });

    it('should store error in execution', () => {
      coordinator.startExecution('task-123', 'coder');
      const error = new Error('Rate limit exceeded');

      const result = coordinator.failExecution('task-123', error);

      expect(result.execution.error).toBe(error);
      expect(result.error).toBe(error);
    });

    it('should throw error for unknown taskId', () => {
      const error = new Error('Some error');

      expect(() => coordinator.failExecution('unknown-task', error)).toThrow(
        'No active execution for task unknown-task'
      );
    });

    it('should log error message with execution details', () => {
      coordinator.startExecution('task-123', 'coder');
      const error = new Error('Provider error');

      coordinator.failExecution('task-123', error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Task execution failed',
        expect.objectContaining({
          taskId: 'task-123',
          role: 'coder',
          error,
        })
      );
    });
  });

  describe('getExecution()', () => {
    it('should return execution by taskId', () => {
      const started = coordinator.startExecution('task-123', 'coder');

      const retrieved = coordinator.getExecution('task-123');

      expect(retrieved).toBe(started);
    });

    it('should return undefined for unknown taskId', () => {
      const result = coordinator.getExecution('nonexistent-task');

      expect(result).toBeUndefined();
    });

    it('should return undefined after execution is cleared', () => {
      coordinator.startExecution('task-123', 'coder');
      coordinator.clearExecution('task-123');

      const result = coordinator.getExecution('task-123');

      expect(result).toBeUndefined();
    });
  });

  describe('clearExecution()', () => {
    it('should remove execution from tracking', () => {
      coordinator.startExecution('task-123', 'coder');
      expect(coordinator.getExecution('task-123')).toBeDefined();

      coordinator.clearExecution('task-123');

      expect(coordinator.getExecution('task-123')).toBeUndefined();
    });

    it('should not throw for unknown taskId', () => {
      expect(() => coordinator.clearExecution('unknown-task')).not.toThrow();
    });
  });

  describe('getActiveExecutions()', () => {
    it('should return empty array when no executions', () => {
      const executions = coordinator.getActiveExecutions();

      expect(executions).toEqual([]);
    });

    it('should return all active executions', () => {
      coordinator.startExecution('task-1', 'coder');
      coordinator.startExecution('task-2', 'critic');
      coordinator.startExecution('task-3', 'reviewer');

      const executions = coordinator.getActiveExecutions();

      expect(executions).toHaveLength(3);
      expect(executions.map((e) => e.taskId)).toContain('task-1');
      expect(executions.map((e) => e.taskId)).toContain('task-2');
      expect(executions.map((e) => e.taskId)).toContain('task-3');
    });

    it('should not include cleared executions', () => {
      coordinator.startExecution('task-1', 'coder');
      coordinator.startExecution('task-2', 'critic');
      coordinator.clearExecution('task-1');

      const executions = coordinator.getActiveExecutions();

      expect(executions).toHaveLength(1);
      expect(executions[0].taskId).toBe('task-2');
    });
  });

  describe('hasActiveExecutions()', () => {
    it('should return false when no executions', () => {
      expect(coordinator.hasActiveExecutions()).toBe(false);
    });

    it('should return true when executions exist', () => {
      coordinator.startExecution('task-1', 'coder');

      expect(coordinator.hasActiveExecutions()).toBe(true);
    });

    it('should return false after all executions cleared', () => {
      coordinator.startExecution('task-1', 'coder');
      coordinator.startExecution('task-2', 'critic');
      coordinator.clearExecution('task-1');
      coordinator.clearExecution('task-2');

      expect(coordinator.hasActiveExecutions()).toBe(false);
    });
  });

  describe('execution lifecycle', () => {
    it('should track full execution lifecycle from start to completion', () => {
      // Start
      const execution = coordinator.startExecution('task-123', 'coder');
      expect(execution.status).toBe('running');
      expect(execution.endTime).toBeUndefined();
      expect(execution.result).toBeUndefined();

      // Complete
      const response: AgentResponse = {
        role: 'coder',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Done' }],
        metadata: { traceId: 'trace', durationMs: 100 },
      };
      const result = coordinator.completeExecution('task-123', response);

      expect(result.execution.status).toBe('completed');
      expect(result.execution.endTime).toBeDefined();
      expect(result.execution.result).toBe(response);
    });

    it('should track full execution lifecycle from start to failure', () => {
      // Start
      const execution = coordinator.startExecution('task-456', 'critic');
      expect(execution.status).toBe('running');
      expect(execution.endTime).toBeUndefined();
      expect(execution.error).toBeUndefined();

      // Fail
      const error = new Error('Provider unavailable');
      const result = coordinator.failExecution('task-456', error);

      expect(result.execution.status).toBe('failed');
      expect(result.execution.endTime).toBeDefined();
      expect(result.execution.error).toBe(error);
    });
  });
});
