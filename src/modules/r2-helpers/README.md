# R2 Helpers - Comprehensive Cloudflare R2 Storage Utilities

This module provides a complete set of utilities for working with Cloudflare R2 storage in Cloudflare Workers, offering type-safe operations, ETag-based concurrency control, TTL management, and comprehensive error handling.

## Features

- **Type-Safe JSON Storage**: Full TypeScript support with generics for all JSON operations
- **ETag CAS (Compare-and-Swap)**: Atomic operations with exponential backoff retry logic
- **TTL Management**: Automatic expiration handling with customizable retention periods
- **File Blob Handling**: Complete file storage with metadata support
- **Error Recovery**: Multiple error handling strategies with circuit breaker patterns
- **Key Management**: Predictable key generation with entity-based prefixes
- **Integration Ready**: Seamless integration with existing models and validators

## Quick Start

```typescript
import { createR2Storage } from './r2-helpers';

// In your Cloudflare Worker
export default {
  async fetch(request: Request, env: any) {
    const storage = createR2Storage(env.R2_BUCKET);

    // Store an assistant
    const assistant = { id: 'asst_123', name: 'My Assistant', model: 'gpt-4' };
    await storage.assistants.put(assistant);

    // Retrieve with type safety
    const retrieved = await storage.assistants.get('asst_123');

    // CAS operations for concurrency control
    const result = await storage.assistants.putWithCas(
      assistant,
      retrieved.etag,
      { ttlSeconds: 86400 } // 24 hours
    );

    return Response.json({ success: result.success });
  }
};
```

## Core Components

### 1. Type-Safe Storage Manager

The `R2StorageManager` provides entity-specific storage interfaces:

```typescript
const storage = createR2Storage(env.R2_BUCKET);

// Entity-specific storages
await storage.assistants.put(assistant);
await storage.threads.get(threadId);
await storage.messages.put(threadId, message);
await storage.runs.updateWithCas(threadId, runId, updater);
await storage.files.putBlob(fileId, blob, metadata);
await storage.tools.put(toolName, tool);
```

### 2. JSON Storage Functions

Basic CRUD operations with optional TTL:

```typescript
import { putJson, getJson, putJsonWithCas } from './r2-helpers';

// Basic operations
await putJson(bucket, key, data, { ttlSeconds: 3600 });
const data = await getJson<MyType>(bucket, key);

// CAS for concurrency control
const result = await putJsonWithCas(bucket, key, data, etag);
if (!result.success) {
  console.log('Conflict detected, handle accordingly');
}
```

### 3. File Blob Handling

Complete file storage with metadata:

```typescript
import { putFile, getFile, deleteFile } from './r2-helpers';

// Store file with metadata
await putFile(bucket, key, blob, {
  contentType: 'image/jpeg',
  filename: 'photo.jpg'
});

// Retrieve file
const blob = await getFile(bucket, key);
if (blob) {
  // Process the blob
}

// Delete file
const deleted = await deleteFile(bucket, key);
```

### 4. Key Management

Predictable key generation with entity prefixes:

```typescript
import { getAssistantKey, getThreadKey, getMessageKey } from './r2-helpers';

// Generate keys for different entities
const assistantKey = getAssistantKey('asst_123');        // 'assistants/asst_123.json'
const threadKey = getThreadKey('thread_456');            // 'threads/thread_456.json'
const messageKey = getMessageKey('thread_456', 'msg_789'); // 'messages/thread_456/msg_789.json'
```

### 5. TTL and Metadata Management

Automatic expiration handling:

```typescript
import { createJsonMetadata, getRecommendedTTL } from './r2-helpers';

// Recommended TTL for different entity types
const assistantTTL = getRecommendedTTL('assistant'); // 30 days
const threadTTL = getRecommendedTTL('thread');       // 7 days
const runTTL = getRecommendedTTL('run');             // 24 hours

// Custom metadata with TTL
const metadata = createJsonMetadata('assistant', assistantTTL, {
  customField: 'value'
});
```

### 6. CAS with Retry Logic

Exponential backoff for conflict resolution:

```typescript
import { executeWithCasRetry, CAS_STRATEGIES } from './r2-helpers';

// Execute operation with retry
const result = await executeWithCasRetry(
  async (etag) => {
    // Your CAS operation here
    return await conditionalPut(bucket, key, data, { etag });
  },
  CAS_STRATEGIES.STANDARD // 3 retries, 100ms-1000ms backoff
);
```

### 7. Error Handling

Comprehensive error recovery strategies:

```typescript
import { withErrorHandling, ErrorRecoveryStrategy } from './r2-helpers';

// Wrap operations with error handling
const result = await withErrorHandling(
  () => getJson(bucket, key),
  {
    strategy: ErrorRecoveryStrategy.RETRY,
    maxRetries: 3,
    logger: (error) => console.error('R2 Error:', error)
  }
);
```

## Configuration

### Wrangler Configuration

Add R2 bucket binding to your `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-bucket-name"
```

### TypeScript Configuration

The module is designed for Cloudflare Workers environment. Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "lib": ["es2021"],
    "target": "es2021",
    "module": "esnext",
    "moduleResolution": "node"
  }
}
```

## API Reference

### Storage Interfaces

#### AssistantStorage
- `get(id: string): Promise<Assistant | null>`
- `put(assistant: Assistant, options?: JsonStorageOptions): Promise<void>`
- `putWithCas(assistant: Assistant, etag?: string, options?: CasOptions): Promise<CasResult<Assistant>>`
- `updateWithCas(id: string, updater: (current: Assistant | null) => Assistant, options?: CasOptions): Promise<CasResult<Assistant>>`
- `delete(id: string, etag?: string): Promise<CasResult<void>>`
- `exists(id: string): Promise<boolean>`

#### FileStorage
- `getMetadata(fileId: string): Promise<File | null>`
- `putMetadata(file: File, options?: JsonStorageOptions): Promise<void>`
- `putBlob(fileId: string, blob: Blob, metadata?: Record<string, string>): Promise<void>`
- `getBlob(fileId: string): Promise<Blob | null>`
- `delete(fileId: string): Promise<boolean>`
- `exists(fileId: string): Promise<boolean>`
- `getBlobUrl(fileId: string): string`

### Utility Functions

#### JSON Operations
- `getJson<T>(bucket, key): Promise<T | null>`
- `putJson<T>(bucket, key, data, options?): Promise<void>`
- `putJsonWithCas<T>(bucket, key, data, etag?, options?): Promise<CasResult<T>>`

#### File Operations
- `putFile(bucket, key, blob, metadata?): Promise<void>`
- `getFile(bucket, key): Promise<Blob | null>`
- `deleteFile(bucket, key): Promise<boolean>`

#### Key Management
- `getAssistantKey(id): string`
- `getThreadKey(id): string`
- `getMessageKey(threadId, messageId): string`
- `getRunKey(threadId, runId): string`
- `getFileMetadataKey(fileId): string`
- `getFileBlobKey(fileId): string`

#### TTL Management
- `getRecommendedTTL(entityType): number`
- `createJsonMetadata(objectType, ttl?, customMetadata?): R2Metadata`
- `isExpired(metadata): boolean`

#### Error Handling
- `withErrorHandling<T>(operation, config): Promise<T>`
- `createCircuitBreaker(failureThreshold?, recoveryTimeout?)`

## Best Practices

### 1. Use Appropriate TTL Values

```typescript
// Use recommended TTLs for different entity types
const assistantOptions = { ttlSeconds: getRecommendedTTL('assistant') }; // 30 days
const threadOptions = { ttlSeconds: getRecommendedTTL('thread') };       // 7 days
const runOptions = { ttlSeconds: getRecommendedTTL('run') };             // 24 hours
```

### 2. Handle CAS Conflicts

```typescript
// Always check CAS operation results
const result = await storage.assistants.putWithCas(assistant, etag);
if (!result.success) {
  if (result.error === 'conflict') {
    // Handle conflict - maybe retry with fresh data
    const current = await storage.assistants.get(assistant.id);
    // Merge changes and retry
  } else {
    // Handle other errors
    throw new Error(`Failed to update assistant: ${result.error}`);
  }
}
```

### 3. Use Error Handling Strategically

```typescript
// For critical operations, use retry
const criticalData = await withErrorHandling(
  () => getJson(bucket, 'critical/key'),
  { strategy: ErrorRecoveryStrategy.RETRY, maxRetries: 3 }
);

// For non-critical operations, use fallback
const optionalData = await withErrorHandling(
  () => getJson(bucket, 'optional/key'),
  {
    strategy: ErrorRecoveryStrategy.FALLBACK,
    fallback: () => Promise.resolve({ defaultValue: true })
  }
);
```

### 4. Batch Related Operations

```typescript
// For related operations, consider transactional behavior
const assistant = { id: 'asst_123', name: 'Assistant' };
const thread = { id: 'thread_456', assistant_id: 'asst_123' };

try {
  await Promise.all([
    storage.assistants.put(assistant),
    storage.threads.put(thread)
  ]);
} catch (error) {
  // Handle partial failure - consider cleanup
}
```

### 5. Monitor and Log Errors

```typescript
import { globalErrorMetrics } from './r2-helpers';

// Set up error monitoring
const errorConfig = {
  logger: (error) => {
    globalErrorMetrics.recordError(error.type, error.key);
    console.error('R2 Operation Error:', error);
  }
};

// Use consistent error handling
await withErrorHandling(operation, errorConfig);
```

## Error Types

The module defines specific error types for better error handling:

- `R2ErrorType.NOT_FOUND`: Resource not found
- `R2ErrorType.CONFLICT`: CAS conflict (ETag mismatch)
- `R2ErrorType.VALIDATION_ERROR`: Invalid data or parameters
- `R2ErrorType.INTERNAL_ERROR`: Internal storage error
- `R2ErrorType.TTL_EXPIRED`: Object has expired

## Performance Considerations

1. **Key Naming**: Use consistent key patterns for efficient listing operations
2. **TTL Usage**: Set appropriate TTL values to manage storage costs
3. **Batch Operations**: Use Promise.all for parallel operations when possible
4. **Error Handling**: Use appropriate error recovery strategies based on operation criticality
5. **Metadata**: Keep metadata size reasonable to avoid performance impact

## Migration Guide

When migrating from direct R2 operations:

1. Replace direct `bucket.get()` calls with typed storage methods
2. Add TTL management where appropriate
3. Implement CAS operations for concurrent scenarios
4. Add proper error handling and logging
5. Use the key management utilities for consistent naming

## Contributing

When extending this module:

1. Maintain type safety with generics
2. Add comprehensive JSDoc documentation
3. Include error handling for all new operations
4. Add tests for new functionality
5. Update this README with new features

## License

This module is part of the OpenAI Compatible Assistant project and follows the same licensing terms.