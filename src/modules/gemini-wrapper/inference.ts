import { GeminiClient } from './client';
import { GeminiPromptBuilder } from './prompt-builder';
import { GeminiToolConverter } from './tool-converter';
import { GeminiOutputNormalizer } from './output-normalizer';
import { GeminiRequest, GeminiGenerationConfig, NormalizedResponse, InferenceConfig } from './types';
import { Assistant, Message, Tool } from '../models/index';

export class GeminiInference {
  private client: GeminiClient;

  constructor(apiKey: string, model?: string) {
    this.client = new GeminiClient({
      apiKey,
      model: model || 'gemini-pro',
    });
  }

  /**
   * Generate a response from message history
   */
  async generateResponse(
    messages: Message[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const geminiMessages = GeminiPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools: [] },
      messages,
      false
    );

    const request = this.buildRequest(geminiMessages, undefined, config);
    const response = await this.client.generate(request);

    return GeminiOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Generate response with tool calling support
   */
  async generateWithTools(
    messages: Message[],
    tools: Tool[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const geminiMessages = GeminiPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools },
      messages,
      false
    );

    const geminiTools = GeminiToolConverter.convertTools(tools);
    const request = this.buildRequest(geminiMessages, geminiTools, config);
    const response = await this.client.generate(request);

    return GeminiOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Generate response for a complete assistant setup
   */
  async generateAssistantResponse(
    assistant: Assistant,
    messages: Message[],
    config?: InferenceConfig
  ): Promise<NormalizedResponse> {
    const geminiMessages = GeminiPromptBuilder.buildMessages(assistant, messages, true);
    const geminiTools = GeminiToolConverter.convertTools(assistant.tools);
    const request = this.buildRequest(geminiMessages, geminiTools, config);

    const response = await this.client.generate(request);
    return GeminiOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Stream response generation
   */
  async *streamResponse(
    messages: Message[],
    tools?: Tool[],
    config?: InferenceConfig
  ): AsyncGenerator<NormalizedResponse, void, unknown> {
    const geminiMessages = GeminiPromptBuilder.buildMessages(
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

    const geminiTools = tools ? GeminiToolConverter.convertTools(tools) : undefined;
    const request = this.buildRequest(geminiMessages, geminiTools, config);

    const stream = this.client.generateStream(request);

    for await (const chunk of stream) {
      const normalized = GeminiOutputNormalizer.normalizeStreamChunk(chunk);
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
    let geminiMessages = GeminiPromptBuilder.buildMessages(
      { instructions: '', model: '', name: '', id: '', object: 'assistant', created_at: Date.now(), tools: [] },
      originalMessages,
      false
    );

    // Add tool calls to the conversation
    for (const toolCall of toolCalls) {
      geminiMessages.push(GeminiPromptBuilder.createToolCallMessage(
        toolCall.name,
        toolCall.arguments
      ));
    }

    // Add tool results
    for (const result of toolResults) {
      geminiMessages = GeminiPromptBuilder.addToolResult(
        geminiMessages,
        '', // tool call ID not needed for Gemini
        result.name,
        result.result
      );
    }

    const request = this.buildRequest(geminiMessages, undefined, config);
    const response = await this.client.generate(request);

    return GeminiOutputNormalizer.normalizeResponse(response);
  }

  /**
   * Build a Gemini request from components
   */
  private buildRequest(
    messages: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }> }>,
    tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters?: any }> }>,
    config?: InferenceConfig
  ): GeminiRequest {
    const request: GeminiRequest = {
      contents: messages,
    };

    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    if (config) {
      request.generationConfig = {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        topK: config.topK,
        topP: config.topP,
      };
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
        const validation = GeminiToolConverter.validateToolSchema(tool.function);
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

      if (config.topK !== undefined && config.topK < 1) {
        errors.push('TopK must be greater than 0');
      }

      if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
        errors.push('TopP must be between 0 and 1');
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
      name: this.client.getConfig().model || 'gemini-pro',
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
   * Health check for the Gemini API
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const testMessage = GeminiPromptBuilder.createUserMessage('Hello');
      const request: GeminiRequest = {
        contents: [testMessage],
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
}