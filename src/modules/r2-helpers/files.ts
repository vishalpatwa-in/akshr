import { AssistantR2Bucket, R2Metadata, R2Error, R2ErrorType } from './types';
import { createFileMetadata, isExpired } from './ttl';

/**
 * Stores a file blob in R2 with metadata
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @param blob - The file blob to store
 * @param metadata - Optional additional metadata
 * @returns Promise that resolves when the operation completes
 * @throws R2Error if the operation fails
 */
export async function putFile(
  bucket: AssistantR2Bucket,
  key: string,
  blob: Blob,
  metadata?: Record<string, string>
): Promise<void> {
  try {
    // Validate blob
    if (!blob || blob.size === 0) {
      throw new R2Error(
        R2ErrorType.VALIDATION_ERROR,
        'Invalid blob: blob is empty or null',
        400,
        key
      );
    }

    // Get blob properties
    const contentType = blob.type || 'application/octet-stream';
    const size = blob.size;

    // Create file metadata
    const fileMetadata = createFileMetadata(
      key.split('/').pop() || 'unknown', // Extract filename from key
      contentType,
      size,
      undefined, // No TTL for files by default
      metadata
    );

    // Store the file in R2
    await bucket.put(key, blob, {
      customMetadata: fileMetadata as any
    });

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to store file at key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Retrieves a file blob from R2
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to the file blob or null if not found
 * @throws R2Error if the operation fails
 */
export async function getFile(bucket: AssistantR2Bucket, key: string): Promise<Blob | null> {
  try {
    const object = await bucket.get(key);

    if (!object) {
      return null;
    }

    // Check if object has expired
    const metadata = object.customMetadata as any;
    if (isExpired(metadata)) {
      // Object has expired, delete it and return null
      await bucket.delete(key);
      return null;
    }

    // Convert R2Object to Blob
    return await objectToBlob(object);

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to retrieve file from key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Deletes a file blob from R2
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to true if the file was deleted, false if it didn't exist
 * @throws R2Error if the operation fails
 */
export async function deleteFile(bucket: AssistantR2Bucket, key: string): Promise<boolean> {
  try {
    // Check if file exists first
    const exists = await fileExists(bucket, key);
    if (!exists) {
      return false;
    }

    // Delete the file
    await bucket.delete(key);
    return true;

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to delete file at key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Checks if a file exists in R2
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to true if the file exists and is valid
 */
export async function fileExists(bucket: AssistantR2Bucket, key: string): Promise<boolean> {
  try {
    const object = await bucket.get(key);
    if (!object) {
      return false;
    }

    // Check if object has expired
    const metadata = object.customMetadata as any;
    if (isExpired(metadata)) {
      // Object has expired, clean it up
      await bucket.delete(key);
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Gets metadata for a file without retrieving the full blob
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to the file metadata or null if not found
 * @throws R2Error if the operation fails
 */
export async function getFileMetadata(
  bucket: AssistantR2Bucket,
  key: string
): Promise<R2Metadata | null> {
  try {
    const object = await bucket.get(key);

    if (!object) {
      return null;
    }

    // Check if object has expired
    const metadata = object.customMetadata as any;
    if (isExpired(metadata)) {
      // Object has expired, clean it up
      await bucket.delete(key);
      return null;
    }

    return metadata as R2Metadata;

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to retrieve file metadata from key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Updates metadata for an existing file
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @param metadata - New metadata to set
 * @returns Promise that resolves when the operation completes
 * @throws R2Error if the operation fails
 */
export async function updateFileMetadata(
  bucket: AssistantR2Bucket,
  key: string,
  metadata: Record<string, string>
): Promise<void> {
  try {
    // Get the current object
    const currentObject = await bucket.get(key);
    if (!currentObject) {
      throw new R2Error(
        R2ErrorType.NOT_FOUND,
        `File not found at key: ${key}`,
        404,
        key
      );
    }

    // Check if object has expired
    const currentMetadata = currentObject.customMetadata as any;
    if (isExpired(currentMetadata)) {
      await bucket.delete(key);
      throw new R2Error(
        R2ErrorType.NOT_FOUND,
        `File has expired at key: ${key}`,
        404,
        key
      );
    }

    // Convert object back to blob for re-upload
    const blob = await objectToBlob(currentObject);

    // Merge metadata
    const updatedMetadata = {
      ...currentMetadata,
      ...metadata
    };

    // Re-upload with updated metadata
    await bucket.put(key, blob, {
      customMetadata: updatedMetadata
    });

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to update file metadata at key: ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      key
    );
  }
}

/**
 * Gets the size of a file in bytes
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to the file size in bytes or null if not found
 */
export async function getFileSize(bucket: AssistantR2Bucket, key: string): Promise<number | null> {
  try {
    const metadata = await getFileMetadata(bucket, key);
    return metadata?.size || null;
  } catch (error) {
    return null;
  }
}

/**
 * Gets the content type of a file
 * @param bucket - The R2 bucket instance
 * @param key - The object key for the file
 * @returns Promise that resolves to the content type or null if not found
 */
export async function getFileContentType(bucket: AssistantR2Bucket, key: string): Promise<string | null> {
  try {
    const metadata = await getFileMetadata(bucket, key);
    return metadata?.contentType || null;
  } catch (error) {
    return null;
  }
}

/**
 * Copies a file to a new key
 * @param bucket - The R2 bucket instance
 * @param sourceKey - The source file key
 * @param destinationKey - The destination file key
 * @returns Promise that resolves when the operation completes
 * @throws R2Error if the operation fails
 */
export async function copyFile(
  bucket: AssistantR2Bucket,
  sourceKey: string,
  destinationKey: string
): Promise<void> {
  try {
    // Get the source file
    const sourceObject = await bucket.get(sourceKey);
    if (!sourceObject) {
      throw new R2Error(
        R2ErrorType.NOT_FOUND,
        `Source file not found at key: ${sourceKey}`,
        404,
        sourceKey
      );
    }

    // Check if source has expired
    const sourceMetadata = sourceObject.customMetadata as any;
    if (isExpired(sourceMetadata)) {
      await bucket.delete(sourceKey);
      throw new R2Error(
        R2ErrorType.NOT_FOUND,
        `Source file has expired at key: ${sourceKey}`,
        404,
        sourceKey
      );
    }

    // Convert to blob and store at destination
    const blob = await objectToBlob(sourceObject);

    // Update metadata for the copy
    const copyMetadata = {
      ...sourceMetadata,
      copiedFrom: sourceKey,
      copiedAt: new Date().toISOString()
    };

    await bucket.put(destinationKey, blob, {
      customMetadata: copyMetadata
    });

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to copy file from ${sourceKey} to ${destinationKey}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      sourceKey
    );
  }
}

/**
 * Moves a file to a new key (copy then delete)
 * @param bucket - The R2 bucket instance
 * @param sourceKey - The source file key
 * @param destinationKey - The destination file key
 * @returns Promise that resolves when the operation completes
 * @throws R2Error if the operation fails
 */
export async function moveFile(
  bucket: AssistantR2Bucket,
  sourceKey: string,
  destinationKey: string
): Promise<void> {
  try {
    // Copy the file first
    await copyFile(bucket, sourceKey, destinationKey);

    // Then delete the source
    await deleteFile(bucket, sourceKey);

  } catch (error) {
    if (error instanceof R2Error) {
      throw error;
    }

    throw new R2Error(
      R2ErrorType.INTERNAL_ERROR,
      `Failed to move file from ${sourceKey} to ${destinationKey}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      sourceKey
    );
  }
}

/**
 * Converts an R2Object to a Blob
 * @param object - The R2Object to convert
 * @returns Promise that resolves to the blob
 */
async function objectToBlob(object: R2Object): Promise<Blob> {
  const r2Object = object as any;
  if (r2Object.body) {
    return await r2Object.body.blob();
  }
  throw new Error('R2Object has no body');
}

/**
 * Creates a typed file storage interface for a specific type
 * @param bucket - The R2 bucket instance
 * @param keyPrefix - Optional key prefix for namespacing
 * @returns Object with typed file storage methods
 */
export function createTypedFileStorage(
  bucket: AssistantR2Bucket,
  keyPrefix?: string
) {
  const prefixKey = (key: string) => keyPrefix ? `${keyPrefix}/${key}` : key;

  return {
    put: (key: string, blob: Blob, metadata?: Record<string, string>) =>
      putFile(bucket, prefixKey(key), blob, metadata),
    get: (key: string) => getFile(bucket, prefixKey(key)),
    delete: (key: string) => deleteFile(bucket, prefixKey(key)),
    exists: (key: string) => fileExists(bucket, prefixKey(key)),
    getMetadata: (key: string) => getFileMetadata(bucket, prefixKey(key)),
    updateMetadata: (key: string, metadata: Record<string, string>) =>
      updateFileMetadata(bucket, prefixKey(key), metadata),
    getSize: (key: string) => getFileSize(bucket, prefixKey(key)),
    getContentType: (key: string) => getFileContentType(bucket, prefixKey(key)),
    copy: (sourceKey: string, destinationKey: string) =>
      copyFile(bucket, prefixKey(sourceKey), prefixKey(destinationKey)),
    move: (sourceKey: string, destinationKey: string) =>
      moveFile(bucket, prefixKey(sourceKey), prefixKey(destinationKey))
  };
}