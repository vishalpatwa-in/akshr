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
import { OpenAIClient } from '../../openai-wrapper/client';
import { OpenAIConfig } from '../../openai-wrapper/types';

/**
 * OpenAI Provider Adapter
 * Adapts the existing OpenAI wrapper to the unified Provider interface
 */
export class OpenAIAdapter implements Provider {
  readonly type = ProviderType.OPENAI;
  readonly capabilities: ProviderCapability[] = [...PROVIDER_CAPABILITIES[ProviderType.OPENAI]];

  private client: OpenAIClient;
  private _config: ProviderConfig;
  private metrics: ProviderMetrics;

  constructor(config: ProviderConfig) {
    this._config = {
      timeout: 30000,
      maxRetries: 3,
      ...config
    };

    // Convert unified config to OpenAI-specific config
    const openaiConfig: OpenAIConfig = {
      apiKey: this._config.apiKey,
      baseUrl: this._config.baseUrl,
      timeout: this._config.timeout,
      maxRetries: this._config.maxRetries,
      organization: this._config.organization,
      model: this._config.model
    };

    this.client = new OpenAIClient(openaiConfig);
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
   * Generate a response using OpenAI
   */
  async generateResponse(request: UnifiedRequest): Promise<UnifiedResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to OpenAI format
      const openaiRequest = this.convertToOpenAIRequest(request);

      // Make the request
      const response = await this.client.generate(openaiRequest);

      // Convert response back to unified format
      const unifiedResponse = this.convertFromOpenAIResponse(response);

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
   * Generate a response with tools using OpenAI
   */
  async generateWithTools(request: UnifiedRequest): Promise<UnifiedResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to OpenAI format
      const openaiRequest = this.convertToOpenAIRequest(request);

      // Make the request with tools (same as regular generate)
      const response = await this.client.generate(openaiRequest);

      // Convert response back to unified format
      const unifiedResponse = this.convertFromOpenAIResponse(response);

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
   * Stream response using OpenAI
   */
  async *streamResponse(request: UnifiedRequest): AsyncIterableIterator<UnifiedStreamResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      // Convert unified request to OpenAI format
      const openaiRequest = this.convertToOpenAIRequest(request);
      openaiRequest.stream = true;

      // Stream the response
      const stream = this.client.generateStream(openaiRequest);

      for await (const chunk of stream) {
        yield this.convertFromOpenAIStreamResponse(chunk);
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
   * Health check for OpenAI provider
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      // Simple health check by testing connection
      const testResult = await this.client.testConnection();
      const responseTime = Date.now() - startTime;

      if (!testResult.success) {
        throw new Error(testResult.error);
      }

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
    const openaiConfig: Partial<OpenAIConfig> = {
      apiKey: this._config.apiKey,
      baseUrl: this._config.baseUrl,
      timeout: this._config.timeout,
      maxRetries: this._config.maxRetries,
      organization: this._config.organization,
      model: this._config.model
    };

    this.client.updateConfig(openaiConfig);
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
   * Convert unified request to OpenAI format
   */
  private convertToOpenAIRequest(request: UnifiedRequest): any {
    return {
      model: request.model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        tool_call_id: msg.tool_call_id,
        tool_calls: msg.tool_calls,
        name: msg.name
      })),
      tools: request.tools,
      tool_choice: request.tool_choice,
      stream: request.stream,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      user: request.user
    };
  }

  /**
   * Convert OpenAI response to unified format
   */
  private convertFromOpenAIResponse(response: any): UnifiedResponse {
    return {
      id: response.id,
      object: response.object,
      created: response.created,
      model: response.model,
      choices: response.choices.map((choice: any) => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content,
          tool_call_id: choice.message.tool_call_id,
          tool_calls: choice.message.tool_calls,
          name: choice.message.name
        },
        finish_reason: choice.finish_reason
      })),
      usage: {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens
      },
      system_fingerprint: response.system_fingerprint
    };
  }

  /**
   * Convert OpenAI stream response to unified format
   */
  private convertFromOpenAIStreamResponse(response: any): UnifiedStreamResponse {
    return {
      id: response.id,
      object: response.object,
      created: response.created,
      model: response.model,
      choices: response.choices.map((choice: any) => ({
        index: choice.index,
        delta: {
          role: choice.delta.role,
          content: choice.delta.content,
          tool_calls: choice.delta.tool_calls
        },
        finish_reason: choice.finish_reason
      })),
      usage: response.usage
    };
  }

  /**
   * Convert error to unified format
   */
  private convertError(error: any): UnifiedProviderError {
    let type = ProviderErrorType.UNKNOWN_ERROR;
    let retryable = false;

    if (error.statusCode) {
      switch (error.statusCode) {
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
          if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
            type = ProviderErrorType.NETWORK_ERROR;
            retryable = true;
          } else if (error.code === 'ETIMEDOUT') {
            type = ProviderErrorType.TIMEOUT_ERROR;
            retryable = true;
          }
      }
    }

    const unifiedError = new Error(error.message || 'OpenAI API error') as UnifiedProviderError;
    unifiedError.type = type;
    unifiedError.code = error.code;
    unifiedError.statusCode = error.statusCode;
    unifiedError.retryable = retryable;
    unifiedError.provider = ProviderType.OPENAI;
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