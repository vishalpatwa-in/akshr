import { R2Metadata, DEFAULT_TTL } from './types';

/**
 * Calculates the expiration timestamp for an object
 * @param ttlSeconds - TTL in seconds (optional, defaults to 48 hours)
 * @returns ISO timestamp string when the object expires
 */
export function calculateExpirationTimestamp(ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? DEFAULT_TTL.HOURS_48;
  const now = new Date();
  const expirationTime = new Date(now.getTime() + (ttl * 1000));
  return expirationTime.toISOString();
}

/**
 * Checks if an object has expired based on its metadata
 * @param metadata - The R2 object metadata
 * @returns True if the object has expired, false otherwise
 */
export function isExpired(metadata?: R2Metadata): boolean {
  if (!metadata?.expiresAt) {
    return false; // No expiration set, so never expired
  }

  const expirationTime = new Date(metadata.expiresAt);
  const now = new Date();
  return now > expirationTime;
}

/**
 * Calculates the remaining TTL for an object
 * @param metadata - The R2 object metadata
 * @returns Remaining seconds until expiration, or null if no expiration set
 */
export function getRemainingTTL(metadata?: R2Metadata): number | null {
  if (!metadata?.expiresAt) {
    return null;
  }

  const expirationTime = new Date(metadata.expiresAt);
  const now = new Date();
  const remainingMs = expirationTime.getTime() - now.getTime();

  return Math.max(0, Math.floor(remainingMs / 1000));
}

/**
 * Creates metadata with TTL information
 * @param ttlSeconds - TTL in seconds (optional)
 * @param customMetadata - Additional custom metadata
 * @returns Complete metadata object with TTL information
 */
export function createMetadataWithTTL(
  ttlSeconds?: number,
  customMetadata?: Record<string, string | number | boolean>
): R2Metadata {
  const now = new Date();
  const metadata: R2Metadata = {
    createdAt: now.toISOString(),
    ...customMetadata
  };

  if (ttlSeconds !== undefined && ttlSeconds > 0) {
    metadata.expiresAt = calculateExpirationTimestamp(ttlSeconds);
  }

  return metadata;
}

/**
 * Updates the expiration time for an existing object
 * @param currentMetadata - Current metadata object
 * @param newTtlSeconds - New TTL in seconds
 * @returns Updated metadata object
 */
export function updateExpiration(
  currentMetadata: R2Metadata,
  newTtlSeconds: number
): R2Metadata {
  const updated = { ...currentMetadata };

  if (newTtlSeconds > 0) {
    updated.expiresAt = calculateExpirationTimestamp(newTtlSeconds);
  } else {
    delete updated.expiresAt;
  }

  return updated;
}

/**
 * Extends the TTL for an existing object
 * @param currentMetadata - Current metadata object
 * @param additionalSeconds - Additional seconds to add to the current TTL
 * @returns Updated metadata object
 */
export function extendTTL(
  currentMetadata: R2Metadata,
  additionalSeconds: number
): R2Metadata {
  const updated = { ...currentMetadata };

  if (currentMetadata.expiresAt) {
    const currentExpiration = new Date(currentMetadata.expiresAt);
    const newExpiration = new Date(currentExpiration.getTime() + (additionalSeconds * 1000));
    updated.expiresAt = newExpiration.toISOString();
  } else {
    // No current expiration, set new one
    updated.expiresAt = calculateExpirationTimestamp(additionalSeconds);
  }

  return updated;
}

/**
 * Creates file-specific metadata
 * @param filename - Original filename
 * @param contentType - MIME content type
 * @param size - File size in bytes
 * @param ttlSeconds - TTL in seconds (optional)
 * @param customMetadata - Additional custom metadata
 * @returns Complete metadata object for file storage
 */
export function createFileMetadata(
  filename: string,
  contentType: string,
  size: number,
  ttlSeconds?: number,
  customMetadata?: Record<string, string | number | boolean>
): R2Metadata {
  return createMetadataWithTTL(ttlSeconds, {
    filename,
    contentType,
    size,
    ...customMetadata
  });
}

/**
 * Creates JSON object metadata
 * @param objectType - Type of object (e.g., 'assistant', 'thread', 'message', 'run')
 * @param ttlSeconds - TTL in seconds (optional)
 * @param customMetadata - Additional custom metadata
 * @returns Complete metadata object for JSON storage
 */
export function createJsonMetadata(
  objectType: string,
  ttlSeconds?: number,
  customMetadata?: Record<string, string | number | boolean>
): R2Metadata {
  return createMetadataWithTTL(ttlSeconds, {
    objectType,
    ...customMetadata
  });
}

/**
 * Validates TTL configuration
 * @param ttlSeconds - TTL to validate
 * @returns Object with validation result and error message if invalid
 */
export function validateTTL(ttlSeconds?: number): { valid: boolean; error?: string } {
  if (ttlSeconds === undefined || ttlSeconds === null) {
    return { valid: true }; // TTL is optional
  }

  if (typeof ttlSeconds !== 'number') {
    return { valid: false, error: 'TTL must be a number' };
  }

  if (ttlSeconds < 0) {
    return { valid: false, error: 'TTL cannot be negative' };
  }

  if (ttlSeconds > DEFAULT_TTL.DAYS_365) {
    return { valid: false, error: 'TTL cannot exceed 365 days' };
  }

  return { valid: true };
}

/**
 * Gets the appropriate TTL for different object types
 * @param objectType - Type of object
 * @returns Recommended TTL in seconds
 */
export function getRecommendedTTL(objectType: string): number {
  const ttlMap: Record<string, number> = {
    'assistant': DEFAULT_TTL.DAYS_30, // Assistants persist longer
    'thread': DEFAULT_TTL.DAYS_7,     // Threads for a week
    'message': DEFAULT_TTL.DAYS_7,    // Messages for a week
    'run': DEFAULT_TTL.HOURS_24,      // Runs for a day
    'file': DEFAULT_TTL.DAYS_7,       // Files for a week
    'tool': DEFAULT_TTL.DAYS_30       // Tools persist longer
  };

  return ttlMap[objectType] ?? DEFAULT_TTL.HOURS_48;
}

/**
 * Constants for TTL calculations
 */
export const TTL_CONSTANTS = {
  /** One second in milliseconds */
  SECOND_MS: 1000,
  /** One minute in milliseconds */
  MINUTE_MS: 60 * 1000,
  /** One hour in milliseconds */
  HOUR_MS: 60 * 60 * 1000,
  /** One day in milliseconds */
  DAY_MS: 24 * 60 * 60 * 1000,
  /** One week in milliseconds */
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  /** One month in milliseconds (approx) */
  MONTH_MS: 30 * 24 * 60 * 60 * 1000,
  /** One year in milliseconds */
  YEAR_MS: 365 * 24 * 60 * 60 * 1000,
  /** 365 days in seconds for validation */
  DAYS_365: 365 * 24 * 60 * 60
} as const;

/**
 * Formats TTL duration for display
 * @param seconds - TTL in seconds
 * @returns Human-readable duration string
 */
export function formatTTL(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  } else if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  } else {
    return `${Math.floor(seconds / 86400)}d`;
  }
}

/**
 * Parses TTL from various formats
 * @param ttlInput - TTL input (number, string like "24h", "7d", etc.)
 * @returns TTL in seconds, or null if invalid
 */
export function parseTTL(ttlInput: number | string): number | null {
  if (typeof ttlInput === 'number') {
    return ttlInput;
  }

  if (typeof ttlInput === 'string') {
    const match = ttlInput.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];

      switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        case 'd': return value * 86400;
        default: return null;
      }
    }
  }

  return null;
}