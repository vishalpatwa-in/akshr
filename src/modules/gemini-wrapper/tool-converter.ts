import { GeminiFunctionDeclaration, GeminiSchema, GeminiTool } from './types';
import { Tool, FunctionSchema } from '../models/index';

export class GeminiToolConverter {
  /**
   * Convert OpenAI-style tools to Gemini function declarations
   */
  static convertTools(tools: Tool[]): GeminiTool[] {
    const functionDeclarations = tools
      .filter(tool => tool.type === 'function' && tool.function)
      .map(tool => this.convertFunctionSchema(tool.function))
      .filter((decl): decl is GeminiFunctionDeclaration => decl !== null);

    if (functionDeclarations.length === 0) {
      return [];
    }

    return [{
      functionDeclarations,
    }];
  }

  /**
   * Convert a single OpenAI function schema to Gemini format
   */
  static convertFunctionSchema(functionSchema: FunctionSchema): GeminiFunctionDeclaration | null {
    if (!functionSchema.name) {
      console.warn('Function schema missing name');
      return null;
    }

    const geminiSchema: GeminiFunctionDeclaration = {
      name: functionSchema.name,
      description: functionSchema.description || '',
      parameters: functionSchema.parameters ? this.convertJsonSchema(functionSchema.parameters) : undefined,
    };

    return geminiSchema;
  }

  /**
   * Convert JSON Schema to Gemini schema format
   */
  static convertJsonSchema(schema: Record<string, any>): GeminiSchema | undefined {
    if (!schema || typeof schema !== 'object') {
      return undefined;
    }

    const geminiSchema: GeminiSchema = {
      type: this.mapJsonTypeToGemini(schema.type),
    };

    // Handle properties for object types
    if (schema.type === 'object' && schema.properties) {
      geminiSchema.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        const converted = this.convertJsonSchema(value as Record<string, any>);
        if (converted) {
          geminiSchema.properties[key] = converted;
        }
      }
    }

    // Handle array types
    if (schema.type === 'array' && schema.items) {
      geminiSchema.items = this.convertJsonSchema(schema.items as Record<string, any>);
    }

    // Handle enums
    if (schema.enum && Array.isArray(schema.enum)) {
      geminiSchema.enum = schema.enum.map(String);
    }

    // Handle required fields
    if (schema.required && Array.isArray(schema.required)) {
      geminiSchema.required = schema.required;
    }

    // Handle description
    if (schema.description) {
      geminiSchema.description = schema.description;
    }

    return geminiSchema;
  }

  /**
   * Map JSON Schema types to Gemini types
   */
  private static mapJsonTypeToGemini(jsonType: string | string[]): string {
    if (Array.isArray(jsonType)) {
      // Use the first type as primary
      return this.mapSingleType(jsonType[0]);
    }
    return this.mapSingleType(jsonType);
  }

  /**
   * Map a single JSON type to Gemini type
   */
  private static mapSingleType(type: string): string {
    const typeMapping: Record<string, string> = {
      'string': 'string',
      'number': 'number',
      'integer': 'number',
      'boolean': 'boolean',
      'array': 'array',
      'object': 'object',
    };

    return typeMapping[type] || 'string'; // Default to string for unknown types
  }

  /**
   * Validate that a tool schema is compatible with Gemini
   */
  static validateToolSchema(functionSchema: FunctionSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!functionSchema.name) {
      errors.push('Function name is required');
    }

    if (functionSchema.name && functionSchema.name.length > 64) {
      errors.push('Function name must be 64 characters or less');
    }

    if (!functionSchema.description) {
      errors.push('Function description is required');
    }

    if (functionSchema.description && functionSchema.description.length > 512) {
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
   * Validate JSON schema for Gemini compatibility
   */
  static validateJsonSchema(schema: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!schema.type) {
      errors.push('Schema type is required');
    }

    // Check nested properties depth (Gemini has limits)
    if (schema.properties) {
      const depthCheck = this.checkSchemaDepth(schema, 0);
      if (depthCheck > 5) {
        errors.push('Schema nesting depth exceeds Gemini limit of 5 levels');
      }
    }

    // Check for unsupported types
    if (schema.type && !['string', 'number', 'boolean', 'array', 'object'].includes(schema.type)) {
      errors.push(`Unsupported schema type: ${schema.type}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check the depth of a schema structure
   */
  private static checkSchemaDepth(schema: Record<string, any>, currentDepth: number): number {
    let maxDepth = currentDepth;

    if (schema.properties) {
      for (const value of Object.values(schema.properties)) {
        const depth = this.checkSchemaDepth(value as Record<string, any>, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    if (schema.items) {
      const depth = this.checkSchemaDepth(schema.items as Record<string, any>, currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  /**
   * Optimize tool schemas for better Gemini performance
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

        return optimized;
      }
      return tool;
    });
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
}