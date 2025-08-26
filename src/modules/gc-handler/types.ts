/**
 * Garbage Collection Handler Types
 * Comprehensive types for the Cloudflare Workers R2 garbage collection system
 */

/**
 * Resource types that can be garbage collected
 */
export enum GCResourceType {
  ASSISTANT = 'assistant',
  THREAD = 'thread',
  MESSAGE = 'message',
  RUN = 'run',
  FILE = 'file'
}

/**
 * GC operation modes
 */
export enum GCMode {
  /** Actual cleanup operations */
  CLEANUP = 'cleanup',
  /** Dry run - report what would be deleted without actually deleting */
  DRY_RUN = 'dry_run',
  /** Count only - just count expired objects without action */
  COUNT = 'count'
}

/**
 * GC operation status
 */
export enum GCOperationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * Configuration for GC operations
 */
export interface GCConfig {
  /** Operation mode */
  mode: GCMode;
  /** Resource types to process (empty array means all) */
  resourceTypes?: GCResourceType[];
  /** Maximum number of objects to process per resource type */
  maxObjectsPerType?: number;
  /** Batch size for processing */
  batchSize?: number;
  /** Maximum number of concurrent batches */
  maxConcurrentBatches?: number;
  /** Rate limit for R2 operations (requests per second) */
  rateLimit?: number;
  /** Dry run mode - don't actually delete, just report */
  dryRun?: boolean;
  /** Continue on errors */
  continueOnErrors?: boolean;
  /** Timeout for the entire operation (in seconds) */
  timeoutSeconds?: number;
  /** Admin key for authentication */
  adminKey?: string;
}

/**
 * Result of a single object cleanup operation
 */
export interface GCCleanupResult {
  /** Whether the cleanup was successful */
  success: boolean;
  /** The key that was processed */
  key: string;
  /** Resource type */
  resourceType: GCResourceType;
  /** Error message if failed */
  error?: string;
  /** Size of the object deleted (in bytes) */
  sizeBytes?: number;
  /** Additional metadata about the cleanup */
  metadata?: Record<string, any>;
}

/**
 * Statistics for a resource type cleanup
 */
export interface GCResourceStats {
  /** Resource type */
  resourceType: GCResourceType;
  /** Total objects found */
  totalFound: number;
  /** Objects that were expired */
  expiredCount: number;
  /** Objects successfully cleaned up */
  cleanedCount: number;
  /** Objects that failed to clean up */
  failedCount: number;
  /** Total size cleaned up (in bytes) */
  totalSizeBytes: number;
  /** Processing duration (in milliseconds) */
  durationMs: number;
  /** Errors encountered */
  errors: string[];
  /** Individual cleanup results */
  results: GCCleanupResult[];
}

/**
 * Overall GC operation result
 */
export interface GCOperationResult {
  /** Operation ID for tracking */
  operationId: string;
  /** Operation status */
  status: GCOperationStatus;
  /** Start timestamp */
  startedAt: string;
  /** End timestamp */
  completedAt?: string;
  /** Configuration used */
  config: GCConfig;
  /** Statistics by resource type */
  resourceStats: Record<GCResourceType, GCResourceStats>;
  /** Overall statistics */
  overallStats: {
    totalProcessed: number;
    totalCleaned: number;
    totalFailed: number;
    totalSizeBytes: number;
    totalDurationMs: number;
  };
  /** Errors encountered during the operation */
  errors: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Progress tracking for GC operations
 */
export interface GCProgress {
  /** Operation ID */
  operationId: string;
  /** Current resource type being processed */
  currentResourceType?: GCResourceType;
  /** Overall progress (0-100) */
  overallProgress: number;
  /** Progress by resource type (0-100) */
  resourceProgress: Record<GCResourceType, number>;
  /** Current batch being processed */
  currentBatch?: number;
  /** Total batches */
  totalBatches?: number;
  /** Estimated time remaining (in seconds) */
  estimatedTimeRemaining?: number;
  /** Current statistics */
  stats: Partial<GCOperationResult['overallStats']>;
}

/**
 * Request payload for manual GC trigger
 */
export interface GCTriggerRequest {
  /** Operation mode */
  mode?: GCMode;
  /** Resource types to process */
  resourceTypes?: GCResourceType[];
  /** Maximum objects per resource type */
  maxObjectsPerType?: number;
  /** Batch size */
  batchSize?: number;
  /** Admin key for authentication */
  adminKey: string;
}

/**
 * R2 list operation options with pagination
 */
export interface R2ListOptions {
  /** Prefix to filter by */
  prefix?: string;
  /** Cursor for pagination */
  cursor?: string;
  /** Maximum number of objects to return */
  limit?: number;
  /** Whether to include metadata in the response */
  include?: string[];
}

/**
 * Extended R2 object with metadata
 */
export interface R2ObjectWithMetadata {
  /** The key for the object */
  key: string;
  /** The version of the object */
  version: string;
  /** The size of the object in bytes */
  size: number;
  /** The ETag of the object */
  etag: string;
  /** The HTTP ETag of the object */
  httpEtag: string;
  /** Checksums for the object */
  checksums: R2Checksums;
  /** When the object was uploaded */
  uploaded: Date;
  /** HTTP metadata */
  httpMetadata?: R2HTTPMetadata;
  /** Custom metadata */
  customMetadata?: Record<string, string>;
  /** Range information */
  range?: R2Range;
  /** Storage class */
  storageClass: string;
  /** SSE key MD5 */
  ssecKeyMd5?: string;
  /** Expiration timestamp */
  expiresAt?: string;
  /** Whether the object has expired */
  isExpired?: boolean;
}

/**
 * Batch processing result
 */
export interface BatchProcessResult<T> {
  /** Whether the batch was successful */
  success: boolean;
  /** Items processed in this batch */
  items: T[];
  /** Results for each item */
  results: GCCleanupResult[];
  /** Errors encountered */
  errors: string[];
  /** Processing duration */
  durationMs: number;
}

/**
 * Rate limiter for R2 operations
 */
export interface RateLimiter {
  /** Current request count in the window */
  currentCount: number;
  /** Window start time */
  windowStart: number;
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * GC metrics for monitoring
 */
export interface GCMetrics {
  /** Operation metrics */
  operations: {
    total: number;
    successful: number;
    failed: number;
    dryRun: number;
  };
  /** Resource cleanup metrics */
  resources: Record<GCResourceType, {
    totalProcessed: number;
    totalCleaned: number;
    totalErrors: number;
    averageProcessingTime: number;
  }>;
  /** Performance metrics */
  performance: {
    averageOperationDuration: number;
    averageObjectsPerSecond: number;
    peakMemoryUsage?: number;
  };
  /** Error tracking */
  errors: {
    total: number;
    byType: Record<string, number>;
    byResource: Record<GCResourceType, number>;
  };
}