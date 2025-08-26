import type { AssistantR2Bucket } from '../r2-helpers/types';
import type { R2StorageManager } from '../r2-helpers/storage';
import type { Assistant, Thread, Message, Run, File, Tool } from '../models';

/**
 * Base service configuration
 */
export interface ServiceConfig {
  storage: R2StorageManager;
  bucket: AssistantR2Bucket;
}

/**
 * Pagination options for list operations
 */
export interface PaginationOptions {
  limit?: number;
  after?: string;
  before?: string;
}

/**
 * Pagination metadata for responses
 */
export interface PaginationMeta {
  hasMore: boolean;
  firstId?: string;
  lastId?: string;
}

/**
 * Base list response structure
 */
export interface ListResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Business rule validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Service operation result
 */
export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * ID generation utilities
 */
export interface IdGenerator {
  generateAssistantId(): string;
  generateThreadId(): string;
  generateMessageId(): string;
  generateRunId(): string;
  generateFileId(): string;
}

/**
 * Business rule validators
 */
export interface BusinessRules {
  validateAssistantModel(model: string): ValidationResult;
  validateToolSchema(tool: Tool): ValidationResult;
  validateResourceOwnership(resourceId: string, ownerId?: string): ValidationResult;
  validateRateLimit(identifier: string, operation: string): Promise<ValidationResult>;
  validateResourceRelationship(parentId: string, childId: string, type: 'thread-message' | 'assistant-run'): ValidationResult;
}

/**
 * Cache interface for performance optimizations
 */
export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Base repository interface
 */
export interface BaseRepository<T, TCreate, TUpdate> {
  create(data: TCreate): Promise<ServiceResult<T>>;
  getById(id: string): Promise<ServiceResult<T>>;
  update(id: string, data: TUpdate): Promise<ServiceResult<T>>;
  delete(id: string): Promise<ServiceResult<void>>;
  exists(id: string): Promise<boolean>;
}

/**
 * List repository interface
 */
export interface ListRepository<T> {
  list(options?: PaginationOptions): Promise<ServiceResult<ListResponse<T>>>;
  listByOwner(ownerId: string, options?: PaginationOptions): Promise<ServiceResult<ListResponse<T>>>;
}

/**
 * Base service interface
 */
export interface BaseService<T, TCreate, TUpdate> extends BaseRepository<T, TCreate, TUpdate>, ListRepository<T> {
  validateCreate(data: TCreate): ValidationResult;
  validateUpdate(id: string, data: TUpdate): Promise<ValidationResult>;
}