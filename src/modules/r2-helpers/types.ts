/**
 * R2 Bucket binding interface for the assistant storage
 * Uses Cloudflare Workers built-in R2Bucket type
 */
export type AssistantR2Bucket = R2Bucket;

/**
 * Metadata structure for stored objects with TTL information
 */
export interface R2Metadata {
  /** ISO timestamp when the object was created */
  createdAt?: string;
  /** ISO timestamp when the object expires */
  expiresAt?: string;
  /** Content type for file objects */
  contentType?: string;
  /** Original filename for file objects */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /** Custom metadata fields */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Options for storing JSON objects
 */
export interface JsonStorageOptions {
  /** TTL in seconds (default: 48 hours) */
  ttlSeconds?: number;
  /** Additional metadata to store */
  metadata?: Record<string, string>;
}

/**
 * Options for CAS operations
 */
export interface CasOptions extends JsonStorageOptions {
  /** ETag for conditional operations */
  etag?: string;
  /** Maximum retry attempts for CAS conflicts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds (default: 100) */
  initialBackoffMs?: number;
  /** Maximum backoff delay in milliseconds (default: 1000) */
  maxBackoffMs?: number;
}

/**
 * Result of a CAS operation
 */
export interface CasResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The stored data (if successful) */
  data?: T;
  /** New ETag of the stored object */
  etag?: string;
  /** Number of retries attempted */
  retries: number;
  /** Error message if operation failed */
  error?: string;
}

/**
 * R2 operation error types
 */
export enum R2ErrorType {
  NOT_FOUND = 'not_found',
  CONFLICT = 'conflict',
  VALIDATION_ERROR = 'validation_error',
  INTERNAL_ERROR = 'internal_error',
  TTL_EXPIRED = 'ttl_expired'
}

/**
 * Custom error class for R2 operations
 */
export class R2Error extends Error {
  public readonly type: R2ErrorType;
  public readonly statusCode: number;
  public readonly key?: string;

  constructor(
    type: R2ErrorType,
    message: string,
    statusCode: number = 500,
    key?: string
  ) {
    super(message);
    this.name = 'R2Error';
    this.type = type;
    this.statusCode = statusCode;
    this.key = key;
  }
}

/**
 * Key prefixes for different object types
 */
export const KEY_PREFIXES = {
  ASSISTANT: 'assistants',
  THREAD: 'threads',
  MESSAGE: 'messages',
  RUN: 'runs',
  FILE_META: 'files',
  FILE_BLOB: 'files'
} as const;

/**
 * Default TTL constants
 */
export const DEFAULT_TTL = {
  /** 48 hours in seconds */
  HOURS_48: 48 * 60 * 60,
  /** 24 hours in seconds */
  HOURS_24: 24 * 60 * 60,
  /** 7 days in seconds */
  DAYS_7: 7 * 24 * 60 * 60,
  /** 30 days in seconds */
  DAYS_30: 30 * 24 * 60 * 60,
  /** 365 days in seconds for validation */
  DAYS_365: 365 * 24 * 60 * 60
} as const;

/**
 * CAS retry configuration
 */
export const CAS_CONFIG = {
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_INITIAL_BACKOFF_MS: 100,
  DEFAULT_MAX_BACKOFF_MS: 1000,
  BACKOFF_MULTIPLIER: 2
} as const;