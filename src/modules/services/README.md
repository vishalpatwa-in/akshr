# Services Module

This module provides comprehensive core business logic for creating and managing assistants, threads, messages, and files in the Cloudflare Workers environment.

## Architecture Overview

The services module follows a clean architecture pattern with the following components:

- **Service Layer**: Core business logic for each resource type
- **Repository Pattern**: Data access abstraction using R2 helpers
- **Validation Layer**: Business rules and input validation
- **Utility Classes**: ID generation, caching, business rules validation

## Services

### AssistantService

Manages OpenAI-compatible assistant resources with comprehensive validation and business rules.

**Features:**
- Full CRUD operations (Create, Read, Update, Delete)
- Model compatibility validation for Gemini
- Tool schema validation for Gemini compatibility
- Rate limiting and resource ownership validation
- Caching for performance optimization
- Pagination support for listing operations

**Key Methods:**
```typescript
create(data: CreateAssistantRequest): Promise<ServiceResult<Assistant>>
getById(id: string): Promise<ServiceResult<Assistant>>
update(id: string, data: UpdateAssistantRequest): Promise<ServiceResult<Assistant>>
delete(id: string): Promise<ServiceResult<void>>
list(options?: PaginationOptions): Promise<ServiceResult<ListResponse<Assistant>>>
listByOwner(ownerId: string, options?: PaginationOptions): Promise<ServiceResult<ListResponse<Assistant>>>
exists(id: string): Promise<boolean>
```

### ThreadService

Manages conversation threads with message relationship handling.

**Features:**
- Thread creation with optional metadata
- Message count tracking and summary
- Metadata updates with validation
- Cascade deletion considerations (placeholder for future implementation)
- Rate limiting and validation

**Key Methods:**
```typescript
create(data: CreateThreadRequest): Promise<ServiceResult<Thread>>
getById(id: string): Promise<ServiceResult<Thread>>
update(id: string, data: UpdateThreadRequest): Promise<ServiceResult<Thread>>
delete(id: string): Promise<ServiceResult<void>>
list(options?: PaginationOptions): Promise<ServiceResult<ListResponse<Thread>>>
getMessageCount(threadId: string): Promise<ServiceResult<number>>
```

### MessageService

Handles message management with comprehensive content processing and validation.

**Features:**
- Multi-format content processing (text, images, tool calls)
- Content validation and size limits
- Thread relationship validation
- Message type-specific validation (user, assistant, tool)
- Role-based validation rules
- Pagination support for message listing

**Key Methods:**
```typescript
create(threadId: string, data: CreateMessageRequest): Promise<ServiceResult<Message>>
getById(threadId: string, messageId: string): Promise<ServiceResult<Message>>
update(threadId: string, messageId: string, data: UpdateMessageRequest): Promise<ServiceResult<Message>>
delete(threadId: string, messageId: string): Promise<ServiceResult<void>>
listByThread(threadId: string, options?: PaginationOptions): Promise<ServiceResult<ListResponse<Message>>>
exists(threadId: string, messageId: string): Promise<boolean>
```

### FileService

Manages file uploads, storage, and lifecycle with comprehensive validation.

**Features:**
- File upload with metadata extraction
- File type validation for assistants
- Size limits and expiration management
- Status tracking and updates
- Content retrieval with expiration checks
- Cleanup operations for expired files
- Comprehensive validation for different file types

**Key Methods:**
```typescript
upload(data: UploadFileRequest): Promise<ServiceResult<File>>
getById(id: string): Promise<ServiceResult<File>>
getFileContent(id: string): Promise<ServiceResult<Blob | null>>
delete(id: string): Promise<ServiceResult<{ id: string; object: string; deleted: boolean }>>
list(options?: { purpose?: string; limit?: number }): Promise<ServiceResult<{ data: File[]; object: string }>>
updateStatus(id: string, status: FileStatus, statusDetails?: string): Promise<ServiceResult<File>>
cleanupExpiredFiles(): Promise<ServiceResult<{ deleted: number }>>
```

## Usage Example

```typescript
import { ServiceFactory } from './services';

// In your Cloudflare Worker
export default {
  async fetch(request: Request, env: any) {
    // Create service factory with R2 bucket
    const factory = new ServiceFactory(env.MY_R2_BUCKET);

    // Create individual services
    const assistantService = factory.createAssistantService();
    const threadService = factory.createThreadService();
    const messageService = factory.createMessageService();
    const fileService = factory.createFileService();

    // Or create all services at once
    const services = factory.createAllServices();

    // Example: Create an assistant
    const result = await services.assistants.create({
      name: "Math Tutor",
      instructions: "You are a helpful math tutor.",
      model: "gemini-1.5-flash",
      tools: [],
      metadata: { version: "1.0" }
    });

    if (result.success) {
      return new Response(JSON.stringify(result.data), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
```

## Business Rules and Validation

### Model Compatibility
- Supports Gemini models: `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash-exp`
- Validates model compatibility before creation

### Tool Schema Validation
- Validates function schemas for Gemini compatibility
- Ensures proper parameter types and structure
- Validates function names and descriptions

### Rate Limiting
- Implements configurable rate limits per operation
- Uses in-memory tracking with sliding window
- Returns appropriate error responses when limits are exceeded

### Content Validation
- Text content size limits (configurable, default 10MB)
- Image URL validation
- Message content structure validation
- Metadata size limits (16KB)

### File Validation
- File size limits (1 byte to 512MB)
- File type validation for assistants
- Supported formats: plain text, markdown, PDF, JSON, CSV, Word documents
- Expiration management with automatic cleanup

### Resource Relationships
- Thread-Message relationship validation
- Message role validation (user/assistant/tool)
- Tool message requirements (tool_call_id)
- Resource ownership validation

## Error Handling

All services return consistent error responses:

```typescript
interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
```

Common error codes:
- `VALIDATION_ERROR`: Input validation failed
- `NOT_FOUND_ERROR`: Resource not found
- `RATE_LIMIT_ERROR`: Rate limit exceeded
- `MODEL_VALIDATION_ERROR`: Model compatibility issue
- `TOOL_VALIDATION_ERROR`: Tool schema validation failed
- `CONTENT_PROCESSING_ERROR`: Content processing failed
- `STORAGE_ERROR`: R2 storage operation failed

## Performance Optimizations

### Caching
- In-memory LRU cache for frequently accessed resources
- Configurable TTL (Time-To-Live) for cache entries
- Cache invalidation on updates and deletes

### Pagination
- Efficient pagination for large datasets
- Configurable page sizes with reasonable defaults
- Metadata about pagination state (hasMore, firstId, lastId)

### Storage Optimization
- Uses R2 helpers with TTL for automatic expiration
- Efficient key patterns for resource relationships
- Optimized storage operations for Cloudflare Workers

## Configuration

Services are configured through the `ServiceConfig` interface:

```typescript
interface ServiceConfig {
  storage: R2StorageManager;
  bucket: AssistantR2Bucket;
}
```

### Environment Setup

Ensure your Cloudflare Worker has access to:
- R2 bucket binding for data persistence
- Sufficient memory for caching and operations
- Appropriate timeout settings for file operations

## Future Enhancements

The services are designed to be extensible. Potential future enhancements include:

- Database integration for complex queries
- Redis caching for distributed deployments
- Background job processing for file cleanup
- Advanced analytics and monitoring
- Integration with external file storage services
- Advanced search and filtering capabilities