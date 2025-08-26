/**
 * Comprehensive Validation Middleware System
 * Payload validation, size limits, content-type validation, and file upload handling
 */

import { z } from 'zod';
import { APIError, ErrorFactory, ErrorType } from '../errors';
import type { Config } from '../config';

// Validation result
export interface ValidationResult {
  valid: boolean;
  data?: any;
  error?: APIError;
}

// File validation result
export interface FileValidationResult {
  valid: boolean;
  files?: FileInfo[];
  error?: APIError;
}

// File information
export interface FileInfo {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

// Content type configuration
export interface ContentTypeConfig {
  allowed: string[];
  required?: boolean;
}

// Request size limits
export interface SizeLimits {
  maxBodySize: number;
  maxFileSize: number;
  maxTotalFiles: number;
}

/**
 * Parse multipart form data
 */
export async function parseMultipartFormData(
  request: Request,
  maxSize: number = 10 * 1024 * 1024
): Promise<{ fields: Record<string, string>; files: FileInfo[] } | APIError> {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return ErrorFactory.invalidContentType('Expected multipart/form-data');
    }

    const formData = await request.formData();
    const fields: Record<string, string> = {};
    const files: FileInfo[] = [];

    let totalSize = 0;

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        // Handle file
        const fileSize = value.size;
        totalSize += fileSize;

        if (totalSize > maxSize) {
          return ErrorFactory.payloadTooLarge(`Total file size exceeds ${maxSize} bytes`);
        }

        files.push({
          name: value.name,
          size: fileSize,
          type: value.type,
          lastModified: value.lastModified,
        });
      } else {
        // Handle text field
        fields[key] = value as string;
      }
    }

    return { fields, files };
  } catch (error) {
    return ErrorFactory.wrapError(error, 'Failed to parse multipart form data');
  }
}

/**
 * Validate request content type
 */
export function validateContentType(
  request: Request,
  config: ContentTypeConfig
): ValidationResult {
  const contentType = request.headers.get('Content-Type') || '';

  // Skip validation for GET/DELETE requests unless content type is required
  if ((request.method === 'GET' || request.method === 'DELETE') && !config.required) {
    return { valid: true };
  }

  if (!contentType && config.required) {
    return {
      valid: false,
      error: ErrorFactory.invalidContentType('Content-Type header is required'),
    };
  }

  const isAllowed = config.allowed.some(allowedType => {
    if (allowedType === 'multipart/form-data') {
      return contentType.includes('multipart/form-data');
    }
    return contentType.includes(allowedType);
  });

  if (!isAllowed) {
    return {
      valid: false,
      error: ErrorFactory.invalidContentType(
        `Content-Type must be one of: ${config.allowed.join(', ')}`
      ),
    };
  }

  return { valid: true };
}

/**
 * Validate request size
 */
export function validateRequestSize(
  request: Request,
  limits: SizeLimits
): ValidationResult {
  const contentLength = request.headers.get('Content-Length');

  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size)) {
      return {
        valid: false,
        error: ErrorFactory.validationError('Invalid Content-Length header'),
      };
    }

    if (size > limits.maxBodySize) {
      return {
        valid: false,
        error: ErrorFactory.payloadTooLarge(
          `Request size ${size} exceeds maximum allowed size ${limits.maxBodySize}`
        ),
      };
    }
  }

  return { valid: true };
}

/**
 * Validate file uploads
 */
export function validateFileUploads(
  files: FileInfo[],
  config: Config
): FileValidationResult {
  const maxFileSize = config.MAX_FILE_SIZE;
  const allowedTypes = config.ALLOWED_FILE_TYPES.split(',').map(type => type.trim());

  // Check total number of files
  if (files.length > 10) { // Default max 10 files
    return {
      valid: false,
      error: ErrorFactory.fileUploadError('Too many files. Maximum 10 files allowed.'),
    };
  }

  // Validate each file
  for (const file of files) {
    // Check file size
    if (file.size > maxFileSize) {
      return {
        valid: false,
        error: ErrorFactory.fileUploadError(
          `File "${file.name}" size ${file.size} exceeds maximum allowed size ${maxFileSize}`,
          { file: file.name, size: file.size, maxSize: maxFileSize }
        ),
      };
    }

    // Check file type
    const isAllowedType = allowedTypes.some(allowedType => {
      if (allowedType === 'image/*') {
        return file.type.startsWith('image/');
      }
      if (allowedType === 'text/*') {
        return file.type.startsWith('text/') || file.type === 'application/json';
      }
      return file.type === allowedType;
    });

    if (!isAllowedType) {
      return {
        valid: false,
        error: ErrorFactory.fileUploadError(
          `File type "${file.type}" not allowed for file "${file.name}"`,
          { file: file.name, type: file.type, allowedTypes }
        ),
      };
    }

    // Additional security checks
    if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
      return {
        valid: false,
        error: ErrorFactory.fileUploadError(
          `Invalid file name: "${file.name}". File names cannot contain path separators.`,
          { file: file.name }
        ),
      };
    }
  }

  return { valid: true, files };
}

/**
 * Create payload validation middleware
 */
export function createPayloadValidationMiddleware(
  schema: z.ZodSchema,
  options: {
    contentTypes?: string[];
    sizeLimits?: Partial<SizeLimits>;
    skipValidation?: boolean;
  } = {}
) {
  return async (request: Request, config: Config): Promise<ValidationResult | APIError> => {
    if (options.skipValidation) {
      return { valid: true };
    }

    // Set default options
    const contentTypes = options.contentTypes || ['application/json'];
    const sizeLimits: SizeLimits = {
      maxBodySize: options.sizeLimits?.maxBodySize || config.MAX_REQUEST_SIZE,
      maxFileSize: options.sizeLimits?.maxFileSize || config.MAX_FILE_SIZE,
      maxTotalFiles: options.sizeLimits?.maxTotalFiles || 10,
    };

    // Validate content type
    const contentTypeValidation = validateContentType(request, {
      allowed: contentTypes,
      required: request.method !== 'GET' && request.method !== 'DELETE',
    });

    if (!contentTypeValidation.valid) {
      return contentTypeValidation.error!;
    }

    // Validate request size
    const sizeValidation = validateRequestSize(request, sizeLimits);
    if (!sizeValidation.valid) {
      return sizeValidation.error!;
    }

    // Handle different content types
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data
      const parsed = await parseMultipartFormData(request, sizeLimits.maxBodySize);
      if (parsed instanceof APIError) {
        return parsed;
      }

      // Validate file uploads if present
      if (parsed.files && parsed.files.length > 0) {
        const fileValidation = validateFileUploads(parsed.files, config);
        if (!fileValidation.valid) {
          return fileValidation.error!;
        }
      }

      // Validate form fields with schema
      try {
        const validatedData = schema.parse(parsed.fields);
        return { valid: true, data: Object.assign({}, validatedData, { files: parsed.files }) };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return ErrorFactory.validationError(
            'Form validation failed',
            error.issues,
            error.issues[0]?.path?.join('.')
          );
        }
        return ErrorFactory.wrapError(error, 'Form validation failed');
      }
    } else if (contentType.includes('application/json') || !contentType) {
      // Handle JSON payload
      if (request.method === 'GET' || request.method === 'DELETE') {
        // For GET/DELETE, validate query parameters
        const url = new URL(request.url);
        const queryParams = Object.fromEntries(url.searchParams.entries());

        try {
          const validatedData = schema.parse(queryParams);
          return { valid: true, data: validatedData };
        } catch (error) {
          if (error instanceof z.ZodError) {
            return ErrorFactory.validationError(
              'Query parameter validation failed',
              error.issues,
              error.issues[0]?.path?.join('.')
            );
          }
          return ErrorFactory.wrapError(error, 'Query parameter validation failed');
        }
      } else {
        // For POST/PUT, validate request body
        try {
          const body = await request.json();
          const validatedData = schema.parse(body);
          return { valid: true, data: validatedData };
        } catch (error) {
          if (error instanceof z.ZodError) {
            return ErrorFactory.validationError(
              'Request body validation failed',
              error.issues,
              error.issues[0]?.path?.join('.')
            );
          }
          return ErrorFactory.wrapError(error, 'Request body validation failed');
        }
      }
    }

    return { valid: true };
  };
}

/**
 * Create response validation middleware
 */
export function createResponseValidationMiddleware(schema: z.ZodSchema) {
  return async (response: any, config: Config): Promise<ValidationResult> => {
    try {
      const validatedResponse = schema.parse(response);
      return { valid: true, data: validatedResponse };
    } catch (error) {
      if (error instanceof z.ZodError) {
        if (config.EXPOSE_ERROR_DETAILS) {
          return {
            valid: false,
            error: ErrorFactory.internalError(
              'Response validation failed',
              new Error(`Response schema validation failed: ${error.message}`)
            ),
          };
        } else {
          return {
            valid: false,
            error: ErrorFactory.internalError('Response validation failed'),
          };
        }
      }

      return {
        valid: false,
        error: ErrorFactory.wrapError(error, 'Response validation failed'),
      };
    }
  };
}

/**
 * Input sanitization utilities
 */
export const SanitizationUtils = {
  /**
   * Sanitize string input
   */
  sanitizeString(input: string): string {
    if (typeof input !== 'string') return '';

    return input
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  },

  /**
   * Sanitize object recursively
   */
  sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  },

  /**
   * Sanitize filename
   */
  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove dangerous characters
      .replace(/^\.+/, '') // Remove leading dots
      .replace(/\.+$/, '') // Remove trailing dots
      .trim();
  },
};

/**
 * Business rule validation utilities
 */
export const BusinessRuleUtils = {
  /**
   * Validate email format (basic)
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  /**
   * Validate URL format
   */
  validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Validate resource ownership
   */
  validateOwnership(resourceId: string, userId: string): Promise<boolean> {
    // This would typically check against a database
    // For now, return true (implement actual ownership check as needed)
    return Promise.resolve(true);
  },

  /**
   * Validate rate limits for specific operations
   */
  validateOperationLimits(operation: string, userId: string): Promise<boolean> {
    // This would check operation-specific rate limits
    // For now, return true (implement as needed)
    return Promise.resolve(true);
  },
};

export default {
  createPayloadValidationMiddleware,
  createResponseValidationMiddleware,
  parseMultipartFormData,
  validateContentType,
  validateRequestSize,
  validateFileUploads,
  SanitizationUtils,
  BusinessRuleUtils,
};