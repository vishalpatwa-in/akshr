import { Tool } from '../models/tool';
import { ServiceResult } from '../services/types';

/**
 * Interface for tool implementations
 */
export interface ToolImplementation {
  name: string;
  description: string;
  execute(args: Record<string, any>): Promise<any>;
  validateArgs(args: Record<string, any>): { valid: boolean; errors: string[] };
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  toolCallId: string;
  timeout?: number;
  retries?: number;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  retryCount: number;
}

/**
 * Tool Registry manages tool implementations and execution
 */
export class ToolRegistry {
  private tools = new Map<string, ToolImplementation>();
  private defaultTimeout = 30000; // 30 seconds
  private defaultRetries = 2;

  /**
   * Register a tool implementation
   */
  register(tool: ToolImplementation): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool implementation
   */
  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  /**
   * Get a tool implementation by name
   */
  get(toolName: string): ToolImplementation | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Check if a tool is registered
   */
  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * List all registered tools
   */
  list(): ToolImplementation[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name with the given arguments
   */
  async execute(
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext = { toolCallId: '' }
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = context.retries || this.defaultRetries;

    while (retryCount <= maxRetries) {
      try {
        const tool = this.tools.get(toolName);
        if (!tool) {
          return {
            success: false,
            error: `Tool '${toolName}' not found`,
            executionTime: Date.now() - startTime,
            retryCount
          };
        }

        // Validate arguments
        const validation = tool.validateArgs(args);
        if (!validation.valid) {
          return {
            success: false,
            error: `Invalid arguments: ${validation.errors.join(', ')}`,
            executionTime: Date.now() - startTime,
            retryCount
          };
        }

        // Execute with timeout
        const timeout = context.timeout || this.defaultTimeout;
        const result = await this.executeWithTimeout(tool, args, timeout);

        return {
          success: true,
          result,
          executionTime: Date.now() - startTime,
          retryCount
        };

      } catch (error) {
        retryCount++;

        if (retryCount > maxRetries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Tool execution failed',
            executionTime: Date.now() - startTime,
            retryCount: retryCount - 1
          };
        }

        // Wait before retry (exponential backoff)
        await this.sleep(Math.pow(2, retryCount) * 100);
      }
    }

    // This should never be reached, but TypeScript needs it
    return {
      success: false,
      error: 'Unexpected error in tool execution',
      executionTime: Date.now() - startTime,
      retryCount
    };
  }

  /**
   * Execute a tool with timeout
   */
  private async executeWithTimeout(
    tool: ToolImplementation,
    args: Record<string, any>,
    timeout: number
  ): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      try {
        const result = await tool.execute(args);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Validate tool arguments against tool schema
   */
  validateToolArgs(toolName: string, args: Record<string, any>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool '${toolName}' not found`] };
    }

    return tool.validateArgs(args);
  }

  /**
   * Get tool information for OpenAI-compatible format
   */
  getToolDefinitions(): Tool[] {
    return this.list().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: {}, // Would need to be populated from tool schema
          required: []
        }
      }
    }));
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health check for the tool registry
   */
  healthCheck(): { healthy: boolean; toolsCount: number; error?: string } {
    try {
      return {
        healthy: true,
        toolsCount: this.tools.size
      };
    } catch (error) {
      return {
        healthy: false,
        toolsCount: 0,
        error: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }
}

/**
 * Built-in tool implementations
 */

// Weather Tool
export class WeatherTool implements ToolImplementation {
  name = 'get_weather';
  description = 'Get weather information for a location';

  async execute(args: Record<string, any>): Promise<any> {
    const { location } = args;

    // Mock weather API call
    return {
      location,
      temperature: Math.floor(Math.random() * 30) + 10,
      condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.floor(Math.random() * 60) + 40
    };
  }

  validateArgs(args: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!args.location || typeof args.location !== 'string') {
      errors.push('Location must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }
}

// Calculator Tool
export class CalculatorTool implements ToolImplementation {
  name = 'calculate';
  description = 'Perform mathematical calculations';

  async execute(args: Record<string, any>): Promise<any> {
    const { expression } = args;

    // Simple expression evaluation (in production, use a safe math library)
    try {
      // WARNING: eval is dangerous in production - use a safe alternative
      const result = Function('"use strict"; return (' + expression + ')')();
      return { expression, result };
    } catch (error) {
      throw new Error(`Invalid mathematical expression: ${expression}`);
    }
  }

  validateArgs(args: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!args.expression || typeof args.expression !== 'string') {
      errors.push('Expression must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }
}

// Database Search Tool
export class DatabaseSearchTool implements ToolImplementation {
  name = 'search_database';
  description = 'Search for information in the database';

  async execute(args: Record<string, any>): Promise<any> {
    const { query, limit = 10 } = args;

    // Mock database search
    return {
      query,
      results: [
        { id: 1, title: `Result for "${query}"`, relevance: 0.95 },
        { id: 2, title: `Another result for "${query}"`, relevance: 0.87 }
      ],
      total: 2,
      limit
    };
  }

  validateArgs(args: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!args.query || typeof args.query !== 'string') {
      errors.push('Query must be a non-empty string');
    }

    if (args.limit !== undefined && (typeof args.limit !== 'number' || args.limit < 1)) {
      errors.push('Limit must be a positive number');
    }

    return { valid: errors.length === 0, errors };
  }
}

// Create default tool registry with built-in tools
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Register built-in tools
  registry.register(new WeatherTool());
  registry.register(new CalculatorTool());
  registry.register(new DatabaseSearchTool());

  return registry;
}

// Types are exported above with their declarations