/**
 * Enhanced Rate Limiting System
 * Sliding window rate limiting with configurable limits and bypass logic
 */

import { APIError, ErrorFactory, ErrorType } from '../errors';
import type { Config } from '../config';
import { extractClientInfo } from '../auth';

// Rate limit storage interface
interface RateLimitEntry {
  count: number;
  windowStart: number;
  windowEnd: number;
  firstRequest: number;
  lastRequest: number;
}

// In-memory storage for rate limiting (for Cloudflare Workers)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limit configuration per endpoint
export interface RateLimitConfig {
  requests: number;
  windowMs: number;
  identifier?: string;
  bypassKey?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalRequests: number;
  windowStart: number;
  windowEnd: number;
  retryAfter?: number;
}

/**
 * Generate rate limit key
 */
export function generateRateLimitKey(
  request: Request,
  config: Config,
  customIdentifier?: string
): string {
  const clientInfo = extractClientInfo(request);
  const url = new URL(request.url);

  // Use custom identifier if provided
  if (customIdentifier) {
    return `rl:${customIdentifier}:${clientInfo.ip}`;
  }

  // Default: IP + endpoint pattern
  const endpoint = url.pathname;
  return `rl:${endpoint}:${clientInfo.ip}`;
}

/**
 * Clean up expired entries from store
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.windowEnd < now) {
      expiredKeys.push(key);
    }
  }

  expiredKeys.forEach(key => rateLimitStore.delete(key));
}

/**
 * Check rate limit with sliding window
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  currentTime: number = Date.now()
): RateLimitResult {
  const windowSize = config.windowMs;
  const maxRequests = config.requests;

  let entry = rateLimitStore.get(key);

  // Initialize entry if not exists
  if (!entry) {
    entry = {
      count: 0,
      windowStart: currentTime,
      windowEnd: currentTime + windowSize,
      firstRequest: currentTime,
      lastRequest: currentTime,
    };
  }

  // Check if current window has expired
  if (currentTime > entry.windowEnd) {
    // Start new window
    entry = {
      count: 0,
      windowStart: currentTime,
      windowEnd: currentTime + windowSize,
      firstRequest: currentTime,
      lastRequest: currentTime,
    };
  }

  // Calculate sliding window
  const timeElapsed = currentTime - entry.windowStart;
  const timeRemaining = entry.windowEnd - currentTime;

  // Calculate effective count based on sliding window
  let effectiveCount = entry.count;

  // If we're in the middle of the window, calculate proportional count
  if (timeElapsed > 0 && timeElapsed < windowSize) {
    const proportionalCount = (entry.count * (windowSize - timeElapsed)) / windowSize;
    effectiveCount = Math.floor(proportionalCount);
  }

  const allowed = effectiveCount < maxRequests;
  const remaining = Math.max(0, maxRequests - effectiveCount - 1);
  const resetTime = entry.windowEnd;

  // Update entry if request is allowed
  if (allowed) {
    entry.count++;
    entry.lastRequest = currentTime;
    rateLimitStore.set(key, entry);
  }

  return {
    allowed,
    remaining,
    resetTime,
    totalRequests: entry.count,
    windowStart: entry.windowStart,
    windowEnd: entry.windowEnd,
    retryAfter: allowed ? undefined : Math.ceil(timeRemaining / 1000),
  };
}

/**
 * Create rate limit middleware
 */
export function createRateLimitMiddleware(rateLimitConfig?: Partial<RateLimitConfig>) {
  return async (
    request: Request,
    config: Config,
    authContext?: any
  ): Promise<Response | null> => {
    // Skip rate limiting if disabled
    if (!config.ENABLE_RATE_LIMIT) {
      return null;
    }

    // Check if user has bypass permission
    const hasBypass = authContext?.scopes?.includes('bypass_rate_limit') ||
                     (rateLimitConfig?.bypassKey && request.headers.get('X-Bypass-Key') === rateLimitConfig.bypassKey);

    if (hasBypass) {
      return null; // Skip rate limiting
    }

    // Get rate limit configuration
    const finalConfig: RateLimitConfig = {
      requests: rateLimitConfig?.requests || config.RATE_LIMIT_REQUESTS,
      windowMs: rateLimitConfig?.windowMs || config.RATE_LIMIT_WINDOW_MS,
      bypassKey: rateLimitConfig?.bypassKey || config.RATE_LIMIT_BYPASS_KEY,
      identifier: rateLimitConfig?.identifier,
      skipSuccessfulRequests: rateLimitConfig?.skipSuccessfulRequests || false,
      skipFailedRequests: rateLimitConfig?.skipFailedRequests || false,
    };

    const key = generateRateLimitKey(request, config, finalConfig.identifier);
    const result = checkRateLimit(key, finalConfig);

    // Clean up expired entries periodically (every 100 requests)
    if (Math.random() < 0.01) {
      cleanupExpiredEntries();
    }

    if (!result.allowed) {
      // Create rate limit error
      const error = ErrorFactory.rateLimitExceeded(
        `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`
      );

      // Create response with rate limit headers
      const response = error.toHTTPResponse(config);
      const headers = new Headers(response.headers);

      // Add rate limit headers
      headers.set('X-RateLimit-Limit', finalConfig.requests.toString());
      headers.set('X-RateLimit-Remaining', '0');
      headers.set('X-RateLimit-Reset', result.resetTime.toString());
      headers.set('Retry-After', (result.retryAfter || 60).toString());
      headers.set('X-RateLimit-Window-Start', result.windowStart.toString());
      headers.set('X-RateLimit-Window-End', result.windowEnd.toString());

      return new Response(response.body, {
        status: 429,
        headers,
      });
    }

    return null; // Continue to next middleware
  };
}

/**
 * Add rate limit headers to successful response
 */
export function addRateLimitHeaders(
  response: Response,
  key: string,
  config: RateLimitConfig
): Response {
  const entry = rateLimitStore.get(key);
  if (!entry) return response;

  const currentTime = Date.now();
  const result = checkRateLimit(key, config, currentTime);

  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', config.requests.toString());
  headers.set('X-RateLimit-Remaining', result.remaining.toString());
  headers.set('X-RateLimit-Reset', result.resetTime.toString());
  headers.set('X-RateLimit-Window-Start', result.windowStart.toString());
  headers.set('X-RateLimit-Window-End', result.windowEnd.toString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create endpoint-specific rate limit configurations
 */
export const RateLimitConfigs = {
  // General API endpoints
  default: {
    requests: 100,
    windowMs: 60000, // 1 minute
  },

  // Chat completions - higher limit for streaming
  chatCompletions: {
    requests: 50,
    windowMs: 60000,
  },

  // File uploads - lower limit due to resource usage
  fileUploads: {
    requests: 10,
    windowMs: 60000,
  },

  // Health check - higher limit
  healthCheck: {
    requests: 1000,
    windowMs: 60000,
  },

  // Assistant management - moderate limit
  assistants: {
    requests: 50,
    windowMs: 60000,
  },

  // Thread operations - higher limit for conversations
  threads: {
    requests: 200,
    windowMs: 60000,
  },
};

/**
 * Rate limit utility functions
 */
export const RateLimitUtils = {
  /**
   * Get current rate limit status for a key
   */
  getRateLimitStatus(key: string, config: RateLimitConfig): RateLimitResult | null {
    const entry = rateLimitStore.get(key);
    if (!entry) return null;

    return checkRateLimit(key, config);
  },

  /**
   * Reset rate limit for a key
   */
  resetRateLimit(key: string): void {
    rateLimitStore.delete(key);
  },

  /**
   * Get all active rate limit entries (for monitoring)
   */
  getActiveRateLimits(): Array<{ key: string; entry: RateLimitEntry }> {
    return Array.from(rateLimitStore.entries()).map(([key, entry]) => ({
      key,
      entry,
    }));
  },

  /**
   * Clear all rate limit entries
   */
  clearAll(): void {
    rateLimitStore.clear();
  },

  /**
   * Get rate limit statistics
   */
  getStatistics(): {
    totalKeys: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(rateLimitStore.values());
    if (entries.length === 0) {
      return { totalKeys: 0, oldestEntry: null, newestEntry: null };
    }

    const timestamps = entries.map(entry => entry.firstRequest);
    return {
      totalKeys: rateLimitStore.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  },
};

export default {
  createRateLimitMiddleware,
  addRateLimitHeaders,
  checkRateLimit,
  generateRateLimitKey,
  cleanupExpiredEntries,
  RateLimitConfigs,
  RateLimitUtils,
};