/**
 * Admin Authentication Middleware for GC Operations
 * Provides secure access control for garbage collection endpoints
 */

import { validateGCTriggerRequest } from './index';

/**
 * Admin authentication middleware for GC operations
 * @param request - The incoming request
 * @param env - Environment variables
 * @returns Response if authentication fails, null if successful
 */
export async function gcAuthMiddleware(
  request: Request,
  env: { GC_ADMIN_KEY?: string }
): Promise<Response | null> {
  try {
    // Only allow POST requests for GC operations
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({
          error: { message: 'Method not allowed. Use POST for GC operations.' }
        }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Check if GC admin key is configured
    if (!env.GC_ADMIN_KEY) {
      return new Response(
        JSON.stringify({
          error: { message: 'GC admin authentication not configured.' }
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse request body
    let requestBody: any;
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        requestBody = await request.json();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        requestBody = Object.fromEntries(formData.entries());
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        requestBody = Object.fromEntries(formData.entries());
      } else {
        // Try to parse as JSON by default
        try {
          requestBody = await request.json();
        } catch {
          requestBody = {};
        }
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid request body format.' }
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate admin key
    const adminKey = requestBody.adminKey ||
                    request.headers.get('x-gc-admin-key') ||
                    request.headers.get('authorization')?.replace('Bearer ', '');

    if (!adminKey) {
      return new Response(
        JSON.stringify({
          error: { message: 'Admin key required. Provide adminKey in request body, or X-GC-Admin-Key header, or Authorization header.' }
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (adminKey !== env.GC_ADMIN_KEY) {
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid admin key.' }
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate request structure if it's a GC trigger request
    if (requestBody && typeof requestBody === 'object') {
      const triggerRequest = requestBody as any;
      triggerRequest.adminKey = adminKey; // Ensure admin key is set

      const validation = validateGCTriggerRequest(triggerRequest);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Invalid request parameters.',
              details: validation.errors
            }
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Authentication successful
    return null;

  } catch (error) {
    console.error('GC authentication error:', error);
    return new Response(
      JSON.stringify({
        error: { message: 'Authentication service error.' }
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Create authenticated GC handler wrapper
 * @param handler - The GC handler function
 * @returns Wrapped handler with authentication
 */
export function withGCAuth<T extends any[]>(
  handler: (request: Request, env: any, ...args: T) => Promise<Response>
) {
  return async (request: Request, env: any, ...args: T): Promise<Response> => {
    // Run authentication middleware
    const authResult = await gcAuthMiddleware(request, env);
    if (authResult) {
      return authResult; // Authentication failed
    }

    // Authentication successful, proceed with handler
    return handler(request, env, ...args);
  };
}

/**
 * Rate limiting middleware for GC operations
 * @param maxRequestsPerHour - Maximum requests per hour
 * @returns Middleware function
 */
export function createGCRateLimitMiddleware(maxRequestsPerHour: number = 10) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return async (request: Request): Promise<Response | null> => {
    const clientIP = request.headers.get('cf-connecting-ip') ||
                    request.headers.get('x-forwarded-for') ||
                    'unknown';
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    const resetTime = now + windowMs;

    const clientRequests = requests.get(clientIP) || { count: 0, resetTime };

    // Reset if window has passed
    if (now > clientRequests.resetTime) {
      clientRequests.count = 0;
      clientRequests.resetTime = resetTime;
    }

    // Check rate limit
    if (clientRequests.count >= maxRequestsPerHour) {
      const resetIn = Math.ceil((clientRequests.resetTime - now) / 1000);
      return new Response(
        JSON.stringify({
          error: {
            message: 'Rate limit exceeded. Too many GC requests.',
            retryAfter: resetIn
          }
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': resetIn.toString(),
            'X-RateLimit-Limit': maxRequestsPerHour.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(clientRequests.resetTime).toISOString()
          }
        }
      );
    }

    // Increment counter
    clientRequests.count++;
    requests.set(clientIP, clientRequests);

    return null; // Rate limit not exceeded
  };
}

/**
 * Security headers middleware for GC endpoints
 * @returns Middleware function
 */
export function createGCSecurityHeadersMiddleware() {
  return (response: Response): Response => {
    const newHeaders = new Headers(response.headers);

    // Security headers
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'DENY');
    newHeaders.set('X-XSS-Protection', '1; mode=block');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // CORS headers for GC endpoints
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, X-GC-Admin-Key, Authorization');
    newHeaders.set('Access-Control-Max-Age', '86400'); // 24 hours

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  };
}

/**
 * Combined GC middleware with authentication, rate limiting, and security headers
 * @param env - Environment variables
 * @returns Middleware function
 */
export function createGCCompleteMiddleware(env: { GC_ADMIN_KEY?: string }) {
  const rateLimitMiddleware = createGCRateLimitMiddleware();
  const securityHeadersMiddleware = createGCSecurityHeadersMiddleware();

  return async (request: Request): Promise<{ response: Response } | null> => {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return {
        response: new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-GC-Admin-Key, Authorization',
            'Access-Control-Max-Age': '86400'
          }
        })
      };
    }

    // Apply rate limiting
    const rateLimitResult = await rateLimitMiddleware(request);
    if (rateLimitResult) {
      return { response: securityHeadersMiddleware(rateLimitResult) };
    }

    // Apply authentication
    const authResult = await gcAuthMiddleware(request, env);
    if (authResult) {
      return { response: securityHeadersMiddleware(authResult) };
    }

    return null; // All middleware passed
  };
}