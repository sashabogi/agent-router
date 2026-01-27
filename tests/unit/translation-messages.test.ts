/**
 * Unit tests for message translation
 *
 * Tests the message format translation including:
 * - toAnthropicMessages() format conversion
 * - toOpenAIMessages() with system message handling
 * - toGeminiContents() format conversion
 * - fromAnthropicResponse() content extraction
 * - Tool use and tool result translation
 */

import { describe, it, expect } from 'vitest';
import {
  toAnthropicMessages,
  toOpenAIMessages,
  toGeminiContents,
  fromAnthropicResponse,
  fromOpenAIResponse,
  fromGeminiResponse,
  extractTextContent,
  hasToolUse,
  hasToolResult,
  getToolUseBlocks,
  getToolResultBlocks,
  type AnthropicResponse,
  type OpenAIResponse,
  type GeminiResponse,
} from '../../src/translation/messages.js';
import type { Message, ContentBlock } from '../../src/types.js';

describe('Message Translation', () => {
  describe('toAnthropicMessages()', () => {
    it('should convert simple text messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = toAnthropicMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('should handle system prompt as separate property', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toAnthropicMessages(messages, 'You are a helpful assistant.');

      expect(result.system).toBe('You are a helpful assistant.');
      expect(result.messages[0].role).toBe('user');
    });

    it('should not include system property when undefined', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toAnthropicMessages(messages);

      expect(result.system).toBeUndefined();
      expect('system' in result).toBe(false);
    });

    it('should convert content blocks correctly', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this code' },
          ],
        },
      ];

      const result = toAnthropicMessages(messages);

      expect(result.messages[0].content).toEqual([
        { type: 'text', text: 'Analyze this code' },
      ]);
    });

    it('should handle tool_use blocks', () => {
      // Need to include a user message first since Anthropic requires starting with user
      const messages: Message[] = [
        { role: 'user', content: 'Use the read_file tool' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'read_file',
              input: { path: '/test.ts' },
            },
          ],
        },
      ];

      const result = toAnthropicMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].content).toEqual([
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'read_file',
          input: { path: '/test.ts' },
        },
      ]);
    });

    it('should handle tool_result blocks', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'File contents here',
            },
          ],
        },
      ];

      const result = toAnthropicMessages(messages);

      expect(result.messages[0].content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_123',
          content: 'File contents here',
        },
      ]);
    });

    it('should ensure messages start with user role', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'I should not be first' },
      ];

      const result = toAnthropicMessages(messages);

      // Should prepend empty user message
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should merge consecutive same-role messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First message' },
        { role: 'user', content: 'Second message' },
      ];

      const result = toAnthropicMessages(messages);

      // Should merge into one user message
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      // Content should be merged as blocks
      expect(Array.isArray(result.messages[0].content)).toBe(true);
    });
  });

  describe('toOpenAIMessages()', () => {
    it('should convert simple messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = toOpenAIMessages(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('should add system message at the beginning', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toOpenAIMessages(messages, 'You are a helpful assistant.');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should not add system message when undefined', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toOpenAIMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('should convert tool_use to tool_calls format', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check that file.' },
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'read_file',
              input: { path: '/test.ts' },
            },
          ],
        },
      ];

      const result = toOpenAIMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Let me check that file.');
      expect(result[0].tool_calls).toBeDefined();
      expect(result[0].tool_calls).toHaveLength(1);
      expect(result[0].tool_calls?.[0]).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"/test.ts"}',
        },
      });
    });

    it('should convert tool_result to separate tool messages', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_123',
              content: 'File contents here',
            },
          ],
        },
      ];

      const result = toOpenAIMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'tool',
        tool_call_id: 'call_123',
        content: 'File contents here',
      });
    });
  });

  describe('toGeminiContents()', () => {
    it('should convert simple messages with correct role mapping', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = toGeminiContents(messages);

      expect(result.contents).toHaveLength(2);
      expect(result.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'Hello' }],
      });
      // Note: 'assistant' becomes 'model' in Gemini
      expect(result.contents[1]).toEqual({
        role: 'model',
        parts: [{ text: 'Hi there!' }],
      });
    });

    it('should handle system prompt as systemInstruction', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toGeminiContents(messages, 'You are a helpful assistant.');

      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
    });

    it('should not include systemInstruction when undefined', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];

      const result = toGeminiContents(messages);

      expect(result.systemInstruction).toBeUndefined();
      expect('systemInstruction' in result).toBe(false);
    });

    it('should convert tool_use to functionCall format', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'read_file',
              input: { path: '/test.ts' },
            },
          ],
        },
      ];

      const result = toGeminiContents(messages);

      expect(result.contents[0].parts[0]).toEqual({
        functionCall: {
          name: 'read_file',
          args: { path: '/test.ts' },
        },
      });
    });

    it('should convert tool_result to functionResponse format', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_123',
              content: 'File contents here',
            },
          ],
        },
      ];

      const result = toGeminiContents(messages);

      expect(result.contents[0].parts[0]).toEqual({
        functionResponse: {
          name: 'call_123',
          response: { result: 'File contents here' },
        },
      });
    });

    it('should merge consecutive same-role contents', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'user', content: 'Second' },
      ];

      const result = toGeminiContents(messages);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].parts).toHaveLength(2);
    });
  });

  describe('fromAnthropicResponse()', () => {
    it('should extract text content from response', () => {
      const response: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello, world!' },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const result = fromAnthropicResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    it('should extract tool_use content from response', () => {
      const response: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file.' },
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'read_file',
            input: { path: '/test.ts' },
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };

      const result = fromAnthropicResponse(response);

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Let me read that file.',
      });
      expect(result.content[1]).toEqual({
        type: 'tool_use',
        id: 'toolu_123',
        name: 'read_file',
        input: { path: '/test.ts' },
      });
    });

    it('should handle empty text in text blocks', () => {
      const response: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text' }, // text is undefined
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 0,
        },
      };

      const result = fromAnthropicResponse(response);

      expect(result.content[0].type).toBe('text');
      // text should be undefined, not empty string
    });
  });

  describe('fromOpenAIResponse()', () => {
    it('should extract text content from response', () => {
      const response: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello, world!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = fromOpenAIResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    it('should extract tool_calls from response', () => {
      const response: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"/test.ts"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      };

      const result = fromOpenAIResponse(response);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'tool_use',
        id: 'call_123',
        name: 'read_file',
        input: { path: '/test.ts' },
      });
    });

    it('should handle empty choices array', () => {
      const response: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      const result = fromOpenAIResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([]);
    });
  });

  describe('fromGeminiResponse()', () => {
    it('should extract text content from response', () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello, world!' }],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const result = fromGeminiResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    it('should extract functionCall from response', () => {
      const response: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'read_file',
                    args: { path: '/test.ts' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const result = fromGeminiResponse(response);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      expect(result.content[0].name).toBe('read_file');
      expect(result.content[0].input).toEqual({ path: '/test.ts' });
    });

    it('should handle empty candidates array', () => {
      const response: GeminiResponse = {
        candidates: [],
      };

      const result = fromGeminiResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([]);
    });
  });

  describe('Utility Functions', () => {
    describe('extractTextContent()', () => {
      it('should extract text from string content', () => {
        const message: Message = {
          role: 'assistant',
          content: 'Hello, world!',
        };

        expect(extractTextContent(message)).toBe('Hello, world!');
      });

      it('should extract text from content blocks', () => {
        const message: Message = {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First line' },
            { type: 'tool_use', id: '1', name: 'test', input: {} },
            { type: 'text', text: 'Second line' },
          ],
        };

        expect(extractTextContent(message)).toBe('First line\nSecond line');
      });

      it('should return empty string when no text blocks', () => {
        const message: Message = {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: '1', name: 'test', input: {} },
          ],
        };

        expect(extractTextContent(message)).toBe('');
      });
    });

    describe('hasToolUse()', () => {
      it('should return true when message has tool_use', () => {
        const message: Message = {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: '1', name: 'test', input: {} },
          ],
        };

        expect(hasToolUse(message)).toBe(true);
      });

      it('should return false when message has no tool_use', () => {
        const message: Message = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        };

        expect(hasToolUse(message)).toBe(false);
      });

      it('should return false for string content', () => {
        const message: Message = {
          role: 'assistant',
          content: 'Hello',
        };

        expect(hasToolUse(message)).toBe(false);
      });
    });

    describe('hasToolResult()', () => {
      it('should return true when message has tool_result', () => {
        const message: Message = {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '1', content: 'result' },
          ],
        };

        expect(hasToolResult(message)).toBe(true);
      });

      it('should return false when message has no tool_result', () => {
        const message: Message = {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        };

        expect(hasToolResult(message)).toBe(false);
      });
    });

    describe('getToolUseBlocks()', () => {
      it('should return all tool_use blocks', () => {
        const message: Message = {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: '1', name: 'test1', input: {} },
            { type: 'tool_use', id: '2', name: 'test2', input: {} },
          ],
        };

        const blocks = getToolUseBlocks(message);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].id).toBe('1');
        expect(blocks[1].id).toBe('2');
      });

      it('should return empty array for string content', () => {
        const message: Message = {
          role: 'assistant',
          content: 'Hello',
        };

        expect(getToolUseBlocks(message)).toEqual([]);
      });
    });

    describe('getToolResultBlocks()', () => {
      it('should return all tool_result blocks', () => {
        const message: Message = {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '1', content: 'result1' },
            { type: 'text', text: 'Context' },
            { type: 'tool_result', tool_use_id: '2', content: 'result2' },
          ],
        };

        const blocks = getToolResultBlocks(message);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].tool_use_id).toBe('1');
        expect(blocks[1].tool_use_id).toBe('2');
      });

      it('should return empty array for string content', () => {
        const message: Message = {
          role: 'user',
          content: 'Hello',
        };

        expect(getToolResultBlocks(message)).toEqual([]);
      });
    });
  });
});
