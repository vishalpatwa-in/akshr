import { AssistantR2Bucket, JsonStorageOptions, CasOptions, CasResult, R2Error, R2ErrorType } from './types';
import { createJsonMetadata, validateTTL, getRecommendedTTL } from './ttl';
import { executeWithCasRetry, createCasOperation } from './cas';

/**
 * Converts an R2Object to a text string
 * @param object - The R2Object to convert
 * @returns Promise that resolves to the text content
 */
async function objectToText(object: R2Object): Promise<string> {
  // Use type assertion to access the body property
  const r2Object = object as any;
  if (r2Object.body) {
    return await r2Object.body.text();
  }
  throw new Error('R2Object has no body');
}

/**
 * Retrieves and parses JSON from R2 with type safety
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @returns Promise that resolves to the parsed JSON data or null if not found
 * @throws R2Error if the operation fails
 */
export async function getJson<T>(bucket: AssistantR2Bucket, key: string): Promise<T | null> {
  try {
    const object = await bucket.get(key);

    if (!object) {
      return null;
    }

    // Check if object has expired
    const metadata = object.customMetadata as any;
    if (metadata?.expiresAt) {
      const expirationTime = new Date(metadata.expiresAt);
      const now = new Date();
      if (now > expirationTime) {
        // Object has expired, delete it and return null
        await bucket.delete(key);
        return null;
      }
    }

    // Parse the JSON data
    const jsonString = await object.text();
    return JSON.parse(jsonString) as T;

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      throw new R2Error(
        R2ErrorType.VALIDATION_ERROR,
        `Invalid JSON data in key: ${key}`,
        400,
        key
      );
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to retrieve JSON from key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Stores JSON data in R2 with optional TTL
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param data - The data to store (will be JSON stringified)
 * @param options - Storage options including TTL
 * @returns Promise that resolves when the operation completes
 * @throws R2Error if the operation fails
 */
export async function putJson<T>(
  bucket: AssistantR2Bucket,
  key: string,
  data: T,
  options: JsonStorageOptions = {}
): Promise<void> {
  try {
    const { ttlSeconds, metadata } = options;

    // Validate TTL if provided
    if (ttlSeconds !== undefined) {
      const validation = validateTTL(ttlSeconds);
      if (!validation.valid) {
        throw new R2Error(
          R2ErrorType.VALIDATION_ERROR,
          `Invalid TTL: ${validation.error}`,
          400,
          key
        );
      }
    }

    // Serialize data to JSON
    let jsonString: string;
    try {
      jsonString = JSON.stringify(data);
    } catch (error) {
      throw new R2Error(
        R2ErrorType.VALIDATION_ERROR,
        `Failed to serialize data to JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
        400,
        key
      );
    }

    // Create metadata with TTL
    const objectMetadata = createJsonMetadata(
      getObjectTypeFromData(data),
      ttlSeconds,
      metadata
    );

    // Store in R2
    await bucket.put(key, jsonString, {
      customMetadata: objectMetadata as any
    });

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to store JSON at key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Stores JSON data with conditional update using ETag CAS
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param data - The data to store (will be JSON stringified)
 * @param etag - Optional ETag for conditional update
 * @param options - CAS options including TTL and retry configuration
 * @returns Promise that resolves to the CAS result
 */
export async function putJsonWithCas<T>(
  bucket: AssistantR2Bucket,
  key: string,
  data: T,
  etag?: string,
  options: CasOptions = {}
): Promise<CasResult<T>> {
  const { ttlSeconds, metadata, ...casOptions } = options;

  // Validate TTL if provided
  if (ttlSeconds !== undefined) {
    const validation = validateTTL(ttlSeconds);
    if (!validation.valid) {
      return {
        success: false,
        retries: 0,
        error: `Invalid TTL: ${validation.error}`
      };
    }
  }

  // Create the CAS operation
  const operation = createCasOperation<T>(
    bucket,
    key,
    async (currentObject, currentEtag) => {
      // Validate ETag if provided
      if (currentEtag && currentObject) {
        if (currentObject.etag !== currentEtag) {
          throw new R2Error(R2ErrorType.CONFLICT, 'ETag mismatch', 409, key);
        }
      } else if (currentEtag && !currentObject) {
        throw new R2Error(R2ErrorType.NOT_FOUND, 'Object not found for CAS operation', 404, key);
      }

      // Serialize data to JSON
      let jsonString: string;
      try {
        jsonString = JSON.stringify(data);
      } catch (error) {
        throw new R2Error(
          R2ErrorType.VALIDATION_ERROR,
          `Failed to serialize data to JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
          400,
          key
        );
      }

      // Create metadata with TTL
      const objectMetadata = createJsonMetadata(
        getObjectTypeFromData(data),
        ttlSeconds,
        metadata
      );

      // Store in R2
      await bucket.put(key, jsonString, {
        customMetadata: objectMetadata as any
      });

      return data;
    }
  );

  // Execute with retry logic
  return executeWithCasRetry(operation, { ...casOptions, etag });
}

/**
 * Updates existing JSON data with optimistic concurrency control
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param updater - Function that takes current data and returns updated data
 * @param options - CAS options including TTL and retry configuration
 * @returns Promise that resolves to the CAS result
 */
export async function updateJsonWithCas<T>(
  bucket: AssistantR2Bucket,
  key: string,
  updater: (currentData: T | null) => T,
  options: CasOptions = {}
): Promise<CasResult<T>> {
  const { ttlSeconds, metadata, ...casOptions } = options;

  // Validate TTL if provided
  if (ttlSeconds !== undefined) {
    const validation = validateTTL(ttlSeconds);
    if (!validation.valid) {
      return {
        success: false,
        retries: 0,
        error: `Invalid TTL: ${validation.error}`
      };
    }
  }

  // Create the CAS operation
  const operation = createCasOperation<T>(
    bucket,
    key,
    async (currentObject, currentEtag) => {
      // Parse current data
      let currentData: T | null = null;
      if (currentObject) {
        try {
          const jsonString = await objectToText(currentObject);
          currentData = JSON.parse(jsonString) as T;
        } catch (error) {
          throw new R2Error(
            R2ErrorType.VALIDATION_ERROR,
            `Failed to parse current JSON data: ${error instanceof Error ? error.message : 'Unknown error'}`,
            400,
            key
          );
        }
      }

      // Apply the update
      const updatedData = updater(currentData);

      // Serialize updated data
      let jsonString: string;
      try {
        jsonString = JSON.stringify(updatedData);
      } catch (error) {
        throw new R2Error(
          R2ErrorType.VALIDATION_ERROR,
          `Failed to serialize updated data to JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
          400,
          key
        );
      }

      // Create metadata with TTL
      const objectMetadata = createJsonMetadata(
        getObjectTypeFromData(updatedData),
        ttlSeconds,
        metadata
      );

      // Store in R2
      await bucket.put(key, jsonString, {
        customMetadata: objectMetadata as any
      });

      return updatedData;
    }
  );

  // Execute with retry logic
  return executeWithCasRetry(operation, casOptions);
}

/**
 * Deletes JSON data from R2 with optional ETag validation
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @param etag - Optional ETag for conditional deletion
 * @returns Promise that resolves to the CAS result
 */
export async function deleteJson(
  bucket: AssistantR2Bucket,
  key: string,
  etag?: string
): Promise<CasResult<void>> {
  const operation = createCasOperation<void>(
    bucket,
    key,
    async (currentObject, currentEtag) => {
      // Validate ETag if provided
      if (currentEtag && currentObject) {
        if (currentObject.etag !== currentEtag) {
          throw new R2Error(R2ErrorType.CONFLICT, 'ETag mismatch', 409, key);
        }
      } else if (currentEtag && !currentObject) {
        throw new R2Error(R2ErrorType.NOT_FOUND, 'Object not found for deletion', 404, key);
      }

      // Perform the delete operation
      await bucket.delete(key);
    }
  );

  return executeWithCasRetry(operation, { etag });
}

/**
 * Checks if a JSON object exists in R2
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @returns Promise that resolves to true if the object exists and is valid
 */
export async function jsonExists(bucket: AssistantR2Bucket, key: string): Promise<boolean> {
  try {
    const object = await bucket.get(key);
    if (!object) {
      return false;
    }

    // Check if object has expired
    const metadata = object.customMetadata as any;
    if (metadata?.expiresAt) {
      const expirationTime = new Date(metadata.expiresAt);
      const now = new Date();
      if (now > expirationTime) {
        // Object has expired, clean it up
        await bucket.delete(key);
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Gets the ETag for a JSON object
 * @param bucket - The R2 bucket instance
 * @param key - The object key
 * @returns Promise that resolves to the ETag or null if not found
 */
export async function getJsonEtag(bucket: AssistantR2Bucket, key: string): Promise<string | null> {
  try {
    const object = await bucket.get(key);
    return object?.etag || null;
  } catch (error) {
    return null;
  }
}

/**
 * Determines the object type from the data structure
 * @param data - The data object
 * @returns String representation of the object type
 */
function getObjectTypeFromData(data: any): string {
  if (data && typeof data === 'object' && 'object' in data) {
    return data.object || 'unknown';
  }
  return typeof data;
}

/**
 * Creates a typed JSON storage interface for a specific type
 * @param bucket - The R2 bucket instance
 * @param keyPrefix - Optional key prefix for namespacing
 * @returns Object with typed JSON storage methods
 */
export function createTypedJsonStorage<T>(
  bucket: AssistantR2Bucket,
  keyPrefix?: string
) {
  const prefixKey = (key: string) => keyPrefix ? `${keyPrefix}/${key}` : key;

  return {
    get: (key: string) => getJson<T>(bucket, prefixKey(key)),
    put: (key: string, data: T, options?: JsonStorageOptions) =>
      putJson<T>(bucket, prefixKey(key), data, options),
    putWithCas: (key: string, data: T, etag?: string, options?: CasOptions) =>
      putJsonWithCas<T>(bucket, prefixKey(key), data, etag, options),
    updateWithCas: (key: string, updater: (currentData: T | null) => T, options?: CasOptions) =>
      updateJsonWithCas<T>(bucket, prefixKey(key), updater, options),
    delete: (key: string, etag?: string) =>
      deleteJson(bucket, prefixKey(key), etag),
    exists: (key: string) => jsonExists(bucket, prefixKey(key)),
    getEtag: (key: string) => getJsonEtag(bucket, prefixKey(key))
  };
}