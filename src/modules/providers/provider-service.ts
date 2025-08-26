import {
  Provider,
  ProviderType,
  ProviderConfig,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamResponse,
  UnifiedProviderError,
  ProviderSelectionCriteria,
  ProviderConfiguration,
  ProviderEvent,
  PROVIDER_DEFAULTS,
  PROVIDER_CAPABILITIES,
  RETRYABLE_ERRORS
} from './types';
import { ProviderRegistry } from './registry';
import { FallbackManager } from './fallback-manager';
import { ProviderSelectionStrategy } from './selection-strategy';
import { OpenAIAdapter } from './adapters/openai-adapter';
import { GeminiAdapter } from './adapters/gemini-adapter';

/**
 * Provider Service
 * Main service that orchestrates all provider operations with unified interface
 */
export class ProviderService {
  private registry: ProviderRegistry;
  private fallbackManager: FallbackManager;
  private selectionStrategy: ProviderSelectionStrategy;
  private eventListeners: Array<(event: ProviderEvent) => void> = [];
  private config: ProviderConfiguration;

  constructor(config: ProviderConfiguration) {
    this.config = config;
    this.registry = new ProviderRegistry();
    this.fallbackManager = new FallbackManager(config.fallback);
    this.selectionStrategy = new ProviderSelectionStrategy(this.registry, this.fallbackManager);

    this.initializeProviders();
  }

  /**
   * Initialize providers based on configuration
   */
  private initializeProviders(): void {
    // Initialize OpenAI provider
    const openaiConfig = this.config.providers[ProviderType.OPENAI];
    if (openaiConfig?.enabled) {
      const provider = new OpenAIAdapter(openaiConfig.config);
      this.registry.register({
        type: ProviderType.OPENAI,
        provider,
        priority: openaiConfig.priority,
        fallbackFor: openaiConfig.fallbackFor || [],
        enabled: true
      });
    }

    // Initialize Gemini provider
    const geminiConfig = this.config.providers[ProviderType.GEMINI];
    if (geminiConfig?.enabled) {
      const provider = new GeminiAdapter(geminiConfig.config);
      this.registry.register({
        type: ProviderType.GEMINI,
        provider,
        priority: geminiConfig.priority,
        fallbackFor: geminiConfig.fallbackFor || [],
        enabled: true
      });
    }
  }

  /**
   * Generate response using the best available provider
   */
  async generateResponse(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {},
    requestId?: string
  ): Promise<UnifiedResponse> {
    const startTime = Date.now();

    try {
      const result = await this.selectionStrategy.executeWithBestProvider(
        request,
        async (provider) => {
          this.emitEvent({
            timestamp: Date.now(),
            provider: provider.type,
            eventType: 'request',
            requestId
          });

          return provider.generateResponse(request);
        },
        criteria,
        requestId
      );

      this.emitEvent({
        timestamp: Date.now(),
        provider: result.model.includes('gpt') ? ProviderType.OPENAI : ProviderType.GEMINI,
        eventType: 'success',
        duration: Date.now() - startTime,
        requestId
      });

      return result;
    } catch (error) {
      const unifiedError = this.handleError(error);
      this.emitEvent({
        timestamp: Date.now(),
        provider: unifiedError.provider,
        eventType: 'error',
        duration: Date.now() - startTime,
        error: unifiedError,
        requestId
      });
      throw unifiedError;
    }
  }

  /**
   * Generate response with tools using the best available provider
   */
  async generateWithTools(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {},
    requestId?: string
  ): Promise<UnifiedResponse> {
    const startTime = Date.now();

    try {
      const result = await this.selectionStrategy.executeWithBestProvider(
        request,
        async (provider) => {
          this.emitEvent({
            timestamp: Date.now(),
            provider: provider.type,
            eventType: 'request',
            requestId
          });

          return provider.generateWithTools(request);
        },
        criteria,
        requestId
      );

      this.emitEvent({
        timestamp: Date.now(),
        provider: result.model.includes('gpt') ? ProviderType.OPENAI : ProviderType.GEMINI,
        eventType: 'success',
        duration: Date.now() - startTime,
        requestId
      });

      return result;
    } catch (error) {
      const unifiedError = this.handleError(error);
      this.emitEvent({
        timestamp: Date.now(),
        provider: unifiedError.provider,
        eventType: 'error',
        duration: Date.now() - startTime,
        error: unifiedError,
        requestId
      });
      throw unifiedError;
    }
  }

  /**
   * Stream response using the best available provider
   */
  async *streamResponse(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {},
    requestId?: string
  ): AsyncIterableIterator<UnifiedStreamResponse> {
    const startTime = Date.now();

    try {
      const eventEmitter = this.emitEvent.bind(this);
      yield* this.selectionStrategy.streamWithBestProvider(
        request,
        async function* (provider: Provider) {
          eventEmitter({
            timestamp: Date.now(),
            provider: provider.type,
            eventType: 'request',
            requestId
          });

          yield* provider.streamResponse(request);
        },
        criteria,
        requestId
      );

      this.emitEvent({
        timestamp: Date.now(),
        provider: request.model.includes('gpt') ? ProviderType.OPENAI : ProviderType.GEMINI,
        eventType: 'success',
        duration: Date.now() - startTime,
        requestId
      });

    } catch (error) {
      const unifiedError = this.handleError(error);
      this.emitEvent({
        timestamp: Date.now(),
        provider: unifiedError.provider,
        eventType: 'error',
        duration: Date.now() - startTime,
        error: unifiedError,
        requestId
      });
      throw unifiedError;
    }
  }

  /**
   * Get provider recommendations for a request
   */
  async getProviderRecommendations(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {}
  ): Promise<{
    recommended: Provider | null;
    alternatives: Provider[];
    reasoning: string[];
  }> {
    return this.selectionStrategy.getProviderRecommendations(request, criteria);
  }

  /**
   * Get provider comparison for analysis
   */
  async getProviderComparison(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {}
  ): Promise<Map<ProviderType, any>> {
    return this.selectionStrategy.getProviderComparison(request, criteria);
  }

  /**
   * Enable a provider
   */
  enableProvider(providerType: ProviderType): void {
    this.registry.enableProvider(providerType);
  }

  /**
   * Disable a provider
   */
  disableProvider(providerType: ProviderType): void {
    this.registry.disableProvider(providerType);
  }

  /**
   * Update provider configuration
   */
  updateProviderConfig(providerType: ProviderType, config: Partial<ProviderConfig>): void {
    this.registry.updateProviderConfig(providerType, config);
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: ProviderEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: ProviderEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    providers: any;
    fallback: any;
    circuitBreakers: any;
    uptime: number;
  }> {
    const providers = await this.registry.getProviderStats();
    const fallback = this.fallbackManager.getStats();
    const circuitBreakers = fallback.circuitBreakers;

    return {
      providers,
      fallback: fallback.config,
      circuitBreakers,
      uptime: Date.now() // Could be enhanced to track actual uptime
    };
  }

  /**
   * Health check for the entire service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Map<ProviderType, any>;
    issues: string[];
  }> {
    const issues: string[] = [];
    const providerHealth = await this.registry.getAllProviderHealth();

    let healthy = false;
    for (const [type, health] of providerHealth) {
      if (health.status === 'available') {
        healthy = true;
      } else {
        issues.push(`${type} provider is ${health.status}`);
      }
    }

    if (!healthy) {
      issues.push('No healthy providers available');
    }

    return {
      healthy,
      providers: providerHealth,
      issues
    };
  }

  /**
   * Reset circuit breaker for a provider
   */
  resetCircuitBreaker(providerType: ProviderType): void {
    this.fallbackManager.resetCircuitBreaker(providerType);
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<ProviderConfiguration>): void {
    this.config = { ...this.config, ...config };

    // Update fallback manager
    if (config.fallback) {
      this.fallbackManager.updateConfig(config.fallback);
    }

    // Reinitialize providers if configuration changed
    if (config.providers) {
      this.registry = new ProviderRegistry();
      this.initializeProviders();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.fallbackManager.cleanup();
    this.eventListeners = [];
  }

  /**
   * Handle and unify errors
   */
  private handleError(error: any): UnifiedProviderError {
    if (error.type && error.provider) {
      return error as UnifiedProviderError;
    }

    // Create unified error from unknown error
    let type = 'unknown_error';
    let retryable = false;
    let provider = ProviderType.OPENAI; // Default

    if (error.code) {
      switch (error.code) {
        case 429:
          type = 'rate_limit_error';
          retryable = true;
          break;
        case 401:
        case 403:
          type = 'authentication_error';
          retryable = false;
          break;
        case 400:
          type = 'invalid_request';
          retryable = false;
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          type = 'server_error';
          retryable = true;
          break;
        default:
          if (error.code >= 500) {
            type = 'server_error';
            retryable = true;
          }
      }
    } else if (error.name === 'AbortError') {
      type = 'timeout_error';
      retryable = true;
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      type = 'network_error';
      retryable = true;
    }

    // Try to determine provider from error message or context
    if (error.message && error.message.toLowerCase().includes('gemini')) {
      provider = ProviderType.GEMINI;
    }

    const unifiedError = new Error(error.message || 'Unknown error') as UnifiedProviderError;
    unifiedError.type = type as any;
    unifiedError.code = error.code?.toString();
    unifiedError.statusCode = error.statusCode;
    unifiedError.retryable = retryable;
    unifiedError.provider = provider;
    unifiedError.originalError = error;

    return unifiedError;
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ProviderEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in provider event listener:', error);
      }
    }
  }
}

/**
 * Create default provider configuration
 */
export function createDefaultProviderConfiguration(): ProviderConfiguration {
  return {
    providers: {
      [ProviderType.OPENAI]: {
        enabled: true,
        config: {
          apiKey: '', // To be set via environment or configuration
          baseUrl: 'https://api.openai.com/v1',
          timeout: PROVIDER_DEFAULTS.TIMEOUT,
          maxRetries: PROVIDER_DEFAULTS.MAX_RETRIES,
          model: 'gpt-4-turbo'
        },
        priority: 1,
        fallbackFor: []
      },
      [ProviderType.GEMINI]: {
        enabled: false, // Disabled by default, enable when API key is provided
        config: {
          apiKey: '', // To be set via environment or configuration
          baseUrl: 'https://generativelanguage.googleapis.com',
          timeout: PROVIDER_DEFAULTS.TIMEOUT,
          maxRetries: PROVIDER_DEFAULTS.MAX_RETRIES,
          model: 'gemini-pro'
        },
        priority: 2,
        fallbackFor: [ProviderType.OPENAI]
      }
    },
    fallback: {
      enabled: true,
      maxRetries: PROVIDER_DEFAULTS.MAX_RETRIES,
      retryDelay: PROVIDER_DEFAULTS.RETRY_DELAY,
      exponentialBackoff: true,
      timeout: PROVIDER_DEFAULTS.TIMEOUT,
      retryableErrors: [...RETRYABLE_ERRORS],
      circuitBreakerThreshold: PROVIDER_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerTimeout: PROVIDER_DEFAULTS.CIRCUIT_BREAKER_TIMEOUT
    },
    monitoring: {
      enabled: true,
      metricsInterval: PROVIDER_DEFAULTS.METRICS_INTERVAL,
      healthCheckInterval: PROVIDER_DEFAULTS.HEALTH_CHECK_INTERVAL
    }
  };
}