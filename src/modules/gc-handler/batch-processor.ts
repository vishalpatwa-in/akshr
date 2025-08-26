/**
 * Batch Processor for Garbage Collection
 * Handles efficient batch processing with pagination, concurrency, and error recovery
 */

import { GCResourceType, GCCleanupResult, BatchProcessResult, R2ObjectWithMetadata } from './types';
import { BATCH_CONFIG, getResourceConfig } from './config';
import { isExpired } from '../r2-helpers/ttl';
import { getEntityPrefix } from '../r2-helpers/keys';

/**
 * Batch processor for efficient R2 object processing
 */
export class BatchProcessor {
  private bucket: R2Bucket;
  private rateLimiter: RateLimiter;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
    this.rateLimiter = new RateLimiter(BATCH_CONFIG.defaultBatchSize);
  }

  /**
   * Process objects in batches with pagination support
   * @param resourceType - Type of resource to process
   * @param processor - Function to process each batch
   * @param options - Processing options
   * @returns Processing results
   */
  async processInBatches<T>(
    resourceType: GCResourceType,
    processor: (batch: R2ObjectWithMetadata[]) => Promise<BatchProcessResult<T>>,
    options: {
      batchSize?: number;
      maxConcurrentBatches?: number;
      maxObjects?: number;
      continueOnErrors?: boolean;
    } = {}
  ): Promise<{
    totalProcessed: number;
    totalErrors: number;
    results: BatchProcessResult<T>[];
    errors: string[];
  }> {
    const config = {
      batchSize: options.batchSize || BATCH_CONFIG.defaultBatchSize,
      maxConcurrentBatches: options.maxConcurrentBatches || BATCH_CONFIG.maxConcurrentBatches,
      maxObjects: options.maxObjects,
      continueOnErrors: options.continueOnErrors ?? true
    };

    const resourceConfig = getResourceConfig(resourceType);
    const prefix = resourceConfig.prefix;

    let cursor: string | undefined;
    let totalProcessed = 0;
    let totalErrors = 0;
    const results: BatchProcessResult<T>[] = [];
    const errors: string[] = [];
    const processingQueue: Promise<void>[] = [];

    do {
      // Check rate limits
      await this.rateLimiter.waitForSlot();

      // List objects with pagination
      const listResult = await this.listObjectsWithMetadata(prefix, {
        cursor,
        limit: config.batchSize
      });

      if (!listResult.success) {
        const error = `Failed to list objects for ${resourceType}: ${listResult.error}`;
        errors.push(error);
        if (!config.continueOnErrors) break;
        continue;
      }

      const objects = listResult.objects;
      if (objects.length === 0) break;

      // Check if we've reached the maximum objects limit
      if (config.maxObjects && totalProcessed + objects.length > config.maxObjects) {
        objects.splice(config.maxObjects - totalProcessed);
      }

      // Process batch
      const batchPromise = this.processBatch(objects, processor, resourceType)
        .then(batchResult => {
          results.push(batchResult);
          totalProcessed += batchResult.items.length;
          totalErrors += batchResult.errors.length;
        })
        .catch(error => {
          const errorMsg = `Batch processing failed for ${resourceType}: ${error.message}`;
          errors.push(errorMsg);
          totalErrors++;
        });

      processingQueue.push(batchPromise);

      // Control concurrency
      if (processingQueue.length >= config.maxConcurrentBatches) {
        await Promise.all(processingQueue.splice(0, config.maxConcurrentBatches));
      }

      // Check if we should stop
      if (config.maxObjects && totalProcessed >= config.maxObjects) break;

      cursor = listResult.cursor;
      if (!cursor) break;

      // Small delay between batches to prevent overwhelming R2
      await this.delay(BATCH_CONFIG.batchDelayMs);

    } while (cursor && (!config.maxObjects || totalProcessed < config.maxObjects));

    // Wait for remaining batches
    await Promise.all(processingQueue);

    return {
      totalProcessed,
      totalErrors,
      results,
      errors
    };
  }

  /**
   * List R2 objects with metadata and expiration information
   * @param prefix - Key prefix to filter by
   * @param options - List options
   * @returns List result with enhanced metadata
   */
  private async listObjectsWithMetadata(
    prefix: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<{
    success: boolean;
    objects: R2ObjectWithMetadata[];
    cursor?: string;
    error?: string;
  }> {
    try {
      const listOptions = {
        prefix,
        cursor: options.cursor,
        limit: options.limit,
        include: ['customMetadata', 'httpMetadata'] as ('customMetadata' | 'httpMetadata')[]
      };

      const result = await this.bucket.list(listOptions);

      const objectsWithMetadata: R2ObjectWithMetadata[] = result.objects.map((obj) => ({
        ...obj,
        customMetadata: obj.customMetadata || {},
        expiresAt: obj.customMetadata?.expiresAt,
        isExpired: obj.customMetadata?.expiresAt ? isExpired({ expiresAt: obj.customMetadata.expiresAt }) : false
      }));

      return {
        success: true,
        objects: objectsWithMetadata,
        cursor: result.truncated ? result.cursor : undefined
      };
    } catch (error) {
      return {
        success: false,
        objects: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process a single batch of objects
   * @param objects - Objects to process
   * @param processor - Batch processor function
   * @param resourceType - Resource type for error context
   * @returns Batch processing result
   */
  private async processBatch<T>(
    objects: R2ObjectWithMetadata[],
    processor: (batch: R2ObjectWithMetadata[]) => Promise<BatchProcessResult<T>>,
    resourceType: GCResourceType
  ): Promise<BatchProcessResult<T>> {
    const startTime = Date.now();

    try {
      const result = await processor(objects);
      result.durationMs = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        items: objects as T[],
        results: [],
        errors: [error instanceof Error ? error.message : `Unknown error processing batch for ${resourceType}`],
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Utility delay function
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Rate limiter for controlling R2 request frequency
 */
export class RateLimiter {
  private currentCount: number = 0;
  private windowStart: number = Date.now();
  private maxRequests: number;
  private windowMs: number = 1000; // 1 second window

  constructor(maxRequests: number) {
    this.maxRequests = maxRequests;
  }

  /**
   * Wait until a request slot is available
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Reset window if needed
    if (now - this.windowStart >= this.windowMs) {
      this.currentCount = 0;
      this.windowStart = now;
    }

    // If we're at the limit, wait for the next window
    if (this.currentCount >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.windowStart);
      await this.delay(waitTime);
      this.currentCount = 0;
      this.windowStart = Date.now();
    }

    this.currentCount++;
  }

  /**
   * Utility delay function
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a batch processor instance
 * @param bucket - R2 bucket instance
 * @returns Batch processor instance
 */
export function createBatchProcessor(bucket: R2Bucket): BatchProcessor {
  return new BatchProcessor(bucket);
}

/**
 * Create a rate limiter instance
 * @param maxRequests - Maximum requests per second
 * @returns Rate limiter instance
 */
export function createRateLimiter(maxRequests: number): RateLimiter {
  return new RateLimiter(maxRequests);
}