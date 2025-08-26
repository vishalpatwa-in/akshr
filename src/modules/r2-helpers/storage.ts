import { AssistantR2Bucket, JsonStorageOptions, CasOptions, KEY_PREFIXES } from './types';
import {
  getAssistantKey,
  getThreadKey,
  getMessageKey,
  getRunKey,
  getFileMetadataKey,
  getFileBlobKey,
  getEntityPrefix
} from './keys';
import { createJsonMetadata, getRecommendedTTL } from './ttl';
import { getJson, putJson, putJsonWithCas, updateJsonWithCas, deleteJson } from './json';
import { putFile, getFile, deleteFile, getFileMetadata } from './files';
import { withErrorHandling, ErrorRecoveryStrategy } from './errors';

// Import existing models
import type {
  Assistant,
  Thread,
  Message,
  Run,
  File,
  Tool
} from '../models';

/**
 * Storage interface for Assistant objects
 */
export interface AssistantStorage {
  get(id: string): Promise<Assistant | null>;
  put(assistant: Assistant, options?: JsonStorageOptions): Promise<void>;
  putWithCas(assistant: Assistant, etag?: string, options?: CasOptions): Promise<any>;
  updateWithCas(id: string, updater: (current: Assistant | null) => Assistant, options?: CasOptions): Promise<any>;
  delete(id: string, etag?: string): Promise<any>;
  exists(id: string): Promise<boolean>;
}

/**
 * Storage interface for Thread objects
 */
export interface ThreadStorage {
  get(id: string): Promise<Thread | null>;
  put(thread: Thread, options?: JsonStorageOptions): Promise<void>;
  putWithCas(thread: Thread, etag?: string, options?: CasOptions): Promise<any>;
  updateWithCas(id: string, updater: (current: Thread | null) => Thread, options?: CasOptions): Promise<any>;
  delete(id: string, etag?: string): Promise<any>;
  exists(id: string): Promise<boolean>;
}

/**
 * Storage interface for Message objects
 */
export interface MessageStorage {
  get(threadId: string, messageId: string): Promise<Message | null>;
  put(threadId: string, message: Message, options?: JsonStorageOptions): Promise<void>;
  putWithCas(threadId: string, message: Message, etag?: string, options?: CasOptions): Promise<any>;
  updateWithCas(threadId: string, messageId: string, updater: (current: Message | null) => Message, options?: CasOptions): Promise<any>;
  delete(threadId: string, messageId: string, etag?: string): Promise<any>;
  exists(threadId: string, messageId: string): Promise<boolean>;
}

/**
 * Storage interface for Run objects
 */
export interface RunStorage {
  get(threadId: string, runId: string): Promise<Run | null>;
  put(threadId: string, run: Run, options?: JsonStorageOptions): Promise<void>;
  putWithCas(threadId: string, run: Run, etag?: string, options?: CasOptions): Promise<any>;
  updateWithCas(threadId: string, runId: string, updater: (current: Run | null) => Run, options?: CasOptions): Promise<any>;
  delete(threadId: string, runId: string, etag?: string): Promise<any>;
  exists(threadId: string, runId: string): Promise<boolean>;
  list(threadId: string): Promise<Run[]>;
}

/**
 * Storage interface for File objects
 */
export interface FileStorage {
  getMetadata(fileId: string): Promise<File | null>;
  putMetadata(file: File, options?: JsonStorageOptions): Promise<void>;
  putBlob(fileId: string, blob: Blob, metadata?: Record<string, string>): Promise<void>;
  getBlob(fileId: string): Promise<Blob | null>;
  delete(fileId: string): Promise<boolean>;
  exists(fileId: string): Promise<boolean>;
  getBlobUrl(fileId: string): string; // Returns a key that can be used for direct access
}

/**
 * Storage interface for Tool objects (stored by function name)
 */
export interface ToolStorage {
  get(name: string): Promise<Tool | null>;
  put(name: string, tool: Tool, options?: JsonStorageOptions): Promise<void>;
  putWithCas(name: string, tool: Tool, etag?: string, options?: CasOptions): Promise<any>;
  updateWithCas(name: string, updater: (current: Tool | null) => Tool, options?: CasOptions): Promise<any>;
  delete(name: string, etag?: string): Promise<any>;
  exists(name: string): Promise<boolean>;
}

/**
 * Main storage manager that provides access to all entity-specific storages
 */
export class R2StorageManager {
  constructor(private bucket: AssistantR2Bucket) {}

  /**
   * Gets the assistant storage interface
   */
  get assistants(): AssistantStorage {
    return new TypedAssistantStorage(this.bucket);
  }

  /**
   * Gets the thread storage interface
   */
  get threads(): ThreadStorage {
    return new TypedThreadStorage(this.bucket);
  }

  /**
   * Gets the message storage interface
   */
  get messages(): MessageStorage {
    return new TypedMessageStorage(this.bucket);
  }

  /**
   * Gets the run storage interface
   */
  get runs(): RunStorage {
    return new TypedRunStorage(this.bucket);
  }

  /**
   * Gets the file storage interface
   */
  get files(): FileStorage {
    return new TypedFileStorage(this.bucket);
  }

  /**
   * Gets the tool storage interface
   */
  get tools(): ToolStorage {
    return new TypedToolStorage(this.bucket);
  }

  /**
   * Performs a health check on the R2 storage
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Try to perform a simple operation
      const testKey = 'health-check';
      await this.bucket.put(testKey, 'test');
      await this.bucket.delete(testKey);
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

/**
 * Typed storage implementation for Assistant objects
 */
class TypedAssistantStorage implements AssistantStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async get(id: string): Promise<Assistant | null> {
    return withErrorHandling(
      () => getJson<Assistant>(this.bucket, getAssistantKey(id)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async put(assistant: Assistant, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('assistant')
    };
    return putJson(this.bucket, getAssistantKey(assistant.id), assistant, finalOptions);
  }

  async putWithCas(assistant: Assistant, etag?: string, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('assistant')
    };
    return putJsonWithCas(this.bucket, getAssistantKey(assistant.id), assistant, etag, finalOptions);
  }

  async updateWithCas(id: string, updater: (current: Assistant | null) => Assistant, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('assistant')
    };
    return updateJsonWithCas(this.bucket, getAssistantKey(id), updater, finalOptions);
  }

  async delete(id: string, etag?: string): Promise<any> {
    return deleteJson(this.bucket, getAssistantKey(id), etag);
  }

  async exists(id: string): Promise<boolean> {
    try {
      const result = await getJson(this.bucket, getAssistantKey(id));
      return result !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Typed storage implementation for Thread objects
 */
class TypedThreadStorage implements ThreadStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async get(id: string): Promise<Thread | null> {
    return withErrorHandling(
      () => getJson<Thread>(this.bucket, getThreadKey(id)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async put(thread: Thread, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('thread')
    };
    return putJson(this.bucket, getThreadKey(thread.id), thread, finalOptions);
  }

  async putWithCas(thread: Thread, etag?: string, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('thread')
    };
    return putJsonWithCas(this.bucket, getThreadKey(thread.id), thread, etag, finalOptions);
  }

  async updateWithCas(id: string, updater: (current: Thread | null) => Thread, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('thread')
    };
    return updateJsonWithCas(this.bucket, getThreadKey(id), updater, finalOptions);
  }

  async delete(id: string, etag?: string): Promise<any> {
    return deleteJson(this.bucket, getThreadKey(id), etag);
  }

  async exists(id: string): Promise<boolean> {
    try {
      const result = await getJson(this.bucket, getThreadKey(id));
      return result !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Typed storage implementation for Message objects
 */
class TypedMessageStorage implements MessageStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async get(threadId: string, messageId: string): Promise<Message | null> {
    return withErrorHandling(
      () => getJson<Message>(this.bucket, getMessageKey(threadId, messageId)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async put(threadId: string, message: Message, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('message')
    };
    return putJson(this.bucket, getMessageKey(threadId, message.id), message, finalOptions);
  }

  async putWithCas(threadId: string, message: Message, etag?: string, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('message')
    };
    return putJsonWithCas(this.bucket, getMessageKey(threadId, message.id), message, etag, finalOptions);
  }

  async updateWithCas(threadId: string, messageId: string, updater: (current: Message | null) => Message, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('message')
    };
    return updateJsonWithCas(this.bucket, getMessageKey(threadId, messageId), updater, finalOptions);
  }

  async delete(threadId: string, messageId: string, etag?: string): Promise<any> {
    return deleteJson(this.bucket, getMessageKey(threadId, messageId), etag);
  }

  async exists(threadId: string, messageId: string): Promise<boolean> {
    try {
      const result = await getJson(this.bucket, getMessageKey(threadId, messageId));
      return result !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Typed storage implementation for Run objects
 */
class TypedRunStorage implements RunStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async get(threadId: string, runId: string): Promise<Run | null> {
    return withErrorHandling(
      () => getJson<Run>(this.bucket, getRunKey(threadId, runId)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async put(threadId: string, run: Run, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('run')
    };
    return putJson(this.bucket, getRunKey(threadId, run.id), run, finalOptions);
  }

  async putWithCas(threadId: string, run: Run, etag?: string, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('run')
    };
    return putJsonWithCas(this.bucket, getRunKey(threadId, run.id), run, etag, finalOptions);
  }

  async updateWithCas(threadId: string, runId: string, updater: (current: Run | null) => Run, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('run')
    };
    return updateJsonWithCas(this.bucket, getRunKey(threadId, runId), updater, finalOptions);
  }

  async delete(threadId: string, runId: string, etag?: string): Promise<any> {
    return deleteJson(this.bucket, getRunKey(threadId, runId), etag);
  }

  async exists(threadId: string, runId: string): Promise<boolean> {
    try {
      const result = await getJson(this.bucket, getRunKey(threadId, runId));
      return result !== null;
    } catch {
      return false;
    }
  }

  async list(threadId: string): Promise<Run[]> {
    try {
      const runs: Run[] = [];
      const prefix = `${KEY_PREFIXES.RUN}/${threadId}/`;

      const listResult = await this.bucket.list({ prefix });

      for (const object of listResult.objects) {
        try {
          const response = await this.bucket.get(object.key);
          if (response) {
            const data = await response.text();
            const run = JSON.parse(data);
            runs.push(run);
          }
        } catch (error) {
          console.error('Error parsing run:', error);
        }
      }

      // Sort by creation time (newest first)
      return runs.sort((a: Run, b: Run) => b.created_at - a.created_at);
    } catch (error) {
      console.error('Error listing runs by thread:', error);
      return [];
    }
  }
}

/**
 * Typed storage implementation for File objects
 */
class TypedFileStorage implements FileStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async getMetadata(fileId: string): Promise<File | null> {
    return withErrorHandling(
      () => getJson<File>(this.bucket, getFileMetadataKey(fileId)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async putMetadata(file: File, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('file')
    };
    return putJson(this.bucket, getFileMetadataKey(file.id), file, finalOptions);
  }

  async putBlob(fileId: string, blob: Blob, metadata?: Record<string, string>): Promise<void> {
    return putFile(this.bucket, getFileBlobKey(fileId), blob, metadata);
  }

  async getBlob(fileId: string): Promise<Blob | null> {
    return getFile(this.bucket, getFileBlobKey(fileId));
  }

  async delete(fileId: string): Promise<boolean> {
    // Delete both metadata and blob
    const [metaDeleted, blobDeleted] = await Promise.all([
      deleteFile(this.bucket, getFileMetadataKey(fileId)),
      deleteFile(this.bucket, getFileBlobKey(fileId))
    ]);
    return metaDeleted && blobDeleted;
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      const [metaExists, blobExists] = await Promise.all([
        this.getMetadata(fileId).then(meta => meta !== null),
        getFile(this.bucket, getFileBlobKey(fileId)).then(blob => blob !== null)
      ]);
      return metaExists && blobExists;
    } catch {
      return false;
    }
  }

  getBlobUrl(fileId: string): string {
    return getFileBlobKey(fileId);
  }
}

/**
 * Typed storage implementation for Tool objects
 */
class TypedToolStorage implements ToolStorage {
  constructor(private bucket: AssistantR2Bucket) {}

  async get(name: string): Promise<Tool | null> {
    return withErrorHandling(
      () => getJson<Tool>(this.bucket, getToolKey(name)),
      { strategy: ErrorRecoveryStrategy.LOG_AND_CONTINUE }
    );
  }

  async put(name: string, tool: Tool, options?: JsonStorageOptions): Promise<void> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('tool')
    };
    return putJson(this.bucket, getToolKey(name), tool, finalOptions);
  }

  async putWithCas(name: string, tool: Tool, etag?: string, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('tool')
    };
    return putJsonWithCas(this.bucket, getToolKey(name), tool, etag, finalOptions);
  }

  async updateWithCas(name: string, updater: (current: Tool | null) => Tool, options?: CasOptions): Promise<any> {
    const finalOptions = {
      ...options,
      ttlSeconds: options?.ttlSeconds ?? getRecommendedTTL('tool')
    };
    return updateJsonWithCas(this.bucket, getToolKey(name), updater, finalOptions);
  }

  async delete(name: string, etag?: string): Promise<any> {
    return deleteJson(this.bucket, getToolKey(name), etag);
  }

  async exists(name: string): Promise<boolean> {
    try {
      const result = await getJson(this.bucket, getToolKey(name));
      return result !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Helper function to get tool key (not exported from keys module)
 */
function getToolKey(toolId: string): string {
  return `tools/${toolId}.json`;
}

/**
 * Creates a new R2 storage manager instance
 * @param bucket - The R2 bucket instance
 * @returns R2StorageManager instance
 */
export function createR2Storage(bucket: AssistantR2Bucket): R2StorageManager {
  return new R2StorageManager(bucket);
}