import { z } from 'zod';
import type { File, FileStatus } from '../models';
import {
  UploadFileRequest,
  FileResponse,
  ListFilesResponse,
  DeleteFileResponse
} from '../validators/file';
import { R2StorageManager } from '../r2-helpers/storage';
import { AssistantR2Bucket } from '../r2-helpers/types';
import type {
  ServiceResult,
  ValidationResult,
  ServiceConfig
} from './types';
import { ServiceUtils, DefaultIdGenerator, DefaultBusinessRules, InMemoryCache } from './utils';

// Infer types from Zod schemas
type UploadFileRequestType = z.infer<typeof UploadFileRequest>;

/**
 * File service implementing comprehensive business logic for file management, storage, and lifecycle
 */
export class FileService {
  private readonly storage: R2StorageManager;
  private readonly bucket: AssistantR2Bucket;
  private readonly idGenerator: DefaultIdGenerator;
  private readonly businessRules: DefaultBusinessRules;
  private readonly cache: InMemoryCache;
  private readonly CACHE_PREFIX = 'file:';
  private readonly CACHE_TTL = 300; // 5 minutes

  // File size limits (in bytes)
  private readonly MAX_FILE_SIZE = 512 * 1024 * 1024; // 512MB
  private readonly MIN_FILE_SIZE = 1; // 1 byte
  private readonly DEFAULT_EXPIRATION_DAYS = 30; // 30 days

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

  /**
   * Upload file with metadata extraction and validation
   */
  async upload(data: UploadFileRequestType): Promise<ServiceResult<File>> {
    try {
      // Validate request data
      const validation = this.validateUpload(data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit('file_upload', 'upload');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // In a real implementation, the file would be uploaded via multipart/form-data
      // For now, we'll simulate the file processing
      const fileData = data.file as any; // This would be a File/Blob in real implementation

      // Extract file metadata
      const metadata = await this.extractFileMetadata(fileData);

      // Generate ID and create file record
      const file: File = {
        id: this.idGenerator.generateFileId(),
        object: 'file',
        created_at: Math.floor(Date.now() / 1000),
        filename: metadata.filename,
        bytes: metadata.size,
        purpose: data.purpose,
        expires_at: Math.floor(Date.now() / 1000) + (this.DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60),
        status: 'uploaded',
        status_details: undefined
      };

      // Store file metadata
      await this.storage.files.putMetadata(file);

      // In real implementation, store the actual file blob:
      // await this.storage.files.putBlob(file.id, fileData);

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${file.id}`, file, this.CACHE_TTL);

      return this.createSuccessResult(file);
    } catch (error) {
      console.error(`Error in upload file:`, error);
      return this.createErrorResult(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPLOAD_ERROR'
      );
    }
  }

  /**
   * Retrieve file metadata and content
   */
  async getById(id: string): Promise<ServiceResult<File>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'file_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid file ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check cache first
      const cached = await this.getFromCache<File>(`${this.CACHE_PREFIX}${id}`);
      if (cached) {
        return this.createSuccessResult(cached);
      }

      // Fetch from storage
      const file = await this.storage.files.getMetadata(id);
      if (!file) {
        return this.createErrorResult(
          `File with ID '${id}' not found`,
          'NOT_FOUND_ERROR'
        );
      }

      // Check if file has expired
      if (this.isExpired(file)) {
        return this.createErrorResult(
          `File with ID '${id}' has expired`,
          'EXPIRED_ERROR'
        );
      }

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${id}`, file, this.CACHE_TTL);

      return this.createSuccessResult(file);
    } catch (error) {
      console.error(`Error in get file:`, error);
      return this.createErrorResult(
        `Failed to get file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR'
      );
    }
  }

  /**
   * Get file content (blob)
   */
  async getFileContent(id: string): Promise<ServiceResult<Blob | null>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'file_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid file ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check if file exists and is not expired
      const fileResult = await this.getById(id);
      if (!fileResult.success) {
        return this.createErrorResult(fileResult.error || 'File not found', 'NOT_FOUND_ERROR');
      }

      // In real implementation, get the actual file blob:
      // const blob = await this.storage.files.getBlob(id);
      // return this.createSuccessResult(blob);

      // For now, return null as placeholder
      return this.createSuccessResult(null);
    } catch (error) {
      console.error(`Error in get file content:`, error);
      return this.createErrorResult(
        `Failed to get file content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_CONTENT_ERROR'
      );
    }
  }

  /**
   * Delete file with cleanup of all associated data
   */
  async delete(id: string): Promise<ServiceResult<{ id: string; object: string; deleted: boolean }>> {
    try {
      // Validate ID format
      const idValidation = this.validateIdFormat(id, 'file_');
      if (!idValidation.valid) {
        return this.createErrorResult(
          `Invalid file ID: ${idValidation.errors.join(', ')}`,
          'INVALID_ID_ERROR'
        );
      }

      // Check if file exists
      const exists = await this.exists(id);
      if (!exists) {
        return this.createSuccessResult({
          id,
          object: 'file',
          deleted: false
        });
      }

      // Delete both metadata and blob
      const deleted = await this.storage.files.delete(id);

      if (deleted) {
        // Remove from cache
        await this.deleteFromCache(`${this.CACHE_PREFIX}${id}`);

        // TODO: Clean up references to this file in assistants, messages, etc.
        // This would require searching through all entities that reference this file
      }

      return this.createSuccessResult({
        id,
        object: 'file',
        deleted
      });
    } catch (error) {
      console.error(`Error in delete file:`, error);
      return this.createErrorResult(
        `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_ERROR'
      );
    }
  }

  /**
   * List files with filtering and pagination
   */
  async list(options: { purpose?: string; limit?: number } = {}): Promise<ServiceResult<{ data: File[]; object: string }>> {
    try {
      // TODO: Implement proper file listing with filtering
      // For now, return empty list as placeholder
      const files: File[] = [];

      return this.createSuccessResult({
        data: files,
        object: 'list'
      });
    } catch (error) {
      console.error(`Error in list files:`, error);
      return this.createErrorResult(
        `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * Check if file exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      return await this.storage.files.exists(id);
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }

  /**
   * Check if file has expired
   */
  private isExpired(file: File): boolean {
    return Date.now() / 1000 > file.expires_at;
  }

  /**
   * Extract metadata from uploaded file
   */
  private async extractFileMetadata(fileData: any): Promise<{ filename: string; size: number; contentType?: string }> {
    // In a real implementation, this would extract metadata from the uploaded file
    // For now, return placeholder data
    return {
      filename: fileData?.name || 'unknown_file',
      size: fileData?.size || 0,
      contentType: fileData?.type
    };
  }

  /**
   * Validate file upload request
   */
  private validateUpload(data: UploadFileRequestType): ValidationResult {
    const errors: string[] = [];

    if (!data.file) {
      errors.push('File is required');
    } else {
      // In real implementation, validate file size, type, etc.
      const file = data.file as any;

      if (file.size < this.MIN_FILE_SIZE) {
        errors.push(`File size must be at least ${this.MIN_FILE_SIZE} byte`);
      }

      if (file.size > this.MAX_FILE_SIZE) {
        errors.push(`File size must not exceed ${this.MAX_FILE_SIZE} bytes`);
      }

      // Validate file type for assistants
      if (data.purpose === 'assistants') {
        const allowedTypes = [
          'text/plain',
          'text/markdown',
          'application/pdf',
          'application/json',
          'text/csv',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (file.type && !allowedTypes.includes(file.type)) {
          errors.push(`File type '${file.type}' is not supported for assistants. Supported types: ${allowedTypes.join(', ')}`);
        }
      }
    }

    if (data.purpose !== 'assistants') {
      errors.push('Only "assistants" purpose is currently supported');
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Clean up expired files (for background processing)
   */
  async cleanupExpiredFiles(): Promise<ServiceResult<{ deleted: number }>> {
    try {
      // TODO: Implement batch cleanup of expired files
      // This would require scanning all files and removing expired ones
      // For now, return placeholder
      return this.createSuccessResult({ deleted: 0 });
    } catch (error) {
      console.error(`Error in cleanup expired files:`, error);
      return this.createErrorResult(
        `Failed to cleanup expired files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CLEANUP_ERROR'
      );
    }
  }

  /**
   * Update file status
   */
  async updateStatus(id: string, status: FileStatus, statusDetails?: string): Promise<ServiceResult<File>> {
    try {
      // Get current file
      const currentResult = await this.getById(id);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Update status
      const updated: File = {
        ...current,
        status,
        status_details: statusDetails
      };

      // Store updated metadata
      await this.storage.files.putMetadata(updated);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${id}`, updated, this.CACHE_TTL);

      return this.createSuccessResult(updated);
    } catch (error) {
      console.error(`Error in update file status:`, error);
      return this.createErrorResult(
        `Failed to update file status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_STATUS_ERROR'
      );
    }
  }
}