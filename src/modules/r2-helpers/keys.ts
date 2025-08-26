import { KEY_PREFIXES } from './types';

/**
 * Generates a standardized key for storing assistants
 * @param assistantId - The unique identifier for the assistant
 * @returns The R2 key for the assistant
 */
export function getAssistantKey(assistantId: string): string {
  return `${KEY_PREFIXES.ASSISTANT}/${assistantId}.json`;
}

/**
 * Generates a standardized key for storing threads
 * @param threadId - The unique identifier for the thread
 * @returns The R2 key for the thread
 */
export function getThreadKey(threadId: string): string {
  return `${KEY_PREFIXES.THREAD}/${threadId}.json`;
}

/**
 * Generates a standardized key for storing messages
 * @param threadId - The thread identifier
 * @param messageId - The unique identifier for the message
 * @returns The R2 key for the message
 */
export function getMessageKey(threadId: string, messageId: string): string {
  return `${KEY_PREFIXES.MESSAGE}/${threadId}/${messageId}.json`;
}

/**
 * Generates a standardized key for storing runs
 * @param threadId - The thread identifier
 * @param runId - The unique identifier for the run
 * @returns The R2 key for the run
 */
export function getRunKey(threadId: string, runId: string): string {
  return `${KEY_PREFIXES.RUN}/${threadId}/${runId}.json`;
}

/**
 * Generates a standardized key for storing file metadata
 * @param fileId - The unique identifier for the file
 * @returns The R2 key for the file metadata
 */
export function getFileMetadataKey(fileId: string): string {
  return `${KEY_PREFIXES.FILE_META}/${fileId}/meta.json`;
}

/**
 * Generates a standardized key for storing file blobs
 * @param fileId - The unique identifier for the file
 * @returns The R2 key for the file blob
 */
export function getFileBlobKey(fileId: string): string {
  return `${KEY_PREFIXES.FILE_BLOB}/${fileId}/blob`;
}

/**
 * Generates a standardized key for storing tool definitions
 * @param toolId - The unique identifier for the tool
 * @returns The R2 key for the tool definition
 */
export function getToolKey(toolId: string): string {
  return `tools/${toolId}.json`;
}

/**
 * Generates a list key for storing paginated results
 * @param entityType - The type of entity (assistants, threads, messages, runs)
 * @param cursor - Optional cursor for pagination
 * @returns The R2 key for the list
 */
export function getListKey(entityType: keyof typeof KEY_PREFIXES, cursor?: string): string {
  const baseKey = `${entityType}/_list`;
  return cursor ? `${baseKey}/${cursor}.json` : `${baseKey}.json`;
}

/**
 * Extracts the entity ID from an R2 key
 * @param key - The R2 key
 * @param entityType - The type of entity
 * @returns The extracted ID or null if not found
 */
export function extractIdFromKey(key: string, entityType: keyof typeof KEY_PREFIXES): string | null {
  const prefix = KEY_PREFIXES[entityType];
  const regex = new RegExp(`^${prefix}/([^/]+?)(\\.json|/blob)?$`);
  const match = key.match(regex);
  return match ? match[1] : null;
}

/**
 * Extracts thread ID and message ID from a message key
 * @param key - The message R2 key
 * @returns Object with threadId and messageId, or null if not found
 */
export function extractMessageIdsFromKey(key: string): { threadId: string; messageId: string } | null {
  const regex = new RegExp(`^${KEY_PREFIXES.MESSAGE}/([^/]+)/([^/]+)\\.json$`);
  const match = key.match(regex);
  if (match) {
    return { threadId: match[1], messageId: match[2] };
  }
  return null;
}

/**
 * Extracts thread ID and run ID from a run key
 * @param key - The run R2 key
 * @returns Object with threadId and runId, or null if not found
 */
export function extractRunIdsFromKey(key: string): { threadId: string; runId: string } | null {
  const regex = new RegExp(`^${KEY_PREFIXES.RUN}/([^/]+)/([^/]+)\\.json$`);
  const match = key.match(regex);
  if (match) {
    return { threadId: match[1], runId: match[2] };
  }
  return null;
}

/**
 * Extracts file ID from a file key (works for both metadata and blob keys)
 * @param key - The file R2 key
 * @returns The file ID or null if not found
 */
export function extractFileIdFromKey(key: string): string | null {
  const regex = new RegExp(`^${KEY_PREFIXES.FILE_META}/([^/]+)/(meta\\.json|blob)$`);
  const match = key.match(regex);
  return match ? match[1] : null;
}

/**
 * Checks if a key matches a specific entity type
 * @param key - The R2 key to check
 * @param entityType - The entity type to check against
 * @returns True if the key matches the entity type
 */
export function isEntityType(key: string, entityType: keyof typeof KEY_PREFIXES): boolean {
  const prefix = KEY_PREFIXES[entityType];
  return key.startsWith(prefix + '/');
}

/**
 * Gets the entity type from a key
 * @param key - The R2 key
 * @returns The entity type or null if not recognized
 */
export function getEntityTypeFromKey(key: string): keyof typeof KEY_PREFIXES | null {
  for (const [entityType, prefix] of Object.entries(KEY_PREFIXES)) {
    if (key.startsWith(prefix + '/')) {
      return entityType as keyof typeof KEY_PREFIXES;
    }
  }
  return null;
}

/**
 * Generates a prefix for listing keys of a specific entity type
 * @param entityType - The entity type
 * @returns The prefix for listing operations
 */
export function getEntityPrefix(entityType: keyof typeof KEY_PREFIXES): string {
  return `${KEY_PREFIXES[entityType]}/`;
}

/**
 * Sanitizes a key to ensure it's safe for R2 storage
 * @param key - The key to sanitize
 * @returns The sanitized key
 */
export function sanitizeKey(key: string): string {
  // Replace unsafe characters with safe alternatives
  return key
    .replace(/[^a-zA-Z0-9\-_.\/]/g, '_') // Replace special chars with underscore
    .replace(/\/+/g, '/') // Replace multiple slashes with single slash
    .replace(/^\//, '') // Remove leading slash
    .replace(/\/$/, ''); // Remove trailing slash
}