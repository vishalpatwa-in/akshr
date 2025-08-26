import { Run, RunStatus, RequiredToolAction } from '../models/run';
import { Message, MessageContent } from '../models/message';
import { Tool } from '../models/tool';
import { ServiceConfig, ServiceResult } from './types';
import { ServiceUtils } from './utils';
import { NormalizedResponse, NormalizedToolCall } from '../gemini-wrapper/types';
import { ToolRegistry, ToolExecutionResult as RegistryToolResult, createDefaultToolRegistry } from '../tool-registry';

/**
 * ToolCallingFlow handles the detection, validation, execution,
 * and result processing of tool calls within the run execution flow.
 */
export class ToolCallingFlow {
  private readonly config: ServiceConfig;
  private readonly toolRegistry: ToolRegistry;

  constructor(config: ServiceConfig, toolRegistry?: ToolRegistry) {
    this.config = config;
    this.toolRegistry = toolRegistry || createDefaultToolRegistry();
  }

  /**
   * Detect if a Gemini response contains tool calls
   */
  detectToolCalls(response: NormalizedResponse): boolean {
    return !!(response.toolCalls && response.toolCalls.length > 0);
  }

  /**
   * Extract and validate tool calls from Gemini response
   */
  extractToolCalls(response: NormalizedResponse): ServiceResult<NormalizedToolCall[]> {
    try {
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return { success: true, data: [] };
      }

      // Validate tool calls
      const validation = this.validateToolCalls(response.toolCalls);
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid tool calls: ${validation.errors.join(', ')}`,
          code: 'INVALID_TOOL_CALLS'
        };
      }

      return { success: true, data: response.toolCalls };
    } catch (error) {
      console.error('Error extracting tool calls:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract tool calls',
        code: 'TOOL_CALL_EXTRACTION_ERROR'
      };
    }
  }

  /**
   * Create required tool actions from tool calls
   */
  createRequiredToolActions(
    toolCalls: NormalizedToolCall[],
    availableTools: Tool[]
  ): ServiceResult<RequiredToolAction[]> {
    try {
      const toolActions: RequiredToolAction[] = [];

      for (const toolCall of toolCalls) {
        // Validate tool exists
        const tool = availableTools.find(t => t.function.name === toolCall.name);
        if (!tool) {
          return {
            success: false,
            error: `Tool '${toolCall.name}' not found in available tools`,
            code: 'TOOL_NOT_FOUND'
          };
        }

        // Validate tool call arguments against schema
        const validation = this.validateToolCallArguments(toolCall, tool);
        if (!validation.valid) {
          return {
            success: false,
            error: `Invalid arguments for tool '${toolCall.name}': ${validation.errors.join(', ')}`,
            code: 'INVALID_TOOL_ARGUMENTS'
          };
        }

        toolActions.push({
          tool_call_id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments)
          }
        });
      }

      return { success: true, data: toolActions };
    } catch (error) {
      console.error('Error creating tool actions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create tool actions',
        code: 'TOOL_ACTION_CREATION_ERROR'
      };
    }
  }

  /**
   * Execute tool calls and return results
   */
  async executeToolCalls(
    toolCalls: NormalizedToolCall[],
    availableTools: Tool[]
  ): Promise<ServiceResult<ToolExecutionResult[]>> {
    try {
      const results: ToolExecutionResult[] = [];

      for (const toolCall of toolCalls) {
        const result = await this.executeSingleToolCall(toolCall, availableTools);
        results.push(result);

        // If any tool execution fails, we might want to handle it
        // For now, we'll collect all results and let the caller decide
      }

      return { success: true, data: results };
    } catch (error) {
      console.error('Error executing tool calls:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute tool calls',
        code: 'TOOL_EXECUTION_ERROR'
      };
    }
  }

  /**
   * Execute a single tool call
   */
  private async executeSingleToolCall(
    toolCall: NormalizedToolCall,
    availableTools: Tool[]
  ): Promise<ToolExecutionResult> {
    try {
      // Check if tool is available in the assistant's tools
      const tool = availableTools.find(t => t.function.name === toolCall.name);
      if (!tool) {
        return {
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          success: false,
          error: `Tool '${toolCall.name}' not found in available tools`,
          code: 'TOOL_NOT_FOUND'
        };
      }

      // Check if tool is registered in the tool registry
      if (!this.toolRegistry.has(toolCall.name)) {
        return {
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          success: false,
          error: `Tool '${toolCall.name}' not implemented in registry`,
          code: 'TOOL_NOT_IMPLEMENTED'
        };
      }

      // Execute the tool using the registry
      const result = await this.toolRegistry.execute(
        toolCall.name,
        toolCall.arguments,
        { toolCallId: toolCall.id }
      );

      return {
        tool_call_id: toolCall.id,
        tool_name: toolCall.name,
        success: result.success,
        result: result.result,
        error: result.error,
        code: result.success ? undefined : 'TOOL_EXECUTION_FAILED'
      };
    } catch (error) {
      return {
        tool_call_id: toolCall.id,
        tool_name: toolCall.name,
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
        code: 'TOOL_EXECUTION_FAILED'
      };
    }
  }

  /**
   * Create tool result messages for the conversation
   */
  createToolResultMessages(
    toolCalls: NormalizedToolCall[],
    toolResults: ToolExecutionResult[]
  ): MessageContent[] {
    const messages: MessageContent[] = [];

    for (const toolCall of toolCalls) {
      const result = toolResults.find(r => r.tool_call_id === toolCall.id);

      if (result) {
        messages.push({
          type: 'tool_call',
          tool_call: {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments)
            }
          }
        });

        // Add tool result
        messages.push({
          type: 'text',
          text: {
            value: result.success
              ? JSON.stringify(result.result)
              : `Error: ${result.error || 'Tool execution failed'}`
          }
        });
      }
    }

    return messages;
  }

  /**
   * Validate tool calls structure and content
   */
  private validateToolCalls(toolCalls: NormalizedToolCall[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!Array.isArray(toolCalls)) {
      errors.push('Tool calls must be an array');
      return { valid: false, errors };
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];

      if (!toolCall.id || typeof toolCall.id !== 'string') {
        errors.push(`Tool call ${i}: ID must be a non-empty string`);
      }

      if (!toolCall.name || typeof toolCall.name !== 'string') {
        errors.push(`Tool call ${i}: Name must be a non-empty string`);
      }

      if (toolCall.arguments === undefined) {
        errors.push(`Tool call ${i}: Arguments are required`);
      }

      // Validate arguments is an object
      if (typeof toolCall.arguments !== 'object' || toolCall.arguments === null) {
        errors.push(`Tool call ${i}: Arguments must be an object`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate tool call arguments against tool schema
   */
  private validateToolCallArguments(
    toolCall: NormalizedToolCall,
    tool: Tool
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      // Basic validation - in a real implementation you would
      // validate against the JSON schema in tool.function.parameters
      if (!tool.function.parameters) {
        return { valid: true, errors: [] };
      }

      // For now, just check if arguments is a valid object
      if (typeof toolCall.arguments !== 'object' || toolCall.arguments === null) {
        errors.push('Arguments must be an object');
      }

    } catch (error) {
      errors.push(`Argument validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return { valid: errors.length === 0, errors };
  }


  /**
   * Check if tool results indicate success or failure
   */
  analyzeToolResults(results: ToolExecutionResult[]): {
    allSuccessful: boolean;
    failures: ToolExecutionResult[];
    successes: ToolExecutionResult[];
  } {
    const failures = results.filter(r => !r.success);
    const successes = results.filter(r => r.success);

    return {
      allSuccessful: failures.length === 0,
      failures,
      successes
    };
  }
}

/**
 * Result of a single tool execution
 */
export interface ToolExecutionResult {
  tool_call_id: string;
  tool_name: string;
  success: boolean;
  result?: any;
  error?: string;
  code?: string;
}

/**
 * Tool calling session state
 */
export interface ToolCallingSession {
  toolCalls: NormalizedToolCall[];
  requiredActions: RequiredToolAction[];
  executionResults: ToolExecutionResult[];
  status: 'pending' | 'executing' | 'completed' | 'failed';
}