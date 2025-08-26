# Garbage Collection System

A comprehensive garbage collection system for Cloudflare Workers R2 storage, designed to automatically clean up expired resources based on TTL (Time-To-Live) settings.

## Overview

The GC system provides automated cleanup of expired resources including:
- **Assistants** - AI assistant configurations
- **Threads** - Conversation threads
- **Messages** - Individual messages in threads
- **Runs** - Assistant execution runs
- **Files** - Uploaded files and metadata

## Features

### 🧹 **Automated Cleanup**
- Cron-triggered daily cleanup at 2 AM UTC
- Configurable TTL for different resource types
- Cascade deletion for related resources
- Safe deletion with error recovery

### 🔐 **Security & Authentication**
- Admin-only access with configurable keys
- Rate limiting for API endpoints
- Comprehensive security headers
- CORS support for cross-origin requests

### 📊 **Monitoring & Metrics**
- Detailed operation statistics
- Progress tracking
- Error reporting and recovery
- Comprehensive logging

### 🛡️ **Safety Features**
- Dry-run mode for testing
- Idempotent operations for retry safety
- Configurable batch processing
- Error containment and recovery

## Quick Start

### 1. Configuration

Add to your `wrangler.toml`:

```toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC

[secrets]
GC_ADMIN_KEY = "your-secure-admin-key-here"
```

### 2. Manual Trigger

```bash
# Trigger GC operation
curl -X POST https://your-domain.com/admin/gc \
  -H "Content-Type: application/json" \
  -H "X-GC-Admin-Key: your-admin-key" \
  -d '{
    "mode": "cleanup",
    "resourceTypes": ["assistant", "thread", "message", "run", "file"]
  }'
```

### 3. Dry Run (Testing)

```bash
# Test cleanup without actually deleting
curl -X POST https://your-domain.com/admin/gc/dry-run \
  -H "Content-Type: application/json" \
  -H "X-GC-Admin-Key: your-admin-key" \
  -d '{
    "resourceTypes": ["thread", "message"]
  }'
```

## API Endpoints

### POST `/admin/gc`
Trigger a garbage collection operation.

**Request Body:**
```json
{
  "mode": "cleanup" | "dry_run",
  "resourceTypes": ["assistant", "thread", "message", "run", "file"],
  "maxObjectsPerType": 10000,
  "batchSize": 100,
  "adminKey": "your-admin-key"
}
```

**Response:**
```json
{
  "success": true,
  "operationId": "gc-1234567890-abc123",
  "status": "completed",
  "summary": "GC operation completed...",
  "details": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### POST `/admin/gc/dry-run`
Test garbage collection without actually deleting objects.

### GET `/admin/gc/config`
Get current GC configuration and system status.

### GET `/admin/gc/status/{operationId}`
Get status of a specific GC operation (future feature).

## Configuration

### Default TTL Values

| Resource Type | TTL | Description |
|---------------|-----|-------------|
| `assistant` | 30 days | AI assistant configurations |
| `thread` | 7 days | Conversation threads |
| `message` | 7 days | Individual messages |
| `run` | 24 hours | Assistant execution runs |
| `file` | 7 days | Uploaded files |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GC_ADMIN_KEY` | Yes | Admin key for GC operations |
| `R2_BUCKET` | Yes | R2 bucket binding |

### GC Configuration Options

```typescript
interface GCConfig {
  mode: 'cleanup' | 'dry_run' | 'count';  // Operation mode
  resourceTypes?: string[];               // Resources to process
  maxObjectsPerType?: number;             // Max objects per type
  batchSize?: number;                     // Batch size for processing
  maxConcurrentBatches?: number;          // Concurrent batch limit
  rateLimit?: number;                     // Requests per second
  dryRun?: boolean;                       // Dry run mode
  continueOnErrors?: boolean;             // Continue on individual errors
  timeoutSeconds?: number;                // Operation timeout
  adminKey?: string;                      // Admin authentication key
}
```

## Resource-Specific Cleanup

### Assistants
- **Cleanup**: Direct deletion
- **Cascade**: Deletes related threads and runs
- **TTL**: 30 days (longer retention for configurations)

### Threads
- **Cleanup**: Direct deletion
- **Cascade**: Deletes related messages and runs
- **TTL**: 7 days (conversation retention)

### Messages
- **Cleanup**: Direct deletion
- **Cascade**: None (leaf resource)
- **TTL**: 7 days (message retention)

### Runs
- **Cleanup**: Direct deletion
- **Cascade**: None (execution records)
- **TTL**: 24 hours (short retention for runs)

### Files
- **Cleanup**: Deletes both metadata and blob
- **Cascade**: None
- **TTL**: 7 days (file retention)

## Batch Processing

The system processes objects in configurable batches:

```typescript
const config = {
  batchSize: 100,           // Objects per batch
  maxConcurrentBatches: 5,  // Concurrent processing
  rateLimit: 50            // Requests per second
};
```

### Pagination Support
- Automatic cursor-based pagination
- Configurable page sizes
- Memory-efficient processing

## Error Handling

### Error Recovery Strategies
- **Retry Logic**: Exponential backoff for transient failures
- **Circuit Breaker**: Prevents cascade failures
- **Error Containment**: Isolated resource processing
- **Graceful Degradation**: Continue processing on individual errors

### Error Types
- `VALIDATION_ERROR`: Invalid configuration or data
- `TTL_EXPIRED`: Object already expired
- `NOT_FOUND`: Object not found during cleanup
- `CONFLICT`: Concurrent modification conflict
- `INTERNAL_ERROR`: System-level errors

## Monitoring & Logging

### Metrics Collection
```typescript
interface GCMetrics {
  operations: {
    total: number;
    successful: number;
    failed: number;
    dryRun: number;
  };
  resources: Record<ResourceType, {
    totalProcessed: number;
    totalCleaned: number;
    totalErrors: number;
    averageProcessingTime: number;
  }>;
}
```

### Log Levels
- `DEBUG`: Detailed operation logs
- `INFO`: General operation information
- `WARN`: Non-critical issues
- `ERROR`: Critical errors and failures

## Security Considerations

### Authentication
- **Admin Key Required**: All GC operations require authentication
- **Multiple Key Sources**: Support for headers, body, and Authorization
- **Secure Key Storage**: Use Cloudflare Secrets for key management

### Rate Limiting
- **Request Limits**: Configurable requests per hour
- **IP-based Tracking**: Per-client rate limiting
- **Burst Protection**: Prevents abuse attempts

### Security Headers
```typescript
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};
```

## Best Practices

### Production Deployment
1. **Test in Dry Run Mode**: Always test with `dry_run` first
2. **Monitor Operations**: Check logs and metrics after deployment
3. **Configure Timeouts**: Set appropriate timeouts for your workload
4. **Backup Strategy**: Consider backup before enabling automatic deletion

### Performance Optimization
1. **Tune Batch Sizes**: Adjust based on your R2 performance
2. **Monitor Rate Limits**: Ensure rate limits don't impact cleanup
3. **Resource Prioritization**: Process high-priority resources first
4. **Memory Management**: Use appropriate batch sizes for memory constraints

### Error Handling
1. **Implement Retries**: Configure retry logic for transient failures
2. **Monitor Error Rates**: Alert on high error rates
3. **Circuit Breakers**: Implement circuit breakers for cascade failure prevention
4. **Graceful Degradation**: Ensure partial failures don't stop the entire operation

## Troubleshooting

### Common Issues

#### High Error Rates
```bash
# Check operation status
curl https://your-domain.com/admin/gc/config \
  -H "X-GC-Admin-Key: your-admin-key"
```

#### Rate Limiting
```json
{
  "error": {
    "message": "Rate limit exceeded. Too many GC requests.",
    "retryAfter": 3600
  }
}
```

#### Authentication Failures
```json
{
  "error": {
    "message": "Admin key required."
  }
}
```

### Debug Commands

```bash
# Get system configuration
curl https://your-domain.com/admin/gc/config \
  -H "X-GC-Admin-Key: your-admin-key"

# Dry run specific resources
curl -X POST https://your-domain.com/admin/gc/dry-run \
  -H "Content-Type: application/json" \
  -H "X-GC-Admin-Key: your-admin-key" \
  -d '{"resourceTypes": ["thread"]}'

# Full cleanup with custom batch size
curl -X POST https://your-domain.com/admin/gc \
  -H "Content-Type: application/json" \
  -H "X-GC-Admin-Key: your-admin-key" \
  -d '{
    "batchSize": 50,
    "maxObjectsPerType": 1000,
    "resourceTypes": ["message", "run"]
  }'
```

## Cron Scheduling

### Default Schedule
```toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC
```

### Custom Schedules
```toml
[triggers]
crons = [
  "0 */6 * * *",   # Every 6 hours
  "0 2 * * 0",     # Weekly on Sundays at 2 AM
  "0 2 1 * *"      # Monthly on the 1st at 2 AM
]
```

## Integration with Existing Systems

The GC system integrates seamlessly with existing R2 helpers:

### R2 Helpers Integration
```typescript
import { createR2Storage } from '../r2-helpers/storage';
import { createGarbageCollectionHandler } from './index';

// Use existing R2 storage
const storage = createR2Storage(env.R2_BUCKET);
const gcHandler = createGarbageCollectionHandler(env.R2_BUCKET);
```

### Monitoring Integration
```typescript
// Integrate with existing monitoring
import { monitoring } from '../monitoring';

// Log GC operations
monitoring.log({
  event: 'gc_operation',
  operationId: result.operationId,
  status: result.status,
  metrics: result.overallStats
});
```

## Future Enhancements

### Planned Features
- **Progress Streaming**: Real-time progress updates
- **Operation Persistence**: Store operation status in R2/D1
- **Advanced Scheduling**: Custom cron expressions per resource type
- **Metrics Dashboard**: Web-based monitoring interface
- **Automated Backups**: Backup before deletion
- **Smart TTL**: Dynamic TTL based on usage patterns

### API Improvements
- **Webhooks**: Notify on operation completion
- **Pagination**: Paginated results for large operations
- **Filtering**: Advanced filtering options
- **Bulk Operations**: Process multiple resource types simultaneously

## Contributing

When contributing to the GC system:

1. **Test Thoroughly**: Use dry-run mode for all changes
2. **Maintain Compatibility**: Ensure backward compatibility
3. **Document Changes**: Update this README for new features
4. **Security First**: All changes must maintain security standards
5. **Performance**: Consider performance impact of changes

## License

This garbage collection system is part of the OpenAI Compatible Assistant project and follows the same licensing terms.