import type { R2StorageManager } from '../r2-helpers/storage';
import type { AssistantR2Bucket } from '../r2-helpers/types';
import type {
  ServiceConfig,
  ServiceResult,
  ValidationResult,
  BaseService as IBaseService,
  BaseRepository,
  ListRepository,
  PaginationOptions,
  ListResponse
} from './types';
import { DefaultIdGenerator, DefaultBusinessRules, InMemoryCache, ServiceUtils } from './utils';
import type { IdGenerator, BusinessRules, CacheService } from './types';

/**
 * Base service class providing common functionality for all services
 */
export abstract class BaseService<T, TCreate, TUpdate> implements IBaseService<T, TCreate, TUpdate> {
  protected readonly storage: R2StorageManager;
  protected readonly bucket: AssistantR2Bucket;
  protected readonly idGenerator: IdGenerator;
  protected readonly businessRules: BusinessRules;
  protected readonly cache: CacheService;

  constructor(config: ServiceConfig) {
    this.storage = config.storage;
    this.bucket = config.bucket;
    this.idGenerator = new DefaultIdGenerator();
    this.businessRules = new DefaultBusinessRules();
    this.cache = new InMemoryCache();
  }

  /**
   * Abstract methods that must be implemented by subclasses
   */
  abstract create(data: TCreate): Promise<ServiceResult<T>>;
  abstract update(id: string, data: TUpdate): Promise<ServiceResult<T>>;
  abstract getById(id: string): Promise<ServiceResult<T>>;
  abstract delete(id: string): Promise<ServiceResult<void>>;
  abstract list(options?: PaginationOptions): Promise<ServiceResult<ListResponse<T>>>;
  abstract listByOwner(ownerId: string, options?: PaginationOptions): Promise<ServiceResult<ListResponse<T>>>;
  abstract exists(id: string): Promise<boolean>;
  abstract validateCreate(data: TCreate): ValidationResult;
  abstract validateUpdate(id: string, data: TUpdate): Promise<ValidationResult>;

  /**
   * Common validation methods
   */
  protected async validateResourceExists(id: string, resourceType: string): Promise<ValidationResult> {
    const exists = await this.exists(id);
    if (!exists) {
      return ServiceUtils.createValidationResult(false, [`${resourceType} with ID '${id}' does not exist`]);
    }
    return ServiceUtils.createValidationResult(true);
  }

  protected async validateOwnership(resourceId: string, ownerId?: string): Promise<ValidationResult> {
    return this.businessRules.validateResourceOwnership(resourceId, ownerId);
  }

  protected async validateRateLimit(identifier: string, operation: string): Promise<ValidationResult> {
    return this.businessRules.validateRateLimit(identifier, operation);
  }

  protected validateIdFormat(id: string, expectedPrefix: string): ValidationResult {
    if (!id || typeof id !== 'string') {
      return ServiceUtils.createValidationResult(false, ['ID must be a non-empty string']);
    }

    if (!id.startsWith(expectedPrefix)) {
      return ServiceUtils.createValidationResult(false, [`ID must start with '${expectedPrefix}'`]);
    }

    return ServiceUtils.createValidationResult(true);
  }

  /**
   * Common error handling
   */
  protected handleError(error: unknown, operation: string): ServiceResult {
    console.error(`Error in ${operation}:`, error);

    if (error instanceof Error) {
      return ServiceUtils.createErrorResult(
        `Failed to ${operation}: ${error.message}`,
        error.name
      );
    }

    return ServiceUtils.createErrorResult(
      `Failed to ${operation}: Unknown error`,
      'UNKNOWN_ERROR'
    );
  }

  /**
   * Cache operations
   */
  protected async getFromCache<T>(key: string): Promise<T | null> {
    return this.cache.get<T>(key);
  }

  protected async setCache<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    await this.cache.set(key, value, ttlSeconds);
  }

  protected async deleteFromCache(key: string): Promise<void> {
    await this.cache.delete(key);
  }

  /**
   * Common utility methods
   */
  protected generateTimestamp(): string {
    return ServiceUtils.generateTimestamp();
  }

  protected sanitizeString(input: string): string {
    return ServiceUtils.sanitizeString(input);
  }

  protected calculatePaginationMeta<T extends { id: string }>(
    items: T[],
    requestedLimit: number,
    totalAvailable?: number
  ) {
    return ServiceUtils.calculatePaginationMeta(items, requestedLimit, totalAvailable);
  }

  protected validateContentSize(content: string, maxSize: number = 10 * 1024 * 1024): ValidationResult {
    return ServiceUtils.validateContentSize(content, maxSize);
  }

  /**
   * Common service result helpers
   */
  protected createSuccessResult<T>(data: T): ServiceResult<T> {
    return ServiceUtils.createSuccessResult(data);
  }

  protected createErrorResult(error: string, code?: string): ServiceResult {
    return ServiceUtils.createErrorResult(error, code);
  }

  protected createValidationResult(valid: boolean, errors: string[] = []): ValidationResult {
    return ServiceUtils.createValidationResult(valid, errors);
  }
}

/**
 * Base repository implementation providing common CRUD operations
 */
export abstract class BaseRepositoryImpl<T extends { id: string }> implements BaseRepository<T, Partial<T>, Partial<T>> {
  protected readonly storage: R2StorageManager;
  protected readonly entityType: string;

  constructor(storage: R2StorageManager, entityType: string) {
    this.storage = storage;
    this.entityType = entityType;
  }

  abstract create(data: Partial<T>): Promise<ServiceResult<T>>;
  abstract update(id: string, data: Partial<T>): Promise<ServiceResult<T>>;
  abstract getById(id: string): Promise<ServiceResult<T>>;
  abstract delete(id: string): Promise<ServiceResult<void>>;
  abstract exists(id: string): Promise<boolean>;
  abstract list(options?: PaginationOptions): Promise<ServiceResult<ListResponse<T>>>;

  protected handleStorageError(error: unknown, operation: string): ServiceResult {
    console.error(`Storage error in ${operation}:`, error);

    if (error instanceof Error) {
      return ServiceUtils.createErrorResult(
        `Storage operation failed: ${error.message}`,
        'STORAGE_ERROR'
      );
    }

    return ServiceUtils.createErrorResult(
      'Storage operation failed: Unknown error',
      'STORAGE_ERROR'
    );
  }

  protected createSuccessResult<T>(data: T): ServiceResult<T> {
    return ServiceUtils.createSuccessResult(data);
  }

  protected createErrorResult(error: string, code?: string): ServiceResult {
    return ServiceUtils.createErrorResult(error, code);
  }
}