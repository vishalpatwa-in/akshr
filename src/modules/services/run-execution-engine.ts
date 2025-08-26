import { Run, RunStatus, RunError, RequiredToolAction } from '../models/run';
import { Message, MessageContent, TextContent, ImageContent, ToolCallContent } from '../models/message';
import { Assistant } from '../models/assistant';
import { ServiceConfig, ServiceResult } from './types';
import { ServiceUtils } from './utils';
import { ProviderService } from '../providers/provider-service';
import {
  UnifiedRequest,
  UnifiedResponse,
  UnifiedMessage,
  UnifiedTool,
  UnifiedContent,
  UnifiedToolCall,
  UnifiedProviderError,
  ProviderErrorType
} from '../providers/types';
import { Tool } from '../models/tool';

/**
 * RunExecutionEngine handles the execution lifecycle of runs including
 * state transitions, provider abstraction layer inference, tool calling, and streaming.
 */
export class RunExecutionEngine {
  private readonly config: ServiceConfig;
  private readonly providerService: ProviderService;

  constructor(config: ServiceConfig, providerService: ProviderService) {
    this.config = config;
    this.providerService = providerService;
  }

  /**
   * Convert internal Message format to UnifiedMessage format
   */
  private convertToUnifiedMessage(message: Message): UnifiedMessage {
    const unifiedContent: UnifiedContent[] = [];

    for (const content of message.content) {
      if (content.type === 'text') {
        unifiedContent.push({
          type: 'text',
          text: content.text.value
        });
      } else if (content.type === 'image_url') {
        unifiedContent.push({
          type: 'image_url',
          image_url: {
            url: content.image_url.url,
            detail: content.image_url.detail
          }
        });
      } else if (content.type === 'tool_call') {
        // Tool calls will be handled separately as they go in tool_calls array
      }
    }

    const unifiedMessage: UnifiedMessage = {
      role: message.role === 'tool' ? 'tool' : message.role,
      content: unifiedContent.length === 1 && unifiedContent[0].type === 'text'
        ? unifiedContent[0].text!
        : unifiedContent
    };

    // Add tool calls if present
    const toolCalls = message.content
      .filter((c): c is ToolCallContent => c.type === 'tool_call')
      .map(c => c.tool_call);

    if (toolCalls.length > 0) {
      unifiedMessage.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));
    }

    if (message.tool_call_id) {
      unifiedMessage.tool_call_id = message.tool_call_id;
    }

    return unifiedMessage;
  }

  /**
   * Convert internal Tool format to UnifiedTool format
   */
  private convertToUnifiedTool(tool: Tool): UnifiedTool {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || {}
      }
    };
  }

  /**
   * Convert UnifiedResponse to the format expected by the run execution engine
   */
  private convertFromUnifiedResponse(response: UnifiedResponse): {
    text?: string;
    toolCalls?: Array<{ name: string; arguments: any }>
  } {
    const choice = response.choices[0];
    if (!choice) {
      return {};
    }

    const result: {
      text?: string;
      toolCalls?: Array<{ name: string; arguments: any }>
    } = {};

    // Extract text content
    if (typeof choice.message.content === 'string') {
      result.text = choice.message.content;
    } else if (Array.isArray(choice.message.content)) {
      const textContent = choice.message.content.find(c => c.type === 'text');
      if (textContent) {
        result.text = textContent.text;
      }
    }

    // Extract tool calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      result.toolCalls = choice.message.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }));
    }

    return result;
  }

  /**
   * Add tool results to messages as tool response messages
   */
  private addToolResultsToMessages(messages: Message[], toolCalls: any[], results: any[]): Message[] {
    const messagesWithResults = [...messages];

    // Add tool response messages
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const toolCall = toolCalls[i];

      messagesWithResults.push({
        id: `msg_tool_${Date.now()}_${i}`,
        object: 'message',
        created_at: Math.floor(Date.now() / 1000),
        thread_id: messages[0]?.thread_id || '',
        role: 'tool',
        content: [{
          type: 'text',
          text: {
            value: JSON.stringify(result.result)
          }
        }],
        tool_call_id: toolCall.id
      });
    }

    return messagesWithResults;
  }

  /**
   * Execute a run from start to completion
   */
  async executeRun(run: Run): Promise<ServiceResult<Run>> {
    try {
      // Transition to in_progress
      let currentRun = await this.transitionRunStatus(run, 'in_progress');

      // Execute the run based on its current state
      while (currentRun.status === 'in_progress') {
        const result = await this.processRunStep(currentRun);
        if (!result.success) {
          // Transition to failed state
          return await this.failRun(currentRun, result.error || 'Execution failed');
        }

        if (!result.data) {
          return await this.failRun(currentRun, 'No run data returned from step processing');
        }

        currentRun = result.data;
      }

      return { success: true, data: currentRun };
    } catch (error) {
      console.error('Error in executeRun:', error);
      return await this.failRun(run, error instanceof Error ? error.message : 'Unknown execution error');
    }
  }

  /**
   * Process a single step of run execution
   */
  private async processRunStep(run: Run): Promise<ServiceResult<Run>> {
    try {
      // Get messages for the thread
      const messages = await this.getThreadMessages(run.thread_id);
      if (!messages.success || !messages.data) {
        return {
          success: false,
          error: messages.error || 'Failed to get thread messages',
          code: messages.code || 'GET_MESSAGES_ERROR'
        };
      }

      // Get assistant configuration
      const assistant = await this.getAssistant(run.assistant_id);
      if (!assistant.success || !assistant.data) {
        return {
          success: false,
          error: 'Assistant not found',
          code: 'ASSISTANT_NOT_FOUND'
        };
      }

      // Create unified request configuration
      const request: UnifiedRequest = {
        model: run.model,
        messages: messages.data.map(msg => this.convertToUnifiedMessage(msg)),
        temperature: 0.7,
        max_tokens: 4096
      };

      // Check if we have tool results to process
      if (run.status === 'in_progress' && !run.required_tool_actions) {
        // Generate response with potential tool calls
        // Add assistant tools to the request if available
        if (assistant.data.tools && assistant.data.tools.length > 0) {
          request.tools = assistant.data.tools.map(tool => this.convertToUnifiedTool(tool));
        }

        // Generate response with potential tool calls
        const response = await this.providerService.generateWithTools(request, {}, run.id);

        // Convert response to expected format
        const convertedResponse = this.convertFromUnifiedResponse(response);

        // Check for tool calls in the response
        if (convertedResponse.toolCalls && convertedResponse.toolCalls.length > 0) {
          // Create required tool actions
          const toolActions: RequiredToolAction[] = convertedResponse.toolCalls.map((toolCall, index) => ({
            tool_call_id: `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments)
            }
          }));

          // Transition to requires_tool_actions
          return await this.requireToolActions(run, toolActions);
        } else {
          // No tool calls, create assistant message and complete
          const assistantMessage = await this.createAssistantMessage(run.thread_id, convertedResponse.text || '');
          if (!assistantMessage.success) {
            return {
              success: false,
              error: assistantMessage.error || 'Failed to create assistant message',
              code: assistantMessage.code || 'CREATE_MESSAGE_ERROR'
            };
          }

          // Transition to completed
          return await this.completeRun(run);
        }
      } else if (run.status === 'in_progress' && run.required_tool_actions) {
        // Process tool results and continue
        const toolResults = await this.processToolResults(run, messages.data);
        if (!toolResults.success || !toolResults.data) {
          return {
            success: false,
            error: toolResults.error || 'Failed to process tool results',
            code: toolResults.code || 'PROCESS_TOOL_RESULTS_ERROR'
          };
        }

        // Add tool results to the messages
        const messagesWithToolResults = this.addToolResultsToMessages(messages.data, toolResults.data.toolCalls, toolResults.data.results);

        // Create new request with tool results
        const toolResultRequest: UnifiedRequest = {
          model: run.model,
          messages: messagesWithToolResults.map(msg => this.convertToUnifiedMessage(msg)),
          temperature: 0.7,
          max_tokens: 4096
        };

        // Continue with tool results
        const response = await this.providerService.generateResponse(toolResultRequest, {}, run.id);

        // Convert response and create assistant message with final response
        const convertedToolResponse = this.convertFromUnifiedResponse(response);
        const assistantMessage = await this.createAssistantMessage(run.thread_id, convertedToolResponse.text || '');
        if (!assistantMessage.success) {
          return {
            success: false,
            error: assistantMessage.error || 'Failed to create assistant message',
            code: assistantMessage.code || 'CREATE_MESSAGE_ERROR'
          };
        }

        // Transition to completed
        return await this.completeRun(run);
      }

      return { success: true, data: run };
    } catch (error) {
      console.error('Error in processRunStep:', error);

      // Handle unified provider errors
      if (error instanceof Error && 'type' in error && 'provider' in error) {
        const unifiedError = error as UnifiedProviderError;
        return {
          success: false,
          error: unifiedError.message || 'Provider error occurred',
          code: unifiedError.type || 'PROVIDER_ERROR'
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Step processing failed',
        code: 'STEP_PROCESSING_ERROR'
      };
    }
  }

  /**
   * Stream run execution for real-time updates
   */
  async *streamRunExecution(run: Run): AsyncGenerator<RunExecutionEvent, void, unknown> {
    try {
      yield { type: 'run.created', data: run };

      // Transition to in_progress
      let currentRun = await this.transitionRunStatus(run, 'in_progress');
      yield { type: 'run.in_progress', data: currentRun };

      // Execute the run based on its current state
      while (currentRun.status === 'in_progress') {
        const result = await this.processRunStep(currentRun);
        if (!result.success) {
          // Transition to failed state
          const failedRun = await this.failRun(currentRun, result.error || 'Execution failed');
          if (failedRun.success) {
            yield { type: 'run.failed', data: failedRun.data! };
          }
          return;
        }

        if (!result.data) {
          const failedRun = await this.failRun(currentRun, 'No run data returned');
          if (failedRun.success) {
            yield { type: 'run.failed', data: failedRun.data! };
          }
          return;
        }

        currentRun = result.data;

        if (currentRun.status === 'requires_tool_actions') {
          yield { type: 'run.requires_tool_actions', data: currentRun };
          return; // Wait for tool outputs
        } else if (currentRun.status === 'completed') {
          yield { type: 'run.completed', data: currentRun };
          return;
        }
      }
    } catch (error) {
      console.error('Error in streamRunExecution:', error);
      const failedRun = await this.failRun(run, error instanceof Error ? error.message : 'Unknown execution error');
      if (failedRun.success && failedRun.data) {
        yield { type: 'run.failed', data: failedRun.data! };
      }
    }
  }

  /**
   * Transition run to a new status with validation
   */
  private async transitionRunStatus(run: Run, newStatus: RunStatus, error?: RunError): Promise<Run> {
    const updatedRun: Run = {
      ...run,
      status: newStatus,
      last_error: error
    };

    // Set timestamps based on status
    if (newStatus === 'in_progress' && !run.started_at) {
      updatedRun.started_at = Math.floor(Date.now() / 1000);
    } else if ((newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') && !run.completed_at) {
      updatedRun.completed_at = Math.floor(Date.now() / 1000);
    }

    // Persist the updated run
    await this.config.storage.runs.put(run.thread_id, updatedRun);

    return updatedRun;
  }

  /**
   * Set run to require tool actions
   */
  private async requireToolActions(run: Run, toolActions: RequiredToolAction[]): Promise<ServiceResult<Run>> {
    try {
      const updatedRun: Run = {
        ...run,
        status: 'requires_tool_actions',
        required_tool_actions: toolActions
      };

      await this.config.storage.runs.put(run.thread_id, updatedRun);

      return { success: true, data: updatedRun };
    } catch (error) {
      console.error('Error requiring tool actions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to require tool actions',
        code: 'REQUIRE_TOOL_ACTIONS_ERROR'
      };
    }
  }

  /**
   * Complete a run successfully
   */
  private async completeRun(run: Run): Promise<ServiceResult<Run>> {
    try {
      const completedRun = await this.transitionRunStatus(run, 'completed');
      return { success: true, data: completedRun };
    } catch (error) {
      console.error('Error completing run:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete run',
        code: 'COMPLETE_RUN_ERROR'
      };
    }
  }

  /**
   * Fail a run with error details
   */
  private async failRun(run: Run, errorMessage: string): Promise<ServiceResult<Run>> {
    try {
      const error: RunError = {
        code: 'EXECUTION_ERROR',
        message: errorMessage
      };

      const failedRun = await this.transitionRunStatus(run, 'failed', error);
      return { success: true, data: failedRun };
    } catch (error) {
      console.error('Error failing run:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fail run',
        code: 'FAIL_RUN_ERROR'
      };
    }
  }

  /**
   * Get messages for a thread
   */
  private async getThreadMessages(threadId: string): Promise<ServiceResult<Message[]>> {
    try {
      // This would need to be implemented in the message service
      // For now, return empty array as placeholder
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error getting thread messages:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get thread messages',
        code: 'GET_MESSAGES_ERROR'
      };
    }
  }

  /**
   * Create an assistant message in the thread
   */
  private async createAssistantMessage(threadId: string, content: string): Promise<ServiceResult<Message>> {
    try {
      // This would need to be implemented in the message service
      // For now, return a placeholder success
      return {
        success: true,
        data: {
          id: `msg_${Date.now()}`,
          object: 'message',
          created_at: Math.floor(Date.now() / 1000),
          thread_id: threadId,
          role: 'assistant',
          content: [{ type: 'text', text: { value: content } }]
        }
      };
    } catch (error) {
      console.error('Error creating assistant message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create assistant message',
        code: 'CREATE_MESSAGE_ERROR'
      };
    }
  }

  /**
   * Process tool results for a run
   */
  private async processToolResults(run: Run, messages: Message[]): Promise<ServiceResult<{ toolCalls: any[], results: any[] }>> {
    try {
      // Extract tool calls from recent messages
      const toolCalls: any[] = [];
      const results: any[] = [];

      // Process tool results from the run's required tool actions
      if (run.required_tool_actions) {
        for (const action of run.required_tool_actions) {
          toolCalls.push({
            id: action.tool_call_id,
            name: action.function.name,
            arguments: JSON.parse(action.function.arguments)
          });
        }
      }

      // In a real implementation, you would execute the tools here
      // For now, return placeholder results
      for (const toolCall of toolCalls) {
        results.push({
          name: toolCall.name,
          result: `Mock result for ${toolCall.name}`
        });
      }

      return {
        success: true,
        data: { toolCalls, results }
      };
    } catch (error) {
      console.error('Error processing tool results:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process tool results',
        code: 'PROCESS_TOOL_RESULTS_ERROR'
      };
    }
  }

  /**
   * Get assistant by ID
   */
  private async getAssistant(assistantId: string): Promise<ServiceResult<Assistant>> {
    try {
      const assistant = await this.config.storage.assistants.get(assistantId);
      if (!assistant) {
        return {
          success: false,
          error: 'Assistant not found',
          code: 'ASSISTANT_NOT_FOUND'
        };
      }
      return { success: true, data: assistant };
    } catch (error) {
      console.error('Error getting assistant:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get assistant',
        code: 'GET_ASSISTANT_ERROR'
      };
    }
  }

  /**
   * Validate if a run can transition to a new status
   */
  private validateStatusTransition(currentStatus: RunStatus, newStatus: RunStatus): boolean {
    const validTransitions: Record<RunStatus, RunStatus[]> = {
      'queued': ['in_progress', 'cancelled'],
      'in_progress': ['requires_tool_actions', 'completed', 'failed', 'cancelled'],
      'requires_tool_actions': ['in_progress', 'cancelled'],
      'completed': [], // Terminal state
      'failed': [], // Terminal state
      'cancelled': [] // Terminal state
    };

    return validTransitions[currentStatus]?.includes(newStatus) ?? false;
  }

  /**
   * Health check for the execution engine
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      return await this.providerService.healthCheck();
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }
}

/**
 * Events emitted during run execution streaming
 */
export interface RunExecutionEvent {
  type: 'run.created' | 'run.in_progress' | 'run.requires_tool_actions' | 'run.completed' | 'run.failed';
  data: Run;
}