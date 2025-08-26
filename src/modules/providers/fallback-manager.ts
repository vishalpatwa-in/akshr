import {
  Provider,
  ProviderType,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamResponse,
  UnifiedProviderError,
  ProviderErrorType,
  CircuitBreaker,
  CircuitBreakerState,
  FallbackConfig,
  PROVIDER_DEFAULTS,
  RETRYABLE_ERRORS
} from './types';

/**
 * Fallback Manager
 * Handles automatic fallback between providers with circuit breaker pattern
 */
export class FallbackManager {
  private circuitBreakers: Map<ProviderType, CircuitBreaker> = new Map();
  private config: FallbackConfig;
  private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = {
      enabled: true,
      maxRetries: PROVIDER_DEFAULTS.MAX_RETRIES,
      retryDelay: PROVIDER_DEFAULTS.RETRY_DELAY,
      exponentialBackoff: true,
      timeout: PROVIDER_DEFAULTS.TIMEOUT,
      retryableErrors: [...RETRYABLE_ERRORS],
      circuitBreakerThreshold: PROVIDER_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerTimeout: PROVIDER_DEFAULTS.CIRCUIT_BREAKER_TIMEOUT,
      ...config
    };
  }

  /**
   * Execute request with fallback logic
   */
  async executeWithFallback<T>(
    providers: Provider[],
    operation: (provider: Provider) => Promise<T>,
    requestId?: string
  ): Promise<T> {
    if (!this.config.enabled || providers.length === 0) {
      return operation(providers[0]);
    }

    const errors: UnifiedProviderError[] = [];
    let attempt = 0;

    for (const provider of providers) {
      attempt++;

      // Check circuit breaker
      if (this.isCircuitOpen(provider.type)) {
        errors.push(this.createCircuitOpenError(provider.type));
        continue;
      }

      try {
        // Execute with timeout
        const result = await this.executeWithTimeout(
          () => operation(provider),
          this.config.timeout,
          provider.type
        );

        // Success - record success and return
        this.recordSuccess(provider.type);
        return result;

      } catch (error) {
        const unifiedError = this.ensureUnifiedError(error, provider.type);
        errors.push(unifiedError);

        // Record failure
        this.recordFailure(provider.type);

        // Check if we should retry with the same provider
        if (this.shouldRetry(unifiedError, attempt)) {
          const delay = this.calculateRetryDelay(attempt);
          await this.sleep(delay);

          try {
            const retryResult = await this.executeWithTimeout(
              () => operation(provider),
              this.config.timeout,
              provider.type
            );

            this.recordSuccess(provider.type);
            return retryResult;
          } catch (retryError) {
            const retryUnifiedError = this.ensureUnifiedError(retryError, provider.type);
            errors.push(retryUnifiedError);
            this.recordFailure(provider.type);
          }
        }
      }
    }

    // All providers failed, throw the last error
    throw this.createFallbackError(errors);
  }

  /**
   * Stream with fallback logic
   */
  async *streamWithFallback(
    providers: Provider[],
    operation: (provider: Provider) => AsyncIterableIterator<UnifiedStreamResponse>,
    requestId?: string
  ): AsyncIterableIterator<UnifiedStreamResponse> {
    if (!this.config.enabled || providers.length === 0) {
      yield* operation(providers[0]);
      return;
    }

    const errors: UnifiedProviderError[] = [];
    let attempt = 0;

    for (const provider of providers) {
      attempt++;

      // Check circuit breaker
      if (this.isCircuitOpen(provider.type)) {
        errors.push(this.createCircuitOpenError(provider.type));
        continue;
      }

      try {
        // Execute streaming operation
        const stream = operation(provider);
        let hasYielded = false;

        for await (const chunk of stream) {
          hasYielded = true;
          yield chunk;
        }

        if (hasYielded) {
          // Success - record success
          this.recordSuccess(provider.type);
          return;
        }

      } catch (error) {
        const unifiedError = this.ensureUnifiedError(error, provider.type);
        errors.push(unifiedError);

        // Record failure
        this.recordFailure(provider.type);

        // For streaming, we don't retry the same provider
        // Move to next provider immediately
      }
    }

    // All providers failed, throw the last error
    throw this.createFallbackError(errors);
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number,
    providerType: ProviderType
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(this.createTimeoutError(providerType));
      }, timeout);

      operation()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(providerType: ProviderType): boolean {
    const breaker = this.circuitBreakers.get(providerType);
    if (!breaker) return false;

    if (breaker.state === CircuitBreakerState.OPEN) {
      // Check if we should transition to half-open
      const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
      if (timeSinceLastFailure >= this.config.circuitBreakerTimeout) {
        breaker.state = CircuitBreakerState.HALF_OPEN;
        breaker.successCount = 0;
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record successful operation
   */
  private recordSuccess(providerType: ProviderType): void {
    const breaker = this.getOrCreateBreaker(providerType);

    breaker.successCount++;

    // If half-open and we've had enough successes, close the circuit
    if (breaker.state === CircuitBreakerState.HALF_OPEN && breaker.successCount >= 3) {
      breaker.state = CircuitBreakerState.CLOSED;
      breaker.failureCount = 0;
      breaker.successCount = 0;
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(providerType: ProviderType): void {
    const breaker = this.getOrCreateBreaker(providerType);

    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    // Check if we should open the circuit
    if (breaker.state === CircuitBreakerState.CLOSED &&
        breaker.failureCount >= this.config.circuitBreakerThreshold) {
      breaker.state = CircuitBreakerState.OPEN;
    } else if (breaker.state === CircuitBreakerState.HALF_OPEN) {
      // Failed while half-open, go back to open
      breaker.state = CircuitBreakerState.OPEN;
      breaker.successCount = 0;
    }
  }

  /**
   * Get or create circuit breaker for provider
   */
  private getOrCreateBreaker(providerType: ProviderType): CircuitBreaker {
    let breaker = this.circuitBreakers.get(providerType);
    if (!breaker) {
      breaker = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        successCount: 0
      };
      this.circuitBreakers.set(providerType, breaker);
    }
    return breaker;
  }

  /**
   * Check if we should retry an error
   */
  private shouldRetry(error: UnifiedProviderError, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) return false;
    return this.config.retryableErrors.includes(error.type);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    if (!this.config.exponentialBackoff) {
      return this.config.retryDelay;
    }

    const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    return Math.min(delay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ensure error is in unified format
   */
  private ensureUnifiedError(error: any, providerType: ProviderType): UnifiedProviderError {
    if (error.type && error.provider) {
      return error as UnifiedProviderError;
    }

    // Create unified error from unknown error
    let type = ProviderErrorType.UNKNOWN_ERROR;
    let retryable = false;

    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      type = ProviderErrorType.NETWORK_ERROR;
      retryable = true;
    } else if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
      type = ProviderErrorType.TIMEOUT_ERROR;
      retryable = true;
    }

    const unifiedError = new Error(error.message || 'Unknown error') as UnifiedProviderError;
    unifiedError.type = type;
    unifiedError.code = error.code;
    unifiedError.statusCode = error.statusCode;
    unifiedError.retryable = retryable;
    unifiedError.provider = providerType;
    unifiedError.originalError = error;

    return unifiedError;
  }

  /**
   * Create circuit open error
   */
  private createCircuitOpenError(providerType: ProviderType): UnifiedProviderError {
    const error = new Error(`Circuit breaker is open for provider ${providerType}`) as UnifiedProviderError;
    error.type = ProviderErrorType.SERVER_ERROR;
    error.retryable = true;
    error.provider = providerType;
    return error;
  }

  /**
   * Create timeout error
   */
  private createTimeoutError(providerType: ProviderType): UnifiedProviderError {
    const error = new Error(`Request timeout for provider ${providerType}`) as UnifiedProviderError;
    error.type = ProviderErrorType.TIMEOUT_ERROR;
    error.retryable = true;
    error.provider = providerType;
    return error;
  }

  /**
   * Create fallback error with all provider errors
   */
  private createFallbackError(errors: UnifiedProviderError[]): UnifiedProviderError {
    const providerErrors = errors.map(e => `${e.provider}: ${e.message}`).join(', ');
    const error = new Error(`All providers failed: ${providerErrors}`) as UnifiedProviderError;
    error.type = ProviderErrorType.SERVER_ERROR;
    error.retryable = false;
    error.provider = errors[0]?.provider || ProviderType.OPENAI;
    error.originalError = errors;
    return error;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FallbackConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get circuit breaker status for all providers
   */
  getCircuitBreakerStatus(): Map<ProviderType, CircuitBreaker> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Reset circuit breaker for a provider
   */
  resetCircuitBreaker(providerType: ProviderType): void {
    const breaker = this.circuitBreakers.get(providerType);
    if (breaker) {
      breaker.state = CircuitBreakerState.CLOSED;
      breaker.failureCount = 0;
      breaker.successCount = 0;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.clear();
  }

  /**
   * Get fallback statistics
   */
  getStats(): {
    circuitBreakers: Map<ProviderType, CircuitBreaker>;
    config: FallbackConfig;
  } {
    return {
      circuitBreakers: new Map(this.circuitBreakers),
      config: { ...this.config }
    };
  }
}