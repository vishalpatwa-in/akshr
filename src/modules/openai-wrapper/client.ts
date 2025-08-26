import OpenAI from 'openai';
import {
  OpenAIConfig,
  OpenAIRequest,
  OpenAIResponse,
  OpenAIStreamResponse,
  OpenAIError,
  OpenAIStreamingEvent,
  OPENAI_DEFAULTS
} from './types';

export class OpenAIClient {
  private client: OpenAI;
  private config: Required<OpenAIConfig>;

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || OPENAI_DEFAULTS.MODEL,
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      organization: config.organization || '',
    };

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      organization: this.config.organization || undefined,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
    });
  }

  /**
   * Generate a response from the OpenAI API
   */
  async generate(request: OpenAIRequest): Promise<OpenAIResponse> {
    try {
      const openaiRequest = this.buildOpenAIRequest(request);
      // Ensure we're not streaming for the regular generate method
      openaiRequest.stream = false;

      const response = await this.client.chat.completions.create(openaiRequest) as OpenAI.Chat.Completions.ChatCompletion;

      return this.convertToOpenAIResponse(response);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Generate a streaming response from the OpenAI API
   */
  async *generateStream(request: OpenAIRequest): AsyncGenerator<OpenAIStreamResponse, void, unknown> {
    try {
      const openaiRequest = this.buildOpenAIRequest(request);
      openaiRequest.stream = true;

      const stream = await this.client.chat.completions.create(openaiRequest) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

      for await (const chunk of stream) {
        yield this.convertToOpenAIStreamResponse(chunk);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Generate streaming events for unified client interface
   */
  async *generateStreamingEvents(request: OpenAIRequest): AsyncGenerator<OpenAIStreamingEvent, void, unknown> {
    try {
      // Emit run created event
      yield {
        type: 'run.created',
        data: { id: `run_${Date.now()}`, model: request.model }
      };

      const stream = this.generateStream(request);

      for await (const chunk of stream) {
        // Emit response delta events
        if (chunk.choices[0]?.delta?.content) {
          yield {
            type: 'response.delta',
            data: {
              content: chunk.choices[0].delta.content,
              finish_reason: chunk.choices[0].finish_reason
            }
          };
        }

        // Emit tool call events
        if (chunk.choices[0]?.delta?.tool_calls) {
          yield {
            type: 'tool_call',
            data: {
              tool_calls: chunk.choices[0].delta.tool_calls
            }
          };
        }

        // Emit completion event
        if (chunk.choices[0]?.finish_reason) {
          yield {
            type: 'run.completed',
            data: {
              finish_reason: chunk.choices[0].finish_reason,
              usage: chunk.usage
            }
          };
          break;
        }
      }
    } catch (error) {
      yield {
        type: 'run.failed',
        data: { error: this.handleError(error) }
      };
    }
  }

  /**
   * Build OpenAI SDK request from our internal format
   */
  private buildOpenAIRequest(request: OpenAIRequest): OpenAI.Chat.Completions.ChatCompletionCreateParams {
    const openaiRequest: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model,
      messages: request.messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
        content: msg.content,
        name: msg.name,
        tool_call_id: msg.tool_call_id,
        tool_calls: msg.tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      logit_bias: request.logit_bias,
      user: request.user,
      stream: request.stream,
      tools: request.tools?.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict,
        },
      })),
      tool_choice: request.tool_choice,
    };

    // Add GPT-5 specific parameters if supported
    if (request.verbosity) {
      (openaiRequest as any).verbosity = request.verbosity;
    }
    if (request.reasoning_effort) {
      (openaiRequest as any).reasoning_effort = request.reasoning_effort;
    }

    return openaiRequest;
  }

  /**
   * Convert OpenAI SDK response to our internal format
   */
  private convertToOpenAIResponse(response: OpenAI.Chat.Completions.ChatCompletion): OpenAIResponse {
    return {
      id: response.id,
      object: 'chat.completion',
      created: response.created,
      model: response.model,
      choices: response.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content || '',
          tool_calls: choice.message.tool_calls as any,
        },
        finish_reason: choice.finish_reason,
      })),
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      },
      system_fingerprint: response.system_fingerprint,
    };
  }

  /**
   * Convert OpenAI SDK streaming response to our internal format
   */
  private convertToOpenAIStreamResponse(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): OpenAIStreamResponse {
    return {
      id: chunk.id,
      object: 'chat.completion.chunk',
      created: chunk.created,
      model: chunk.model,
      choices: chunk.choices.map(choice => ({
        index: choice.index,
        delta: {
          role: choice.delta.role,
          content: choice.delta.content,
          tool_calls: choice.delta.tool_calls,
        },
        finish_reason: choice.finish_reason,
      })),
      usage: chunk.usage ? {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      } : undefined,
      system_fingerprint: chunk.system_fingerprint,
    };
  }

  /**
   * Handle and convert OpenAI errors to our format
   */
  private handleError(error: any): OpenAIError {
    if (error instanceof OpenAI.APIError) {
      return {
        error: {
          message: error.message,
          type: error.type || 'api_error',
          param: error.param || undefined,
          code: error.code || undefined,
        },
      };
    }

    // Handle network or other errors
    return {
      error: {
        message: error.message || 'Unknown error occurred',
        type: 'internal_error',
        code: 'INTERNAL_ERROR',
      },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config };

    // Reinitialize client if API key or base URL changed
    if (config.apiKey || config.baseUrl || config.organization) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        organization: this.config.organization,
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
      });
    }
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<OpenAIConfig, 'apiKey'> {
    const { apiKey, ...safeConfig } = this.config;
    return safeConfig;
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.models.list();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}