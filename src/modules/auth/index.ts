/**
 * Enhanced Authorization System
 * Bearer token authentication with secure token handling
 */

import { z } from 'zod';
import { APIError, ErrorFactory, ErrorType } from '../errors';
import type { Config } from '../config';

// Authentication token schema
const AuthTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  type: z.literal('Bearer'),
});

export type AuthToken = z.infer<typeof AuthTokenSchema>;

// Authentication context
export interface AuthContext {
  token: string;
  userId?: string;
  scopes?: string[];
  metadata?: Record<string, any>;
  authenticated: boolean;
}

// Authorization middleware options
export interface AuthMiddlewareOptions {
  required?: boolean;
  scopes?: string[];
  bypassHeader?: string;
}

/**
 * Parse authorization header
 */
export function parseAuthHeader(authHeader: string | null): AuthToken | null {
  if (!authHeader) return null;

  // Support Bearer token format
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    return { token, type: 'Bearer' };
  }

  // Support raw token (legacy support)
  if (authHeader && !authHeader.includes(' ')) {
    return { token: authHeader.trim(), type: 'Bearer' };
  }

  return null;
}

/**
 * Validate authentication token
 */
export function validateAuthToken(
  token: AuthToken | null,
  config: Config
): { valid: boolean; context?: AuthContext; error?: APIError } {
  if (!token) {
    return {
      valid: false,
      error: ErrorFactory.authenticationError('Missing authentication token'),
    };
  }

  // Simple token validation - compare with API key from config
  if (token.token === config.API_KEY) {
    return {
      valid: true,
      context: {
        token: token.token,
        authenticated: true,
        scopes: ['read', 'write', 'admin'], // Default scopes for API key
        metadata: {
          type: 'api_key',
          issued_at: new Date().toISOString(),
        },
      },
    };
  }

  // Check for bypass key if configured
  if (config.RATE_LIMIT_BYPASS_KEY && token.token === config.RATE_LIMIT_BYPASS_KEY) {
    return {
      valid: true,
      context: {
        token: token.token,
        authenticated: true,
        scopes: ['read', 'write', 'admin', 'bypass_rate_limit'],
        metadata: {
          type: 'bypass_key',
          issued_at: new Date().toISOString(),
        },
      },
    };
  }

  return {
    valid: false,
    error: ErrorFactory.authenticationError('Invalid authentication token'),
  };
}

/**
 * Check if request has required scopes
 */
export function checkScopes(
  context: AuthContext,
  requiredScopes?: string[]
): { authorized: boolean; error?: APIError } {
  if (!requiredScopes || requiredScopes.length === 0) {
    return { authorized: true };
  }

  if (!context.scopes) {
    return {
      authorized: false,
      error: ErrorFactory.authorizationError('No scopes available for authorization check'),
    };
  }

  const hasAllScopes = requiredScopes.every(scope =>
    context.scopes!.includes(scope)
  );

  if (!hasAllScopes) {
    return {
      authorized: false,
      error: ErrorFactory.authorizationError(
        `Missing required scopes: ${requiredScopes.join(', ')}`
      ),
    };
  }

  return { authorized: true };
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  return async (request: Request, config: Config): Promise<AuthContext | APIError> => {
    const authHeader = request.headers.get('Authorization');
    const authToken = parseAuthHeader(authHeader);

    // Check if authentication is required
    if (!options.required && !authToken) {
      return {
        token: '',
        authenticated: false,
        scopes: [],
        metadata: { type: 'anonymous' },
      };
    }

    // Validate token
    const validation = validateAuthToken(authToken, config);
    if (!validation.valid) {
      return validation.error!;
    }

    const context = validation.context!;

    // Check scopes if required
    if (options.scopes && options.scopes.length > 0) {
      const scopeCheck = checkScopes(context, options.scopes);
      if (!scopeCheck.authorized) {
        return scopeCheck.error!;
      }
    }

    // Check for bypass header
    if (options.bypassHeader) {
      const bypassValue = request.headers.get(options.bypassHeader);
      if (bypassValue && config.RATE_LIMIT_BYPASS_KEY === bypassValue) {
        context.scopes = context.scopes || [];
        context.scopes.push('bypass_rate_limit');
      }
    }

    return context;
  };
}

/**
 * Extract client information for logging
 */
export function extractClientInfo(request: Request): {
  ip: string;
  userAgent?: string;
  country?: string;
  city?: string;
} {
  // Cloudflare specific headers
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For') ||
             request.headers.get('X-Real-IP') ||
             'unknown';

  const userAgent = request.headers.get('User-Agent') || undefined;
  const country = request.headers.get('CF-IPCountry') || undefined;
  const city = request.headers.get('CF-Ray') ? undefined : undefined; // CF doesn't provide city directly

  return { ip, userAgent, country, city };
}

/**
 * Create secure authentication middleware with detailed logging
 */
export function createSecureAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  return async (request: Request, config: Config): Promise<AuthContext | APIError> => {
    const startTime = Date.now();
    const clientInfo = extractClientInfo(request);

    try {
      // Perform authentication
      const result = await createAuthMiddleware(options)(request, config);

      // Log authentication attempt
      if (config.LOG_REQUESTS) {
        const logData = {
          authenticated: result instanceof APIError ? false : result.authenticated,
          client_ip: clientInfo.ip,
          user_agent: clientInfo.userAgent,
          country: clientInfo.country,
          duration_ms: Date.now() - startTime,
          path: new URL(request.url).pathname,
          method: request.method,
          success: !(result instanceof APIError),
        };

        console.log(`[AUTH] ${request.method} ${new URL(request.url).pathname}`, logData);
      }

      return result;
    } catch (error) {
      // Log authentication failure
      if (config.LOG_REQUESTS) {
        console.error(`[AUTH] Authentication error:`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          client_ip: clientInfo.ip,
          path: new URL(request.url).pathname,
          method: request.method,
          duration_ms: Date.now() - startTime,
        });
      }

      return ErrorFactory.wrapError(error, 'Authentication failed');
    }
  };
}

/**
 * Utility functions for authorization
 */
export const AuthUtils = {
  /**
   * Check if context has specific scope
   */
  hasScope(context: AuthContext, scope: string): boolean {
    return context.scopes?.includes(scope) ?? false;
  },

  /**
   * Check if context has any of the specified scopes
   */
  hasAnyScope(context: AuthContext, scopes: string[]): boolean {
    if (!context.scopes) return false;
    return scopes.some(scope => context.scopes!.includes(scope));
  },

  /**
   * Check if context has all specified scopes
   */
  hasAllScopes(context: AuthContext, scopes: string[]): boolean {
    if (!context.scopes) return false;
    return scopes.every(scope => context.scopes!.includes(scope));
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(context: AuthContext): boolean {
    return context.authenticated;
  },

  /**
   * Get user ID from context
   */
  getUserId(context: AuthContext): string | undefined {
    return context.userId;
  },

  /**
   * Create anonymous context
   */
  createAnonymousContext(): AuthContext {
    return {
      token: '',
      authenticated: false,
      scopes: [],
      metadata: { type: 'anonymous' },
    };
  },

  /**
   * Sanitize token for logging (show only first/last 4 characters)
   */
  sanitizeToken(token: string): string {
    if (token.length <= 8) return '*'.repeat(token.length);
    return token.substring(0, 4) + '*'.repeat(token.length - 8) + token.substring(token.length - 4);
  },
};

export default {
  createAuthMiddleware,
  createSecureAuthMiddleware,
  parseAuthHeader,
  validateAuthToken,
  checkScopes,
  extractClientInfo,
  AuthUtils,
};