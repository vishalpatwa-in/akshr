/**
 * Enhanced Middleware for OpenAI Assistant API Router
 * Provides comprehensive security, validation, rate limiting, and monitoring
 */

import { z } from 'zod';
import type { Env } from '../../index';
import { createErrorResponse } from '../r2-helpers';

// Import enhanced systems
import { loadConfig, type Config } from '../config';
import { APIError, ErrorFactory, ErrorUtils } from '../errors';
import { createSecureAuthMiddleware, type AuthContext } from '../auth';
import { createRateLimitMiddleware } from '../rate-limit';
import { createPayloadValidationMiddleware } from '../validation';
import { createSecurityMiddleware, addCORSHeaders } from '../security';
import { createRequestLoggingMiddleware, createHealthCheckHandler, createMetricsHandler } from '../monitoring';

// Extended environment interface
interface ExtendedEnv extends Env {
  [key: string]: any;
}

// Middleware context
interface MiddlewareContext {
  config: Config;
  auth: AuthContext;
  startTime: number;
  correlationId: string;
}

// Enhanced authentication middleware
export const authMiddleware = async (request: Request, env: ExtendedEnv, params: Record<string, string>): Promise<Response | null> => {
  const config = loadConfig(env);
  const secureAuthMiddleware = createSecureAuthMiddleware({ required: true });

  const authResult = await secureAuthMiddleware(request, config);

  if (authResult instanceof APIError) {
    return authResult.toHTTPResponse(config);
  }

  // Store auth context in request for later use
  (request as any).authContext = authResult;
  return null; // Continue to next middleware
};

// Rate limiting middleware (simple in-memory implementation)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export const rateLimitMiddleware = (maxRequests: number = 100, windowMs: number = 60000) =>
  async (request: Request, env: Env, params: Record<string, string>) => {
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `${clientIP}:${new Date().getMinutes()}`;

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;

    const current = rateLimitStore.get(key) || { count: 0, resetTime: windowEnd };

    // Reset if window has passed
    if (now > current.resetTime) {
      current.count = 0;
      current.resetTime = windowEnd;
    }

    current.count++;
    rateLimitStore.set(key, current);

    // Set rate limit headers
    const resetTime = Math.ceil((current.resetTime - now) / 1000);

    if (current.count > maxRequests) {
      const response = new Response(JSON.stringify({
        error: { message: 'Rate limit exceeded' }
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });

      response.headers.set('X-RateLimit-Limit', maxRequests.toString());
      response.headers.set('X-RateLimit-Remaining', '0');
      response.headers.set('X-RateLimit-Reset', current.resetTime.toString());
      response.headers.set('Retry-After', resetTime.toString());

      return response;
    }

    // Add rate limit headers to successful requests
    // This will be handled by the main handler

    return null; // Continue
  };

// Request logging middleware
export const loggingMiddleware = async (request: Request, env: Env, params: Record<string, string>) => {
  const start = Date.now();
  const url = new URL(request.url);
  console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}`);

  // Continue to handler, we'll log the response when it comes back
  return null;
};

// Content type validation middleware
export const contentTypeMiddleware = (allowedTypes: string[]) =>
  async (request: Request, env: Env, params: Record<string, string>) => {
    const contentType = request.headers.get('Content-Type') || '';

    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const isAllowed = allowedTypes.some(type =>
        contentType.includes(type) || (type === 'multipart/form-data' && contentType.includes('multipart'))
      );

      if (!isAllowed) {
        return new Response(JSON.stringify({
          error: { message: `Content-Type must be one of: ${allowedTypes.join(', ')}` }
        }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return null;
  };

// Request validation middleware
export const validationMiddleware = (schema: z.ZodSchema) =>
  async (request: Request, env: Env, params: Record<string, string>) => {
    try {
      if (request.method === 'GET' || request.method === 'DELETE') {
        // For GET/DELETE, validate query parameters
        const url = new URL(request.url);
        const queryParams = Object.fromEntries(url.searchParams.entries());
        schema.parse(queryParams);
      } else {
        // For POST/PUT, validate request body
        const body = await request.json();
        schema.parse(body);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return new Response(JSON.stringify({
          error: {
            message: 'Validation failed',
            details: error.issues
          }
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: { message: 'Invalid request format' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return null;
  };

// CORS middleware
export const corsMiddleware = async (request: Request, env: Env, params: Record<string, string>) => {
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  return null;
};

// Error handling wrapper
export const errorHandler = (handler: Function) =>
  async (request: Request, env: Env, params: Record<string, string>) => {
    try {
      return await handler(request, env, params);
    } catch (error) {
      console.error('Handler error:', error);

      if (error instanceof z.ZodError) {
        return new Response(JSON.stringify({
          error: {
            message: 'Validation error',
            details: error.issues
          }
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: { message: 'Internal server error' }
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

// Utility to add CORS headers to responses
export const addCorsHeaders = (response: Response): Response => {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return newResponse;
};

// Enhanced middleware that combines all security features
export const createEnhancedMiddleware = (env: ExtendedEnv) => {
  const config = loadConfig(env);

  return {
    // Authentication middleware
    auth: authMiddleware,

    // Rate limiting middleware
    rateLimit: createRateLimitMiddleware(),

    // Request validation middleware factory
    validatePayload: (schema: z.ZodSchema) => createPayloadValidationMiddleware(schema),

    // Security middleware
    security: createSecurityMiddleware(config),

    // Request logging
    logging: createRequestLoggingMiddleware(config),

    // Health check handler
    healthCheck: createHealthCheckHandler(config),

    // Metrics handler
    metrics: createMetricsHandler(config),
  };
};