/**
 * Garbage Collection Handler
 * Main entry point for the Cloudflare Workers R2 garbage collection system
 */

import { BatchProcessor, createBatchProcessor } from './batch-processor';
import { ResourceCleanupHandler, createResourceCleanupHandler } from './resource-cleanup';
import {
  GCConfig,
  GCOperationResult,
  GCProgress,
  GCResourceType,
  GCMode,
  GCOperationStatus,
  GCTriggerRequest,
  GCResourceStats
} from './types';
import {
  createGCConfig,
  validateGCConfig,
  getResourceTypesByPriority,
  CRON_CONFIG
} from './config';

/**
 * Main garbage collection handler
 */
export class GarbageCollectionHandler {
  private batchProcessor: BatchProcessor;
  private cleanupHandler: ResourceCleanupHandler;
  private config: Required<GCConfig>;

  constructor(bucket: R2Bucket, config: Partial<GCConfig> = {}) {
    this.config = createGCConfig(config);
    this.batchProcessor = createBatchProcessor(bucket);
    this.cleanupHandler = createResourceCleanupHandler(bucket, this.config.dryRun);
  }

  /**
   * Execute garbage collection operation
   * @param configOverrides - Configuration overrides for this operation
   * @returns Operation result
   */
  async executeGC(configOverrides: Partial<GCConfig> = {}): Promise<GCOperationResult> {
    const operationConfig = { ...this.config, ...configOverrides };
    const operationId = `gc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const result: GCOperationResult = {
      operationId,
      status: GCOperationStatus.IN_PROGRESS,
      startedAt: new Date().toISOString(),
      config: operationConfig,
      resourceStats: {} as any,
      overallStats: {
        totalProcessed: 0,
        totalCleaned: 0,
        totalFailed: 0,
        totalSizeBytes: 0,
        totalDurationMs: 0
      },
      errors: [],
      dryRun: operationConfig.dryRun
    };

    try {
      console.log(`Starting GC operation ${operationId} in ${operationConfig.mode} mode`);

      // Validate configuration
      const validation = validateGCConfig(operationConfig);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Determine resource types to process
      const resourceTypes = operationConfig.resourceTypes?.length
        ? operationConfig.resourceTypes
        : getResourceTypesByPriority();

      // Process each resource type
      for (const resourceType of resourceTypes) {
        if (operationConfig.resourceTypes && !operationConfig.resourceTypes.includes(resourceType)) {
          continue; // Skip if not in the specified list
        }

        try {
          console.log(`Processing resource type: ${resourceType}`);
          const resourceResult = await this.processResourceType(resourceType, operationConfig);
          result.resourceStats[resourceType] = resourceResult;

          // Update overall stats
          result.overallStats.totalProcessed += resourceResult.totalFound;
          result.overallStats.totalCleaned += resourceResult.cleanedCount;
          result.overallStats.totalFailed += resourceResult.failedCount;
          result.overallStats.totalSizeBytes += resourceResult.totalSizeBytes;

        } catch (error) {
          const errorMsg = `Failed to process ${resourceType}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMsg);
          result.errors.push(errorMsg);

          // Initialize empty stats for failed resource type
          result.resourceStats[resourceType] = {
            resourceType,
            totalFound: 0,
            expiredCount: 0,
            cleanedCount: 0,
            failedCount: 0,
            totalSizeBytes: 0,
            durationMs: 0,
            errors: [errorMsg],
            results: []
          };
        }
      }

      // Calculate total duration
      result.overallStats.totalDurationMs = Date.now() - new Date(result.startedAt).getTime();
      result.status = result.errors.length > 0 ? GCOperationStatus.COMPLETED : GCOperationStatus.COMPLETED;
      result.completedAt = new Date().toISOString();

      console.log(`GC operation ${operationId} completed. Processed: ${result.overallStats.totalProcessed}, Cleaned: ${result.overallStats.totalCleaned}, Failed: ${result.overallStats.totalFailed}`);

    } catch (error) {
      const errorMsg = `GC operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
      result.status = GCOperationStatus.FAILED;
      result.completedAt = new Date().toISOString();
      result.overallStats.totalDurationMs = Date.now() - new Date(result.startedAt).getTime();
    }

    return result;
  }

  /**
   * Process a specific resource type
   * @param resourceType - Resource type to process
   * @param config - Operation configuration
   * @returns Resource processing statistics
   */
  private async processResourceType(
    resourceType: GCResourceType,
    config: Required<GCConfig>
  ): Promise<GCResourceStats> {
    const startTime = Date.now();

    const stats = {
      resourceType,
      totalFound: 0,
      expiredCount: 0,
      cleanedCount: 0,
      failedCount: 0,
      totalSizeBytes: 0,
      durationMs: 0,
      errors: [] as string[],
      results: [] as any[]
    };

    try {
      // Process in batches
      const batchResults = await this.batchProcessor.processInBatches(
        resourceType,
        async (batch) => {
          return await this.cleanupHandler.processBatchCleanup(batch, resourceType);
        },
        {
          batchSize: config.batchSize,
          maxConcurrentBatches: config.maxConcurrentBatches,
          maxObjects: config.maxObjectsPerType,
          continueOnErrors: config.continueOnErrors
        }
      );

      // Aggregate results
      for (const batchResult of batchResults.results) {
        stats.totalFound += batchResult.items.length;
        stats.expiredCount += batchResult.items.filter(item => item.isExpired).length;
        stats.cleanedCount += batchResult.results.filter(r => r.success).length;
        stats.failedCount += batchResult.results.filter(r => !r.success).length;
        stats.totalSizeBytes += batchResult.results.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
        stats.results.push(...batchResult.results);
        stats.errors.push(...batchResult.errors);
      }

      if (batchResults.errors.length > 0) {
        stats.errors.push(...batchResults.errors);
      }

    } catch (error) {
      const errorMsg = `Resource processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      stats.errors.push(errorMsg);
    }

    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  /**
   * Get current operation progress (for streaming updates)
   * @param operationId - Operation ID to get progress for
   * @returns Progress information
   */
  getProgress(operationId: string): GCProgress | null {
    // In a real implementation, this would track progress from a persistent store
    // For now, return null as we don't have persistent progress tracking
    return null;
  }

  /**
   * Validate admin key for GC operations
   * @param providedKey - Key provided in request
   * @returns Whether the key is valid
   */
  validateAdminKey(providedKey?: string): boolean {
    if (!this.config.adminKey) return true; // No admin key required
    return providedKey === this.config.adminKey;
  }
}

/**
 * Create a garbage collection handler instance
 * @param bucket - R2 bucket instance
 * @param config - Configuration
 * @returns GC handler instance
 */
export function createGarbageCollectionHandler(
  bucket: R2Bucket,
  config: Partial<GCConfig> = {}
): GarbageCollectionHandler {
  return new GarbageCollectionHandler(bucket, config);
}

/**
 * Execute GC operation with request data
 * @param bucket - R2 bucket instance
 * @param request - GC trigger request
 * @returns Operation result
 */
export async function executeGCOperation(
  bucket: R2Bucket,
  request: GCTriggerRequest
): Promise<GCOperationResult> {
  const config: GCConfig = {
    mode: request.mode || GCMode.CLEANUP,
    resourceTypes: request.resourceTypes,
    maxObjectsPerType: request.maxObjectsPerType,
    batchSize: request.batchSize,
    dryRun: request.mode === GCMode.DRY_RUN,
    adminKey: request.adminKey
  };

  const handler = createGarbageCollectionHandler(bucket, config);
  return await handler.executeGC(config);
}

/**
 * Get GC operation statistics summary
 * @param result - Operation result
 * @returns Formatted statistics
 */
export function getGCStatsSummary(result: GCOperationResult): string {
  const lines = [
    `GC Operation ${result.operationId}`,
    `Status: ${result.status}`,
    `Mode: ${result.dryRun ? 'DRY RUN' : 'CLEANUP'}`,
    `Started: ${result.startedAt}`,
    `Completed: ${result.completedAt || 'In progress'}`,
    `Duration: ${result.overallStats.totalDurationMs}ms`,
    '',
    'Overall Statistics:',
    `  Total Processed: ${result.overallStats.totalProcessed}`,
    `  Total Cleaned: ${result.overallStats.totalCleaned}`,
    `  Total Failed: ${result.overallStats.totalFailed}`,
    `  Total Size: ${formatBytes(result.overallStats.totalSizeBytes)}`,
    '',
    'Resource Breakdown:'
  ];

  for (const [resourceType, stats] of Object.entries(result.resourceStats)) {
    lines.push(`  ${resourceType}:`);
    lines.push(`    Found: ${stats.totalFound}, Expired: ${stats.expiredCount}`);
    lines.push(`    Cleaned: ${stats.cleanedCount}, Failed: ${stats.failedCount}`);
    lines.push(`    Size: ${formatBytes(stats.totalSizeBytes)}`);
    lines.push(`    Duration: ${stats.durationMs}ms`);
    if (stats.errors.length > 0) {
      lines.push(`    Errors: ${stats.errors.length}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('', 'Errors:');
    result.errors.forEach(error => lines.push(`  - ${error}`));
  }

  return lines.join('\n');
}

/**
 * Format bytes for display
 * @param bytes - Number of bytes
 * @returns Formatted string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate GC trigger request
 * @param request - Request to validate
 * @returns Validation result
 */
export function validateGCTriggerRequest(request: GCTriggerRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!request.adminKey) {
    errors.push('Admin key is required');
  }

  if (request.mode && !Object.values(GCMode).includes(request.mode)) {
    errors.push(`Invalid mode: ${request.mode}`);
  }

  if (request.resourceTypes) {
    const validTypes = Object.values(GCResourceType);
    const invalidTypes = request.resourceTypes.filter(type => !validTypes.includes(type));
    if (invalidTypes.length > 0) {
      errors.push(`Invalid resource types: ${invalidTypes.join(', ')}`);
    }
  }

  if (request.maxObjectsPerType && request.maxObjectsPerType <= 0) {
    errors.push('maxObjectsPerType must be positive');
  }

  if (request.batchSize && request.batchSize <= 0) {
    errors.push('batchSize must be positive');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}