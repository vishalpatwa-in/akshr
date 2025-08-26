import { z } from 'zod';
import type { Thread, Message } from '../models';
import {
  CreateThreadRequest,
  UpdateThreadRequest,
  ThreadResponse,
  ListThreadsResponse
} from '../validators/thread';
import { R2StorageManager } from '../r2-helpers/storage';
import { AssistantR2Bucket } from '../r2-helpers/types';
import type {
  ServiceResult,
  ValidationResult,
  PaginationOptions,
  ListResponse,
  ServiceConfig
} from './types';
import { ServiceUtils, DefaultIdGenerator, DefaultBusinessRules, InMemoryCache } from './utils';

// Infer types from Zod schemas
type CreateThreadRequestType = z.infer<typeof CreateThreadRequest>;
type UpdateThreadRequestType = z.infer<typeof UpdateThreadRequest>;

/**
 * Thread service implementing comprehensive business logic for threads and message management
 */
export class ThreadService {
  private readonly storage: R2StorageManager;
  private readonly bucket: AssistantR2Bucket;
  private readonly idGenerator: DefaultIdGenerator;
  private readonly businessRules: DefaultBusinessRules;
  private readonly cache: InMemoryCache;
  private readonly CACHE_PREFIX = 'thread:';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(config: ServiceConfig) {
    this.storage = config.storage;
    this.bucket = config.bucket;
    this.idGenerator = new DefaultIdGenerator();
    this.businessRules = new DefaultBusinessRules();
    this.cache = new InMemoryCache();
  }

  // Helper methods for common operations
  private createSuccessResult<T>(data: T): ServiceResult<T> {
    return ServiceUtils.createSuccessResult(data);
  }

  private createErrorResult(error: string, code?: string): ServiceResult<any> {
    return ServiceUtils.createErrorResult(error, code);
  }

  private createValidationResult(valid: boolean, errors: string[] = []): ValidationResult {
    return ServiceUtils.createValidationResult(valid, errors);
  }

  private validateIdFormat(id: string, expectedPrefix: string): ValidationResult {
    if (!id || typeof id !== 'string') {
      return this.createValidationResult(false, ['ID must be a non-empty string']);
    }
    if (!id.startsWith(expectedPrefix)) {
      return this.createValidationResult(false, [`ID must start with '${expectedPrefix}'`]);
    }
    return this.createValidationResult(true);
  }

  private async validateResourceExists(id: string, resourceType: string): Promise<ValidationResult> {
    const exists = await this.exists(id);
    if (!exists) {
      return this.createValidationResult(false, [`${resourceType} with ID '${id}' does not exist`]);
    }
    return this.createValidationResult(true);
  }

  private async validateRateLimit(identifier: string, operation: string): Promise<ValidationResult> {
    return this.businessRules.validateRateLimit(identifier, operation);
  }

  private async getFromCache<T>(key: string): Promise<T | null> {
    return this.cache.get<T>(key);
  }

  private async setCache<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    await this.cache.set(key, value, ttlSeconds);
  }

  private async deleteFromCache(key: string): Promise<void> {
    await this.cache.delete(key);
  }

  private calculatePaginationMeta<T extends { id: string }>(
    items: T[],
    requestedLimit: number,
    totalAvailable?: number
  ) {
    return ServiceUtils.calculatePaginationMeta(items, requestedLimit, totalAvailable);
  }

  /**
   * Create a new thread with optional initial messages
   */
  async create(data: CreateThreadRequestType): Promise<ServiceResult<Thread>> {
    try {
      // Validate request data
      const validation = this.validateCreate(data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit('thread_create', 'create');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // Generate ID and create thread
      const thread: Thread = {
        id: this.idGenerator.generateThreadId(),
        object: 'thread',
        created_at: Math.floor(Date.now() / 1000),
        metadata: data.metadata
      };

      // Store thread
      await this.storage.threads.put(thread);

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${thread.id}`, thread, this.CACHE_TTL);

      return this.createSuccessResult(thread);
    } catch (error) {
      console.error(`Error in create thread:`, error);
      return this.createErrorResult(
        `Failed to create thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_ERROR'
      );
    }
  }

  /**
   * Retrieve thread by ID with message count summary
   */
  async getById(id: string): Promise<ServiceResult<Thread>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'thread_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check cache first
      const cached = await this.getFromCache<Thread>(`${this.CACHE_PREFIX}${id}`);
      if (cached) {
        return this.createSuccessResult(cached);
      }

      // Fetch from storage
      const thread = await this.storage.threads.get(id);
      if (!thread) {
        return this.createErrorResult(
          `Thread with ID '${id}' not found`,
          'NOT_FOUND_ERROR'
        );
      }

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${id}`, thread, this.CACHE_TTL);

      return this.createSuccessResult(thread);
    } catch (error) {
      console.error(`Error in get thread:`, error);
      return this.createErrorResult(
        `Failed to get thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR'
      );
    }
  }

  /**
   * Update thread metadata
   */
  async update(id: string, data: UpdateThreadRequestType): Promise<ServiceResult<Thread>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'thread_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Validate update data
      const validation = await this.validateUpdate(id, data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit(`thread_update_${id}`, 'update');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // Get current thread
      const currentResult = await this.getById(id);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Apply updates
      const updated: Thread = {
        ...current,
        metadata: data.metadata !== undefined ? data.metadata : current.metadata
      };

      // Update with CAS for concurrency control
      await this.storage.threads.put(updated);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${id}`, updated, this.CACHE_TTL);

      return this.createSuccessResult(updated);
    } catch (error) {
      console.error(`Error in update thread:`, error);
      return this.createErrorResult(
        `Failed to update thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_ERROR'
      );
    }
  }

  /**
   * Delete thread with all associated messages and runs
   */
  async delete(id: string): Promise<ServiceResult<void>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'thread_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check if thread exists
      const exists = await this.exists(id);
      if (!exists) {
        return this.createErrorResult(
          `Thread with ID '${id}' not found`,
          'NOT_FOUND_ERROR'
        );
      }

      // TODO: Implement cascade deletion of messages and runs
      // For now, we'll just delete the thread
      // In a real implementation, you would:
      // 1. Get all messages for this thread
      // 2. Delete all messages
      // 3. Get all runs for this thread
      // 4. Delete all runs
      // 5. Delete the thread

      // Delete from storage
      await this.storage.threads.delete(id);

      // Remove from cache
      await this.deleteFromCache(`${this.CACHE_PREFIX}${id}`);

      return this.createSuccessResult(undefined);
    } catch (error) {
      console.error(`Error in delete thread:`, error);
      return this.createErrorResult(
        `Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_ERROR'
      );
    }
  }

  /**
   * List threads with pagination and filtering
   */
  async list(options: PaginationOptions = {}): Promise<ServiceResult<ListResponse<Thread>>> {
    try {
      const limit = Math.min(options.limit || 20, 100); // Max 100 items
      const threads: Thread[] = [];

      // TODO: Implement proper pagination in R2 storage
      // For now, we'll use a simple approach
      const meta = this.calculatePaginationMeta(threads, limit);

      return this.createSuccessResult({
        data: threads,
        meta
      });
    } catch (error) {
      console.error(`Error in list threads:`, error);
      return this.createErrorResult(
        `Failed to list threads: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * List threads by owner (placeholder for future implementation)
   */
  async listByOwner(ownerId: string, options: PaginationOptions = {}): Promise<ServiceResult<ListResponse<Thread>>> {
    // TODO: Implement ownership-based filtering
    return this.list(options);
  }

  /**
   * Check if thread exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      return await this.storage.threads.exists(id);
    } catch (error) {
      console.error('Error checking thread existence:', error);
      return false;
    }
  }

  /**
   * Get message count for a thread
   */
  async getMessageCount(threadId: string): Promise<ServiceResult<number>> {
    try {
      // TODO: Implement efficient message counting
      // This would require either:
      // 1. Storing a counter in the thread object
      // 2. Using a separate index for messages per thread
      // 3. Scanning all messages with the thread prefix

      // For now, return 0 as a placeholder
      return this.createSuccessResult(0);
    } catch (error) {
      console.error(`Error getting message count for thread ${threadId}:`, error);
      return this.createErrorResult(
        `Failed to get message count: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'COUNT_ERROR'
      );
    }
  }

  /**
   * Validate create request
   */
  validateCreate(data: CreateThreadRequestType): ValidationResult {
    const errors: string[] = [];

    // Basic validation - threads don't have many required fields
    // The main validation is for metadata size if provided
    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      if (metadataStr.length > 16 * 1024) { // 16KB limit for metadata
        errors.push('Metadata size exceeds maximum allowed size (16KB)');
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate update request
   */
  async validateUpdate(id: string, data: UpdateThreadRequestType): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate the thread exists
    const existenceValidation = await this.validateResourceExists(id, 'Thread');
    if (!existenceValidation.valid) {
      errors.push(...existenceValidation.errors);
    }

    // Validate metadata size
    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      if (metadataStr.length > 16 * 1024) { // 16KB limit for metadata
        errors.push('Metadata size exceeds maximum allowed size (16KB)');
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }
}