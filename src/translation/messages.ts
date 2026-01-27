/**
 * Message Format Translation
 *
 * Translates messages between AgentRouter's internal format and provider-specific formats.
 * Handles the differences in how each provider represents:
 * - System prompts
 * - Message content (text, tool use, tool results)
 * - Role naming conventions
 *
 * Format Reference:
 * | Feature      | Anthropic              | OpenAI                 | Gemini              |
 * |--------------|------------------------|------------------------|---------------------|
 * | System       | separate param         | role: "system" message | systemInstruction   |
 * | Content      | content blocks         | string or array        | parts array         |
 * | Tool use     | tool_use block         | tool_calls array       | functionCall        |
 * | Tool result  | tool_result block      | role: "tool" message   | functionResponse    |
 */

import type { Message, ContentBlock } from '../types.js';

// ============================================================================
// Anthropic Types
// ============================================================================

/**
 * Anthropic message format
 */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic content block
 */
export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

/**
 * Anthropic API response format
 */
export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Anthropic request format (for sending to API)
 */
export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  tools?: AnthropicTool[];
  stream?: boolean;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// OpenAI Types
// ============================================================================

/**
 * OpenAI message format
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * OpenAI content part for multi-modal messages
 */
export interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * OpenAI tool call format
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI API response format
 */
export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Gemini Types
// ============================================================================

/**
 * Gemini content format
 */
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Gemini part format (can be text, function call, or function response)
 */
export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

/**
 * Gemini API response format
 */
export interface GeminiResponse {
  candidates: {
    content: GeminiContent;
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    safetyRatings?: {
      category: string;
      probability: string;
    }[];
  }[];
  promptFeedback?: {
    safetyRatings?: {
      category: string;
      probability: string;
    }[];
  };
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Gemini request format
 */
export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
  tools?: GeminiTool[];
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: GeminiSchema;
}

export interface GeminiSchema {
  type: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
}

// ============================================================================
// Translation Functions: To Provider Formats
// ============================================================================

/**
 * Convert internal messages to Anthropic format
 *
 * Anthropic:
 * - System prompt is a separate top-level parameter
 * - Messages use 'user' | 'assistant' roles
 * - Content can be string or ContentBlock[]
 * - Tool results go in user messages with tool_result blocks
 *
 * @param messages - Internal Message array
 * @param systemPrompt - Optional system prompt (becomes separate param in Anthropic)
 * @returns Anthropic-formatted messages (system prompt handled separately by caller)
 */
export function toAnthropicMessages(
  messages: Message[],
  systemPrompt?: string
): { messages: AnthropicMessage[]; system?: string } {
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    const anthropicMessage = messageToAnthropic(message);
    anthropicMessages.push(anthropicMessage);
  }

  // Ensure valid message sequence (must start with user, alternate)
  const validatedMessages = validateAnthropicMessageSequence(anthropicMessages);

  const result: { messages: AnthropicMessage[]; system?: string } = {
    messages: validatedMessages,
  };

  if (systemPrompt !== undefined) {
    result.system = systemPrompt;
  }

  return result;
}

/**
 * Convert internal messages to OpenAI format
 *
 * OpenAI:
 * - System prompt is a message with role: "system"
 * - Tool use is in assistant message's tool_calls array
 * - Tool results are separate messages with role: "tool"
 *
 * @param messages - Internal Message array
 * @param systemPrompt - Optional system prompt (becomes first message)
 * @returns OpenAI-formatted messages
 */
export function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string
): OpenAIMessage[] {
  const openAIMessages: OpenAIMessage[] = [];

  // Add system prompt as first message if provided
  if (systemPrompt) {
    openAIMessages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const message of messages) {
    const translated = messageToOpenAI(message);
    // messageToOpenAI can return multiple messages (for tool results)
    openAIMessages.push(...translated);
  }

  return openAIMessages;
}

/**
 * Convert internal messages to Gemini format
 *
 * Gemini:
 * - System prompt goes in systemInstruction
 * - Roles are 'user' | 'model' (not 'assistant')
 * - Content is always an array of parts
 * - Function calls and responses are specific part types
 *
 * @param messages - Internal Message array
 * @param systemPrompt - Optional system prompt (becomes systemInstruction)
 * @returns Gemini-formatted contents and system instruction
 */
export function toGeminiContents(
  messages: Message[],
  systemPrompt?: string
): { contents: GeminiContent[]; systemInstruction?: { parts: GeminiPart[] } } {
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    const geminiContent = messageToGemini(message);
    contents.push(geminiContent);
  }

  // Validate and merge consecutive same-role messages if needed
  const validatedContents = validateGeminiContentSequence(contents);

  const result: { contents: GeminiContent[]; systemInstruction?: { parts: GeminiPart[] } } = {
    contents: validatedContents,
  };

  if (systemPrompt !== undefined) {
    result.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  return result;
}

// ============================================================================
// Translation Functions: From Provider Responses
// ============================================================================

/**
 * Convert Anthropic response to internal Message format
 *
 * @param response - Anthropic API response
 * @returns Internal Message
 */
export function fromAnthropicResponse(response: AnthropicResponse): Message {
  const content: ContentBlock[] = response.content.map((block): ContentBlock => {
    if (block.type === 'text') {
      const textBlock: ContentBlock = {
        type: 'text',
      };
      if (block.text !== undefined) {
        textBlock.text = block.text;
      }
      return textBlock;
    } else if (block.type === 'tool_use') {
      const toolUseBlock: ContentBlock = {
        type: 'tool_use',
      };
      if (block.id !== undefined) {
        toolUseBlock.id = block.id;
      }
      if (block.name !== undefined) {
        toolUseBlock.name = block.name;
      }
      if (block.input !== undefined) {
        toolUseBlock.input = block.input;
      }
      return toolUseBlock;
    } else if (block.type === 'tool_result') {
      const toolResultBlock: ContentBlock = {
        type: 'tool_result',
      };
      if (block.tool_use_id !== undefined) {
        toolResultBlock.tool_use_id = block.tool_use_id;
      }
      if (block.content !== undefined) {
        toolResultBlock.content = block.content;
      }
      return toolResultBlock;
    }
    // Unknown block type, treat as text
    return {
      type: 'text',
      text: JSON.stringify(block),
    };
  });

  return {
    role: 'assistant',
    content,
  };
}

/**
 * Convert OpenAI response to internal Message format
 *
 * @param response - OpenAI API response
 * @returns Internal Message
 */
export function fromOpenAIResponse(response: OpenAIResponse): Message {
  const choice = response.choices[0];
  if (!choice) {
    return {
      role: 'assistant',
      content: [],
    };
  }

  const message = choice.message;
  const content: ContentBlock[] = [];

  // Handle text content
  if (message.content) {
    if (typeof message.content === 'string') {
      content.push({
        type: 'text',
        text: message.content,
      });
    } else if (Array.isArray(message.content)) {
      // Multi-part content
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          content.push({
            type: 'text',
            text: part.text,
          });
        }
        // Note: Image parts are not supported in our internal format
      }
    }
  }

  // Handle tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: safeJsonParse(toolCall.function.arguments),
      });
    }
  }

  return {
    role: 'assistant',
    content: content.length > 0 ? content : [],
  };
}

/**
 * Convert Gemini response to internal Message format
 *
 * @param response - Gemini API response
 * @returns Internal Message
 */
export function fromGeminiResponse(response: GeminiResponse): Message {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    return {
      role: 'assistant',
      content: [],
    };
  }

  const geminiContent = candidate.content;
  const content: ContentBlock[] = [];

  for (const part of geminiContent.parts) {
    if (part.text !== undefined) {
      content.push({
        type: 'text',
        text: part.text,
      });
    } else if (part.functionCall) {
      content.push({
        type: 'tool_use',
        id: generateToolCallId(),
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    }
    // functionResponse parts are typically in user messages, not assistant responses
  }

  return {
    role: 'assistant',
    content: content.length > 0 ? content : [],
  };
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Convert a single internal message to Anthropic format
 */
function messageToAnthropic(message: Message): AnthropicMessage {
  if (typeof message.content === 'string') {
    return {
      role: message.role,
      content: message.content,
    };
  }

  const anthropicBlocks: AnthropicContentBlock[] = message.content.map((block) => {
    if (block.type === 'text') {
      return {
        type: 'text' as const,
        text: block.text || '',
      };
    } else if (block.type === 'tool_use') {
      return {
        type: 'tool_use' as const,
        id: block.id || generateToolCallId(),
        name: block.name || '',
        input: block.input || {},
      };
    } else if (block.type === 'tool_result') {
      return {
        type: 'tool_result' as const,
        tool_use_id: block.tool_use_id || '',
        content: block.content || '',
      };
    }
    // Fallback for unknown types
    return {
      type: 'text' as const,
      text: JSON.stringify(block),
    };
  });

  return {
    role: message.role,
    content: anthropicBlocks,
  };
}

/**
 * Convert a single internal message to OpenAI format
 * Returns an array because tool results become separate messages
 */
function messageToOpenAI(message: Message): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  if (typeof message.content === 'string') {
    messages.push({
      role: message.role,
      content: message.content,
    });
    return messages;
  }

  // Separate tool results from other content
  const toolResults: ContentBlock[] = [];
  const otherBlocks: ContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      toolResults.push(block);
    } else {
      otherBlocks.push(block);
    }
  }

  // Handle non-tool-result content
  if (otherBlocks.length > 0) {
    const hasToolUse = otherBlocks.some((b) => b.type === 'tool_use');

    if (hasToolUse && message.role === 'assistant') {
      // Assistant message with tool calls
      const textParts = otherBlocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');

      const toolCalls = otherBlocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id || generateToolCallId(),
          type: 'function' as const,
          function: {
            name: b.name || '',
            arguments: JSON.stringify(b.input || {}),
          },
        }));

      messages.push({
        role: 'assistant',
        content: textParts || null,
        tool_calls: toolCalls,
      });
    } else {
      // Regular message
      const textContent = otherBlocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');

      messages.push({
        role: message.role,
        content: textContent,
      });
    }
  }

  // Handle tool results as separate tool messages
  for (const toolResult of toolResults) {
    messages.push({
      role: 'tool',
      tool_call_id: toolResult.tool_use_id || '',
      content: toolResult.content || '',
    });
  }

  return messages;
}

/**
 * Convert a single internal message to Gemini format
 */
function messageToGemini(message: Message): GeminiContent {
  const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user';

  if (typeof message.content === 'string') {
    return {
      role,
      parts: [{ text: message.content }],
    };
  }

  const parts: GeminiPart[] = message.content.map((block) => {
    if (block.type === 'text') {
      return { text: block.text || '' };
    } else if (block.type === 'tool_use') {
      return {
        functionCall: {
          name: block.name || '',
          args: (block.input!) || {},
        },
      };
    } else if (block.type === 'tool_result') {
      // Gemini needs the function name for responses, but we only have tool_use_id
      // The caller should track tool names or include them in the content
      return {
        functionResponse: {
          name: block.tool_use_id || 'unknown',
          response: { result: block.content || '' },
        },
      };
    }
    // Fallback
    return { text: JSON.stringify(block) };
  });

  return {
    role,
    parts,
  };
}

/**
 * Ensure Anthropic messages follow required sequence rules:
 * - Must start with a user message
 * - Messages must alternate between user and assistant
 */
function validateAnthropicMessageSequence(
  messages: AnthropicMessage[]
): AnthropicMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const result: AnthropicMessage[] = [];
  let lastRole: 'user' | 'assistant' | null = null;

  for (const message of messages) {
    // First message must be user
    if (result.length === 0 && message.role !== 'user') {
      // Prepend an empty user message
      result.push({
        role: 'user',
        content: '',
      });
    }

    // Merge consecutive same-role messages
    if (lastRole === message.role && result.length > 0) {
      const lastIndex = result.length - 1;
      const lastMessage = result[lastIndex];
      if (lastMessage) {
        result[lastIndex] = {
          ...lastMessage,
          content: mergeAnthropicContent(lastMessage.content, message.content),
        };
      }
    } else {
      result.push({ ...message });
    }

    lastRole = message.role;
  }

  return result;
}

/**
 * Merge two Anthropic content values
 */
function mergeAnthropicContent(
  a: string | AnthropicContentBlock[],
  b: string | AnthropicContentBlock[]
): string | AnthropicContentBlock[] {
  const blocksA = typeof a === 'string' ? [{ type: 'text' as const, text: a }] : a;
  const blocksB = typeof b === 'string' ? [{ type: 'text' as const, text: b }] : b;
  return [...blocksA, ...blocksB];
}

/**
 * Ensure Gemini contents follow required sequence rules:
 * - Contents should alternate between user and model
 */
function validateGeminiContentSequence(contents: GeminiContent[]): GeminiContent[] {
  if (contents.length === 0) {
    return contents;
  }

  const result: GeminiContent[] = [];
  let lastRole: 'user' | 'model' | null = null;

  for (const content of contents) {
    // Merge consecutive same-role contents
    if (lastRole === content.role && result.length > 0) {
      const lastIndex = result.length - 1;
      const lastContent = result[lastIndex];
      if (lastContent) {
        result[lastIndex] = {
          ...lastContent,
          parts: [...lastContent.parts, ...content.parts],
        };
      }
    } else {
      result.push({ ...content, parts: [...content.parts] });
    }

    lastRole = content.role;
  }

  return result;
}

/**
 * Safely parse JSON, returning empty object on failure
 */
function safeJsonParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Generate a unique tool call ID
 */
function generateToolCallId(): string {
  return `toolu_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Extract text content from a Message
 */
export function extractTextContent(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}

/**
 * Check if a message contains tool use
 */
export function hasToolUse(message: Message): boolean {
  if (typeof message.content === 'string') {
    return false;
  }
  return message.content.some((block) => block.type === 'tool_use');
}

/**
 * Check if a message contains tool results
 */
export function hasToolResult(message: Message): boolean {
  if (typeof message.content === 'string') {
    return false;
  }
  return message.content.some((block) => block.type === 'tool_result');
}

/**
 * Get all tool use blocks from a message
 */
export function getToolUseBlocks(message: Message): ContentBlock[] {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content.filter((block) => block.type === 'tool_use');
}

/**
 * Get all tool result blocks from a message
 */
export function getToolResultBlocks(message: Message): ContentBlock[] {
  if (typeof message.content === 'string') {
    return [];
  }
  return message.content.filter((block) => block.type === 'tool_result');
}
