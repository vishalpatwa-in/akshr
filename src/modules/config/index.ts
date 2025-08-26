/**
 * Configuration Management System
 * Environment-based configuration for different deployment stages
 */

import { z } from 'zod';

// Configuration schema
const ConfigSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),

  // API Configuration
  API_KEY: z.string().min(1, 'API_KEY is required'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Security Configuration
  CORS_ORIGINS: z.string().default('*'),
  MAX_REQUEST_SIZE: z.number().default(10 * 1024 * 1024), // 10MB
  REQUEST_TIMEOUT: z.number().default(30000), // 30 seconds

  // Rate Limiting
  RATE_LIMIT_REQUESTS: z.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.number().default(60000), // 1 minute
  RATE_LIMIT_BYPASS_KEY: z.string().optional(),

  // File Upload Configuration
  MAX_FILE_SIZE: z.number().default(25 * 1024 * 1024), // 25MB
  ALLOWED_FILE_TYPES: z.string().default('image/*,text/*,application/pdf,application/json'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_REQUESTS: z.boolean().default(true),
  LOG_ERRORS: z.boolean().default(true),

  // Feature Flags
  ENABLE_AUTH: z.boolean().default(true),
  ENABLE_RATE_LIMIT: z.boolean().default(true),
  ENABLE_CORS: z.boolean().default(true),
  ENABLE_REQUEST_LOGGING: z.boolean().default(true),
  ENABLE_ERROR_TRACKING: z.boolean().default(true),
  ENABLE_METRICS: z.boolean().default(true),

  // Security Headers
  ENABLE_SECURITY_HEADERS: z.boolean().default(true),
  CONTENT_SECURITY_POLICY: z.string().optional(),
  STRICT_TRANSPORT_SECURITY: z.string().default('max-age=31536000; includeSubDomains'),

  // Error Handling
  EXPOSE_ERROR_DETAILS: z.boolean().default(false),
  ERROR_TRACKING_URL: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load configuration from environment variables
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Convert Cloudflare env object to plain object
  const envVars: Record<string, string> = {};

  // Handle Cloudflare's env object
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      envVars[key] = value;
    }
  }

  try {
    const config = ConfigSchema.parse(envVars);

    // Validate critical configurations
    if (!config.API_KEY) {
      throw new Error('API_KEY is required');
    }

    if (!config.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required');
    }

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map(issue =>
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');

      throw new Error(`Configuration validation failed: ${errorMessages}`);
    }

    throw error;
  }
}

/**
 * Get default configuration for development
 */
export function getDefaultConfig(): Config {
  return {
    NODE_ENV: 'development',
    API_KEY: 'dev-api-key',
    GEMINI_API_KEY: 'dev-gemini-key',
    CORS_ORIGINS: '*',
    MAX_REQUEST_SIZE: 10 * 1024 * 1024,
    REQUEST_TIMEOUT: 30000,
    RATE_LIMIT_REQUESTS: 100,
    RATE_LIMIT_WINDOW_MS: 60000,
    MAX_FILE_SIZE: 25 * 1024 * 1024,
    ALLOWED_FILE_TYPES: 'image/*,text/*,application/pdf,application/json',
    LOG_LEVEL: 'info',
    LOG_REQUESTS: true,
    LOG_ERRORS: true,
    ENABLE_AUTH: true,
    ENABLE_RATE_LIMIT: true,
    ENABLE_CORS: true,
    ENABLE_REQUEST_LOGGING: true,
    ENABLE_ERROR_TRACKING: true,
    ENABLE_METRICS: true,
    ENABLE_SECURITY_HEADERS: true,
    STRICT_TRANSPORT_SECURITY: 'max-age=31536000; includeSubDomains',
    EXPOSE_ERROR_DETAILS: true,
  };
}

/**
 * Configuration utilities
 */
export const ConfigUtils = {
  /**
   * Get allowed origins as array
   */
  getAllowedOrigins(config: Config): string[] {
    if (config.CORS_ORIGINS === '*') {
      return ['*'];
    }
    return config.CORS_ORIGINS.split(',').map(origin => origin.trim());
  },

  /**
   * Get allowed file types as array
   */
  getAllowedFileTypes(config: Config): string[] {
    return config.ALLOWED_FILE_TYPES.split(',').map(type => type.trim());
  },

  /**
   * Check if current environment is development
   */
  isDevelopment(config: Config): boolean {
    return config.NODE_ENV === 'development';
  },

  /**
   * Check if current environment is production
   */
  isProduction(config: Config): boolean {
    return config.NODE_ENV === 'production';
  },

  /**
   * Check if feature is enabled
   */
  isFeatureEnabled(config: Config, feature: keyof Config): boolean {
    const value = config[feature];
    return typeof value === 'boolean' ? value : false;
  },

  /**
   * Get rate limit configuration
   */
  getRateLimitConfig(config: Config) {
    return {
      requests: config.RATE_LIMIT_REQUESTS,
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      bypassKey: config.RATE_LIMIT_BYPASS_KEY,
    };
  },

  /**
   * Get security headers configuration
   */
  getSecurityHeadersConfig(config: Config) {
    return {
      enabled: config.ENABLE_SECURITY_HEADERS,
      contentSecurityPolicy: config.CONTENT_SECURITY_POLICY,
      strictTransportSecurity: config.STRICT_TRANSPORT_SECURITY,
    };
  },
};

export default ConfigSchema;