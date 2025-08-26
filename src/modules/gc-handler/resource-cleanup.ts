/**
 * Resource-Specific Cleanup Logic
 * Handles different cleanup strategies for each resource type with cascade deletion
 */

import {
  GCResourceType,
  GCCleanupResult,
  R2ObjectWithMetadata,
  BatchProcessResult
} from './types';
import { getResourceConfig } from './config';
import {
  getAssistantKey,
  getThreadKey,
  getMessageKey,
  getRunKey,
  getFileMetadataKey,
  getFileBlobKey,
  extractIdFromKey,
  extractMessageIdsFromKey,
  extractRunIdsFromKey,
  extractFileIdFromKey
} from '../r2-helpers/keys';

/**
 * Resource cleanup handler for different types
 */
export class ResourceCleanupHandler {
  private bucket: R2Bucket;
  private dryRun: boolean;

  constructor(bucket: R2Bucket, dryRun = false) {
    this.bucket = bucket;
    this.dryRun = dryRun;
  }

  /**
   * Process cleanup for a batch of objects
   * @param objects - Objects to clean up
   * @param resourceType - Type of resource being cleaned
   * @returns Cleanup results
   */
  async processBatchCleanup(
    objects: R2ObjectWithMetadata[],
    resourceType: GCResourceType
  ): Promise<BatchProcessResult<R2ObjectWithMetadata>> {
    const startTime = Date.now();
    const results: GCCleanupResult[] = [];
    const errors: string[] = [];

    try {
      // Filter only expired objects
      const expiredObjects = objects.filter(obj => obj.isExpired);

      for (const obj of expiredObjects) {
        try {
          const cleanupResult = await this.cleanupObject(obj, resourceType);
          results.push(cleanupResult);
        } catch (error) {
          const errorMsg = `Failed to cleanup ${resourceType} ${obj.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          results.push({
            success: false,
            key: obj.key,
            resourceType,
            error: errorMsg,
            sizeBytes: obj.size
          });
        }
      }

      return {
        success: errors.length === 0,
        items: expiredObjects,
        results,
        errors,
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      const errorMsg = `Batch cleanup failed for ${resourceType}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        success: false,
        items: objects,
        results: [],
        errors: [errorMsg],
        durationMs: Date.now() - startTime
      };
    }
  }

  /**
   * Clean up a single object with cascade deletion
   * @param obj - Object to clean up
   * @param resourceType - Type of resource
   * @returns Cleanup result
   */
  private async cleanupObject(
    obj: R2ObjectWithMetadata,
    resourceType: GCResourceType
  ): Promise<GCCleanupResult> {
    const resourceConfig = getResourceConfig(resourceType);

    // Handle cascade deletion based on resource type
    switch (resourceType) {
      case GCResourceType.ASSISTANT:
        return await this.cleanupAssistant(obj);

      case GCResourceType.THREAD:
        return await this.cleanupThread(obj);

      case GCResourceType.MESSAGE:
        return await this.cleanupMessage(obj);

      case GCResourceType.RUN:
        return await this.cleanupRun(obj);

      case GCResourceType.FILE:
        return await this.cleanupFile(obj);

      default:
        return await this.cleanupGeneric(obj, resourceType);
    }
  }

  /**
   * Clean up an assistant with cascade to related threads and runs
   * @param obj - Assistant object
   * @returns Cleanup result
   */
  private async cleanupAssistant(obj: R2ObjectWithMetadata): Promise<GCCleanupResult> {
    const assistantId = extractIdFromKey(obj.key, 'ASSISTANT');
    if (!assistantId) {
      throw new Error(`Invalid assistant key: ${obj.key}`);
    }

    const cascadeDeletes: GCCleanupResult[] = [];

    // Find and cleanup related threads
    const threadKeys = await this.findRelatedObjects('threads', assistantId);
    for (const threadKey of threadKeys) {
      try {
        const threadObj = await this.getObject(threadKey);
        if (threadObj) {
          const threadResult = await this.cleanupThread(threadObj);
          cascadeDeletes.push(threadResult);
        }
      } catch (error) {
        cascadeDeletes.push({
          success: false,
          key: threadKey,
          resourceType: GCResourceType.THREAD,
          error: `Failed to cleanup related thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Delete the assistant object itself
    const deleteResult = await this.deleteObject(obj.key);

    return {
      success: deleteResult.success,
      key: obj.key,
      resourceType: GCResourceType.ASSISTANT,
      error: deleteResult.error,
      sizeBytes: obj.size,
      metadata: {
        cascadeDeletes: cascadeDeletes.length,
        cascadeErrors: cascadeDeletes.filter(d => !d.success).length
      }
    };
  }

  /**
   * Clean up a thread with cascade to related messages and runs
   * @param obj - Thread object
   * @returns Cleanup result
   */
  private async cleanupThread(obj: R2ObjectWithMetadata): Promise<GCCleanupResult> {
    const threadId = extractIdFromKey(obj.key, 'THREAD');
    if (!threadId) {
      throw new Error(`Invalid thread key: ${obj.key}`);
    }

    const cascadeDeletes: GCCleanupResult[] = [];

    // Find and cleanup related messages
    const messageKeys = await this.findRelatedObjects('messages', threadId);
    for (const messageKey of messageKeys) {
      try {
        const messageObj = await this.getObject(messageKey);
        if (messageObj) {
          const messageResult = await this.cleanupMessage(messageObj);
          cascadeDeletes.push(messageResult);
        }
      } catch (error) {
        cascadeDeletes.push({
          success: false,
          key: messageKey,
          resourceType: GCResourceType.MESSAGE,
          error: `Failed to cleanup related message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Find and cleanup related runs
    const runKeys = await this.findRelatedObjects('runs', threadId);
    for (const runKey of runKeys) {
      try {
        const runObj = await this.getObject(runKey);
        if (runObj) {
          const runResult = await this.cleanupRun(runObj);
          cascadeDeletes.push(runResult);
        }
      } catch (error) {
        cascadeDeletes.push({
          success: false,
          key: runKey,
          resourceType: GCResourceType.RUN,
          error: `Failed to cleanup related run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Delete the thread object itself
    const deleteResult = await this.deleteObject(obj.key);

    return {
      success: deleteResult.success,
      key: obj.key,
      resourceType: GCResourceType.THREAD,
      error: deleteResult.error,
      sizeBytes: obj.size,
      metadata: {
        cascadeDeletes: cascadeDeletes.length,
        cascadeErrors: cascadeDeletes.filter(d => !d.success).length
      }
    };
  }

  /**
   * Clean up a message (no cascade dependencies)
   * @param obj - Message object
   * @returns Cleanup result
   */
  private async cleanupMessage(obj: R2ObjectWithMetadata): Promise<GCCleanupResult> {
    const deleteResult = await this.deleteObject(obj.key);
    return {
      success: deleteResult.success,
      key: obj.key,
      resourceType: GCResourceType.MESSAGE,
      error: deleteResult.error,
      sizeBytes: obj.size
    };
  }

  /**
   * Clean up a run (no cascade dependencies)
   * @param obj - Run object
   * @returns Cleanup result
   */
  private async cleanupRun(obj: R2ObjectWithMetadata): Promise<GCCleanupResult> {
    const deleteResult = await this.deleteObject(obj.key);
    return {
      success: deleteResult.success,
      key: obj.key,
      resourceType: GCResourceType.RUN,
      error: deleteResult.error,
      sizeBytes: obj.size
    };
  }

  /**
   * Clean up a file with both metadata and blob deletion
   * @param obj - File metadata object
   * @returns Cleanup result
   */
  private async cleanupFile(obj: R2ObjectWithMetadata): Promise<GCCleanupResult> {
    const fileId = extractFileIdFromKey(obj.key);
    if (!fileId) {
      throw new Error(`Invalid file key: ${obj.key}`);
    }

    const results: GCCleanupResult[] = [];

    // Delete file metadata
    const metadataDeleteResult = await this.deleteObject(obj.key);
    results.push({
      success: metadataDeleteResult.success,
      key: obj.key,
      resourceType: GCResourceType.FILE,
      error: metadataDeleteResult.error,
      sizeBytes: obj.size,
      metadata: { type: 'metadata' }
    });

    // Delete file blob if it exists
    const blobKey = getFileBlobKey(fileId);
    try {
      const blobObj = await this.getObject(blobKey);
      if (blobObj) {
        const blobDeleteResult = await this.deleteObject(blobKey);
        results.push({
          success: blobDeleteResult.success,
          key: blobKey,
          resourceType: GCResourceType.FILE,
          error: blobDeleteResult.error,
          sizeBytes: blobObj.size,
          metadata: { type: 'blob' }
        });
      }
    } catch (error) {
      results.push({
        success: false,
        key: blobKey,
        resourceType: GCResourceType.FILE,
        error: `Failed to check/delete blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { type: 'blob' }
      });
    }

    // Return combined result
    const success = results.every(r => r.success);
    const totalSize = results.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
    const errors = results.filter(r => !r.success).map(r => r.error || 'Unknown error');

    return {
      success,
      key: obj.key,
      resourceType: GCResourceType.FILE,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      sizeBytes: totalSize,
      metadata: {
        partsDeleted: results.filter(r => r.success).length,
        partsFailed: results.filter(r => !r.success).length
      }
    };
  }

  /**
   * Generic cleanup for unknown resource types
   * @param obj - Object to clean up
   * @param resourceType - Resource type
   * @returns Cleanup result
   */
  private async cleanupGeneric(
    obj: R2ObjectWithMetadata,
    resourceType: GCResourceType
  ): Promise<GCCleanupResult> {
    const deleteResult = await this.deleteObject(obj.key);
    return {
      success: deleteResult.success,
      key: obj.key,
      resourceType,
      error: deleteResult.error,
      sizeBytes: obj.size
    };
  }

  /**
   * Find related objects for cascade deletion
   * @param prefix - Prefix to search for
   * @param parentId - Parent resource ID
   * @returns Array of related object keys
   */
  private async findRelatedObjects(prefix: string, parentId: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.bucket.list({
        prefix: `${prefix}/${parentId}/`,
        cursor,
        limit: 1000
      });

      keys.push(...result.objects.map(obj => obj.key));

      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);

    return keys;
  }

  /**
   * Get object by key
   * @param key - Object key
   * @returns Object if found, null otherwise
   */
  private async getObject(key: string): Promise<R2ObjectWithMetadata | null> {
    try {
      const obj = await this.bucket.get(key);
      if (!obj) return null;

      return {
        key: obj.key,
        version: obj.version,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.httpEtag,
        checksums: obj.checksums,
        uploaded: obj.uploaded,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata || {},
        range: obj.range,
        storageClass: obj.storageClass,
        ssecKeyMd5: obj.ssecKeyMd5,
        expiresAt: obj.customMetadata?.expiresAt,
        isExpired: obj.customMetadata?.expiresAt ?
          new Date() > new Date(obj.customMetadata.expiresAt) : false
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete object by key
   * @param key - Object key
   * @returns Delete result
   */
  private async deleteObject(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.dryRun) {
        console.log(`DRY RUN: Would delete ${key}`);
        return { success: true };
      }

      await this.bucket.delete(key);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }
}

/**
 * Create a resource cleanup handler instance
 * @param bucket - R2 bucket instance
 * @param dryRun - Whether to perform dry run
 * @returns Resource cleanup handler
 */
export function createResourceCleanupHandler(bucket: R2Bucket, dryRun = false): ResourceCleanupHandler {
  return new ResourceCleanupHandler(bucket, dryRun);
}