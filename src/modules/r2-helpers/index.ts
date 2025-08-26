/**
 * R2 Helpers - Comprehensive Cloudflare R2 Storage Utilities
 *
 * This module provides a complete set of utilities for working with Cloudflare R2 storage
 * in Cloudflare Workers, including:
 *
 * - JSON storage with ETag CAS (Compare-and-Swap)
 * - File blob handling with metadata
 * - TTL (Time-To-Live) management
 * - Exponential backoff retry logic
 * - Type-safe operations for existing models
 * - Comprehensive error handling
 * - Key management and prefixing
 */

// Core Types and Interfaces
export type {
  AssistantR2Bucket,
  R2Metadata,
  JsonStorageOptions,
  CasOptions,
  CasResult,
  R2ErrorType
} from './types';

export {
  R2Error,
  DEFAULT_TTL,
  CAS_CONFIG,
  KEY_PREFIXES
} from './types';

export { CAS_STRATEGIES } from './cas';

// Key Management
export {
  getAssistantKey,
  getThreadKey,
  getMessageKey,
  getRunKey,
  getFileMetadataKey,
  getFileBlobKey,
  getListKey,
  extractIdFromKey,
  extractMessageIdsFromKey,
  extractRunIdsFromKey,
  extractFileIdFromKey,
  isEntityType,
  getEntityTypeFromKey,
  getEntityPrefix,
  sanitizeKey
} from './keys';

// TTL and Metadata Management
export {
  calculateExpirationTimestamp,
  isExpired,
  getRemainingTTL,
  createMetadataWithTTL,
  updateExpiration,
  extendTTL,
  createFileMetadata,
  createJsonMetadata,
  validateTTL,
  getRecommendedTTL,
  formatTTL,
  parseTTL,
  TTL_CONSTANTS
} from './ttl';

// CAS and Retry Logic
export {
  calculateBackoffDelay,
  addJitter,
  executeWithCasRetry,
  createCasOperation,
  conditionalPut,
  conditionalDelete,
  compareEtags,
  extractEtag,
  isValidEtag,
  createRetryStrategy
} from './cas';

// JSON Storage Functions
export {
  getJson,
  putJson,
  putJsonWithCas,
  updateJsonWithCas,
  deleteJson,
  jsonExists,
  getJsonEtag,
  createTypedJsonStorage
} from './json';

// File Blob Handling
export {
  putFile,
  getFile,
  deleteFile,
  fileExists,
  getFileMetadata,
  updateFileMetadata,
  getFileSize,
  getFileContentType,
  copyFile,
  moveFile,
  createTypedFileStorage
} from './files';

// Error Handling
export {
  ErrorRecoveryStrategy,
  handleR2Error,
  isRetryableError,
  createErrorResponse,
  mapErrorToStatusCode,
  createR2Error,
  withErrorHandling,
  createCircuitBreaker,
  withRetryAndCircuitBreaker,
  R2ErrorMetrics,
  globalErrorMetrics
} from './errors';

// Type-Safe Storage Manager
import { R2StorageManager, createR2Storage } from './storage';

export {
  R2StorageManager,
  createR2Storage
};

export type {
  AssistantStorage,
  ThreadStorage,
  MessageStorage,
  RunStorage,
  FileStorage,
  ToolStorage
} from './storage';

// Default export for convenience
const R2Helpers = {
  createR2Storage,
  R2StorageManager
};

export default R2Helpers;