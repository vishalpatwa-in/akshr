import type { Tool, Assistant } from '../models';
import type { ValidationResult, IdGenerator, BusinessRules, ServiceResult, CacheService, PaginationMeta } from './types';

/**
 * Generate a UUID-like string for Cloudflare Workers
 */
function generateUUID(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

/**
 * Default ID generator using crypto.getRandomValues
 */
export class DefaultIdGenerator implements IdGenerator {
  generateAssistantId(): string {
    return `asst_${generateUUID()}`;
  }

  generateThreadId(): string {
    return `thread_${generateUUID()}`;
  }

  generateMessageId(): string {
    return `msg_${generateUUID()}`;
  }

  generateRunId(): string {
    return `run_${generateUUID()}`;
  }

  generateFileId(): string {
    return `file_${generateUUID()}`;
  }
}

/**
 * Business rules validator implementation
 */
export class DefaultBusinessRules implements BusinessRules {
  private readonly supportedModels = [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp'
  ];

  private rateLimitCache = new Map<string, { count: number; resetTime: number }>();
  private readonly maxRequestsPerMinute = 60;

  validateAssistantModel(model: string): ValidationResult {
    const errors: string[] = [];

    if (!model || typeof model !== 'string') {
      errors.push('Model must be a non-empty string');
    } else if (!this.supportedModels.includes(model)) {
      errors.push(`Model '${model}' is not supported. Supported models: ${this.supportedModels.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  validateToolSchema(tool: Tool): ValidationResult {
    const errors: string[] = [];

    // Check if tool has function schema
    if (!tool.function || typeof tool.function !== 'object') {
      errors.push('Tool must have a function definition');
      return { valid: false, errors };
    }

    const func = tool.function;

    if (!func.name || typeof func.name !== 'string') {
      errors.push('Tool function name must be a non-empty string');
    }

    if (func.description !== undefined && typeof func.description !== 'string') {
      errors.push('Tool function description must be a string when provided');
    }

    if (func.parameters && typeof func.parameters === 'object') {
      // Basic parameter validation for Gemini compatibility
      const params = func.parameters as any;

      if (params.type !== 'object') {
        errors.push('Function parameters must be of type "object"');
      }

      if (params.properties && typeof params.properties === 'object') {
        for (const [propName, propDef] of Object.entries(params.properties)) {
          if (typeof propDef === 'object' && propDef !== null) {
            const prop = propDef as any;
            if (!prop.type || typeof prop.type !== 'string') {
              errors.push(`Property '${propName}' must have a valid type`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  validateResourceOwnership(resourceId: string, ownerId?: string): ValidationResult {
    const errors: string[] = [];

    if (!resourceId || typeof resourceId !== 'string') {
      errors.push('Resource ID must be a non-empty string');
    }

    // In a real implementation, you would check against a user context
    // For now, we'll assume ownership is valid if ownerId is provided
    if (ownerId !== undefined && (!ownerId || typeof ownerId !== 'string')) {
      errors.push('Owner ID must be a non-empty string when provided');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async validateRateLimit(identifier: string, operation: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const now = Date.now();
    const key = `${identifier}:${operation}`;

    const current = this.rateLimitCache.get(key) || { count: 0, resetTime: now + 60000 };

    if (now > current.resetTime) {
      // Reset the counter
      this.rateLimitCache.set(key, { count: 1, resetTime: now + 60000 });
    } else if (current.count >= this.maxRequestsPerMinute) {
      errors.push(`Rate limit exceeded for operation '${operation}'. Maximum ${this.maxRequestsPerMinute} requests per minute.`);
    } else {
      this.rateLimitCache.set(key, { count: current.count + 1, resetTime: current.resetTime });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  validateResourceRelationship(parentId: string, childId: string, type: 'thread-message' | 'assistant-run'): ValidationResult {
    const errors: string[] = [];

    if (!parentId || typeof parentId !== 'string') {
      errors.push('Parent ID must be a non-empty string');
    }

    if (!childId || typeof childId !== 'string') {
      errors.push('Child ID must be a non-empty string');
    }

    // Additional validation based on relationship type
    switch (type) {
      case 'thread-message':
        if (!parentId.startsWith('thread_')) {
          errors.push('Parent ID must be a valid thread ID');
        }
        if (!childId.startsWith('msg_')) {
          errors.push('Child ID must be a valid message ID');
        }
        break;
      case 'assistant-run':
        if (!parentId.startsWith('asst_')) {
          errors.push('Parent ID must be a valid assistant ID');
        }
        if (!childId.startsWith('run_')) {
          errors.push('Child ID must be a valid run ID');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Simple in-memory cache implementation
 * In production, you might want to use Redis or another distributed cache
 */
export class InMemoryCache implements CacheService {
  private cache = new Map<string, { value: any; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

/**
 * Utility functions for service operations
 */
export class ServiceUtils {
  static createSuccessResult<T>(data: T): ServiceResult<T> {
    return { success: true, data };
  }

  static createErrorResult(error: string, code?: string): ServiceResult {
    return { success: false, error, code };
  }

  static createValidationResult(valid: boolean, errors: string[] = []): ValidationResult {
    return { valid, errors };
  }

  static generateTimestamp(): string {
    return new Date().toISOString();
  }

  static calculatePaginationMeta<T extends { id: string }>(
    items: T[],
    requestedLimit: number,
    totalAvailable?: number
  ): PaginationMeta {
    const hasMore = totalAvailable ? items.length < totalAvailable : items.length === requestedLimit;

    return {
      hasMore,
      firstId: items.length > 0 ? items[0].id : undefined,
      lastId: items.length > 0 ? items[items.length - 1].id : undefined
    };
  }

  static sanitizeString(input: string): string {
    return input.trim().replace(/[<>\"'&]/g, '');
  }

  static validateContentSize(content: string, maxSize: number = 10 * 1024 * 1024): ValidationResult {
    const errors: string[] = [];

    if (content.length > maxSize) {
      errors.push(`Content size (${content.length} bytes) exceeds maximum allowed size (${maxSize} bytes)`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}