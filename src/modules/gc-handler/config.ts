/**
 * Garbage Collection Configuration
 * Default settings and configuration management for GC operations
 */

import { GCConfig, GCMode, GCResourceType } from './types';

/**
 * Default GC configuration
 */
export const DEFAULT_GC_CONFIG: Required<GCConfig> = {
  mode: GCMode.CLEANUP,
  resourceTypes: [
    GCResourceType.ASSISTANT,
    GCResourceType.THREAD,
    GCResourceType.MESSAGE,
    GCResourceType.RUN,
    GCResourceType.FILE
  ],
  maxObjectsPerType: 10000,
  batchSize: 100,
  maxConcurrentBatches: 5,
  rateLimit: 50, // 50 requests per second
  dryRun: false,
  continueOnErrors: true,
  timeoutSeconds: 300, // 5 minutes
  adminKey: ''
};

/**
 * Resource-specific configurations
 */
export const RESOURCE_CONFIGS = {
  [GCResourceType.ASSISTANT]: {
    priority: 1, // Process assistants first due to cascade effects
    cascadeDelete: [GCResourceType.THREAD, GCResourceType.RUN], // Delete related threads and runs
    prefix: 'assistants/',
    description: 'AI Assistant configurations'
  },
  [GCResourceType.THREAD]: {
    priority: 2,
    cascadeDelete: [GCResourceType.MESSAGE, GCResourceType.RUN], // Delete related messages and runs
    prefix: 'threads/',
    description: 'Conversation threads'
  },
  [GCResourceType.MESSAGE]: {
    priority: 3,
    cascadeDelete: [], // Messages don't have cascading dependencies
    prefix: 'messages/',
    description: 'Individual messages in threads'
  },
  [GCResourceType.RUN]: {
    priority: 4,
    cascadeDelete: [], // Runs don't have cascading dependencies
    prefix: 'runs/',
    description: 'Assistant run executions'
  },
  [GCResourceType.FILE]: {
    priority: 5,
    cascadeDelete: [], // Files don't have cascading dependencies
    prefix: 'files/',
    description: 'Uploaded files and metadata'
  }
} as const;

/**
 * Cron schedule configuration for automated GC
 */
export const CRON_CONFIG = {
  /** Cron expression for daily GC at 2 AM UTC */
  schedule: '0 2 * * *',
  /** Cron expression for weekly GC on Sundays at 3 AM UTC */
  weeklySchedule: '0 3 * * 0',
  /** Maximum runtime for cron-triggered GC (in seconds) */
  maxRuntimeSeconds: 600, // 10 minutes
  /** Timeout buffer before cron job gets terminated (in seconds) */
  timeoutBufferSeconds: 30
};

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONFIG = {
  /** Default requests per second */
  defaultRPS: 50,
  /** Burst limit (maximum requests in a short burst) */
  burstLimit: 100,
  /** Window size for rate limiting (in milliseconds) */
  windowMs: 1000,
  /** Backoff multiplier for rate limit delays */
  backoffMultiplier: 1.5,
  /** Maximum backoff delay (in milliseconds) */
  maxBackoffMs: 5000
};

/**
 * Batch processing configuration
 */
export const BATCH_CONFIG = {
  /** Default batch size for processing */
  defaultBatchSize: 100,
  /** Maximum batch size allowed */
  maxBatchSize: 1000,
  /** Minimum batch size for efficiency */
  minBatchSize: 10,
  /** Maximum concurrent batches */
  maxConcurrentBatches: 5,
  /** Delay between batches (in milliseconds) */
  batchDelayMs: 100,
  /** Retry delay for failed batches (in milliseconds) */
  retryDelayMs: 1000,
  /** Maximum retry attempts for batches */
  maxBatchRetries: 3
};

/**
 * Safety and monitoring configuration
 */
export const SAFETY_CONFIG = {
  /** Enable detailed logging */
  enableDetailedLogging: true,
  /** Log level for GC operations */
  logLevel: 'info',
  /** Maximum number of errors before stopping */
  maxErrorsBeforeStop: 100,
  /** Whether to continue on individual object errors */
  continueOnObjectErrors: true,
  /** Whether to validate object relationships before deletion */
  validateRelationships: true,
  /** Backup metadata before deletion */
  backupMetadata: false,
  /** Metrics collection interval (in milliseconds) */
  metricsIntervalMs: 5000
};

/**
 * Performance optimization settings
 */
export const PERFORMANCE_CONFIG = {
  /** Enable concurrent processing */
  enableConcurrency: true,
  /** Memory limit for operations (approximate, in MB) */
  memoryLimitMB: 128,
  /** Enable pagination for large datasets */
  enablePagination: true,
  /** Page size for R2 list operations */
  listPageSize: 1000,
  /** Enable result caching for repeated operations */
  enableResultCaching: false,
  /** Cache TTL for results (in seconds) */
  cacheTtlSeconds: 300,
  /** Enable progress streaming */
  enableProgressStreaming: true
};

/**
 * Create a GC configuration with defaults and overrides
 * @param overrides - Configuration overrides
 * @returns Complete GC configuration
 */
export function createGCConfig(overrides: Partial<GCConfig> = {}): Required<GCConfig> {
  return {
    ...DEFAULT_GC_CONFIG,
    ...overrides
  };
}

/**
 * Validate GC configuration
 * @param config - Configuration to validate
 * @returns Validation result with errors if any
 */
export function validateGCConfig(config: Partial<GCConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate batch size
  if (config.batchSize && (config.batchSize < BATCH_CONFIG.minBatchSize || config.batchSize > BATCH_CONFIG.maxBatchSize)) {
    errors.push(`Batch size must be between ${BATCH_CONFIG.minBatchSize} and ${BATCH_CONFIG.maxBatchSize}`);
  }

  // Validate max objects per type
  if (config.maxObjectsPerType && config.maxObjectsPerType < 0) {
    errors.push('Max objects per type cannot be negative');
  }

  // Validate rate limit
  if (config.rateLimit && config.rateLimit < 1) {
    errors.push('Rate limit must be at least 1 request per second');
  }

  // Validate timeout
  if (config.timeoutSeconds && config.timeoutSeconds < 30) {
    errors.push('Timeout must be at least 30 seconds');
  }

  // Validate resource types
  if (config.resourceTypes) {
    const validTypes = Object.values(GCResourceType);
    const invalidTypes = config.resourceTypes.filter(type => !validTypes.includes(type));
    if (invalidTypes.length > 0) {
      errors.push(`Invalid resource types: ${invalidTypes.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get resource configuration by type
 * @param resourceType - Resource type
 * @returns Resource configuration
 */
export function getResourceConfig(resourceType: GCResourceType) {
  return RESOURCE_CONFIGS[resourceType];
}

/**
 * Get all resource types sorted by priority
 * @returns Resource types in priority order
 */
export function getResourceTypesByPriority(): GCResourceType[] {
  return Object.entries(RESOURCE_CONFIGS)
    .sort(([, a], [, b]) => a.priority - b.priority)
    .map(([type]) => type as GCResourceType);
}