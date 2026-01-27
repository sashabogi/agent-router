/**
 * Pattern Executor
 *
 * Orchestrates multi-agent workflows using various execution patterns.
 * Provides high-level patterns for agent collaboration including:
 * - Sequential pipelines (A → B → C)
 * - Parallel comparison (same task to multiple agents)
 * - Generator-Critic loops (generate → critique → improve)
 * - Consensus building (propose → vote → synthesize)
 *
 * Each pattern leverages the RouterEngine for individual agent invocations
 * while managing the overall workflow state and data flow between agents.
 */

import { generateTraceId, type Logger } from '../observability/logger.js';

import type { AgentResponse, ContentBlock } from '../types.js';
import type { RouterEngine } from './engine.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Step definition for sequential pipeline execution.
 */
export interface SequentialStep {
  /** The role of the agent to invoke for this step */
  role: string;
  /** Task template for this step. Use {{input}} or {{previousOutput}} placeholders */
  taskTemplate: string;
  /** Optional transform function to modify input before sending to agent */
  transform?: (input: string) => string;
}

/**
 * Result of a sequential pipeline execution.
 */
export interface SequentialResult {
  /** Pattern identifier */
  pattern: 'sequential';
  /** All step responses in order */
  steps: AgentResponse[];
  /** Final output text from the last step */
  finalOutput: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Trace ID for correlation */
  traceId: string;
}

/**
 * Result of a parallel comparison execution.
 */
export interface ParallelResult {
  /** Pattern identifier */
  pattern: 'parallel';
  /** Map of role names to their responses */
  responses: Map<string, AgentResponse>;
  /** Errors for roles that failed */
  errors: Map<string, Error>;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Trace ID for correlation */
  traceId: string;
}

/**
 * Result of a generator-critic loop execution.
 */
export interface CriticLoopResult {
  /** Pattern identifier */
  pattern: 'critic-loop';
  /** Number of iterations completed */
  iterations: number;
  /** Final response from the generator */
  finalResponse: AgentResponse;
  /** Complete history of all generation and critique responses */
  history: CriticLoopIteration[];
  /** Whether the critic approved the final result */
  approved: boolean;
  /** Final output text */
  finalOutput: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Trace ID for correlation */
  traceId: string;
}

/**
 * Single iteration of a critic loop.
 */
export interface CriticLoopIteration {
  /** Iteration number (1-indexed) */
  iteration: number;
  /** Generator's response */
  generation: AgentResponse;
  /** Critic's response */
  critique: AgentResponse;
  /** Whether the critic approved this iteration */
  approved: boolean;
}

/**
 * Result of a consensus building execution.
 */
export interface ConsensusResult {
  /** Pattern identifier */
  pattern: 'consensus';
  /** Initial proposals from all participating roles */
  proposals: Map<string, AgentResponse>;
  /** Votes/assessments from each role on all proposals */
  votes: Map<string, AgentResponse>;
  /** Final synthesized recommendation */
  synthesis: AgentResponse;
  /** Final output text */
  finalOutput: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Trace ID for correlation */
  traceId: string;
}

/**
 * Options for critic loop execution.
 */
export interface CriticLoopOptions {
  /** Maximum number of iterations (default: 3) */
  maxIterations?: number;
  /** Custom approval detection function */
  isApproved?: (critique: string) => boolean;
  /** Custom task template for critique requests */
  critiqueTaskTemplate?: string;
  /** Custom task template for improvement requests */
  improvementTaskTemplate?: string;
}

/**
 * Options for consensus building execution.
 */
export interface ConsensusOptions {
  /** Role to use for final synthesis (default: first role in list) */
  synthesizeRole?: string;
  /** Custom task template for voting phase */
  voteTaskTemplate?: string;
  /** Custom task template for synthesis phase */
  synthesisTaskTemplate?: string;
}

/**
 * Union type of all orchestration results.
 */
export type OrchestrationResult =
  | SequentialResult
  | ParallelResult
  | CriticLoopResult
  | ConsensusResult;

// ============================================================================
// Default Templates
// ============================================================================

const DEFAULT_CRITIQUE_TEMPLATE = `Please critique the following and identify any issues, improvements, or concerns:

{{content}}

Provide specific, actionable feedback. If the work is satisfactory with no major issues, say "approved" or "looks good".`;

const DEFAULT_IMPROVEMENT_TEMPLATE = `Based on this feedback:

{{critique}}

Please improve your previous response:

{{original}}`;

const DEFAULT_VOTE_TEMPLATE = `Given these proposals:

{{proposals}}

Which approach do you think is best and why? You may also suggest combining elements from different proposals.`;

const DEFAULT_SYNTHESIS_TEMPLATE = `Based on the following proposals and assessments, synthesize a final recommendation:

## Proposals
{{proposals}}

## Assessments
{{votes}}

Provide a comprehensive final recommendation that incorporates the best ideas.`;

// ============================================================================
// Satisfaction Detection
// ============================================================================

/**
 * Default list of indicators that suggest the critic is satisfied.
 */
const SATISFACTION_INDICATORS = [
  'looks good',
  'looks great',
  'well done',
  'no major issues',
  'no significant issues',
  'no critical issues',
  'satisfied',
  'approved',
  'no changes needed',
  'ready for',
  'excellent work',
  'solid implementation',
  'meets requirements',
  'lgtm',
  'ship it',
];

/**
 * Default function to detect if a critique indicates approval.
 */
function defaultIsApproved(critique: string): boolean {
  const lower = critique.toLowerCase();
  return SATISFACTION_INDICATORS.some((indicator) => lower.includes(indicator));
}

// ============================================================================
// PatternExecutor Class
// ============================================================================

/**
 * Orchestrates multi-agent workflows using various execution patterns.
 *
 * @example
 * ```typescript
 * const executor = new PatternExecutor(routerEngine, logger);
 *
 * // Sequential pipeline
 * const result = await executor.executeSequential([
 *   { role: 'coder', taskTemplate: 'Implement: {{input}}' },
 *   { role: 'reviewer', taskTemplate: 'Review this code: {{previousOutput}}' },
 * ], 'Create a sorting function');
 *
 * // Parallel comparison
 * const comparison = await executor.executeParallel(
 *   ['coder', 'researcher'],
 *   'What are the best practices for error handling?'
 * );
 *
 * // Critic loop
 * const improved = await executor.executeCriticLoop(
 *   'coder',
 *   'critic',
 *   'Write a REST API endpoint',
 *   { maxIterations: 3 }
 * );
 * ```
 */
export class PatternExecutor {
  constructor(
    private readonly router: RouterEngine,
    private readonly logger: Logger
  ) {}

  // ==========================================================================
  // Sequential Pipeline
  // ==========================================================================

  /**
   * Execute a sequential pipeline of agents.
   *
   * Each agent's output becomes input to the next. Task templates can use
   * placeholders:
   * - `{{input}}` - The original input or previous step's output
   * - `{{previousOutput}}` - Alias for input from previous step
   *
   * @param steps - Array of step definitions with roles and task templates
   * @param initialInput - Initial input to the first step
   * @returns Promise resolving to SequentialResult with all step outputs
   *
   * @example
   * ```typescript
   * const result = await executor.executeSequential([
   *   { role: 'coder', taskTemplate: '{{input}}' },
   *   { role: 'reviewer', taskTemplate: 'Review: {{previousOutput}}' },
   *   { role: 'coder', taskTemplate: 'Fix issues: {{previousOutput}}' },
   * ], 'Write a function to validate email addresses');
   * ```
   */
  async executeSequential(
    steps: SequentialStep[],
    initialInput: string
  ): Promise<SequentialResult> {
    const startTime = Date.now();
    const traceId = generateTraceId();

    this.logger.info('Starting sequential pipeline', {
      traceId,
      stepCount: steps.length,
      roles: steps.map((s) => s.role),
      inputPreview: this.truncate(initialInput, 100),
    });

    const results: AgentResponse[] = [];
    let currentInput = initialInput;

    for (const [i, step] of steps.entries()) {
      const stepNumber = i + 1;

      this.logger.debug('Executing sequential step', {
        traceId,
        step: stepNumber,
        role: step.role,
      });

      // Apply transform if provided
      const transformedInput = step.transform
        ? step.transform(currentInput)
        : currentInput;

      // Build task from template
      const task = this.interpolateTemplate(step.taskTemplate, {
        input: transformedInput,
        previousOutput: transformedInput,
      });

      // Invoke the agent
      const response = await this.router.invokeAgent({
        role: step.role,
        task,
      });

      results.push(response);

      // Extract text content for next step
      currentInput = this.extractText(response);

      this.logger.debug('Sequential step completed', {
        traceId,
        step: stepNumber,
        role: step.role,
        outputPreview: this.truncate(currentInput, 100),
      });
    }

    const totalDurationMs = Date.now() - startTime;

    this.logger.info('Sequential pipeline completed', {
      traceId,
      stepCount: steps.length,
      totalDurationMs,
      outputPreview: this.truncate(currentInput, 100),
    });

    return {
      pattern: 'sequential',
      steps: results,
      finalOutput: currentInput,
      totalDurationMs,
      traceId,
    };
  }

  // ==========================================================================
  // Parallel Comparison
  // ==========================================================================

  /**
   * Execute the same task through multiple agents in parallel.
   *
   * All agents receive the same task and run concurrently. Results are
   * collected for comparison. Errors for individual agents don't fail
   * the entire operation.
   *
   * @param roles - Array of role names to invoke
   * @param task - The task to send to all agents
   * @returns Promise resolving to ParallelResult with all agent responses
   *
   * @example
   * ```typescript
   * const result = await executor.executeParallel(
   *   ['coder', 'researcher', 'critic'],
   *   'What is the best approach to implement caching?'
   * );
   *
   * for (const [role, response] of result.responses) {
   *   console.log(`${role}: ${extractText(response)}`);
   * }
   * ```
   */
  async executeParallel(roles: string[], task: string): Promise<ParallelResult> {
    const startTime = Date.now();
    const traceId = generateTraceId();

    this.logger.info('Starting parallel comparison', {
      traceId,
      roles,
      taskPreview: this.truncate(task, 100),
    });

    const responses = new Map<string, AgentResponse>();
    const errors = new Map<string, Error>();

    // Execute all agents in parallel
    const promises = roles.map(async (role) => {
      try {
        const response = await this.router.invokeAgent({ role, task });
        return { role, status: 'fulfilled' as const, response };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { role, status: 'rejected' as const, error: err };
      }
    });

    const results = await Promise.allSettled(promises);

    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { role, status, response, error } = result.value;

        if (status === 'fulfilled') {
          responses.set(role, response);
        } else {
          errors.set(role, error);
          this.logger.error('Parallel agent failed', {
            traceId,
            role,
            errorMessage: error.message,
          });
        }
      } else {
        // This shouldn't happen since we catch errors in the promise
        this.logger.error('Unexpected error in parallel execution', {
          traceId,
          reason: result.reason as unknown,
        });
      }
    }

    const totalDurationMs = Date.now() - startTime;

    this.logger.info('Parallel comparison completed', {
      traceId,
      totalRoles: roles.length,
      successfulRoles: responses.size,
      failedRoles: errors.size,
      totalDurationMs,
    });

    return {
      pattern: 'parallel',
      responses,
      errors,
      totalDurationMs,
      traceId,
    };
  }

  // ==========================================================================
  // Generator-Critic Loop
  // ==========================================================================

  /**
   * Execute a generator-critic improvement loop.
   *
   * The generator creates an initial response, then the critic reviews it.
   * If the critic identifies issues, the generator improves based on feedback.
   * This continues until the critic approves or max iterations is reached.
   *
   * @param generatorRole - Role for generating content
   * @param criticRole - Role for critiquing content
   * @param task - Initial task for the generator
   * @param options - Optional configuration for the loop
   * @returns Promise resolving to CriticLoopResult with iteration history
   *
   * @example
   * ```typescript
   * const result = await executor.executeCriticLoop(
   *   'coder',
   *   'critic',
   *   'Write a function to parse JSON with error handling',
   *   { maxIterations: 3 }
   * );
   *
   * if (result.approved) {
   *   console.log('Critic approved the final version');
   * }
   * console.log(`Completed in ${result.iterations} iterations`);
   * ```
   */
  async executeCriticLoop(
    generatorRole: string,
    criticRole: string,
    task: string,
    options: CriticLoopOptions = {}
  ): Promise<CriticLoopResult> {
    const startTime = Date.now();
    const traceId = generateTraceId();
    const maxIterations = options.maxIterations ?? 3;
    const isApprovedFn = options.isApproved ?? defaultIsApproved;
    const critiqueTemplate = options.critiqueTaskTemplate ?? DEFAULT_CRITIQUE_TEMPLATE;
    const improvementTemplate =
      options.improvementTaskTemplate ?? DEFAULT_IMPROVEMENT_TEMPLATE;

    this.logger.info('Starting critic loop', {
      traceId,
      generatorRole,
      criticRole,
      maxIterations,
      taskPreview: this.truncate(task, 100),
    });

    const history: CriticLoopIteration[] = [];
    let currentTask = task;
    let approved = false;
    let finalResponse: AgentResponse | undefined;

    for (let i = 0; i < maxIterations; i++) {
      const iteration = i + 1;

      this.logger.debug('Critic loop iteration starting', {
        traceId,
        iteration,
        maxIterations,
      });

      // Generate
      const generation = await this.router.invokeAgent({
        role: generatorRole,
        task: currentTask,
      });

      const generatedContent = this.extractText(generation);
      finalResponse = generation;

      // Critique
      const critiqueTask = this.interpolateTemplate(critiqueTemplate, {
        content: generatedContent,
      });

      const critique = await this.router.invokeAgent({
        role: criticRole,
        task: critiqueTask,
      });

      const critiqueContent = this.extractText(critique);
      approved = isApprovedFn(critiqueContent);

      history.push({
        iteration,
        generation,
        critique,
        approved,
      });

      this.logger.debug('Critic loop iteration completed', {
        traceId,
        iteration,
        approved,
        critiquePreview: this.truncate(critiqueContent, 100),
      });

      // Stop if approved
      if (approved) {
        this.logger.info('Critic loop: approval received', {
          traceId,
          iteration,
        });
        break;
      }

      // Prepare improvement task for next iteration
      if (i < maxIterations - 1) {
        currentTask = this.interpolateTemplate(improvementTemplate, {
          critique: critiqueContent,
          original: generatedContent,
        });
      }
    }

    const totalDurationMs = Date.now() - startTime;

    this.logger.info('Critic loop completed', {
      traceId,
      iterations: history.length,
      approved,
      totalDurationMs,
    });

    // This should never be undefined, but TypeScript needs the check
    if (!finalResponse) {
      throw new Error('No generation was produced in critic loop');
    }

    return {
      pattern: 'critic-loop',
      iterations: history.length,
      finalResponse,
      history,
      approved,
      finalOutput: this.extractText(finalResponse),
      totalDurationMs,
      traceId,
    };
  }

  // ==========================================================================
  // Consensus Building
  // ==========================================================================

  /**
   * Execute a consensus building workflow.
   *
   * Three phases:
   * 1. Proposals: All roles respond to the initial question
   * 2. Voting: Each role evaluates all proposals
   * 3. Synthesis: A designated role synthesizes a final recommendation
   *
   * @param roles - Array of role names to participate
   * @param question - The question or decision to reach consensus on
   * @param options - Optional configuration for the workflow
   * @returns Promise resolving to ConsensusResult with all phases
   *
   * @example
   * ```typescript
   * const result = await executor.executeConsensus(
   *   ['coder', 'critic', 'designer'],
   *   'What is the best architecture for a real-time chat application?',
   *   { synthesizeRole: 'coder' }
   * );
   *
   * console.log('Final recommendation:', result.finalOutput);
   * ```
   */
  async executeConsensus(
    roles: string[],
    question: string,
    options: ConsensusOptions = {}
  ): Promise<ConsensusResult> {
    const startTime = Date.now();
    const traceId = generateTraceId();
    const firstRole = roles[0];
    if (firstRole === undefined || firstRole === '') {
      throw new Error('Cannot execute consensus with empty roles array');
    }
    const synthesizeRole = options.synthesizeRole ?? firstRole;
    const voteTemplate = options.voteTaskTemplate ?? DEFAULT_VOTE_TEMPLATE;
    const synthesisTemplate = options.synthesisTaskTemplate ?? DEFAULT_SYNTHESIS_TEMPLATE;

    this.logger.info('Starting consensus building', {
      traceId,
      roles,
      synthesizeRole,
      questionPreview: this.truncate(question, 100),
    });

    // Phase 1: Collect proposals
    this.logger.debug('Consensus phase 1: Collecting proposals', { traceId });
    const proposalsResult = await this.executeParallel(roles, question);

    // Phase 2: Have each agent vote/comment on others' proposals
    this.logger.debug('Consensus phase 2: Voting on proposals', { traceId });

    const proposalText = this.formatProposals(proposalsResult.responses);

    const voteTask = this.interpolateTemplate(voteTemplate, {
      proposals: proposalText,
    });

    const votesResult = await this.executeParallel(roles, voteTask);

    // Phase 3: Synthesize
    this.logger.debug('Consensus phase 3: Synthesizing final recommendation', {
      traceId,
    });

    const votesText = this.formatVotes(votesResult.responses);

    const synthesisTask = this.interpolateTemplate(synthesisTemplate, {
      proposals: proposalText,
      votes: votesText,
    });

    const synthesis = await this.router.invokeAgent({
      role: synthesizeRole,
      task: synthesisTask,
    });

    const totalDurationMs = Date.now() - startTime;

    this.logger.info('Consensus building completed', {
      traceId,
      proposalCount: proposalsResult.responses.size,
      voteCount: votesResult.responses.size,
      totalDurationMs,
    });

    return {
      pattern: 'consensus',
      proposals: proposalsResult.responses,
      votes: votesResult.responses,
      synthesis,
      finalOutput: this.extractText(synthesis),
      totalDurationMs,
      traceId,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Extract text content from an agent response.
   *
   * @param response - Agent response to extract text from
   * @returns Concatenated text content from all text blocks
   */
  extractText(response: AgentResponse): string {
    return response.content
      .filter((block): block is ContentBlock & { text: string } =>
        block.type === 'text' && typeof block.text === 'string'
      )
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * Interpolate a template string with variable values.
   *
   * @param template - Template string with {{variable}} placeholders
   * @param variables - Object mapping variable names to values
   * @returns Interpolated string
   */
  private interpolateTemplate(
    template: string,
    variables: Record<string, string>
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Format proposals for display in templates.
   *
   * @param proposals - Map of role names to responses
   * @returns Formatted string with numbered proposals
   */
  private formatProposals(proposals: Map<string, AgentResponse>): string {
    let index = 1;
    const parts: string[] = [];

    for (const [role, response] of proposals) {
      parts.push(`## Proposal ${String(index)} (${role})\n${this.extractText(response)}`);
      index++;
    }

    return parts.join('\n\n');
  }

  /**
   * Format votes/assessments for display in templates.
   *
   * @param votes - Map of role names to vote responses
   * @returns Formatted string with role assessments
   */
  private formatVotes(votes: Map<string, AgentResponse>): string {
    const parts: string[] = [];

    for (const [role, response] of votes) {
      parts.push(`### ${role}'s assessment:\n${this.extractText(response)}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Truncate a string to a maximum length.
   *
   * @param str - String to truncate
   * @param maxLength - Maximum length before truncation
   * @returns Truncated string with ellipsis if needed
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength) + '...';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PatternExecutor instance.
 *
 * @param router - RouterEngine for agent invocations
 * @param logger - Logger for observability
 * @returns Configured PatternExecutor instance
 */
export function createPatternExecutor(
  router: RouterEngine,
  logger: Logger
): PatternExecutor {
  return new PatternExecutor(router, logger);
}
