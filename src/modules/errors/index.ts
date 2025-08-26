/**
 * Enhanced Error Handling System
 * Provides consistent error responses, correlation IDs, and error tracking
 */

import { z } from 'zod';
import type { Config } from '../config';

// Error types
export enum ErrorType {
  VALIDATION_ERROR = 'validation_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  NOT_FOUND = 'not_found',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  PAYLOAD_TOO_LARGE = 'payload_too_large',
  INVALID_CONTENT_TYPE = 'invalid_content_type',
  FILE_UPLOAD_ERROR = 'file_upload_error',
  INTERNAL_ERROR = 'internal_error',
  TIMEOUT_ERROR = 'timeout_error',
  CONFIGURATION_ERROR = 'configuration_error',
}

// HTTP Status codes mapping
export const ErrorStatusMap: Record<ErrorType, number> = {
  [ErrorType.VALIDATION_ERROR]: 400,
  [ErrorType.AUTHENTICATION_ERROR]: 401,
  [ErrorType.AUTHORIZATION_ERROR]: 403,
  [ErrorType.NOT_FOUND]: 404,
  [ErrorType.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorType.PAYLOAD_TOO_LARGE]: 413,
  [ErrorType.INVALID_CONTENT_TYPE]: 415,
  [ErrorType.FILE_UPLOAD_ERROR]: 422,
  [ErrorType.TIMEOUT_ERROR]: 408,
  [ErrorType.CONFIGURATION_ERROR]: 500,
  [ErrorType.INTERNAL_ERROR]: 500,
};

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
    param: z.string().optional(),
    details: z.any().optional(),
    correlation_id: z.string(),
    timestamp: z.string(),
    path: z.string().optional(),
    method: z.string().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly param?: string;
  public readonly details?: any;
  public readonly correlationId: string;
  public readonly timestamp: string;
  public readonly path?: string;
  public readonly method?: string;
  public readonly cause?: Error;

  constructor(
    type: ErrorType,
    message: string,
    options: {
      code?: string;
      param?: string;
      details?: any;
      correlationId?: string;
      path?: string;
      method?: string;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'APIError';
    this.type = type;
    this.statusCode = ErrorStatusMap[type];
    this.code = options.code;
    this.param = options.param;
    this.details = options.details;
    this.correlationId = options.correlationId || generateCorrelationId();
    this.timestamp = new Date().toISOString();
    this.path = options.path;
    this.method = options.method;
    this.cause = options.cause;
  }

  /**
   * Convert error to response object
   */
  toResponse(config: Config): ErrorResponse {
    const isDevelopment = config.NODE_ENV === 'development';
    const exposeDetails = config.EXPOSE_ERROR_DETAILS || isDevelopment;

    const errorResponse: ErrorResponse = {
      error: {
        message: this.message,
        type: this.type,
        correlation_id: this.correlationId,
        timestamp: this.timestamp,
        ...(this.code && { code: this.code }),
        ...(this.param && { param: this.param }),
        ...(this.path && { path: this.path }),
        ...(this.method && { method: this.method }),
        ...(exposeDetails && this.details && { details: this.details }),
      },
    };

    return errorResponse;
  }

  /**
   * Create Response object from error
   */
  toHTTPResponse(config: Config): Response {
    const errorResponse = this.toResponse(config);
    const json = JSON.stringify(errorResponse);

    // Add rate limit headers for rate limit errors
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Correlation-ID': this.correlationId,
    });

    if (this.type === ErrorType.RATE_LIMIT_EXCEEDED) {
      headers.set('Retry-After', '60'); // Default retry after 60 seconds
    }

    return new Response(json, {
      status: this.statusCode,
      headers,
    });
  }
}

/**
 * Generate unique correlation ID
 */
export function generateCorrelationId(): string {
  // Use crypto.randomUUID if available, fallback to timestamp + random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create standardized error responses
 */
export const ErrorFactory = {
  validationError(message: string, details?: any, param?: string): APIError {
    return new APIError(ErrorType.VALIDATION_ERROR, message, {
      param,
      details,
      code: 'VALIDATION_FAILED',
    });
  },

  authenticationError(message: string = 'Authentication required'): APIError {
    return new APIError(ErrorType.AUTHENTICATION_ERROR, message, {
      code: 'AUTHENTICATION_FAILED',
    });
  },

  authorizationError(message: string = 'Insufficient permissions'): APIError {
    return new APIError(ErrorType.AUTHORIZATION_ERROR, message, {
      code: 'AUTHORIZATION_FAILED',
    });
  },

  notFound(resource: string, id?: string): APIError {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    return new APIError(ErrorType.NOT_FOUND, message, {
      param: id,
      code: 'RESOURCE_NOT_FOUND',
    });
  },

  rateLimitExceeded(message: string = 'Rate limit exceeded'): APIError {
    return new APIError(ErrorType.RATE_LIMIT_EXCEEDED, message, {
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },

  payloadTooLarge(message: string = 'Request payload too large'): APIError {
    return new APIError(ErrorType.PAYLOAD_TOO_LARGE, message, {
      code: 'PAYLOAD_TOO_LARGE',
    });
  },

  invalidContentType(message: string = 'Invalid content type'): APIError {
    return new APIError(ErrorType.INVALID_CONTENT_TYPE, message, {
      code: 'INVALID_CONTENT_TYPE',
    });
  },

  fileUploadError(message: string, details?: any): APIError {
    return new APIError(ErrorType.FILE_UPLOAD_ERROR, message, {
      details,
      code: 'FILE_UPLOAD_FAILED',
    });
  },

  timeoutError(message: string = 'Request timeout'): APIError {
    return new APIError(ErrorType.TIMEOUT_ERROR, message, {
      code: 'REQUEST_TIMEOUT',
    });
  },

  configurationError(message: string): APIError {
    return new APIError(ErrorType.CONFIGURATION_ERROR, message, {
      code: 'CONFIGURATION_ERROR',
    });
  },

  internalError(message: string = 'Internal server error', cause?: Error): APIError {
    return new APIError(ErrorType.INTERNAL_ERROR, message, {
      cause,
      code: 'INTERNAL_ERROR',
    });
  },

  /**
   * Wrap any error into an APIError
   */
  wrapError(error: unknown, defaultMessage: string = 'An unexpected error occurred'): APIError {
    if (error instanceof APIError) {
      return error;
    }

    if (error instanceof z.ZodError) {
      return ErrorFactory.validationError(
        'Validation failed',
        error.issues,
        error.issues[0]?.path?.join('.')
      );
    }

    if (error instanceof Error) {
      return ErrorFactory.internalError(defaultMessage, error);
    }

    return ErrorFactory.internalError(defaultMessage);
  },
};

/**
 * Error handling utilities
 */
export const ErrorUtils = {
  /**
   * Log error with context
   */
  logError(error: APIError, config: Config, request?: Request): void {
    if (!config.LOG_ERRORS) return;

    const logData = {
      correlation_id: error.correlationId,
      type: error.type,
      message: error.message,
      status_code: error.statusCode,
      timestamp: error.timestamp,
      path: error.path,
      method: error.method,
      ...(error.param && { param: error.param }),
      ...(error.code && { code: error.code }),
      ...(error.details && config.EXPOSE_ERROR_DETAILS && { details: error.details }),
      ...(error.cause && { cause: error.cause.message }),
    };

    // In Cloudflare Workers, use console methods
    const logLevel = config.LOG_LEVEL;
    const logMessage = `[${error.correlationId}] ${error.type}: ${error.message}`;

    switch (logLevel) {
      case 'debug':
        console.debug(logMessage, logData);
        break;
      case 'info':
        console.info(logMessage, logData);
        break;
      case 'warn':
        console.warn(logMessage, logData);
        break;
      case 'error':
      default:
        console.error(logMessage, logData);
        break;
    }

    // Send to error tracking service if configured
    if (config.ERROR_TRACKING_URL) {
      // TODO: Implement error tracking service integration
      // This could be Sentry, LogRocket, or custom service
    }
  },

  /**
   * Create error handler middleware
   */
  createErrorHandler(config: Config) {
    return async (error: unknown, request?: Request): Promise<Response> => {
      let apiError = ErrorFactory.wrapError(error);

      // Add request context to error by creating a new instance
      if (request) {
        const url = new URL(request.url);
        apiError = new APIError(
          apiError.type,
          apiError.message,
          {
            code: apiError.code,
            param: apiError.param,
            details: apiError.details,
            correlationId: apiError.correlationId,
            path: url.pathname,
            method: request.method,
            cause: apiError.cause,
          }
        );
      }

      // Log the error
      ErrorUtils.logError(apiError, config, request);

      // Return error response
      return apiError.toHTTPResponse(config);
    };
  },

  /**
   * Safe async handler wrapper
   */
  withErrorHandling<T extends any[], R>(
    handler: (...args: T) => Promise<R>,
    config: Config,
    request?: Request
  ) {
    return async (...args: T): Promise<R> => {
      try {
        return await handler(...args);
      } catch (error) {
        let apiError = ErrorFactory.wrapError(error);

        // Add request context to error by creating a new instance
        if (request) {
          const url = new URL(request.url);
          apiError = new APIError(
            apiError.type,
            apiError.message,
            {
              code: apiError.code,
              param: apiError.param,
              details: apiError.details,
              correlationId: apiError.correlationId,
              path: url.pathname,
              method: request.method,
              cause: apiError.cause,
            }
          );
        }

        // Log the error
        ErrorUtils.logError(apiError, config, request);

        // Re-throw as APIError for middleware to handle
        throw apiError;
      }
    };
  },
};

export default {
  APIError,
  ErrorFactory,
  ErrorUtils,
  generateCorrelationId,
  ErrorType,
  ErrorStatusMap,
};