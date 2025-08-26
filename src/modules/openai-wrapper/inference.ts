import { OpenAIClient } from './client';
import { OpenAIPromptBuilder } from './prompt-builder';
import { OpenAIToolConverter } from './tool-converter';
import { OpenAIOutputNormalizer } from './output-normalizer';
import { OpenAIRequest, InferenceConfig, NormalizedResponse } from './types';
import { Assistant, Message, Tool } from '../models/index';

export class OpenAIInference {
  private client: OpenAIClient;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAIClient({
      apiKey,
      model: model || 'gpt-5-turbo',
    });
  }

  /**
   * Generate a response from message history
   */
  async generateResponse(
    messages: Message[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const openaiMessages = OpenAIPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools: [] },
      messages,
      false
    );

    const request = this.buildRequest(openaiMessages, undefined, config);
    const response = await this.client.generate(request);

    return OpenAIOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Generate response with tool calling support
   */
  async generateWithTools(
    messages: Message[],
    tools: Tool[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const openaiMessages = OpenAIPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools },
      messages,
      false
    );

    const openaiTools = OpenAIToolConverter.convertTools(tools);
    const request = this.buildRequest(openaiMessages, openaiTools, config);
    const response = await this.client.generate(request);

    return OpenAIOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Generate response for a complete assistant setup
   */
  async generateAssistantResponse(
    assistant: Assistant,
    messages: Message[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const openaiMessages = OpenAIPromptBuilder.buildMessages(assistant, messages, true);
    const openaiTools = OpenAIToolConverter.convertTools(assistant.tools);
    const request = this.buildRequest(openaiMessages, openaiTools, config);

    const response = await this.client.generate(request);
    return OpenAIOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Stream response generation
   */
  async *streamResponse(
    messages: Message[],
    tools?: Tool[],
    config?: InferenceConfig
  ): AsyncGenerator<NormalizedResponse, void, unknown> {
    const openaiMessages = OpenAIPromptBuilder.buildMessages(
      {
        instructions: '',
        model: '',
        name: '',
        id: '',
        object: 'assistant',
        created_at: Date.now(),
        tools: tools || []
      },
      messages,
      false
    );

    const openaiTools = tools ? OpenAIToolConverter.convertTools(tools) : undefined;
    const request = this.buildRequest(openaiMessages, openaiTools, config);

    const stream = this.client.generateStream(request);

    for await (const chunk of stream) {
      const normalized = OpenAIOutputNormalizer.normalizeStreamChunk(chunk);
      if (normalized) {
        yield normalized;
      }
    }
  }

  /**
   * Continue conversation with tool results
   */
  async continueWithToolResults(
    originalMessages: Message[],
    toolCalls: Array<{ id: string; name: string; arguments: any }>,
    toolResults: Array<{ name: string; result: any }>,
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    let openaiMessages = OpenAIPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools: [] },
      originalMessages,
      false
    );

    // Add tool calls to the conversation
    for (const toolCall of toolCalls) {
      openaiMessages.push(OpenAIPromptBuilder.createToolCallMessage(
        toolCall.id,
        toolCall.name,
        toolCall.arguments
      ));
    }

    // Add tool results
    for (const result of toolResults) {
      openaiMessages = OpenAIPromptBuilder.addToolResult(
        openaiMessages,
        result.name, // Use function name as tool_call_id for simplicity
        result.name,
        result.result
      );
    }

    const request = this.buildRequest(openaiMessages, undefined, config);
    const response = await this.client.generate(request);

    return OpenAIOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Build an OpenAI request from components
   */
  private buildRequest(
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | any; tool_call_id?: string; tool_calls?: any; name?: string }>,
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: any; strict?: boolean } }>,
    config?: InferenceConfig
  ): OpenAIRequest {
    const request: OpenAIRequest = {
      model: this.client.getConfig().model || 'gpt-5-turbo',
      messages,
      tools,
    };

    if (config) {
      request.max_tokens = config.maxTokens;
      request.temperature = config.temperature;
      request.top_p = config.topP;
      request.verbosity = config.verbosity;
      request.reasoning_effort = config.reasoning_effort;
    }

    return request;
  }

  /**
   * Validate inference parameters
   */
  validateParameters(
    messages: Message[],
    tools?: Tool[],
    config?: InferenceConfig
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!messages || messages.length === 0) {
      errors.push('Messages array cannot be empty');
    }

    if (tools) {
      for (const tool of tools) {
        const validation = OpenAIToolConverter.validateToolSchema(tool.function);
        if (!validation.valid) {
          errors.push(`Tool '${tool.function.name}': ${validation.errors.join(', ')}`);
        }
      }
    }

    if (config) {
      if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
        errors.push('Temperature must be between 0 and 2');
      }

      if (config.maxTokens !== undefined && config.maxTokens < 1) {
        errors.push('Max tokens must be greater than 0');
      }

      if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
        errors.push('TopP must be between 0 and 1');
      }

      if (config.verbosity && !['low', 'medium', 'high'].includes(config.verbosity)) {
        errors.push('Verbosity must be one of: low, medium, high');
      }

      if (config.reasoning_effort && !['low', 'medium', 'high'].includes(config.reasoning_effort)) {
        errors.push('Reasoning effort must be one of: low, medium, high');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get model information
   */
  getModelInfo(): { name: string; version: string } {
    return {
      name: this.client.getConfig().model || 'gpt-5-turbo',
      version: 'v1',
    };
  }

  /**
   * Update API key
   */
  updateApiKey(apiKey: string): void {
    this.client.updateConfig({ apiKey });
  }

  /**
   * Update model
   */
  updateModel(model: string): void {
    this.client.updateConfig({ model });
  }

  /**
   * Health check for the OpenAI API
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const testMessage = OpenAIPromptBuilder.createUserMessage('Hello');
      const request: OpenAIRequest = {
        model: this.client.getConfig().model || 'gpt-5-turbo',
        messages: [testMessage],
      };

      await this.client.generate(request);
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const connection = await this.client.testConnection();
      if (connection.success) {
        // Return supported models - in a real implementation, you'd fetch from API
        return [
          'gpt-5-turbo',
          'gpt-5-turbo-preview',
          'gpt-5-vision',
          'gpt-4-turbo',
          'gpt-4-vision-preview',
          'gpt-4',
          'gpt-3.5-turbo',
        ];
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch available models:', error);
      return [];
    }
  }

  /**
   * Estimate token count for messages
   */
  estimateTokenCount(messages: Message[]): number {
    return OpenAIPromptBuilder.estimateTokenCount(
      OpenAIPromptBuilder.buildMessages(
        { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools: [] },
        messages,
        false
      )
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): { model: string; baseUrl: string; timeout: number } {
    const config = this.client.getConfig();
    return {
      model: config.model || 'gpt-5-turbo',
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.client.testConnection();
  }
}