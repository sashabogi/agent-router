/**
 * AgentRouter Type Definitions
 *
 * Core type definitions for the AgentRouter MCP server.
 * These types define the data structures for configuration, agents,
 * messages, providers, and MCP tools.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Root configuration object for AgentRouter.
 * Loaded from YAML config file with environment variable interpolation.
 */
export interface Config {
  /** Configuration schema version (e.g., "1.0") */
  version: string;
  /** Default values applied to all roles unless overridden */
  defaults: DefaultConfig;
  /** Role definitions mapping role names to their configurations */
  roles: Record<string, RoleConfig>;
  /** Provider configurations mapping provider names to their settings */
  providers: Record<string, ProviderConfig>;
}

/**
 * Default configuration values applied to all roles.
 * Individual roles can override these values.
 */
export interface DefaultConfig {
  /** Default temperature for LLM requests (0-2) */
  temperature: number;
  /** Default maximum tokens for LLM responses */
  max_tokens: number;
  /** Default timeout in milliseconds for LLM requests */
  timeout_ms: number;
}

/**
 * Configuration for a specific agent role.
 * Defines the provider, model, and optional overrides for a role.
 */
export interface RoleConfig {
  /** Provider name (must match a key in config.providers) */
  provider: string;
  /** Model identifier to use with the provider */
  model: string;
  /** System prompt / persona for this role */
  system_prompt?: string;
  /** Temperature override for this role (0-2) */
  temperature?: number;
  /** Max tokens override for this role */
  max_tokens?: number;
  /** Timeout override in milliseconds for this role */
  timeout_ms?: number;
  /** Fallback configuration if primary provider fails */
  fallback?: FallbackConfig;
}

/**
 * Fallback provider configuration.
 * Used when the primary provider fails or is unavailable.
 */
export interface FallbackConfig {
  /** Fallback provider name */
  provider: string;
  /** Fallback model identifier */
  model: string;
}

/**
 * Access mode for providers.
 * - "api": Uses API key with pay-per-token pricing
 * - "subscription": Uses CLI tool with subscription (Claude Code, Codex CLI, Gemini CLI, etc.)
 */
export type AccessMode = "api" | "subscription";

/**
 * Provider-specific configuration.
 * Contains credentials and settings for connecting to an LLM provider.
 */
export interface ProviderConfig {
  /** Access mode: "api" (pay-per-token) or "subscription" (CLI tools) */
  access_mode?: AccessMode;
  /** API key for authentication (supports ${ENV_VAR} interpolation) */
  api_key?: string;
  /** Base URL for the provider API (for self-hosted or proxy setups) */
  base_url?: string;
  /** Default model for this provider */
  default_model?: string;
  /** Organization ID (OpenAI) */
  organization?: string;
  /** Project ID (Google Cloud / Vertex AI) */
  project?: string;
  /** Region/location (Google Cloud / Vertex AI) */
  location?: string;
  /** Additional headers to include in API requests */
  headers?: Record<string, string>;
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Predefined agent roles.
 * These represent specialized AI agents with specific capabilities.
 */
export type AgentRole = 'coder' | 'critic' | 'designer' | 'researcher' | 'reviewer';

/**
 * Resolved agent configuration.
 * Created by merging role config with defaults.
 * All optional fields from RoleConfig become required here.
 */
export interface AgentConfig {
  /** Provider name */
  provider: string;
  /** Model identifier */
  model: string;
  /** System prompt / persona */
  system_prompt?: string;
  /** Temperature (always resolved, never undefined) */
  temperature: number;
  /** Max tokens (always resolved, never undefined) */
  max_tokens: number;
  /** Timeout in milliseconds (always resolved, never undefined) */
  timeout_ms: number;
  /** Fallback configuration if available */
  fallback?: FallbackConfig;
}

/**
 * Input parameters for invoking an agent.
 */
export interface InvokeAgentInput {
  /** Role name of the agent to invoke */
  role: string;
  /** Task description or question for the agent */
  task: string;
  /** Optional additional context from the conversation */
  context?: string;
  /** Optional tools to make available to the agent */
  tools?: Tool[];
}

/**
 * Response from an agent invocation.
 */
export interface AgentResponse {
  /** Role that was invoked */
  role: string;
  /** Provider that handled the request */
  provider: string;
  /** Model that generated the response */
  model: string;
  /** Response content blocks */
  content: ContentBlock[];
  /** Token usage information */
  usage?: UsageInfo;
  /** Request metadata */
  metadata: {
    /** Unique trace ID for this request */
    traceId: string;
    /** Total duration in milliseconds */
    durationMs: number;
  };
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Chat message in the conversation.
 * Used for building request messages to providers.
 */
export interface Message {
  /** Message role: user or assistant */
  role: 'user' | 'assistant';
  /** Message content (string or content blocks) */
  content: string | ContentBlock[];
}

/**
 * Content block within a message.
 * Supports text, tool use requests, and tool results.
 */
export interface ContentBlock {
  /** Type of content block */
  type: 'text' | 'tool_use' | 'tool_result';
  /** Text content (for type: "text") */
  text?: string;
  /** Tool use ID (for type: "tool_use") */
  id?: string;
  /** Tool name (for type: "tool_use") */
  name?: string;
  /** Tool input parameters (for type: "tool_use") */
  input?: Record<string, unknown>;
  /** Reference to tool_use ID (for type: "tool_result") */
  tool_use_id?: string;
  /** Tool result content (for type: "tool_result") */
  content?: string;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool definition for agent tool use.
 * Follows the Anthropic tool schema format.
 */
export interface Tool {
  /** Tool name (must be unique within a request) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for the tool's input parameters */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported LLM provider types.
 */
export type ProviderType = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'zai' | 'ollama' | 'openrouter';

/**
 * Request to complete a conversation.
 * Sent to providers after translation.
 */
export interface CompletionRequest {
  /** Model identifier */
  model: string;
  /** Conversation messages */
  messages: Message[];
  /** Temperature for response generation (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  max_tokens?: number;
  /** Tools available for the model to use */
  tools?: Tool[];
  /** Whether to stream the response */
  stream?: boolean;
}

/**
 * Response from a completion request.
 * Normalized format returned by all providers.
 */
export interface CompletionResponse {
  /** Unique response ID from the provider */
  id: string;
  /** Response content blocks */
  content: ContentBlock[];
  /** Model that generated the response */
  model: string;
  /** Reason the generation stopped (e.g., "end_turn", "tool_use") */
  stop_reason: string;
  /** Token usage information */
  usage?: UsageInfo;
}

/**
 * Token usage information for a request/response.
 */
export interface UsageInfo {
  /** Number of tokens in the input/prompt */
  input_tokens: number;
  /** Number of tokens in the output/completion */
  output_tokens: number;
  /** Tokens used to create prompt cache (Anthropic) */
  cache_creation_input_tokens?: number;
  /** Tokens read from prompt cache (Anthropic) */
  cache_read_input_tokens?: number;
}

/**
 * Provider interface that all provider adapters must implement.
 */
export interface Provider {
  /** Provider name identifier */
  name: string;
  /** Execute a completion request and return the full response */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Execute a streaming completion request */
  completeStream(request: CompletionRequest): AsyncIterable<StreamChunk>;
  /** Check if the provider is available and configured correctly */
  healthCheck(): Promise<void>;
}

/**
 * Chunk of a streaming response.
 */
export interface StreamChunk {
  /** Type of streaming event */
  type: 'content_block_start' | 'content_block_delta' | 'message_stop';
  /** Index of the content block (for multi-block responses) */
  index?: number;
  /** Content block being started (for content_block_start) */
  content_block?: ContentBlock;
  /** Delta update to content (for content_block_delta) */
  delta?: {
    type: string;
    text?: string;
  };
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * Input schema for the invoke_agent MCP tool.
 */
export interface InvokeAgentToolInput {
  /** The agent role to invoke */
  role: AgentRole | string;
  /** The task description or question for the agent */
  task: string;
  /** Optional additional context from the current conversation */
  context?: string;
}

/**
 * Input schema for the compare_agents MCP tool.
 */
export interface CompareAgentsToolInput {
  /** List of role names to compare */
  roles: string[];
  /** The task to send to all agents */
  task: string;
}

/**
 * Input schema for the critique_plan MCP tool.
 * Shorthand for invoking the critic role.
 */
export interface CritiquePlanToolInput {
  /** The plan or PRD to critique */
  plan: string;
}

/**
 * Input schema for the review_code MCP tool.
 * Shorthand for invoking the reviewer role.
 */
export interface ReviewCodeToolInput {
  /** The code to review */
  code: string;
  /** Optional context about the code (language, purpose, etc.) */
  context?: string;
}

/**
 * Input schema for the design_feedback MCP tool.
 * Shorthand for invoking the designer role.
 */
export interface DesignFeedbackToolInput {
  /** The design to review (description, wireframe, mockup) */
  design: string;
}

/**
 * Output schema for the list_agents MCP tool.
 */
export interface ListAgentsToolOutput {
  /** List of available agent roles */
  roles: {
    /** Role name */
    name: string;
    /** Provider configured for this role */
    provider: string;
    /** Model configured for this role */
    model: string;
    /** Whether a fallback is configured */
    hasFallback: boolean;
  }[];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for AgentRouter errors.
 */
export class AgentRouterError extends Error {
  public readonly code: string;

  constructor(message: string, code: string, cause?: Error) {
    super(message, { cause });
    this.name = 'AgentRouterError';
    this.code = code;
  }
}

/**
 * Error thrown when configuration is invalid.
 */
export class ConfigurationError extends AgentRouterError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIGURATION_ERROR', cause);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown when a provider API call fails.
 */
export class ProviderError extends AgentRouterError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    cause?: Error
  ) {
    super(message, 'PROVIDER_ERROR', cause);
    this.name = 'ProviderError';
  }
}

/**
 * Error thrown when hitting rate limits.
 */
export class RateLimitError extends ProviderError {
  constructor(
    provider: string,
    public readonly retryAfterMs?: number,
    cause?: Error
  ) {
    super(`Rate limit exceeded for provider: ${provider}`, provider, 429, cause);
    this.name = 'RateLimitError';
  }
}

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends ProviderError {
  constructor(provider: string, cause?: Error) {
    super(`Authentication failed for provider: ${provider}`, provider, 401, cause);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when a request times out.
 */
export class TimeoutError extends ProviderError {
  constructor(provider: string, timeoutMs: number, cause?: Error) {
    super(`Request to ${provider} timed out after ${timeoutMs}ms`, provider, undefined, cause);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when message/tool translation fails.
 */
export class TranslationError extends AgentRouterError {
  constructor(
    message: string,
    public readonly sourceFormat: string,
    public readonly targetFormat: string,
    cause?: Error
  ) {
    super(message, 'TRANSLATION_ERROR', cause);
    this.name = 'TranslationError';
  }
}

// ============================================================================
// Task Integration Types (v3.0)
// ============================================================================

/**
 * Execution state for a task being processed by AgentRouter.
 */
export interface TaskExecution {
  /** Claude Code task ID */
  taskId: string;
  /** Agent role used for execution */
  role: string;
  /** Unique trace ID for this execution */
  traceId: string;
  /** Execution start timestamp */
  startTime: number;
  /** Execution end timestamp (set on completion/failure) */
  endTime?: number;
  /** Current execution status */
  status: 'running' | 'completed' | 'failed';
  /** Agent response on success */
  result?: AgentResponse;
  /** Error details on failure */
  error?: Error;
}

/**
 * Instructions for Claude to execute task lifecycle operations.
 * MCP tools cannot directly call Claude Code tools, so they return
 * instruction strings that Claude must execute.
 */
export interface ClaimInstructions {
  /** Instruction to claim the task before execution */
  preExecution: string;
  /** Instruction to mark task complete on success */
  onSuccess: string;
  /** Instruction to release task on failure */
  onFailure: string;
}

/**
 * Result of completing a task execution.
 */
export interface CompletionResult {
  /** The execution record */
  execution: TaskExecution;
  /** Instruction for Claude to mark task complete */
  instructions: string;
  /** Agent response */
  result: AgentResponse;
}

/**
 * Result of a failed task execution.
 */
export interface FailureResult {
  /** The execution record */
  execution: TaskExecution;
  /** Instruction for Claude to release the task */
  instructions: string;
  /** Error that caused the failure */
  error: Error;
}

/**
 * A step in a multi-provider pipeline.
 */
export interface PipelineStep {
  /** Unique step identifier within the pipeline */
  name: string;
  /** Task subject line (imperative form) */
  subject: string;
  /** Detailed task description */
  description?: string;
  /** AgentRouter role for execution */
  role: AgentRole | string;
  /** Names of steps this step depends on */
  dependsOn?: string[];
  /** Additional context for this step's agent */
  context?: string;
}

/**
 * Definition of a multi-step task pipeline.
 */
export interface PipelineDefinition {
  /** Pipeline name for identification */
  name: string;
  /** Pipeline steps in declaration order */
  steps: PipelineStep[];
  /** Context passed to all steps */
  globalContext?: string;
}

/**
 * Execution state for a pipeline.
 */
export interface PipelineExecution {
  /** Unique pipeline execution ID */
  pipelineId: string;
  /** Pipeline definition */
  definition: PipelineDefinition;
  /** Mapping from step name to Claude Code task ID */
  taskIdMap: Map<string, string>;
  /** Overall pipeline status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Pipeline start timestamp */
  startTime: number;
  /** Set of completed step names */
  completedSteps: Set<string>;
  /** Results from completed steps */
  results: Map<string, AgentResponse>;
}

/**
 * Configuration for a background worker.
 */
export interface WorkerConfig {
  /** Worker name for identification and ownership */
  name: string;
  /** Only claim tasks for these roles (empty = any) */
  allowedRoles?: AgentRole[];
  /** Maximum concurrent task executions (default: 1) */
  maxConcurrent?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatMs?: number;
  /** Shutdown after idle for this duration in ms (default: 300000) */
  idleTimeoutMs?: number;
}

/**
 * Current state of a background worker.
 */
export interface WorkerState {
  /** Worker name */
  name: string;
  /** Current worker status */
  status: 'idle' | 'working' | 'shutdown';
  /** Currently executing task ID (if working) */
  currentTask?: string;
  /** Count of successfully completed tasks */
  completedCount: number;
  /** Count of failed task attempts */
  failedCount: number;
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
  /** Task IDs to exclude from claiming (failed attempts) */
  excludeTaskIds?: string[];
}

/**
 * Configuration for the tasks integration feature.
 */
export interface TasksConfig {
  /** Enable task-aware tools */
  enabled: boolean;
  /** Default behavior settings */
  defaults: {
    /** Automatically mark tasks complete on success */
    autoComplete: boolean;
    /** Automatically release tasks on failure */
    autoRelease: boolean;
    /** Maximum execution time per task in ms */
    timeoutMs: number;
  };
  /** Worker mode settings */
  worker: {
    /** Heartbeat interval in ms */
    heartbeatMs: number;
    /** Shutdown after idle for this duration in ms */
    idleTimeoutMs: number;
    /** Maximum retry attempts for failed tasks */
    maxRetries: number;
  };
  /** Pipeline settings */
  pipeline: {
    /** Maximum concurrent pipeline steps */
    maxParallel: number;
    /** Execute independent steps in parallel by default */
    defaultParallel: boolean;
    /** Maximum context length before truncation */
    maxContextLength: number;
  };
}
