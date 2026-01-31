/**
 * Router Engine
 *
 * The main orchestration logic for AgentRouter.
 * Responsible for resolving roles to configurations and executing
 * agent invocations against the appropriate providers.
 *
 * Key responsibilities:
 * - Invoking agents by role with proper message construction
 * - Comparing responses from multiple agents in parallel
 * - Handling fallback providers when primary fails
 * - Logging request/response metadata for observability
 */

import { generateTraceId ,type  Logger } from '../observability/logger.js';
import { ProviderError ,type
  Config,type
  InvokeAgentInput,type
  AgentResponse,type
  AgentConfig,type
  Message,type
  CompletionRequest,
} from '../types.js';

import { RoleResolver } from './role-resolver.js';

import type { ProviderManager } from '../providers/manager.js';


// ============================================================================
// Types
// ============================================================================

/**
 * Options for configuring the RouterEngine.
 */
export interface RouterEngineOptions {
  /** Whether to enable fallback providers (default: true) */
  enableFallback?: boolean;
  /** Maximum retries before attempting fallback (default: 0) */
  maxRetries?: number;
}

/**
 * Result of a comparison operation for a single role.
 */
export interface ComparisonResult {
  role: string;
  status: 'fulfilled' | 'rejected';
  response?: AgentResponse;
  error?: Error;
}

// ============================================================================
// RouterEngine Class
// ============================================================================

/**
 * Main routing engine for AgentRouter.
 *
 * Handles:
 * - Role resolution to provider configurations
 * - Message building with system prompts and context
 * - Agent invocation with proper error handling
 * - Parallel comparison of multiple agents
 * - Fallback execution when primary providers fail
 *
 * @example
 * ```ts
 * const engine = new RouterEngine(config, providerManager, logger);
 *
 * // Invoke a single agent
 * const response = await engine.invokeAgent({
 *   role: 'coder',
 *   task: 'Write a function to sort an array',
 *   context: 'Using TypeScript',
 * });
 *
 * // Compare multiple agents
 * const results = await engine.compareAgents(
 *   ['coder', 'reviewer'],
 *   'Review this code for bugs'
 * );
 * ```
 */
export class RouterEngine {
  private roleResolver: RoleResolver;
  private readonly providers: ProviderManager;
  private readonly logger: Logger;
  private readonly options: Required<RouterEngineOptions>;

  /**
   * Create a new RouterEngine instance.
   *
   * @param config - Configuration object with role and provider definitions
   * @param providers - Provider manager for accessing LLM providers
   * @param logger - Logger instance for observability
   * @param options - Optional configuration for the engine
   */
  constructor(
    config: Config,
    providers: ProviderManager,
    logger: Logger,
    options: RouterEngineOptions = {}
  ) {
    this.roleResolver = new RoleResolver(config);
    this.providers = providers;
    this.logger = logger;
    this.options = {
      enableFallback: options.enableFallback ?? true,
      maxRetries: options.maxRetries ?? 0,
    };
  }

  /**
   * Invoke an agent by role.
   *
   * Flow:
   * 1. Generate trace ID for request correlation
   * 2. Log request start with role and task preview
   * 3. Resolve role to agent configuration
   * 4. Build messages array (system prompt + context + task)
   * 5. Get provider from ProviderManager
   * 6. Call provider.complete()
   * 7. Log response with duration and token usage
   * 8. Return AgentResponse
   * 9. On error: try fallback if configured, otherwise throw
   *
   * @param input - Input parameters including role, task, and optional context
   * @returns Promise resolving to the agent's response
   * @throws ProviderError if the provider fails and no fallback is available
   */
  async invokeAgent(input: InvokeAgentInput): Promise<AgentResponse> {
    const startTime = Date.now();
    const traceId = generateTraceId();

    this.logger.info('Invoking agent', {
      traceId,
      role: input.role,
      taskPreview: input.task.substring(0, 100) + (input.task.length > 100 ? '...' : ''),
      hasContext: !!input.context,
      hasTools: !!input.tools?.length,
    });

    try {
      // 1. Resolve role to agent configuration
      const agentConfig = this.roleResolver.resolve(input.role);

      this.logger.debug('Role resolved', {
        traceId,
        role: input.role,
        provider: agentConfig.provider,
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.max_tokens,
      });

      // 2. Build messages with system prompt and context
      const messages = this.buildMessages(agentConfig, input);

      // 3. Get provider for this agent
      const provider = this.providers.get(agentConfig.provider);

      // 4. Build completion request
      const request: CompletionRequest = {
        model: agentConfig.model,
        messages,
        temperature: agentConfig.temperature,
        max_tokens: agentConfig.max_tokens,
        timeout_ms: agentConfig.timeout_ms,
      };

      // Only add tools if provided (exactOptionalPropertyTypes compliance)
      if (input.tools && input.tools.length > 0) {
        request.tools = input.tools;
      }

      // 5. Execute request
      const response = await provider.complete(request);

      // 6. Calculate duration and log success
      const durationMs = Date.now() - startTime;

      this.logger.info('Agent response received', {
        traceId,
        role: input.role,
        provider: agentConfig.provider,
        model: agentConfig.model,
        durationMs,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        stopReason: response.stop_reason,
      });

      // 7. Return formatted response
      const result: AgentResponse = {
        role: input.role,
        provider: agentConfig.provider,
        model: agentConfig.model,
        content: response.content,
        metadata: {
          traceId,
          durationMs,
        },
      };

      // Only add usage if provided (exactOptionalPropertyTypes compliance)
      if (response.usage) {
        result.usage = response.usage;
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Agent invocation failed', {
        traceId,
        role: input.role,
        durationMs,
        errorMessage,
      });

      // Try fallback if configured and enabled
      if (this.options.enableFallback) {
        const agentConfig = this.roleResolver.resolve(input.role);

        if (agentConfig.fallback) {
          this.logger.info('Attempting fallback provider', {
            traceId,
            role: input.role,
            fallbackProvider: agentConfig.fallback.provider,
            fallbackModel: agentConfig.fallback.model,
          });

          return this.invokeWithFallback(input, agentConfig, traceId, startTime);
        }
      }

      // Re-throw if no fallback available
      throw error;
    }
  }

  /**
   * Compare responses from multiple agents for the same task.
   *
   * Executes all agents in parallel using Promise.allSettled to ensure
   * all results are collected even if some fail.
   *
   * @param roles - Array of role names to invoke
   * @param task - The task to send to all agents
   * @returns Map of role names to their responses (only includes successful results)
   */
  async compareAgents(roles: string[], task: string): Promise<Map<string, AgentResponse>> {
    const traceId = generateTraceId();
    const startTime = Date.now();

    this.logger.info('Starting agent comparison', {
      traceId,
      roles,
      taskPreview: task.substring(0, 100) + (task.length > 100 ? '...' : ''),
    });

    const results = new Map<string, AgentResponse>();

    // Execute all agents in parallel
    const promises = roles.map(async (role) => {
      try {
        const response = await this.invokeAgent({ role, task });
        return { role, status: 'fulfilled' as const, response };
      } catch (error) {
        return {
          role,
          status: 'rejected' as const,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    });

    const responses = await Promise.allSettled(promises);

    // Process results
    for (const result of responses) {
      if (result.status === 'fulfilled') {
        const { role, status, response, error } = result.value;

        if (status === 'fulfilled' && response) {
          results.set(role, response);
        } else if (status === 'rejected' && error) {
          this.logger.error('Agent comparison failed for role', {
            traceId,
            role,
            errorMessage: error.message,
          });
        }
      } else {
        // This shouldn't happen since we catch errors in the promise,
        // but handle it just in case
        const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.error('Unexpected error in agent comparison', {
          traceId,
          errorMessage,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    this.logger.info('Agent comparison completed', {
      traceId,
      totalRoles: roles.length,
      successfulRoles: results.size,
      failedRoles: roles.length - results.size,
      durationMs,
    });

    return results;
  }

  /**
   * Update the configuration.
   * This recreates the RoleResolver with the new configuration.
   *
   * @param config - New configuration object
   */
  updateConfig(config: Config): void {
    this.logger.info('Updating router configuration', {
      version: config.version,
      roleCount: Object.keys(config.roles).length,
    });

    this.roleResolver = new RoleResolver(config);
  }

  /**
   * Get the list of available roles.
   *
   * @returns Array of role names
   */
  listRoles(): string[] {
    return this.roleResolver.listRoles();
  }

  /**
   * Check if a role is configured.
   *
   * @param role - Role name to check
   * @returns True if the role exists
   */
  hasRole(role: string): boolean {
    return this.roleResolver.hasRole(role);
  }

  /**
   * Resolve a role to its full agent configuration.
   *
   * @param role - Role name to resolve
   * @returns Resolved agent configuration with all defaults applied
   * @throws Error if the role does not exist
   */
  resolveRole(role: string): AgentConfig {
    return this.roleResolver.resolve(role);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build the messages array for a completion request.
   *
   * Message structure:
   * 1. System prompt (if configured) - wrapped in <system> tags
   * 2. Context (if provided) - wrapped in <context> tags
   * 3. Task - the actual user request
   *
   * @param agentConfig - Resolved agent configuration
   * @param input - Input parameters with task and optional context
   * @returns Array of messages for the completion request
   */
  private buildMessages(agentConfig: AgentConfig, input: InvokeAgentInput): Message[] {
    const messages: Message[] = [];

    // Add system prompt if configured
    // Note: Some providers handle system prompts differently
    // The translation layer will convert this appropriately
    if (agentConfig.system_prompt) {
      messages.push({
        role: 'user',
        content: `<system>\n${agentConfig.system_prompt}\n</system>`,
      });
      // Add assistant acknowledgment for better prompt structure
      messages.push({
        role: 'assistant',
        content:
          'I understand my role and will respond accordingly. Please provide your request.',
      });
    }

    // Add context if provided
    if (input.context) {
      messages.push({
        role: 'user',
        content: `<context>\n${input.context}\n</context>`,
      });
    }

    // Add the actual task
    messages.push({
      role: 'user',
      content: input.task,
    });

    return messages;
  }

  /**
   * Invoke an agent using its fallback configuration.
   *
   * @param input - Original input parameters
   * @param originalConfig - Original agent configuration (contains fallback)
   * @param traceId - Trace ID for correlation
   * @param startTime - Original start time for duration calculation
   * @returns Promise resolving to the agent's response
   */
  private async invokeWithFallback(
    input: InvokeAgentInput,
    originalConfig: AgentConfig,
    traceId: string,
    startTime: number
  ): Promise<AgentResponse> {
    const fallbackConfig = originalConfig.fallback!;
    const fallbackStartTime = Date.now();

    try {
      // Build a synthetic agent config from the fallback
      const syntheticConfig: AgentConfig = {
        provider: fallbackConfig.provider,
        model: fallbackConfig.model,
        // Inherit other settings from original config
        temperature: originalConfig.temperature,
        max_tokens: originalConfig.max_tokens,
        timeout_ms: originalConfig.timeout_ms,
        // No nested fallback to prevent infinite recursion
      };

      // Only add system_prompt if defined (exactOptionalPropertyTypes compliance)
      if (originalConfig.system_prompt) {
        syntheticConfig.system_prompt = originalConfig.system_prompt;
      }

      // Build messages with the synthetic config
      const messages = this.buildMessages(syntheticConfig, input);

      // Get the fallback provider
      const provider = this.providers.get(fallbackConfig.provider);

      // Build completion request
      const request: CompletionRequest = {
        model: fallbackConfig.model,
        messages,
        temperature: syntheticConfig.temperature,
        max_tokens: syntheticConfig.max_tokens,
        timeout_ms: syntheticConfig.timeout_ms,
      };

      // Only add tools if provided (exactOptionalPropertyTypes compliance)
      if (input.tools && input.tools.length > 0) {
        request.tools = input.tools;
      }

      // Execute request
      const response = await provider.complete(request);

      const durationMs = Date.now() - startTime;
      const fallbackDurationMs = Date.now() - fallbackStartTime;

      this.logger.info('Fallback agent response received', {
        traceId,
        role: input.role,
        provider: fallbackConfig.provider,
        model: fallbackConfig.model,
        durationMs,
        fallbackDurationMs,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      });

      const result: AgentResponse = {
        role: input.role,
        provider: fallbackConfig.provider,
        model: fallbackConfig.model,
        content: response.content,
        metadata: {
          traceId,
          durationMs,
        },
      };

      // Only add usage if provided (exactOptionalPropertyTypes compliance)
      if (response.usage) {
        result.usage = response.usage;
      }

      return result;
    } catch (fallbackError) {
      const durationMs = Date.now() - startTime;
      const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

      this.logger.error('Fallback invocation also failed', {
        traceId,
        role: input.role,
        fallbackProvider: fallbackConfig.provider,
        durationMs,
        errorMessage,
      });

      throw new ProviderError(
        `Both primary and fallback providers failed for role '${input.role}'`,
        fallbackConfig.provider,
        undefined,
        fallbackError instanceof Error ? fallbackError : undefined
      );
    }
  }
}

/**
 * Create a RouterEngine instance with default options.
 *
 * @param config - Configuration object
 * @param providers - Provider manager
 * @param logger - Logger instance
 * @param options - Optional engine configuration
 * @returns Configured RouterEngine instance
 */
export function createRouterEngine(
  config: Config,
  providers: ProviderManager,
  logger: Logger,
  options?: RouterEngineOptions
): RouterEngine {
  return new RouterEngine(config, providers, logger, options);
}
