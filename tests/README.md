# OpenAI Assistant API Acceptance Test Suite

A comprehensive acceptance test suite for the Cloudflare Workers OpenAI Assistant API implementation. This test suite validates all features including TTL/GC, concurrency handling, streaming, file uploads, authentication, and end-to-end workflows.

## Features Tested

### 1. TTL/GC Tests
- Automatic expiration after 48 hours
- Manual GC trigger and cleanup
- Dry-run mode for GC operations
- Cascade deletion behavior
- GC statistics and reporting

### 2. Concurrency Conflict Tests
- ETag CAS conflict handling
- Optimistic concurrency control
- Concurrent run creation and updates
- Retry logic on 409 conflicts
- State transition safety

### 3. End-to-End Tool-Call Round Trip Tests
- Complete assistant creation to tool call completion workflow
- Assistant with file access workflows
- Error handling in end-to-end flows
- Concurrent end-to-end workflows

### 4. Streaming Tests
- SSE streaming for runs
- NDJSON streaming format
- Streaming with tool calls
- Streaming error handling
- Streaming cancellation

### 5. File Upload/Serve Tests
- Multipart file upload
- File metadata retrieval
- File content serving
- File deletion
- File type validation

### 6. Authentication Tests
- Missing authorization header handling
- Invalid API key handling
- Malformed authorization header handling
- Admin key for GC operations
- Bypass key functionality

### 7. API Endpoint Tests
- All CRUD operations for assistants, threads, messages, runs
- Thread management with messages
- Run lifecycle management
- Error responses and validation
- Pagination for list endpoints

### 8. Rate Limiting Tests
- Rate limit enforcement
- Rate limit headers
- Rate limit recovery
- Different endpoint limits

## Prerequisites

- **bash** (4.0 or later)
- **curl** (for HTTP requests)
- **jq** (optional, for JSON processing - tests will work without it but with reduced functionality)
- **Cloudflare Worker** with OpenAI Assistant API deployed and accessible

## Installation

1. Clone or navigate to the test directory:
   ```bash
   cd openai-compatible-assistant/tests/
   ```

2. Make the test scripts executable:
   ```bash
   chmod +x run-tests.sh
   chmod +x tests/*.sh
   ```

3. Configure your deployment settings (see Configuration section below)

## Configuration

### Environment Variables

Set the following environment variables or create a `.env` file:

```bash
# Required: Base URL of your deployed Cloudflare Worker
export BASE_URL="https://your-worker.your-subdomain.workers.dev"

# Required: API key for authentication
export API_KEY="your-api-key-here"

# Required: Admin key for GC operations
export GC_ADMIN_KEY="your-gc-admin-key-here"

# Optional: Bypass key for special operations
export BYPASS_KEY="your-bypass-key-here"

# Optional: Test execution settings
export TEST_TIMEOUT=30
export PARALLEL_JOBS=3
export LOG_LEVEL=INFO
export HTTP_DEBUG=false
export OUTPUT_DIR="./test-results"
```

### Configuration File

Alternatively, edit `tests/config.sh` directly:

```bash
# Update these values with your deployment details
BASE_URL="https://your-worker.your-subdomain.workers.dev"
API_KEY="your-api-key-here"
GC_ADMIN_KEY="your-gc-admin-key-here"
BYPASS_KEY="your-bypass-key-here"
```

## Usage

### Run All Tests

```bash
./run-tests.sh
```

### Run Specific Test Category

```bash
# Run only TTL/GC tests
./run-tests.sh ttl-gc

# Run only concurrency tests
./run-tests.sh concurrency

# Run only authentication tests
./run-tests.sh authentication

# Available categories: ttl-gc, concurrency, end-to-end, streaming,
# file-upload, authentication, api-endpoints, rate-limiting
```

### Run with Verbose Logging

```bash
./run-tests.sh --verbose
```

### Run with Debug Logging

```bash
./run-tests.sh --debug
```

### Dry Run (Show What Would Be Tested)

```bash
./run-tests.sh --dry-run
```

### Custom Configuration

```bash
./run-tests.sh --config /path/to/custom/config.sh
```

### Cleanup Only

```bash
./run-tests.sh --cleanup-only
```

## Test Structure

```
tests/
├── run-tests.sh          # Main test runner
├── config.sh             # Configuration settings
├── utils.sh              # Utility functions
├── fixtures.sh           # Test data fixtures
├── README.md             # This documentation
└── tests/                # Individual test suites
    ├── test-ttl-gc.sh
    ├── test-concurrency.sh
    ├── test-end-to-end.sh
    ├── test-streaming.sh
    ├── test-file-upload.sh
    ├── test-authentication.sh
    ├── test-api-endpoints.sh
    └── test-rate-limiting.sh
```

## Test Results

### Output Format

Test results are saved in JSON format to `test-results/` directory:

```json
{
  "test_run": {
    "start_time": "2024-01-01T12:00:00Z",
    "end_time": "2024-01-01T12:05:30Z",
    "duration_seconds": 330,
    "configuration": {
      "base_url": "https://api.example.com",
      "timeout": 30,
      "parallel_jobs": 3
    },
    "summary": {
      "total_tests": 150,
      "passed_tests": 145,
      "failed_tests": 5,
      "success_rate": 96.67
    },
    "categories": [
      {
        "name": "ttl-gc",
        "duration_seconds": 45,
        "results": {
          "passed": 12,
          "failed": 1,
          "test_groups": [...]
        }
      }
    ]
  }
}
```

### Interpreting Results

- **Success Rate**: Percentage of tests that passed
- **Test Categories**: Each category shows individual test results
- **Duration**: Time taken for each test category
- **Detailed Results**: Individual test function results within each category

### Log Levels

- **DEBUG**: Detailed HTTP requests, responses, and internal operations
- **INFO**: Test progress, results, and important events
- **WARN**: Non-critical issues that don't fail tests
- **ERROR**: Test failures and critical errors

## Troubleshooting

### Common Issues

#### 1. Configuration Errors

```
Configuration errors found:
  - BASE_URL is not configured. Please set your deployed worker URL.
  - API_KEY is not configured. Please set your API key.
```

**Solution**: Set the required environment variables or update `config.sh`

#### 2. Connection Refused

```
curl: (7) Failed to connect to localhost port 8787: Connection refused
```

**Solution**: Ensure your Cloudflare Worker is deployed and accessible

#### 3. Authentication Failed

```
Test failed: Invalid API key
```

**Solution**: Verify your API key is correct and properly configured

#### 4. Timeout Errors

```
Test timed out after 30 seconds
```

**Solution**: Increase `TEST_TIMEOUT` or check network connectivity

### Debugging Tests

Enable debug logging to see detailed HTTP requests and responses:

```bash
export LOG_LEVEL=DEBUG
export HTTP_DEBUG=true
./run-tests.sh
```

### Test Isolation

Each test category creates its own resources and cleans them up. However, if tests are interrupted, you may need to manually clean up resources:

```bash
./run-tests.sh --cleanup-only
```

## API Coverage

### Endpoints Tested

| Endpoint | Methods | Tests |
|----------|---------|-------|
| `/v1/assistants` | GET, POST, PUT, DELETE | CRUD operations, validation |
| `/v1/threads` | GET, POST, PUT, DELETE | Thread management |
| `/v1/threads/{id}/messages` | GET, POST, PUT, DELETE | Message operations |
| `/v1/threads/{id}/runs` | GET, POST | Run lifecycle |
| `/v1/threads/{id}/runs/{id}/cancel` | POST | Run cancellation |
| `/v1/threads/{id}/runs/{id}/submit_tool_outputs` | POST | Tool output submission |
| `/v1/files` | GET, POST, DELETE | File operations |
| `/v1/files/{id}/content` | GET | File content serving |
| `/admin/gc` | POST | GC trigger |
| `/admin/gc/config` | GET | GC configuration |
| `/admin/gc/dry-run` | POST | GC dry run |
| `/admin/gc/status/{id}` | GET | GC status |

### Features Tested

- ✅ CRUD operations for all resources
- ✅ Request validation and error handling
- ✅ Authentication and authorization
- ✅ Rate limiting
- ✅ File upload and serving
- ✅ Streaming responses
- ✅ Tool calling workflows
- ✅ Concurrency control
- ✅ TTL and garbage collection
- ✅ Error recovery and retry logic

## Performance Benchmarks

### Expected Performance

- **Individual API calls**: < 1 second
- **File uploads**: < 30 seconds (depending on size)
- **Streaming responses**: < 5 seconds to establish
- **Concurrent requests**: System dependent
- **GC operations**: < 10 minutes (depending on data volume)

### Performance Testing

Run tests with timing information:

```bash
time ./run-tests.sh
```

## Contributing

### Adding New Tests

1. Create a new test file in `tests/` directory
2. Follow the naming convention: `test-{category}.sh`
3. Implement test functions with descriptive names
4. Add your tests to the `TEST_CATEGORIES` array in `run-tests.sh`
5. Update this documentation

### Test Function Guidelines

```bash
# Good test function
test_specific_feature() {
    log INFO "Testing specific feature..."

    local passed=0
    local failed=0

    # Test implementation
    # ...

    log INFO "Feature tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"specific_feature\", \"passed\": $passed, \"failed\": $failed}]}"
}
```

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review test logs with debug enabled
3. Verify your Cloudflare Worker deployment
4. Check API key and configuration settings

## License

This test suite is part of the OpenAI Assistant API project. See project license for details.