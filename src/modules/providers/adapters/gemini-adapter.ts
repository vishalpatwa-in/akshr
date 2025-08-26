import {
  Provider,
  ProviderType,
  ProviderCapability,
  ProviderConfig,
  ProviderHealth,
  ProviderStatus,
  ProviderMetrics,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamResponse,
  UnifiedProviderError,
  ProviderErrorType,
  PROVIDER_CAPABILITIES
} from '../types';
import { GeminiClient } from '../../gemini-wrapper/client';
import { GeminiConfig } from '../../gemini-wrapper/types';

/**
 * Gemini Provider Adapter
 * Adapts the existing Gemini wrapper to the unified Provider interface
 */
export class GeminiAdapter implements Provider {
  readonly type = ProviderType.GEMINI;
  readonly capabilities: ProviderCapability[] = [...PROVIDER_CAPABILITIES[ProviderType.GEMINI]];

  private client: GeminiClient;
  private _config: ProviderConfig;
  private metrics: ProviderMetrics;

  constructor(config: ProviderConfig) {
    this._config = {
      timeout: 30000,
      maxRetries: 3,
      ...config
    };

    // Convert unified config to Gemini-specific config
    const geminiConfig: GeminiConfig = {
      apiKey: this._config.apiKey,
      baseUrl: this._config.baseUrl,
      timeout: this._config.timeout,
      maxRetries: this._config.maxRetries,
      model: this._config.model
    };

    this.client = new GeminiClient(geminiConfig);
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      rateLimitHits: 0,
      lastRequestTime: 0
    };
  }

  get config(): ProviderConfig {
    return this._config;
  }

  /**
   * Generate a response using Gemini
   */
  async generateResponse(request: UnifiedRequest): Promise<UnifiedResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to Gemini format
      const geminiRequest = this.convertToGeminiRequest(request);

      // Make the request
      const response = await this.client.generate(geminiRequest);

      // Convert response back to unified format
      const unifiedResponse = this.convertFromGeminiResponse(response);

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      return unifiedResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      throw this.convertError(error);
    }
  }

  /**
   * Generate a response with tools using Gemini
   */
  async generateWithTools(request: UnifiedRequest): Promise<UnifiedResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to Gemini format
      const geminiRequest = this.convertToGeminiRequest(request);

      // Make the request with tools
      const response = await this.client.generate(geminiRequest);

      // Convert response back to unified format
      const unifiedResponse = this.convertFromGeminiResponse(response);

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      return unifiedResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      throw this.convertError(error);
    }
  }

  /**
   * Stream response using Gemini
   */
  async *streamResponse(request: UnifiedRequest): AsyncIterableIterator<UnifiedStreamResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to Gemini format
      const geminiRequest = this.convertToGeminiRequest(request);

      // Stream the response
      const stream = this.client.generateStream(geminiRequest);

      for await (const chunk of stream) {
        yield this.convertFromGeminiStreamResponse(chunk);
      }

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      throw this.convertError(error);
    }
  }

  /**
   * Health check for Gemini provider
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      // Simple health check by making a minimal request
      const testRequest = {
        contents: [{ role: 'user' as const, parts: [{ text: 'Hello' }] }]
      };

      await this.client.generate(testRequest);
      const responseTime = Date.now() - startTime;

      return {
        status: ProviderStatus.AVAILABLE,
        lastChecked: Date.now(),
        responseTime,
        errorCount: this.metrics.failedRequests,
        consecutiveErrors: 0
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        status: ProviderStatus.ERROR,
        lastChecked: Date.now(),
        responseTime,
        errorCount: this.metrics.failedRequests,
        consecutiveErrors: 1
      };
    }
  }

  /**
   * Get provider metrics
   */
  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  /**
   * Update provider configuration
   */
  updateConfig(config: Partial<ProviderConfig>): void {
    this._config = { ...this._config, ...config };

    // Update client config
    const geminiConfig: Partial<GeminiConfig> = {
      apiKey: this._config.apiKey,
      baseUrl: this._config.baseUrl,
      timeout: this._config.timeout,
      maxRetries: this._config.maxRetries,
      model: this._config.model
    };

    this.client.updateConfig(geminiConfig);
  }

  /**
   * Validate configuration
   */
  async validateConfig(): Promise<boolean> {
    try {
      if (!this._config.apiKey) {
        return false;
      }

      // Try to validate with a simple health check
      await this.healthCheck();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert unified request to Gemini format
   */
  private convertToGeminiRequest(request: UnifiedRequest): any {
    const contents = request.messages.map(msg => {
      // Convert OpenAI-style messages to Gemini format
      let role: 'user' | 'model' = 'user';
      const parts: any[] = [];

      if (msg.role === 'assistant') {
        role = 'model';
      }

      // Handle content
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content
        for (const content of msg.content) {
          if (content.type === 'text') {
            parts.push({ text: content.text });
          } else if (content.type === 'image_url') {
            // Convert image URL to Gemini format
            parts.push({
              inlineData: {
                mimeType: 'image/jpeg', // Default, could be enhanced
                data: content.image_url?.url // Should be base64
              }
            });
          }
        }
      }

      return { role, parts };
    });

    const geminiRequest: any = {
      contents
    };

    // Add system instruction if present
    const systemMessage = request.messages.find(msg => msg.role === 'system');
    if (systemMessage) {
      geminiRequest.systemInstruction = {
        role: 'user',
        parts: [{ text: systemMessage.content as string }]
      };
    }

    // Add tools if present
    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }))
      }];
    }

    // Add generation config
    if (request.max_tokens || request.temperature || request.top_p) {
      geminiRequest.generationConfig = {
        maxOutputTokens: request.max_tokens,
        temperature: request.temperature,
        topP: request.top_p
      };
    }

    return geminiRequest;
  }

  /**
   * Convert Gemini response to unified format
   */
  private convertFromGeminiResponse(response: any): UnifiedResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidates in Gemini response');
    }

    // Extract text content
    let text = '';
    const toolCalls: any[] = [];

    for (const part of candidate.content.parts || []) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        });
      }
    }

    return {
      id: `gemini_${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this._config.model || 'gemini-pro',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: candidate.finishReason === 'STOP' ? 'stop' : 'length'
      }],
      usage: {
        prompt_tokens: 0, // Not provided by Gemini
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  /**
   * Convert Gemini stream response to unified format
   */
  private convertFromGeminiStreamResponse(response: any): UnifiedStreamResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidates in Gemini stream response');
    }

    let content = '';
    const toolCalls: any[] = [];

    for (const part of candidate.content?.parts || []) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        });
      }
    }

    return {
      id: `gemini_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this._config.model || 'gemini-pro',
      choices: [{
        index: 0,
        delta: {
          content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: candidate.finishReason === 'STOP' ? 'stop' : null
      }]
    };
  }

  /**
   * Convert error to unified format
   */
  private convertError(error: any): UnifiedProviderError {
    let type = ProviderErrorType.UNKNOWN_ERROR;
    let retryable = false;

    if (error.code) {
      switch (error.code) {
        case 429:
          type = ProviderErrorType.RATE_LIMIT_ERROR;
          retryable = true;
          this.metrics.rateLimitHits++;
          break;
        case 401:
        case 403:
          type = ProviderErrorType.AUTHENTICATION_ERROR;
          retryable = false;
          break;
        case 400:
          type = ProviderErrorType.INVALID_REQUEST;
          retryable = false;
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          type = ProviderErrorType.SERVER_ERROR;
          retryable = true;
          break;
        default:
          if (error.code >= 500) {
            type = ProviderErrorType.SERVER_ERROR;
            retryable = true;
          }
      }
    } else if (error.name === 'AbortError') {
      type = ProviderErrorType.TIMEOUT_ERROR;
      retryable = true;
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      type = ProviderErrorType.NETWORK_ERROR;
      retryable = true;
    }

    const unifiedError = new Error(error.message || 'Gemini API error') as UnifiedProviderError;
    unifiedError.type = type;
    unifiedError.code = error.code?.toString();
    unifiedError.statusCode = error.code;
    unifiedError.retryable = retryable;
    unifiedError.provider = ProviderType.GEMINI;
    unifiedError.originalError = error;

    return unifiedError;
  }

  /**
   * Update metrics after request
   */
  private updateMetrics(duration: number, success: boolean): void {
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update rolling average response time
    const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
    const currentAvg = this.metrics.averageResponseTime;
    this.metrics.averageResponseTime = (currentAvg * (totalRequests - 1) + duration) / totalRequests;
  }
}