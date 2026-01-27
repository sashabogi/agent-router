/**
 * Tool Schema Translation
 *
 * Translates tool/function schemas between different LLM provider formats.
 * Each provider has different conventions for defining tools that models can use.
 *
 * Format Comparison:
 * | Feature         | Anthropic        | OpenAI              | Gemini              |
 * |-----------------|------------------|---------------------|---------------------|
 * | Schema key      | input_schema     | parameters          | parameters          |
 * | Wrapper         | none             | function: { }       | functionDeclarations|
 * | Description     | description      | function.description| description         |
 */

import { type Tool, TranslationError } from '../types.js';

// ============================================================================
// Provider-Specific Tool Types
// ============================================================================

/**
 * Anthropic tool format.
 * Tools are defined at the top level with input_schema for parameters.
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * OpenAI tool format.
 * Tools are wrapped in a function object with type: "function".
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * OpenAI function definition (inner part of OpenAITool).
 * Used when providers expect just the function definition.
 */
export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Gemini function declaration.
 * Used inside the functionDeclarations array.
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Gemini tool format.
 * Tools are wrapped in a functionDeclarations array.
 */
export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

// ============================================================================
// Translation Functions
// ============================================================================

/**
 * Translate tools to Anthropic format.
 *
 * Anthropic uses a straightforward format where tools are defined with:
 * - name: The tool name
 * - description: Human-readable description
 * - input_schema: JSON Schema for parameters
 *
 * Since our internal Tool type follows the Anthropic format,
 * this is essentially a pass-through with validation.
 *
 * @param tools - Array of tools in internal format
 * @returns Array of tools in Anthropic format
 * @throws TranslationError if validation fails
 *
 * @example
 * const tools = [{ name: "search", description: "Search the web", input_schema: {...} }];
 * const anthropicTools = toAnthropicTools(tools);
 * // Returns: [{ name: "search", description: "Search the web", input_schema: {...} }]
 */
export function toAnthropicTools(tools: Tool[]): AnthropicTool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map((tool, index) => {
    validateTool(tool, index);

    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.input_schema.properties,
        ...(tool.input_schema.required && { required: tool.input_schema.required }),
      },
    };
  });
}

/**
 * Translate tools to OpenAI format.
 *
 * OpenAI wraps tools in a specific structure:
 * - type: "function" (indicates it's a function tool)
 * - function: Object containing name, description, and parameters
 *
 * The main difference from Anthropic is:
 * - Uses `parameters` instead of `input_schema`
 * - Wraps everything in a `function` object
 * - Adds `type: "function"` at the top level
 *
 * @param tools - Array of tools in internal format
 * @returns Array of tools in OpenAI format
 * @throws TranslationError if validation fails
 *
 * @example
 * const tools = [{ name: "search", description: "Search the web", input_schema: {...} }];
 * const openaiTools = toOpenAITools(tools);
 * // Returns: [{ type: "function", function: { name: "search", description: "...", parameters: {...} } }]
 */
export function toOpenAITools(tools: Tool[]): OpenAITool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map((tool, index) => {
    validateTool(tool, index);

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.input_schema.properties,
          ...(tool.input_schema.required && { required: tool.input_schema.required }),
        },
      },
    };
  });
}

/**
 * Translate tools to OpenAI function format (without wrapper).
 *
 * Some OpenAI-compatible APIs expect just the function definitions
 * without the { type: "function", function: {...} } wrapper.
 *
 * @param tools - Array of tools in internal format
 * @returns Array of function definitions
 * @throws TranslationError if validation fails
 */
export function toOpenAIFunctions(tools: Tool[]): OpenAIFunction[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map((tool, index) => {
    validateTool(tool, index);

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.input_schema.properties,
        ...(tool.input_schema.required && { required: tool.input_schema.required }),
      },
    };
  });
}

/**
 * Translate tools to Gemini format.
 *
 * Gemini uses a different structure where all function declarations
 * are grouped into a single object:
 * - functionDeclarations: Array of function definitions
 *
 * Each function declaration contains:
 * - name: Function name
 * - description: Human-readable description
 * - parameters: JSON Schema for parameters
 *
 * Note: Gemini expects a single tool object containing all functions,
 * not an array of tool objects.
 *
 * @param tools - Array of tools in internal format
 * @returns Single Gemini tool object containing all function declarations
 * @throws TranslationError if validation fails
 *
 * @example
 * const tools = [{ name: "search", description: "Search the web", input_schema: {...} }];
 * const geminiTools = toGeminiTools(tools);
 * // Returns: { functionDeclarations: [{ name: "search", description: "...", parameters: {...} }] }
 */
export function toGeminiTools(tools: Tool[]): GeminiTool {
  if (!tools || tools.length === 0) {
    return { functionDeclarations: [] };
  }

  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool, index) => {
    validateTool(tool, index);

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.input_schema.properties,
        ...(tool.input_schema.required && { required: tool.input_schema.required }),
      },
    };
  });

  return { functionDeclarations };
}

/**
 * Translate tools to Gemini format as an array (for API compatibility).
 *
 * Some Gemini API versions expect an array containing the tool object.
 * This is a convenience wrapper around toGeminiTools.
 *
 * @param tools - Array of tools in internal format
 * @returns Array containing a single Gemini tool object
 * @throws TranslationError if validation fails
 */
export function toGeminiToolsArray(tools: Tool[]): GeminiTool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return [toGeminiTools(tools)];
}

// ============================================================================
// Reverse Translation (From Provider Format to Internal)
// ============================================================================

/**
 * Translate Anthropic tools to internal format.
 *
 * Since our internal format matches Anthropic, this is essentially a pass-through
 * with validation.
 *
 * @param tools - Array of Anthropic tools
 * @returns Array of tools in internal format
 * @throws TranslationError if validation fails
 */
export function fromAnthropicTools(tools: AnthropicTool[]): Tool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map((tool, index) => {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new TranslationError(
        `Anthropic tool at index ${index} is missing a valid name`,
        'anthropic',
        'internal'
      );
    }

    return {
      name: tool.name,
      description: tool.description || '',
      input_schema: {
        type: 'object' as const,
        properties: tool.input_schema?.properties || {},
        ...(tool.input_schema?.required && { required: tool.input_schema.required }),
      },
    };
  });
}

/**
 * Translate OpenAI tools to internal format.
 *
 * Unwraps the function object and converts parameters to input_schema.
 *
 * @param tools - Array of OpenAI tools
 * @returns Array of tools in internal format
 * @throws TranslationError if validation fails
 */
export function fromOpenAITools(tools: OpenAITool[]): Tool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map((tool, index) => {
    if (tool.type !== 'function' || !tool.function) {
      throw new TranslationError(
        `OpenAI tool at index ${index} is not a function tool or is missing function definition`,
        'openai',
        'internal'
      );
    }

    const func = tool.function;

    if (!func.name || typeof func.name !== 'string') {
      throw new TranslationError(
        `OpenAI tool at index ${index} is missing a valid function name`,
        'openai',
        'internal'
      );
    }

    return {
      name: func.name,
      description: func.description || '',
      input_schema: {
        type: 'object' as const,
        properties: func.parameters?.properties || {},
        ...(func.parameters?.required && { required: func.parameters.required }),
      },
    };
  });
}

/**
 * Translate Gemini tools to internal format.
 *
 * Extracts function declarations from the Gemini tool object.
 *
 * @param tool - Gemini tool object containing function declarations
 * @returns Array of tools in internal format
 * @throws TranslationError if validation fails
 */
export function fromGeminiTools(tool: GeminiTool): Tool[] {
  if (!tool?.functionDeclarations || tool.functionDeclarations.length === 0) {
    return [];
  }

  return tool.functionDeclarations.map((func, index) => {
    if (!func.name || typeof func.name !== 'string') {
      throw new TranslationError(
        `Gemini function declaration at index ${index} is missing a valid name`,
        'gemini',
        'internal'
      );
    }

    return {
      name: func.name,
      description: func.description || '',
      input_schema: {
        type: 'object' as const,
        properties: func.parameters?.properties || {},
        ...(func.parameters?.required && { required: func.parameters.required }),
      },
    };
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate a tool definition.
 *
 * @param tool - Tool to validate
 * @param index - Index in the array (for error messages)
 * @throws TranslationError if the tool is invalid
 */
function validateTool(tool: Tool, index: number): void {
  if (!tool) {
    throw new TranslationError(
      `Tool at index ${index} is null or undefined`,
      'internal',
      'provider'
    );
  }

  if (!tool.name || typeof tool.name !== 'string') {
    throw new TranslationError(
      `Tool at index ${index} is missing a valid name`,
      'internal',
      'provider'
    );
  }

  if (!tool.description || typeof tool.description !== 'string') {
    throw new TranslationError(
      `Tool "${tool.name}" at index ${index} is missing a valid description`,
      'internal',
      'provider'
    );
  }

  if (!tool.input_schema || typeof tool.input_schema !== 'object') {
    throw new TranslationError(
      `Tool "${tool.name}" at index ${index} is missing input_schema`,
      'internal',
      'provider'
    );
  }

  if (tool.input_schema.type !== 'object') {
    throw new TranslationError(
      `Tool "${tool.name}" at index ${index} has invalid input_schema type (expected "object")`,
      'internal',
      'provider'
    );
  }

  if (!tool.input_schema.properties || typeof tool.input_schema.properties !== 'object') {
    throw new TranslationError(
      `Tool "${tool.name}" at index ${index} is missing input_schema.properties`,
      'internal',
      'provider'
    );
  }
}

/**
 * Translate tools to a specific provider format.
 *
 * Convenience function for dynamic provider selection.
 *
 * @param tools - Array of tools in internal format
 * @param provider - Target provider name
 * @returns Tools in the appropriate provider format
 * @throws TranslationError if the provider is unknown
 */
export function translateTools(
  tools: Tool[],
  provider: 'anthropic' | 'openai' | 'google' | 'gemini' | 'ollama' | 'openrouter' | 'zai'
): AnthropicTool[] | OpenAITool[] | GeminiTool {
  switch (provider) {
    case 'anthropic':
      return toAnthropicTools(tools);
    case 'openai':
    case 'openrouter':
    case 'zai':
      return toOpenAITools(tools);
    case 'google':
    case 'gemini':
      return toGeminiTools(tools);
    case 'ollama':
      // Ollama uses OpenAI-compatible format
      return toOpenAITools(tools);
    default:
      throw new TranslationError(
        `Unknown provider: ${provider}`,
        'internal',
        provider as string
      );
  }
}
