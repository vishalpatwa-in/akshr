import { z } from 'zod';
import type { Assistant, Tool } from '../models';
import {
  CreateAssistantRequest,
  UpdateAssistantRequest,
  AssistantResponse,
  ListAssistantsResponse
} from '../validators/assistant';
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
type CreateAssistantRequestType = z.infer<typeof CreateAssistantRequest>;
type UpdateAssistantRequestType = z.infer<typeof UpdateAssistantRequest>;

/**
 * Assistant service implementing comprehensive business logic
 */
export class AssistantService {
  private readonly storage: R2StorageManager;
  private readonly bucket: AssistantR2Bucket;
  private readonly idGenerator: DefaultIdGenerator;
  private readonly businessRules: DefaultBusinessRules;
  private readonly cache: InMemoryCache;
  private readonly CACHE_PREFIX = 'assistant:';
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

  private validateContentSize(content: string, maxSize: number = 10 * 1024 * 1024): ValidationResult {
    return ServiceUtils.validateContentSize(content, maxSize);
  }

  /**
   * Create a new assistant with validation and business rules
   */
  async create(data: CreateAssistantRequestType): Promise<ServiceResult<Assistant>> {
    try {
      // Validate request data
      const validation = this.validateCreate(data);
      if (!validation.valid) {
        return ServiceUtils.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        ) as ServiceResult<Assistant>;
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit('assistant_create', 'create');
      if (!rateLimitValidation.valid) {
        return ServiceUtils.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        ) as ServiceResult<Assistant>;
      }

      // Generate ID and create assistant
      const assistant: Assistant = {
        id: this.idGenerator.generateAssistantId(),
        object: 'assistant',
        created_at: Math.floor(Date.now() / 1000),
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        model: data.model,
        tools: data.tools || [],
        file_ids: data.file_ids,
        metadata: data.metadata
      };

      // Validate model compatibility
      const modelValidation = this.businessRules.validateAssistantModel(assistant.model);
      if (!modelValidation.valid) {
        return ServiceUtils.createErrorResult(
          `Model validation failed: ${modelValidation.errors.join(', ')}`,
          'MODEL_VALIDATION_ERROR'
        ) as ServiceResult<Assistant>;
      }

      // Validate tools for Gemini compatibility
      for (const tool of assistant.tools) {
        const toolValidation = this.businessRules.validateToolSchema(tool);
        if (!toolValidation.valid) {
          return ServiceUtils.createErrorResult(
            `Tool validation failed: ${toolValidation.errors.join(', ')}`,
            'TOOL_VALIDATION_ERROR'
          ) as ServiceResult<Assistant>;
        }
      }

      // Store assistant
      await this.storage.assistants.put(assistant);

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${assistant.id}`, assistant, this.CACHE_TTL);

      return this.createSuccessResult(assistant);
    } catch (error) {
      console.error(`Error in create assistant:`, error);
      return ServiceUtils.createErrorResult(
        `Failed to create assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_ERROR'
      ) as ServiceResult<Assistant>;
    }
  }

  /**
   * Retrieve assistant by ID with caching
   */
  async getById(id: string): Promise<ServiceResult<Assistant>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'asst_');
      if (!idValidation.valid) {
        return ServiceUtils.createErrorResult(
          `Invalid assistant ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        ) as ServiceResult<Assistant>;
      }

      // Check cache first
      const cached = await this.getFromCache<Assistant>(`${this.CACHE_PREFIX}${id}`);
      if (cached) {
        return this.createSuccessResult(cached);
      }

      // Fetch from storage
      const assistant = await this.storage.assistants.get(id);
      if (!assistant) {
        return ServiceUtils.createErrorResult(
          `Assistant with ID '${id}' not found`,
          'NOT_FOUND_ERROR'
        ) as ServiceResult<Assistant>;
      }

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${id}`, assistant, this.CACHE_TTL);

      return this.createSuccessResult(assistant);
    } catch (error) {
      console.error(`Error in get assistant:`, error);
      return ServiceUtils.createErrorResult(
        `Failed to get assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR'
      ) as ServiceResult<Assistant>;
    }
  }

  /**
   * Update assistant with partial updates and validation
   */
  async update(id: string, data: UpdateAssistantRequestType): Promise<ServiceResult<Assistant>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'asst_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid assistant ID: ${idValidation.errors.join(', ')}`,
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
      const rateLimitValidation = await this.validateRateLimit(`assistant_update_${id}`, 'update');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // Get current assistant
      const currentResult = await this.getById(id);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Apply updates
      const updated: Assistant = {
        ...current,
        ...data,
        // Preserve immutable fields
        id: current.id,
        object: current.object,
        created_at: current.created_at
      };

      // Validate model if being updated
      if (data.model) {
        const modelValidation = this.businessRules.validateAssistantModel(updated.model);
        if (!modelValidation.valid) {
          return this.createErrorResult(
            `Model validation failed: ${modelValidation.errors.join(', ')}`,
            'MODEL_VALIDATION_ERROR'
          );
        }
      }

      // Validate tools if being updated
      if (data.tools) {
        for (const tool of updated.tools) {
          const toolValidation = this.businessRules.validateToolSchema(tool);
          if (!toolValidation.valid) {
            return this.createErrorResult(
              `Tool validation failed: ${toolValidation.errors.join(', ')}`,
              'TOOL_VALIDATION_ERROR'
            );
          }
        }
      }

      // Update with CAS for concurrency control
      await this.storage.assistants.put(updated);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${id}`, updated, this.CACHE_TTL);

      return this.createSuccessResult(updated);
    } catch (error) {
      console.error(`Error in update assistant:`, error);
      return this.createErrorResult(
        `Failed to update assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_ERROR'
      );
    }
  }

  /**
   * Delete assistant with cascade considerations
   */
  async delete(id: string): Promise<ServiceResult<void>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'asst_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid assistant ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check if assistant exists
      const exists = await this.exists(id);
      if (!exists) {
        return this.createErrorResult(
          `Assistant with ID '${id}' not found`,
          'NOT_FOUND_ERROR'
        );
      }

      // TODO: Add cascade deletion logic for related runs, threads, etc.
      // For now, we'll just delete the assistant

      // Delete from storage
      await this.storage.assistants.delete(id);

      // Remove from cache
      await this.deleteFromCache(`${this.CACHE_PREFIX}${id}`);

      return this.createSuccessResult(undefined);
    } catch (error) {
      console.error(`Error in delete assistant:`, error);
      return this.createErrorResult(
        `Failed to delete assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_ERROR'
      );
    }
  }

  /**
   * List assistants with pagination and filtering
   */
  async list(options: PaginationOptions = {}): Promise<ServiceResult<ListResponse<Assistant>>> {
    try {
      const limit = Math.min(options.limit || 20, 100); // Max 100 items
      const assistants: Assistant[] = [];

      // TODO: Implement proper pagination in R2 storage
      // For now, we'll use a simple approach
      // In a real implementation, you'd need to maintain an index or use a database

      // This is a simplified implementation - in production you'd need proper indexing
      // For now, return empty list with pagination meta
      const meta = this.calculatePaginationMeta(assistants, limit);

      return this.createSuccessResult({
        data: assistants,
        meta
      });
    } catch (error) {
      console.error(`Error in list assistants:`, error);
      return this.createErrorResult(
        `Failed to list assistants: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * List assistants by owner (placeholder for future implementation)
   */
  async listByOwner(ownerId: string, options: PaginationOptions = {}): Promise<ServiceResult<ListResponse<Assistant>>> {
    // TODO: Implement ownership-based filtering
    // For now, delegate to regular list
    return this.list(options);
  }

  /**
   * Check if assistant exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      return await this.storage.assistants.exists(id);
    } catch (error) {
      console.error('Error checking assistant existence:', error);
      return false;
    }
  }

  /**
   * Validate create request
   */
  validateCreate(data: CreateAssistantRequestType): ValidationResult {
    const errors: string[] = [];

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required and must be a non-empty string');
    }

    if (!data.instructions || typeof data.instructions !== 'string' || data.instructions.trim().length === 0) {
      errors.push('Instructions are required and must be a non-empty string');
    }

    if (!data.model || typeof data.model !== 'string' || data.model.trim().length === 0) {
      errors.push('Model is required and must be a non-empty string');
    }

    // Validate content size
    if (data.instructions) {
      const sizeValidation = this.validateContentSize(data.instructions);
      if (!sizeValidation.valid) {
        errors.push(...sizeValidation.errors);
      }
    }

    if (data.description) {
      const sizeValidation = this.validateContentSize(data.description);
      if (!sizeValidation.valid) {
        errors.push(...sizeValidation.errors);
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate update request
   */
  async validateUpdate(id: string, data: UpdateAssistantRequestType): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate the assistant exists
    const existenceValidation = await this.validateResourceExists(id, 'Assistant');
    if (!existenceValidation.valid) {
      errors.push(...existenceValidation.errors);
    }

    // Validate individual fields
    if (data.name !== undefined && (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0)) {
      errors.push('Name must be a non-empty string when provided');
    }

    if (data.instructions !== undefined && (!data.instructions || typeof data.instructions !== 'string' || data.instructions.trim().length === 0)) {
      errors.push('Instructions must be a non-empty string when provided');
    }

    if (data.model !== undefined && (!data.model || typeof data.model !== 'string' || data.model.trim().length === 0)) {
      errors.push('Model must be a non-empty string when provided');
    }

    // Validate content sizes
    if (data.instructions) {
      const sizeValidation = this.validateContentSize(data.instructions);
      if (!sizeValidation.valid) {
        errors.push(...sizeValidation.errors);
      }
    }

    if (data.description) {
      const sizeValidation = this.validateContentSize(data.description);
      if (!sizeValidation.valid) {
        errors.push(...sizeValidation.errors);
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }
}