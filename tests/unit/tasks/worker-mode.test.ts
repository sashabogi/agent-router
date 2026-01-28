/**
 * Unit tests for WorkerMode
 *
 * Tests the worker mode functionality including:
 * - Constructor initialization
 * - Task claim instruction generation
 * - Task lifecycle management (start, complete, fail)
 * - Idle timeout shutdown detection
 * - State management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerMode } from '../../../src/tasks/worker-mode.js';
import type { Logger } from '../../../src/observability/logger.js';
import type { WorkerConfig, AgentRole } from '../../../src/types.js';

/**
 * Creates a mock logger for testing.
 */
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'debug',
  } as unknown as Logger;
}

describe('WorkerMode', () => {
  let worker: WorkerMode;
  let mockLogger: Logger;
  let defaultConfig: WorkerConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-28T12:00:00.000Z'));

    mockLogger = createMockLogger();
    defaultConfig = {
      name: 'test-worker',
      allowedRoles: ['coder', 'reviewer'] as AgentRole[],
      maxConcurrent: 2,
      heartbeatMs: 15000,
      idleTimeoutMs: 60000,
    };

    worker = new WorkerMode(defaultConfig, mockLogger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize state with status "idle"', () => {
      const state = worker.getStatus();
      expect(state.status).toBe('idle');
    });

    it('should set completedCount to 0', () => {
      const state = worker.getStatus();
      expect(state.completedCount).toBe(0);
    });

    it('should set failedCount to 0', () => {
      const state = worker.getStatus();
      expect(state.failedCount).toBe(0);
    });

    it('should set lastHeartbeat to current time', () => {
      const state = worker.getStatus();
      expect(state.lastHeartbeat).toBe(Date.now());
    });

    it('should use provided config values', () => {
      const state = worker.getStatus();
      expect(state.name).toBe('test-worker');
    });

    it('should initialize excludeTaskIds as empty array', () => {
      const state = worker.getStatus();
      expect(state.excludeTaskIds).toEqual([]);
    });

    it('should use default values when config options not provided', () => {
      const minimalConfig: WorkerConfig = {
        name: 'minimal-worker',
      };
      const minimalWorker = new WorkerMode(minimalConfig, mockLogger);
      const state = minimalWorker.getStatus();

      expect(state.name).toBe('minimal-worker');
      expect(state.status).toBe('idle');
    });

    it('should log initialization info', () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker mode initialized',
        expect.objectContaining({
          name: 'test-worker',
          allowedRoles: ['coder', 'reviewer'],
          maxConcurrent: 2,
        })
      );
    });
  });

  describe('generateClaimInstructions()', () => {
    it('should return markdown instructions for TaskList', () => {
      const instructions = worker.generateClaimInstructions();

      expect(instructions).toContain('## Worker Task Claim Protocol');
      expect(instructions).toContain('TaskList()');
    });

    it('should include role filter from allowedRoles', () => {
      const instructions = worker.generateClaimInstructions();

      expect(instructions).toContain('metadata.role IN ["coder", "reviewer"]');
      expect(instructions).toContain('**Allowed Roles:** coder, reviewer');
    });

    it('should show "any role" when no allowedRoles specified', () => {
      const noRolesConfig: WorkerConfig = {
        name: 'any-role-worker',
      };
      const anyRoleWorker = new WorkerMode(noRolesConfig, mockLogger);
      const instructions = anyRoleWorker.generateClaimInstructions();

      expect(instructions).toContain('any role');
      expect(instructions).toContain('**Allowed Roles:** any');
    });

    it('should include excludeTaskIds filter when tasks have been excluded', () => {
      // First fail a task to add it to exclude list
      worker.markTaskStarted('task-123');
      worker.markTaskFailed('task-123');

      const instructions = worker.generateClaimInstructions();

      expect(instructions).toContain('id NOT IN [task-123]');
    });

    it('should not include excludeTaskIds clause when no tasks excluded', () => {
      const instructions = worker.generateClaimInstructions();

      expect(instructions).not.toContain('id NOT IN');
    });

    it('should generate proper claim and execute workflow', () => {
      const instructions = worker.generateClaimInstructions();

      // Check for workflow steps
      expect(instructions).toContain('**Get current tasks:**');
      expect(instructions).toContain('**Find a task matching:**');
      expect(instructions).toContain('status = "pending"');
      expect(instructions).toContain('owner = null');
      expect(instructions).toContain('**If found, claim it:**');
      expect(instructions).toContain('TaskUpdate');
      expect(instructions).toContain('**Execute via AgentRouter:**');
      expect(instructions).toContain('execute_task');
    });

    it('should include worker name in claim instructions', () => {
      const instructions = worker.generateClaimInstructions();

      expect(instructions).toContain('**Worker:** test-worker');
      expect(instructions).toContain(`owner: "test-worker"`);
    });

    it('should include current status and counts', () => {
      // Complete a task to update counts
      worker.markTaskStarted('task-1');
      worker.markTaskCompleted('task-1');

      const instructions = worker.generateClaimInstructions();

      expect(instructions).toContain('**Status:** idle');
      expect(instructions).toContain('**Completed:** 1');
      expect(instructions).toContain('**Failed:** 0');
    });
  });

  describe('markTaskStarted(taskId)', () => {
    it('should set state.currentTask to taskId', () => {
      worker.markTaskStarted('task-abc');

      const state = worker.getStatus();
      expect(state.currentTask).toBe('task-abc');
    });

    it('should set status to "working"', () => {
      worker.markTaskStarted('task-abc');

      const state = worker.getStatus();
      expect(state.status).toBe('working');
    });

    it('should update lastHeartbeat', () => {
      // Advance time
      vi.advanceTimersByTime(5000);
      const expectedTime = Date.now();

      worker.markTaskStarted('task-abc');

      const state = worker.getStatus();
      expect(state.lastHeartbeat).toBe(expectedTime);
    });

    it('should log debug message', () => {
      worker.markTaskStarted('task-xyz');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Worker starting task',
        expect.objectContaining({
          worker: 'test-worker',
          taskId: 'task-xyz',
        })
      );
    });
  });

  describe('markTaskCompleted()', () => {
    beforeEach(() => {
      worker.markTaskStarted('task-to-complete');
    });

    it('should clear currentTask', () => {
      worker.markTaskCompleted('task-to-complete');

      const state = worker.getStatus();
      expect(state.currentTask).toBeUndefined();
    });

    it('should set status to "idle"', () => {
      worker.markTaskCompleted('task-to-complete');

      const state = worker.getStatus();
      expect(state.status).toBe('idle');
    });

    it('should increment completedCount', () => {
      const initialCount = worker.getStatus().completedCount;

      worker.markTaskCompleted('task-to-complete');

      const state = worker.getStatus();
      expect(state.completedCount).toBe(initialCount + 1);
    });

    it('should update lastHeartbeat', () => {
      vi.advanceTimersByTime(10000);
      const expectedTime = Date.now();

      worker.markTaskCompleted('task-to-complete');

      const state = worker.getStatus();
      expect(state.lastHeartbeat).toBe(expectedTime);
    });

    it('should log info message with completion details', () => {
      worker.markTaskCompleted('task-to-complete');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker completed task',
        expect.objectContaining({
          worker: 'test-worker',
          taskId: 'task-to-complete',
          completedCount: 1,
        })
      );
    });

    it('should track multiple completions', () => {
      worker.markTaskCompleted('task-1');
      worker.markTaskStarted('task-2');
      worker.markTaskCompleted('task-2');
      worker.markTaskStarted('task-3');
      worker.markTaskCompleted('task-3');

      const state = worker.getStatus();
      expect(state.completedCount).toBe(3);
    });
  });

  describe('markTaskFailed(taskId)', () => {
    beforeEach(() => {
      worker.markTaskStarted('task-to-fail');
    });

    it('should clear currentTask', () => {
      worker.markTaskFailed('task-to-fail');

      const state = worker.getStatus();
      expect(state.currentTask).toBeUndefined();
    });

    it('should set status to "idle"', () => {
      worker.markTaskFailed('task-to-fail');

      const state = worker.getStatus();
      expect(state.status).toBe('idle');
    });

    it('should increment failedCount', () => {
      const initialCount = worker.getStatus().failedCount;

      worker.markTaskFailed('task-to-fail');

      const state = worker.getStatus();
      expect(state.failedCount).toBe(initialCount + 1);
    });

    it('should add taskId to excludeTaskIds', () => {
      worker.markTaskFailed('task-to-fail');

      const state = worker.getStatus();
      expect(state.excludeTaskIds).toContain('task-to-fail');
    });

    it('should update lastHeartbeat', () => {
      vi.advanceTimersByTime(15000);
      const expectedTime = Date.now();

      worker.markTaskFailed('task-to-fail');

      const state = worker.getStatus();
      expect(state.lastHeartbeat).toBe(expectedTime);
    });

    it('should log warning message with failure details', () => {
      const testError = new Error('Test failure reason');
      worker.markTaskFailed('task-to-fail', testError);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Worker failed task',
        expect.objectContaining({
          worker: 'test-worker',
          taskId: 'task-to-fail',
          failedCount: 1,
          error: 'Test failure reason',
        })
      );
    });

    it('should track multiple failures and exclude all failed tasks', () => {
      worker.markTaskFailed('task-1');
      worker.markTaskStarted('task-2');
      worker.markTaskFailed('task-2');
      worker.markTaskStarted('task-3');
      worker.markTaskFailed('task-3');

      const state = worker.getStatus();
      expect(state.failedCount).toBe(3);
      expect(state.excludeTaskIds).toContain('task-1');
      expect(state.excludeTaskIds).toContain('task-2');
      expect(state.excludeTaskIds).toContain('task-3');
    });
  });

  describe('shouldShutdown()', () => {
    it('should return false when worker just started', () => {
      expect(worker.shouldShutdown()).toBe(false);
    });

    it('should return false when idle less than idleTimeoutMs', () => {
      // Advance time by less than idleTimeoutMs (60000)
      vi.advanceTimersByTime(30000);

      expect(worker.shouldShutdown()).toBe(false);
    });

    it('should return true when idle longer than idleTimeoutMs', () => {
      // Advance time by more than idleTimeoutMs (60000)
      vi.advanceTimersByTime(60001);

      expect(worker.shouldShutdown()).toBe(true);
    });

    it('should reset activity time when task starts', () => {
      // Advance halfway to timeout
      vi.advanceTimersByTime(30000);

      // Start a task - this resets the activity time
      worker.markTaskStarted('current-task');

      // Advance another 30 seconds (would be past original timeout)
      vi.advanceTimersByTime(30000);

      // Should not shutdown because activity time was reset when task started
      expect(worker.shouldShutdown()).toBe(false);

      // Advance past timeout from task start time
      vi.advanceTimersByTime(31000);
      expect(worker.shouldShutdown()).toBe(true);
    });

    it('should reset idle timer when task is completed', () => {
      worker.markTaskStarted('task-1');
      vi.advanceTimersByTime(50000);
      worker.markTaskCompleted('task-1');

      // Advance less than timeout from completion
      vi.advanceTimersByTime(30000);
      expect(worker.shouldShutdown()).toBe(false);

      // Advance past timeout from completion
      vi.advanceTimersByTime(31000);
      expect(worker.shouldShutdown()).toBe(true);
    });

    it('should reset idle timer when task fails', () => {
      worker.markTaskStarted('task-1');
      worker.markTaskFailed('task-1');

      // Advance less than timeout from failure
      vi.advanceTimersByTime(50000);
      expect(worker.shouldShutdown()).toBe(false);

      // Advance past timeout from failure
      vi.advanceTimersByTime(11000);
      expect(worker.shouldShutdown()).toBe(true);
    });

    it('should log info when idle timeout is reached', () => {
      vi.advanceTimersByTime(60001);

      worker.shouldShutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Worker idle timeout reached',
        expect.objectContaining({
          worker: 'test-worker',
          idleTimeoutMs: 60000,
        })
      );
    });
  });

  describe('getStatus()', () => {
    it('should return current WorkerState', () => {
      const state = worker.getStatus();

      expect(state).toMatchObject({
        name: 'test-worker',
        status: 'idle',
        completedCount: 0,
        failedCount: 0,
      });
    });

    it('should reflect status changes after starting task', () => {
      worker.markTaskStarted('task-123');

      const state = worker.getStatus();
      expect(state.status).toBe('working');
      expect(state.currentTask).toBe('task-123');
    });

    it('should reflect status changes after completing task', () => {
      worker.markTaskStarted('task-123');
      worker.markTaskCompleted('task-123');

      const state = worker.getStatus();
      expect(state.status).toBe('idle');
      expect(state.currentTask).toBeUndefined();
      expect(state.completedCount).toBe(1);
    });

    it('should reflect status changes after failing task', () => {
      worker.markTaskStarted('task-123');
      worker.markTaskFailed('task-123');

      const state = worker.getStatus();
      expect(state.status).toBe('idle');
      expect(state.currentTask).toBeUndefined();
      expect(state.failedCount).toBe(1);
      expect(state.excludeTaskIds).toContain('task-123');
    });

    it('should return a copy of state (not the original)', () => {
      const state1 = worker.getStatus();
      const state2 = worker.getStatus();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('additional methods', () => {
    describe('getName()', () => {
      it('should return the worker name', () => {
        expect(worker.getName()).toBe('test-worker');
      });
    });

    describe('isWorking()', () => {
      it('should return false when idle', () => {
        expect(worker.isWorking()).toBe(false);
      });

      it('should return true when working on a task', () => {
        worker.markTaskStarted('task-123');
        expect(worker.isWorking()).toBe(true);
      });

      it('should return false after task completion', () => {
        worker.markTaskStarted('task-123');
        worker.markTaskCompleted('task-123');
        expect(worker.isWorking()).toBe(false);
      });
    });

    describe('excludeTask()', () => {
      it('should add task to exclude list', () => {
        worker.excludeTask('excluded-task');

        const state = worker.getStatus();
        expect(state.excludeTaskIds).toContain('excluded-task');
      });

      it('should not add duplicate task IDs', () => {
        worker.excludeTask('same-task');
        worker.excludeTask('same-task');

        const state = worker.getStatus();
        const occurrences = state.excludeTaskIds?.filter(id => id === 'same-task').length;
        expect(occurrences).toBe(1);
      });
    });

    describe('heartbeat()', () => {
      it('should update lastHeartbeat timestamp', () => {
        vi.advanceTimersByTime(5000);
        const expectedTime = Date.now();

        worker.heartbeat();

        const state = worker.getStatus();
        expect(state.lastHeartbeat).toBe(expectedTime);
      });
    });

    describe('shutdown()', () => {
      it('should set status to shutdown', () => {
        worker.shutdown();

        const state = worker.getStatus();
        expect(state.status).toBe('shutdown');
      });

      it('should log shutdown with final counts', () => {
        worker.markTaskStarted('task-1');
        worker.markTaskCompleted('task-1');
        worker.markTaskStarted('task-2');
        worker.markTaskFailed('task-2');

        worker.shutdown();

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Worker shutdown',
          expect.objectContaining({
            worker: 'test-worker',
            completedCount: 1,
            failedCount: 1,
          })
        );
      });
    });

    describe('updateState()', () => {
      it('should update state with partial updates', () => {
        worker.updateState({ completedCount: 5 });

        const state = worker.getStatus();
        expect(state.completedCount).toBe(5);
        expect(state.status).toBe('idle'); // Other fields unchanged
      });

      it('should update lastHeartbeat on any state update', () => {
        vi.advanceTimersByTime(10000);
        const expectedTime = Date.now();

        worker.updateState({ failedCount: 2 });

        const state = worker.getStatus();
        expect(state.lastHeartbeat).toBe(expectedTime);
      });
    });
  });
});
