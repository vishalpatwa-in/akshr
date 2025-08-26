import { R2Error, R2ErrorType } from './types';

/**
 * Error recovery strategies
 */
export enum ErrorRecoveryStrategy {
  RETRY = 'retry',
  FAIL_FAST = 'fail_fast',
  FALLBACK = 'fallback',
  LOG_AND_CONTINUE = 'log_and_continue'
}

/**
 * Configuration for error handling
 */
export interface ErrorHandlingConfig {
  /** Strategy for handling errors */
  strategy: ErrorRecoveryStrategy;
  /** Maximum number of retries for retry strategy */
  maxRetries?: number;
  /** Base delay for exponential backoff in milliseconds */
  baseDelayMs?: number;
  /** Fallback function for fallback strategy */
  fallback?: () => Promise<any>;
  /** Custom error logger */
  logger?: (error: R2Error) => void;
}

/**
 * Default error handling configuration
 */
export const DEFAULT_ERROR_CONFIG: ErrorHandlingConfig = {
  strategy: ErrorRecoveryStrategy.FAIL_FAST,
  maxRetries: 3,
  baseDelayMs: 1000,
  logger: (error: R2Error) => {
    console.error(`R2 Error [${error.type}]:`, error.message, {
      key: error.key,
      statusCode: error.statusCode
    });
  }
};

/**
 * Handles R2 errors based on the configured strategy
 * @param error - The R2 error to handle
 * @param config - Error handling configuration
 * @returns Promise that resolves to the recovery result
 */
export async function handleR2Error(
  error: R2Error,
  config: ErrorHandlingConfig = DEFAULT_ERROR_CONFIG
): Promise<any> {
  // Log the error if logger is provided
  if (config.logger) {
    config.logger(error);
  }

  switch (config.strategy) {
    case ErrorRecoveryStrategy.RETRY:
      return await handleRetryStrategy(error, config);
    case ErrorRecoveryStrategy.FAIL_FAST:
      throw error;
    case ErrorRecoveryStrategy.FALLBACK:
      return await handleFallbackStrategy(error, config);
    case ErrorRecoveryStrategy.LOG_AND_CONTINUE:
      // Log and return null/undefined
      return null;
    default:
      throw error;
  }
}

/**
 * Handles retry strategy for recoverable errors
 * @param error - The original error
 * @param config - Error handling configuration
 * @returns Promise that resolves when retry completes or throws if exhausted
 */
async function handleRetryStrategy(
  error: R2Error,
  config: ErrorHandlingConfig
): Promise<any> {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = config.baseDelayMs ?? 1000;

  // Only retry certain types of errors
  if (!isRetryableError(error)) {
    throw error;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);

      // If we reach here, the retry succeeded (this would be called from within the operation)
      return { retried: true, attempt };

    } catch (retryError) {
      if (attempt === maxRetries) {
        throw new R2Error(
          error.type,
          `Failed after ${maxRetries} retries: ${error.message}`,
          error.statusCode,
          error.key
        );
      }
      // Continue to next retry attempt
    }
  }
}

/**
 * Handles fallback strategy
 * @param error - The original error
 * @param config - Error handling configuration
 * @returns Promise that resolves to fallback result
 */
async function handleFallbackStrategy(
  error: R2Error,
  config: ErrorHandlingConfig
): Promise<any> {
  if (config.fallback) {
    try {
      return await config.fallback();
    } catch (fallbackError) {
      throw new R2Error(
        R2ErrorType.INTERNAL_ERROR,
        `Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
        500,
        error.key
      );
    }
  }

  // Default fallback behavior
  return getDefaultFallbackValue(error);
}

/**
 * Determines if an error is retryable
 * @param error - The R2 error to check
 * @returns True if the error should be retried
 */
export function isRetryableError(error: R2Error): boolean {
  switch (error.type) {
    case R2ErrorType.INTERNAL_ERROR:
      // Retry internal errors (network issues, temporary failures)
      return true;
    case R2ErrorType.CONFLICT:
      // Retry conflicts (ETag mismatches, concurrent modifications)
      return true;
    case R2ErrorType.VALIDATION_ERROR:
      // Don't retry validation errors (client errors)
      return false;
    case R2ErrorType.NOT_FOUND:
      // Don't retry not found errors
      return false;
    case R2ErrorType.TTL_EXPIRED:
      // Don't retry TTL expired errors
      return false;
    default:
      return false;
  }
}

/**
 * Gets default fallback values based on error type
 * @param error - The R2 error
 * @returns Default fallback value
 */
function getDefaultFallbackValue(error: R2Error): any {
  switch (error.type) {
    case R2ErrorType.NOT_FOUND:
      return null;
    case R2ErrorType.TTL_EXPIRED:
      return null;
    case R2ErrorType.VALIDATION_ERROR:
      return null;
    default:
      return undefined;
  }
}

/**
 * Sleeps for the specified number of milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the sleep duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a standardized error response for API endpoints
 * @param error - The R2 error
 * @returns Standardized error response object
 */
export function createErrorResponse(error: R2Error) {
  return {
    error: {
      message: error.message,
      type: error.type,
      code: error.statusCode,
      ...(error.key && { param: error.key })
    }
  };
}

/**
 * Maps R2 error types to HTTP status codes
 * @param errorType - The R2 error type
 * @returns HTTP status code
 */
export function mapErrorToStatusCode(errorType: R2ErrorType): number {
  switch (errorType) {
    case R2ErrorType.NOT_FOUND:
      return 404;
    case R2ErrorType.VALIDATION_ERROR:
      return 400;
    case R2ErrorType.CONFLICT:
      return 409;
    case R2ErrorType.TTL_EXPIRED:
      return 410; // Gone
    case R2ErrorType.INTERNAL_ERROR:
    default:
      return 500;
  }
}

/**
 * Creates R2 errors from various error sources
 * @param error - The original error
 * @param key - Optional key associated with the error
 * @returns R2Error instance
 */
export function createR2Error(error: any, key?: string): R2Error {
  if (error instanceof R2Error) {
    return error;
  }

  // Handle specific error types
  if (error?.name === 'TypeError' && error.message.includes('fetch')) {
    return new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      'Network error during R2 operation',
      500,
      key
    );
  }

  if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
    return new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      'R2 service unavailable',
      503,
      key
    );
  }

  // Handle JSON parsing errors
  if (error instanceof SyntaxError) {
    return new R2Error(
      R2ErrorType.VALIDATION_ERROR,
      `Invalid JSON data: ${error.message}`,
      400,
      key
    );
  }

  // Generic error
  return new R2Error(
    R2ErrorType.INTERNAL_ERROR,
    error instanceof Error ? error.message : 'Unknown error',
    500,
    key
  );
}

/**
 * Wraps an R2 operation with error handling
 * @param operation - The operation to wrap
 * @param config - Error handling configuration
 * @returns Promise that resolves to the operation result or handles errors
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  config: ErrorHandlingConfig = DEFAULT_ERROR_CONFIG
): Promise<T | any> {
  try {
    return await operation();
  } catch (error) {
    const r2Error = createR2Error(error);
    return await handleR2Error(r2Error, config);
  }
}

/**
 * Creates a circuit breaker for R2 operations
 * @param failureThreshold - Number of failures before opening the circuit
 * @param recoveryTimeout - Time in milliseconds before attempting recovery
 * @returns Circuit breaker function
 */
export function createCircuitBreaker(
  failureThreshold: number = 5,
  recoveryTimeout: number = 60000
) {
  let failureCount = 0;
  let lastFailureTime = 0;
  let state: 'closed' | 'open' | 'half-open' = 'closed';

  return {
    async execute<T>(operation: () => Promise<T>): Promise<T> {
      if (state === 'open') {
        if (Date.now() - lastFailureTime > recoveryTimeout) {
          state = 'half-open';
        } else {
          throw new R2Error(
            R2ErrorType.INTERNAL_ERROR,
            'Circuit breaker is open',
            503
          );
        }
      }

      try {
        const result = await operation();
        // Success - reset failure count
        failureCount = 0;
        state = 'closed';
        return result;
      } catch (error) {
        failureCount++;
        lastFailureTime = Date.now();

        if (failureCount >= failureThreshold) {
          state = 'open';
        }

        throw error;
      }
    },

    getState: () => ({ state, failureCount, lastFailureTime }),
    reset: () => {
      failureCount = 0;
      state = 'closed';
      lastFailureTime = 0;
    }
  };
}

/**
 * Creates a retry wrapper with circuit breaker
 * @param operation - The operation to wrap
 * @param config - Error handling configuration
 * @param circuitBreaker - Circuit breaker instance
 * @returns Promise that resolves to the operation result
 */
export async function withRetryAndCircuitBreaker<T>(
  operation: () => Promise<T>,
  config: ErrorHandlingConfig = DEFAULT_ERROR_CONFIG,
  circuitBreaker = createCircuitBreaker()
): Promise<T> {
  return circuitBreaker.execute(async () => {
    return withErrorHandling(operation, {
      ...config,
      strategy: ErrorRecoveryStrategy.RETRY
    });
  });
}

/**
 * Error metrics collector
 */
export class R2ErrorMetrics {
  private metrics = new Map<string, number>();

  /**
   * Records an error occurrence
   * @param errorType - The type of error
   * @param key - Optional key associated with the error
   */
  recordError(errorType: R2ErrorType, key?: string): void {
    const metricKey = key ? `${errorType}:${key}` : errorType;
    const current = this.metrics.get(metricKey) || 0;
    this.metrics.set(metricKey, current + 1);
  }

  /**
   * Gets error count for a specific type
   * @param errorType - The type of error
   * @param key - Optional key to filter by
   * @returns Error count
   */
  getErrorCount(errorType: R2ErrorType, key?: string): number {
    const metricKey = key ? `${errorType}:${key}` : errorType;
    return this.metrics.get(metricKey) || 0;
  }

  /**
   * Gets all error metrics
   * @returns Map of error metrics
   */
  getAllMetrics(): Map<string, number> {
    return new Map(this.metrics);
  }

  /**
   * Resets all metrics
   */
  reset(): void {
    this.metrics.clear();
  }
}

// Global error metrics instance
export const globalErrorMetrics = new R2ErrorMetrics();