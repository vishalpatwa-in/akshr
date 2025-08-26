import { CasOptions, CasResult, R2Error, R2ErrorType, CAS_CONFIG } from './types';

/**
 * Sleeps for the specified number of milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the sleep duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates the backoff delay for exponential backoff
 * @param attempt - Current attempt number (0-based)
 * @param initialBackoffMs - Initial backoff delay in milliseconds
 * @param maxBackoffMs - Maximum backoff delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  initialBackoffMs: number = CAS_CONFIG.DEFAULT_INITIAL_BACKOFF_MS,
  maxBackoffMs: number = CAS_CONFIG.DEFAULT_MAX_BACKOFF_MS
): number {
  const exponentialDelay = initialBackoffMs * Math.pow(CAS_CONFIG.BACKOFF_MULTIPLIER, attempt);
  return Math.min(exponentialDelay, maxBackoffMs);
}

/**
 * Adds jitter to the backoff delay to avoid thundering herd
 * @param delay - Base delay in milliseconds
 * @param jitterFactor - Jitter factor (default: 0.1 for 10% jitter)
 * @returns Delay with jitter applied
 */
export function addJitter(delay: number, jitterFactor: number = 0.1): number {
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1); // Random between -jitter and +jitter
  return Math.max(0, delay + jitter);
}

/**
 * Executes a CAS operation with retry logic
 * @param operation - Function that performs the CAS operation
 * @param options - CAS configuration options
 * @returns Promise that resolves to the CAS result
 */
export async function executeWithCasRetry<T>(
  operation: (etag?: string) => Promise<CasResult<T>>,
  options: CasOptions = {}
): Promise<CasResult<T>> {
  const {
    maxRetries = CAS_CONFIG.DEFAULT_MAX_RETRIES,
    initialBackoffMs = CAS_CONFIG.DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs = CAS_CONFIG.DEFAULT_MAX_BACKOFF_MS,
    etag: initialEtag
  } = options;

  let lastResult: CasResult<T>;
  let currentEtag = initialEtag;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      lastResult = await operation(currentEtag);

      // If successful, return immediately
      if (lastResult.success) {
        return {
          ...lastResult,
          retries: attempt
        };
      }

      // If not the last attempt and we have a conflict, prepare for retry
      if (attempt < maxRetries && lastResult.error === 'conflict') {
        const backoffDelay = calculateBackoffDelay(attempt, initialBackoffMs, maxBackoffMs);
        const jitteredDelay = addJitter(backoffDelay);

        // Update ETag if we got a new one from the failed operation
        if (lastResult.etag) {
          currentEtag = lastResult.etag;
        }

        await sleep(jitteredDelay);
        continue;
      }

      // If we reach here, either it's not a conflict or we've exhausted retries
      return {
        ...lastResult,
        retries: attempt
      };

    } catch (error) {
      // Handle unexpected errors
      if (attempt === maxRetries) {
        return {
          success: false,
          retries: attempt,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }

      // For unexpected errors, still apply backoff before retry
      const backoffDelay = calculateBackoffDelay(attempt, initialBackoffMs, maxBackoffMs);
      const jitteredDelay = addJitter(backoffDelay);
      await sleep(jitteredDelay);
    }
  }

  // This should never be reached, but TypeScript needs it
  return lastResult!;
}

/**
 * Creates a CAS operation wrapper that handles ETag validation
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param operation - Function that performs the actual operation
 * @returns Function that can be used with executeWithCasRetry
 */
export function createCasOperation<T>(
  bucket: R2Bucket,
  key: string,
  operation: (currentObject: R2Object | null, etag?: string) => Promise<T>
) {
  return async (etag?: string): Promise<CasResult<T>> => {
    try {
      // Get the current object to check ETag
      const currentObject = await bucket.get(key);

      // If ETag is provided, validate it
      if (etag && currentObject) {
        if (currentObject.etag !== etag) {
          return {
            success: false,
            retries: 0,
            error: 'conflict',
            etag: currentObject.etag
          };
        }
      } else if (etag && !currentObject) {
        // ETag provided but object doesn't exist
        return {
          success: false,
          retries: 0,
          error: 'not_found'
        };
      }

      // Perform the actual operation
      const result = await operation(currentObject, etag);

      // Get the updated object to return the new ETag
      const updatedObject = await bucket.get(key);

      return {
        success: true,
        data: result,
        etag: updatedObject?.etag,
        retries: 0
      };

    } catch (error) {
      if (error instanceof R2Error) {
        return {
          success: false,
          retries: 0,
          error: error.type
        };
      }

      return {
        success: false,
        retries: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };
}

/**
 * Validates an ETag format
 * @param etag - The ETag to validate
 * @returns True if the ETag format is valid
 */
export function isValidEtag(etag: string): boolean {
  // Basic ETag validation - should be a quoted string
  return /^"[^"]*"$/.test(etag) || /^[^"]+$/.test(etag);
}

/**
 * Extracts ETag from an R2 object response
 * @param response - R2 get response
 * @returns The ETag string or null if not available
 */
export function extractEtag(response: R2Object | null): string | null {
  return response?.etag || null;
}

/**
 * Compares two ETags for equality
 * @param etag1 - First ETag
 * @param etag2 - Second ETag
 * @returns True if ETags are equal
 */
export function compareEtags(etag1: string, etag2: string): boolean {
  // Normalize ETags by removing quotes for comparison
  const normalize = (etag: string) => etag.replace(/^"|"$/g, '');
  return normalize(etag1) === normalize(etag2);
}

/**
 * Creates a conditional put operation with ETag validation
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param data - Data to store
 * @param options - Storage options including ETag
 * @returns Promise that resolves to the operation result
 */
export async function conditionalPut(
  bucket: R2Bucket,
  key: string,
  data: string | ArrayBuffer | ReadableStream,
  options: { etag?: string; metadata?: Record<string, string> } = {}
): Promise<CasResult<void>> {
  const operation = createCasOperation<void>(
    bucket,
    key,
    async (currentObject, etag) => {
      // If ETag is provided, validate it
      if (etag && currentObject) {
        if (currentObject.etag !== etag) {
          throw new R2Error(R2ErrorType.CONFLICT, 'ETag mismatch', 409, key);
        }
      } else if (etag && !currentObject) {
        throw new R2Error(R2ErrorType.NOT_FOUND, 'Object not found', 404, key);
      }

      // Perform the put operation
      await bucket.put(key, data, {
        ...options.metadata && { customMetadata: options.metadata }
      });
    }
  );

  return operation(options.etag);
}

/**
 * Creates a conditional delete operation with ETag validation
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param etag - ETag for conditional deletion
 * @returns Promise that resolves to the operation result
 */
export async function conditionalDelete(
  bucket: R2Bucket,
  key: string,
  etag?: string
): Promise<CasResult<void>> {
  const operation = createCasOperation<void>(
    bucket,
    key,
    async (currentObject, etag) => {
      // If ETag is provided, validate it
      if (etag && currentObject) {
        if (currentObject.etag !== etag) {
          throw new R2Error(R2ErrorType.CONFLICT, 'ETag mismatch', 409, key);
        }
      } else if (etag && !currentObject) {
        throw new R2Error(R2ErrorType.NOT_FOUND, 'Object not found', 404, key);
      }

      // Perform the delete operation
      await bucket.delete(key);
    }
  );

  return operation(etag);
}

/**
 * Configuration for CAS retry strategies
 */
export const CAS_STRATEGIES = {
  /** Fast retry for low contention scenarios */
  FAST: {
    maxRetries: 2,
    initialBackoffMs: 50,
    maxBackoffMs: 200
  },
  /** Standard retry for normal contention */
  STANDARD: {
    maxRetries: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 1000
  },
  /** Slow retry for high contention scenarios */
  SLOW: {
    maxRetries: 5,
    initialBackoffMs: 200,
    maxBackoffMs: 2000
  }
} as const;

/**
 * Creates a retry strategy based on expected contention level
 * @param strategy - The retry strategy to use
 * @param customOptions - Custom options to override defaults
 * @returns Complete CAS options
 */
export function createRetryStrategy(
  strategy: keyof typeof CAS_STRATEGIES,
  customOptions: Partial<CasOptions> = {}
): CasOptions {
  return {
    ...CAS_STRATEGIES[strategy],
    ...customOptions
  };
}