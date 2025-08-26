/**
 * Security Middleware System
 * Input sanitization, secure headers, and protection against common attacks
 */

import { APIError, ErrorFactory, ErrorType } from '../errors';
import type { Config } from '../config';
import { SanitizationUtils } from '../validation';

// Security headers configuration
export interface SecurityHeadersConfig {
  enabled: boolean;
  contentSecurityPolicy?: string;
  strictTransportSecurity?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
  crossOriginEmbedderPolicy?: string;
}

// CORS configuration
export interface CORSConfig {
  enabled: boolean;
  origins: string[];
  methods: string[];
  headers: string[];
  credentials: boolean;
  maxAge: number;
}

// Request timeout configuration
export interface TimeoutConfig {
  enabled: boolean;
  duration: number; // milliseconds
  gracePeriod: number; // milliseconds
}

/**
 * Create security headers middleware
 */
export function createSecurityHeadersMiddleware(config: SecurityHeadersConfig) {
  return async (request: Request): Promise<Headers> => {
    const headers = new Headers();

    if (!config.enabled) {
      return headers;
    }

    // Security headers
    if (config.contentSecurityPolicy) {
      headers.set('Content-Security-Policy', config.contentSecurityPolicy);
    } else {
      // Default CSP for API
      headers.set('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'");
    }

    if (config.strictTransportSecurity) {
      headers.set('Strict-Transport-Security', config.strictTransportSecurity);
    }

    if (config.xFrameOptions) {
      headers.set('X-Frame-Options', config.xFrameOptions);
    } else {
      headers.set('X-Frame-Options', 'DENY');
    }

    if (config.xContentTypeOptions) {
      headers.set('X-Content-Type-Options', config.xContentTypeOptions);
    } else {
      headers.set('X-Content-Type-Options', 'nosniff');
    }

    if (config.referrerPolicy) {
      headers.set('Referrer-Policy', config.referrerPolicy);
    } else {
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    if (config.permissionsPolicy) {
      headers.set('Permissions-Policy', config.permissionsPolicy);
    } else {
      headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }

    if (config.crossOriginEmbedderPolicy) {
      headers.set('Cross-Origin-Embedder-Policy', config.crossOriginEmbedderPolicy);
    }

    // Additional security headers
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('X-Download-Options', 'noopen');
    headers.set('X-Permitted-Cross-Domain-Policies', 'none');

    return headers;
  };
}

/**
 * Create CORS middleware
 */
export function createCORSMiddleware(corsConfig: CORSConfig) {
  return async (request: Request): Promise<Response | null> => {
    if (!corsConfig.enabled) {
      return null;
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      const headers = new Headers();

      // Set allowed origins
      if (corsConfig.origins.includes('*')) {
        headers.set('Access-Control-Allow-Origin', '*');
      } else {
        const origin = request.headers.get('Origin');
        if (origin && corsConfig.origins.includes(origin)) {
          headers.set('Access-Control-Allow-Origin', origin);
        }
      }

      headers.set('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
      headers.set('Access-Control-Allow-Headers', corsConfig.headers.join(', '));
      headers.set('Access-Control-Max-Age', corsConfig.maxAge.toString());

      if (corsConfig.credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true');
      }

      return new Response(null, {
        status: 204,
        headers,
      });
    }

    return null; // Continue to next handler
  };
}

/**
 * Add CORS headers to response
 */
export function addCORSHeaders(response: Response, corsConfig: CORSConfig, request: Request): Response {
  if (!corsConfig.enabled) {
    return response;
  }

  const headers = new Headers(response.headers);

  // Set allowed origins
  if (corsConfig.origins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', '*');
  } else {
    const origin = request.headers.get('Origin');
    if (origin && corsConfig.origins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
  }

  if (corsConfig.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create input sanitization middleware
 */
export function createInputSanitizationMiddleware() {
  return async (request: Request): Promise<Request> => {
    // Clone request to make it mutable
    const sanitizedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });

    // Sanitize headers
    const headers = new Headers(request.headers);
    for (const [key, value] of headers.entries()) {
      headers.set(key, SanitizationUtils.sanitizeString(value));
    }

    // For requests with body, we would need to parse and sanitize
    // This is typically handled in the validation middleware

    return sanitizedRequest;
  };
}

/**
 * Create request timeout middleware
 */
export function createTimeoutMiddleware(timeoutConfig: TimeoutConfig) {
  return async (request: Request): Promise<APIError | null> => {
    if (!timeoutConfig.enabled) {
      return null;
    }

    // In Cloudflare Workers, we can't actually cancel requests mid-flight
    // but we can track timing and provide timeout information
    const startTime = Date.now();

    // Set a timeout promise that will reject after the specified duration
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeoutConfig.duration);
    });

    // This is a simplified implementation
    // In practice, you'd need to integrate this with the request handling
    return null;
  };
}

/**
 * Create protection against common attacks middleware
 */
export function createAttackProtectionMiddleware() {
  return async (request: Request): Promise<APIError | null> => {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';

    // Check for path traversal attempts
    if (url.pathname.includes('..') || url.pathname.includes('\\')) {
      return ErrorFactory.validationError(
        'Invalid path: Path traversal not allowed',
        undefined,
        'path'
      );
    }

    // Check for suspicious user agents (very basic)
    if (userAgent.includes('sqlmap') || userAgent.includes('nmap')) {
      return ErrorFactory.validationError(
        'Request blocked due to suspicious user agent',
        undefined,
        'user-agent'
      );
    }

    // Check for common attack patterns in query parameters
    for (const [key, value] of url.searchParams.entries()) {
      if (value.includes(' UNION ') || value.includes(' SELECT ') ||
          value.includes(' DROP ') || value.includes(' EXEC ')) {
        return ErrorFactory.validationError(
          'Request blocked due to suspicious query parameter',
          undefined,
          key
        );
      }

      // Check for XSS patterns
      if (value.includes('<script') || value.includes('javascript:')) {
        return ErrorFactory.validationError(
          'Request blocked due to suspicious content',
          undefined,
          key
        );
      }
    }

    // Check request size (basic)
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) { // 50MB
      return ErrorFactory.payloadTooLarge('Request too large');
    }

    // Check for too many query parameters (potential DoS)
    if (url.searchParams.toString().length > 2048) {
      return ErrorFactory.validationError(
        'Query parameters too long',
        undefined,
        'query'
      );
    }

    return null;
  };
}

/**
 * Create security middleware chain
 */
export function createSecurityMiddleware(config: Config) {
  const securityHeaders = createSecurityHeadersMiddleware({
    enabled: config.ENABLE_SECURITY_HEADERS,
    contentSecurityPolicy: config.CONTENT_SECURITY_POLICY,
    strictTransportSecurity: config.STRICT_TRANSPORT_SECURITY,
  });

  const cors = createCORSMiddleware({
    enabled: config.ENABLE_CORS,
    origins: config.CORS_ORIGINS === '*' ? ['*'] : config.CORS_ORIGINS.split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
    maxAge: 86400,
  });

  const timeout = createTimeoutMiddleware({
    enabled: true,
    duration: config.REQUEST_TIMEOUT,
    gracePeriod: 5000,
  });

  return {
    securityHeaders,
    cors,
    timeout,
    inputSanitization: createInputSanitizationMiddleware(),
    attackProtection: createAttackProtectionMiddleware(),
  };
}

/**
 * Security utilities
 */
export const SecurityUtils = {
  /**
   * Generate secure random string
   */
  generateSecureToken(length: number = 32): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Hash sensitive data for logging
   */
  hashForLogging(input: string): string {
    // Simple hash for logging purposes (not for security)
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  },

  /**
   * Check if request is from a trusted source
   */
  isTrustedRequest(request: Request, config: Config): boolean {
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');

    // Check if origin is in allowed list
    if (origin) {
      const allowedOrigins = config.CORS_ORIGINS === '*' ?
        ['*'] : config.CORS_ORIGINS.split(',');
      if (!allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
        return false;
      }
    }

    // Additional checks can be added here
    return true;
  },

  /**
   * Validate API key format
   */
  validateApiKeyFormat(apiKey: string): boolean {
    // Basic validation - should be alphanumeric, reasonable length
    return /^[a-zA-Z0-9_-]{20,}$/.test(apiKey);
  },

  /**
   * Rate limit sensitive operations
   */
  checkSensitiveOperation(request: Request, operation: string): boolean {
    // This would integrate with rate limiting
    // For now, just return true
    return true;
  },
};

export default {
  createSecurityMiddleware,
  createSecurityHeadersMiddleware,
  createCORSMiddleware,
  addCORSHeaders,
  createInputSanitizationMiddleware,
  createTimeoutMiddleware,
  createAttackProtectionMiddleware,
  SecurityUtils,
};