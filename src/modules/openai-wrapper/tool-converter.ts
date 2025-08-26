import { OpenAITool, OpenAIToolCall } from './types';
import { Tool, FunctionSchema } from '../models/index';

export class OpenAIToolConverter {
  /**
   * Convert internal Tool format to OpenAI tool format
   */
  static convertTools(tools: Tool[]): OpenAITool[] {
    return tools
      .filter(tool => tool.type === 'function' && tool.function)
      .map(tool => this.convertFunctionSchema(tool.function))
      .filter((tool): tool is OpenAITool => tool !== null);
  }

  /**
   * Convert a single function schema to OpenAI format
   */
  static convertFunctionSchema(functionSchema: FunctionSchema): OpenAITool | null {
    if (!functionSchema.name) {
      console.warn('Function schema missing name');
      return null;
    }

    return {
      type: 'function',
      function: {
        name: functionSchema.name,
        description: functionSchema.description || '',
        parameters: functionSchema.parameters || {},
        strict: this.shouldUseStrictMode(functionSchema),
      },
    };
  }

  /**
   * Determine if strict mode should be used for the function
   */
  private static shouldUseStrictMode(functionSchema: FunctionSchema): boolean {
    // Use strict mode for functions with well-defined schemas
    return !!(functionSchema.parameters &&
              functionSchema.parameters.type === 'object' &&
              functionSchema.parameters.properties);
  }

  /**
   * Validate that a tool schema is compatible with OpenAI
   */
  static validateToolSchema(functionSchema: FunctionSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!functionSchema.name) {
      errors.push('Function name is required');
    } else {
      // OpenAI function name requirements
      if (functionSchema.name.length > 64) {
        errors.push('Function name must be 64 characters or less');
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(functionSchema.name)) {
        errors.push('Function name must contain only alphanumeric characters, underscores, and hyphens');
      }
    }

    if (!functionSchema.description) {
      errors.push('Function description is required');
    } else if (functionSchema.description.length > 512) {
      errors.push('Function description must be 512 characters or less');
    }

    // Validate parameters schema if present
    if (functionSchema.parameters) {
      const paramValidation = this.validateJsonSchema(functionSchema.parameters);
      errors.push(...paramValidation.errors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate JSON schema for OpenAI compatibility
   */
  static validateJsonSchema(schema: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!schema.type) {
      errors.push('Schema type is required');
    }

    // Check supported types
    if (schema.type && !['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'].includes(schema.type)) {
      errors.push(`Unsupported schema type: ${schema.type}`);
    }

    // Validate object properties
    if (schema.type === 'object') {
      if (schema.properties) {
        const propCount = Object.keys(schema.properties).length;
        if (propCount > 100) {
          errors.push('Object cannot have more than 100 properties');
        }

        // Validate each property
        for (const [key, value] of Object.entries(schema.properties)) {
          if (key.length > 64) {
            errors.push(`Property name '${key}' exceeds 64 character limit`);
          }
          if (value && typeof value === 'object') {
            const nestedValidation = this.validateJsonSchema(value as Record<string, any>);
            errors.push(...nestedValidation.errors.map(error => `Property '${key}': ${error}`));
          }
        }
      }
    }

    // Validate array items
    if (schema.type === 'array' && schema.items) {
      const itemsValidation = this.validateJsonSchema(schema.items as Record<string, any>);
      errors.push(...itemsValidation.errors.map(error => `Array items: ${error}`));
    }

    // Check for required fields
    if (schema.required && Array.isArray(schema.required)) {
      const requiredCount = schema.required.length;
      if (requiredCount > 100) {
        errors.push('Cannot have more than 100 required fields');
      }

      // Ensure required fields exist in properties
      if (schema.properties) {
        for (const required of schema.required) {
          if (!(required in schema.properties)) {
            errors.push(`Required field '${required}' not found in properties`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Optimize tool schemas for better OpenAI performance
   */
  static optimizeToolSchemas(tools: Tool[]): Tool[] {
    return tools.map(tool => {
      if (tool.type === 'function' && tool.function) {
        const optimized = { ...tool };
        optimized.function = { ...tool.function };

        // Ensure descriptions are present and concise
        if (!optimized.function.description) {
          optimized.function.description = `Execute the ${optimized.function.name} function`;
        }

        // Limit description length
        if (optimized.function.description.length > 512) {
          optimized.function.description = optimized.function.description.substring(0, 509) + '...';
        }

        // Optimize parameter schemas
        if (optimized.function.parameters) {
          optimized.function.parameters = this.optimizeJsonSchema(optimized.function.parameters);
        }

        return optimized;
      }
      return tool;
    });
  }

  /**
   * Optimize JSON schema for OpenAI
   */
  private static optimizeJsonSchema(schema: Record<string, any>): Record<string, any> {
    const optimized = { ...schema };

    // Remove redundant descriptions
    if (optimized.properties) {
      for (const [key, value] of Object.entries(optimized.properties)) {
        if (value && typeof value === 'object' && 'description' in value && value.description === `${key} parameter`) {
          delete (value as any).description;
        }
      }
    }

    return optimized;
  }

  /**
   * Create a simple tool schema from basic parameters
   */
  static createSimpleToolSchema(
    name: string,
    description: string,
    properties: Record<string, { type: string; description?: string; required?: boolean }> = {}
  ): FunctionSchema {
    const required: string[] = [];
    const schemaProperties: Record<string, any> = {};

    for (const [key, config] of Object.entries(properties)) {
      schemaProperties[key] = {
        type: config.type,
        description: config.description || `${key} parameter`,
      };

      if (config.required) {
        required.push(key);
      }
    }

    return {
      name,
      description,
      parameters: {
        type: 'object',
        properties: schemaProperties,
        required: required.length > 0 ? required : undefined,
      },
    };
  }

  /**
   * Convert OpenAI tool call format to internal format
   */
  static convertToolCallToInternal(toolCall: OpenAIToolCall): any {
    return {
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    };
  }

  /**
   * Extract tool calls from OpenAI response
   */
  static extractToolCallsFromResponse(choices: Array<{ message?: { tool_calls?: OpenAIToolCall[] } }>): OpenAIToolCall[] {
    const toolCalls: OpenAIToolCall[] = [];

    for (const choice of choices) {
      if (choice.message?.tool_calls) {
        toolCalls.push(...choice.message.tool_calls);
      }
    }

    return toolCalls;
  }

  /**
   * Create tool call result message
   */
  static createToolResultMessage(
    toolCallId: string,
    functionName: string,
    result: any
  ): any {
    return {
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      tool_call_id: toolCallId,
      name: functionName,
    };
  }

  /**
   * Check if tool calls are present in a message
   */
  static hasToolCalls(message: { tool_calls?: OpenAIToolCall[] }): boolean {
    return !!(message.tool_calls && message.tool_calls.length > 0);
  }

  /**
   * Get the total number of tools
   */
  static getToolCount(tools: Tool[]): number {
    return tools.filter(tool => tool.type === 'function' && tool.function).length;
  }

  /**
   * Validate tool collection for OpenAI compatibility
   */
  static validateToolCollection(tools: Tool[]): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (tools.length > 128) {
      errors.push('Cannot have more than 128 tools');
    }

    const functionNames = new Set<string>();

    for (const tool of tools) {
      if (tool.type === 'function' && tool.function) {
        // Check for duplicate names
        if (functionNames.has(tool.function.name)) {
          errors.push(`Duplicate function name: ${tool.function.name}`);
        }
        functionNames.add(tool.function.name);

        // Validate individual tool
        const validation = this.validateToolSchema(tool.function);
        errors.push(...validation.errors.map(error => `Tool '${tool.function.name}': ${error}`));
      } else {
        warnings.push('Non-function tools are ignored by OpenAI');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}