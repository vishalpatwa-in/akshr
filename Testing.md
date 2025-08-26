# OpenAI Compatible Assistant - API Testing Guide

This comprehensive testing guide provides curl commands for testing all endpoints of the deployed CloudFlare Worker. The API is designed to be compatible with OpenAI's Assistant API while running on Cloudflare Workers infrastructure.

## 🚀 Quick Start

### Prerequisites
1. Deploy the CloudFlare Worker to get your `WORKER_URL`
2. Set your `API_KEY` secret in the worker configuration
3. Have `GEMINI_API_KEY` configured for AI functionality

```bash
# Example setup (replace with your actual values)
export WORKER_URL="https://your-worker.your-account.workers.dev"
export API_KEY="your-api-key-here"
```

### Base Testing Commands
```bash
# Test with authentication
curl -X GET "$WORKER_URL/health" \
  -H "Authorization: Bearer $API_KEY"

# Test without authentication (for health check)
curl -X GET "$WORKER_URL/health"
```

## 📋 Table of Contents

1. [Health Check](#health-check)
2. [Chat Completions](#chat-completions)
3. [Completions](#completions)
4. [Models](#models)
5. [Assistants](#assistants)
6. [Threads](#threads)
7. [Messages](#messages)
8. [Runs](#runs)
9. [Files](#files)
10. [Garbage Collection Admin](#garbage-collection-admin)
11. [Error Handling](#error-handling)
12. [Streaming](#streaming)
13. [Advanced Testing](#advanced-testing)

---

## 🔍 Health Check

Test the basic health and status of the deployed worker.

### Basic Health Check
```bash
curl -X GET "$WORKER_URL/health"
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-08-26T11:16:06.752Z",
  "version": "1.0.0",
  "worker": "openai-compatible-assistant",
  "environment": "production",
  "message": "OpenAI Compatible Assistant API is running successfully"
}
```

### Health Check with Authentication
```bash
curl -X GET "$WORKER_URL/health" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 💬 Chat Completions

Test the main chat completion functionality with different models and configurations.

### Basic Chat Completion (Gemini)
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me with a simple task?"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 150
  }'
```

### Chat Completion with System Message
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant that provides concise answers."
      },
      {
        "role": "user",
        "content": "What are the benefits of using CloudFlare Workers?"
      }
    ],
    "temperature": 0.5
  }'
```

### Chat Completion with OpenAI Model (if configured)
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {
        "role": "user",
        "content": "Explain quantum computing in simple terms."
      }
    ],
    "temperature": 0.3,
    "max_tokens": 200
  }'
```

### Multi-turn Conversation
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      },
      {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      {
        "role": "user",
        "content": "What's interesting about that city?"
      }
    ],
    "temperature": 0.7
  }'
```

---

## 📝 Completions

Test the legacy completions endpoint.

### Basic Completion
```bash
curl -X POST "$WORKER_URL/v1/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "prompt": "The future of AI is",
    "temperature": 0.8,
    "max_tokens": 100
  }'
```

### Completion with Custom Prompt
```bash
curl -X POST "$WORKER_URL/v1/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "prompt": "Write a short poem about coding:",
    "temperature": 0.9,
    "max_tokens": 150
  }'
```

---

## 🤖 Models

Test the models listing endpoint to see available models.

### List Available Models
```bash
curl -X GET "$WORKER_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY"
```

**Expected Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-pro",
      "object": "model",
      "created": 1693526400,
      "owned_by": "google"
    },
    {
      "id": "gemini-pro-vision",
      "object": "model",
      "created": 1693526400,
      "owned_by": "google"
    }
  ]
}
```

### Models with OpenAI (if configured)
```bash
# When OpenAI is also configured, you'll see both providers
curl -X GET "$WORKER_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY"
```

**Expected Response with both providers:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4-turbo",
      "object": "model",
      "created": 1693526400,
      "owned_by": "openai"
    },
    {
      "id": "gpt-4",
      "object": "model",
      "created": 1693526400,
      "owned_by": "openai"
    },
    {
      "id": "gemini-pro",
      "object": "model",
      "created": 1693526400,
      "owned_by": "google"
    }
  ]
}
```

---

## 👨‍💼 Assistants

Test CRUD operations for assistants.

### Create Assistant
```bash
curl -X POST "$WORKER_URL/v1/assistants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Test Assistant",
    "description": "An assistant for testing purposes",
    "instructions": "You are a helpful test assistant that provides accurate and concise responses.",
    "model": "gemini-pro",
    "metadata": {
      "test": true,
      "version": "1.0"
    }
  }'
```

### List Assistants
```bash
curl -X GET "$WORKER_URL/v1/assistants" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Specific Assistant
```bash
curl -X GET "$WORKER_URL/v1/assistants/{assistant_id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Update Assistant
```bash
curl -X POST "$WORKER_URL/v1/assistants/{assistant_id}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Updated Test Assistant",
    "description": "Updated description for testing",
    "metadata": {
      "test": true,
      "version": "1.1",
      "updated": true
    }
  }'
```

### Delete Assistant
```bash
curl -X DELETE "$WORKER_URL/v1/assistants/{assistant_id}" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 🧵 Threads

Test thread management operations.

### Create Thread
```bash
curl -X POST "$WORKER_URL/v1/threads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "metadata": {
      "test": true,
      "purpose": "conversation_testing"
    }
  }'
```

### Get Thread
```bash
curl -X GET "$WORKER_URL/v1/threads/{thread_id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Update Thread
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "metadata": {
      "test": true,
      "purpose": "updated_conversation",
      "status": "active"
    }
  }'
```

### Delete Thread
```bash
curl -X DELETE "$WORKER_URL/v1/threads/{thread_id}" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 💬 Messages

Test message operations within threads.

### Create Message
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "role": "user",
    "content": "Hello! I'd like to test the messaging system."
  }'
```

### List Messages in Thread
```bash
curl -X GET "$WORKER_URL/v1/threads/{thread_id}/messages" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Specific Message
```bash
curl -X GET "$WORKER_URL/v1/threads/{thread_id}/messages/{message_id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Update Message
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}/messages/{message_id}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "metadata": {
      "edited": true,
      "edit_timestamp": "2025-08-26T11:16:06.752Z"
    }
  }'
```

### Delete Message
```bash
curl -X DELETE "$WORKER_URL/v1/threads/{thread_id}/messages/{message_id}" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 🏃‍♂️ Runs

Test run execution and management.

### Create Run
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}/runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "assistant_id": "{assistant_id}",
    "instructions": "Please provide a helpful and accurate response.",
    "metadata": {
      "test_run": true
    }
  }'
```

### List Runs
```bash
curl -X GET "$WORKER_URL/v1/threads/{thread_id}/runs" \
  -H "Authorization: Bearer $API_KEY"
```

### Get Specific Run
```bash
curl -X GET "$WORKER_URL/v1/threads/{thread_id}/runs/{run_id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Cancel Run
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}/runs/{run_id}/cancel" \
  -H "Authorization: Bearer $API_KEY"
```

### Submit Tool Outputs
```bash
curl -X POST "$WORKER_URL/v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "tool_outputs": [
      {
        "tool_call_id": "call_abc123",
        "output": "The weather in Paris is 22°C and sunny."
      }
    ]
  }'
```

---

## 📁 Files

Test file upload and management operations.

### Upload File
```bash
# Text file upload
curl -X POST "$WORKER_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-document.txt" \
  -F "purpose=assistants"
```

### List Files
```bash
curl -X GET "$WORKER_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY"
```

### Get File Information
```bash
curl -X GET "$WORKER_URL/v1/files/{file_id}" \
  -H "Authorization: Bearer $API_KEY"
```

### Get File Content
```bash
curl -X GET "$WORKER_URL/v1/files/{file_id}/content" \
  -H "Authorization: Bearer $API_KEY"
```

### Delete File
```bash
curl -X DELETE "$WORKER_URL/v1/files/{file_id}" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 🗑️ Garbage Collection Admin

Test admin endpoints for garbage collection (requires admin privileges).

### Trigger Manual GC
```bash
curl -X POST "$WORKER_URL/admin/gc" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": false,
    "force": false
  }'
```

### Get GC Configuration
```bash
curl -X GET "$WORKER_URL/admin/gc/config" \
  -H "Authorization: Bearer $API_KEY"
```

### Dry Run GC
```bash
curl -X POST "$WORKER_URL/admin/gc/dry-run" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "simulate_deletion": true
  }'
```

### Get GC Status
```bash
curl -X GET "$WORKER_URL/admin/gc/status/{operation_id}" \
  -H "Authorization: Bearer $API_KEY"
```

---

## ❌ Error Handling

Test various error scenarios and edge cases.

### Authentication Errors

#### Missing API Key
```bash
curl -X GET "$WORKER_URL/v1/models"
```
**Expected:** `401 Unauthorized`

#### Invalid API Key
```bash
curl -X GET "$WORKER_URL/v1/models" \
  -H "Authorization: Bearer invalid-key"
```
**Expected:** `401 Unauthorized`

### Validation Errors

#### Invalid JSON
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"invalid": json}'
```
**Expected:** `400 Bad Request`

#### Missing Required Fields
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```
**Expected:** `400 Bad Request` (missing model field)

#### Invalid Model
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "invalid-model",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```
**Expected:** `400 Bad Request` or `404 Not Found`

### Resource Errors

#### Non-existent Resource
```bash
curl -X GET "$WORKER_URL/v1/assistants/non-existent-id" \
  -H "Authorization: Bearer $API_KEY"
```
**Expected:** `404 Not Found`

#### Method Not Allowed
```bash
curl -X PATCH "$WORKER_URL/v1/assistants" \
  -H "Authorization: Bearer $API_KEY"
```
**Expected:** `405 Method Not Allowed`

### Rate Limiting
```bash
# Make multiple rapid requests to trigger rate limiting
for i in {1..150}; do
  curl -X GET "$WORKER_URL/v1/models" \
    -H "Authorization: Bearer $API_KEY" \
    -w "%{http_code}\n" \
    -s -o /dev/null &
done
wait
```
**Expected:** Some requests return `429 Too Many Requests`

---

## 📡 Streaming

Test streaming responses (when implemented).

### Streaming Chat Completion
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "Write a short story about a robot learning to paint."
      }
    ],
    "stream": true,
    "temperature": 0.8
  }'
```

**Expected:** Server-Sent Events (SSE) stream with incremental response chunks.

### Streaming with Tool Calls
```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {
        "role": "user",
        "content": "What's the current weather in Tokyo?"
      }
    ],
    "stream": true,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "City name"
              }
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```

---

## 🔧 Advanced Testing

### Load Testing
```bash
# Simple load test with multiple concurrent requests
for i in {1..50}; do
  curl -X POST "$WORKER_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{
      "model": "gemini-pro",
      "messages": [{"role": "user", "content": "Say hello"}],
      "max_tokens": 10
    }' \
    -w "Request $i: %{http_code} - %{time_total}s\n" \
    -s -o /dev/null &
done
wait
```

### Testing Different Content Types
```bash
# Test with different content types
curl -X POST "$WORKER_URL/v1/assistants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Test Assistant",
    "instructions": "Test instructions",
    "model": "gemini-pro"
  }'

# Test with invalid content type
curl -X POST "$WORKER_URL/v1/assistants" \
  -H "Content-Type: text/plain" \
  -H "Authorization: Bearer $API_KEY" \
  -d 'plain text data'
```
**Expected:** `415 Unsupported Media Type`

### CORS Testing
```bash
# Test CORS preflight request
curl -X OPTIONS "$WORKER_URL/v1/assistants" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

### Testing with Custom Headers
```bash
# Test with custom headers
curl -X GET "$WORKER_URL/health" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Custom-Header: test-value" \
  -H "User-Agent: Test-Script/1.0"
```

### Provider Fallback Testing
```bash
# Test with primary provider unavailable (if fallback is configured)
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {
        "role": "user",
        "content": "Test fallback functionality"
      }
    ],
    "temperature": 0.5
  }'
```

---

## 📊 Monitoring and Debugging

### Test Request Logging
```bash
# Check worker logs in CloudFlare dashboard
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Request-ID: test-12345" \
  -d '{
    "model": "gemini-pro",
    "messages": [{"role": "user", "content": "Test logging"}]
  }'
```

### Test Metrics Endpoint (if implemented)
```bash
curl -X GET "$WORKER_URL/metrics" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 🛠️ Testing Scripts

### Bash Script for Automated Testing
```bash
#!/bin/bash

# Automated API Testing Script
WORKER_URL="https://your-worker.workers.dev"
API_KEY="your-api-key"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test function
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${YELLOW}Testing: $description${NC}"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -X GET "$WORKER_URL$endpoint" \
            -H "Authorization: Bearer $API_KEY" \
            -w "\nHTTP_STATUS:%{http_code}")
    else
        response=$(curl -s -X POST "$WORKER_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $API_KEY" \
            -d "$data" \
            -w "\nHTTP_STATUS:%{http_code}")
    fi

    http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_STATUS:/d')

    if [ "$http_status" -ge 200 ] && [ "$http_status" -lt 300 ]; then
        echo -e "${GREEN}✓ Success ($http_status)${NC}"
    else
        echo -e "${RED}✗ Failed ($http_status)${NC}"
        echo "Response: $body"
    fi

    echo ""
}

# Run tests
test_endpoint "GET" "/health" "" "Health Check"
test_endpoint "GET" "/v1/models" "" "List Models"
test_endpoint "POST" "/v1/assistants" '{
    "name": "Test Assistant",
    "instructions": "Test instructions",
    "model": "gemini-pro"
}' "Create Assistant"

echo "Testing completed!"
```

### Save the script and run it:
```bash
chmod +x test-api.sh
./test-api.sh
```

---

## 🔒 Security Testing

### Test Rate Limiting
```bash
# Test rate limit enforcement
for i in {1..120}; do
    curl -s -X GET "$WORKER_URL/v1/models" \
        -H "Authorization: Bearer $API_KEY" \
        -w "%{http_code}\n" &
done | grep -c "429" || echo "No rate limiting detected"
```

### Test Input Validation
```bash
# Test XSS prevention
curl -X POST "$WORKER_URL/v1/assistants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "<script>alert(\"xss\")</script>",
    "instructions": "Test instructions",
    "model": "gemini-pro"
  }'
```

### Test SQL Injection Prevention
```bash
curl -X GET "$WORKER_URL/v1/assistants/%27%20OR%20%271%27%3D%271" \
  -H "Authorization: Bearer $API_KEY"
```

---

## 📝 Best Practices for Testing

1. **Start with Health Checks**: Always test the health endpoint first
2. **Test Authentication**: Verify all endpoints require proper authentication
3. **Use Realistic Data**: Test with data that mirrors production usage
4. **Test Edge Cases**: Include empty strings, maximum lengths, special characters
5. **Monitor Rate Limits**: Be aware of rate limiting when load testing
6. **Check CORS**: Test cross-origin requests if needed
7. **Validate Responses**: Check both HTTP status codes and response content
8. **Test Error Scenarios**: Ensure proper error handling and user-friendly messages
9. **Monitor Logs**: Check CloudFlare dashboard for detailed logs
10. **Clean Up**: Delete test resources to avoid accumulation

## 🚨 Troubleshooting

### Common Issues

**401 Unauthorized**
- Check if API_KEY is correct
- Ensure Authorization header format is `Bearer {API_KEY}`

**404 Not Found**
- Verify WORKER_URL is correct
- Check endpoint path spelling

**429 Too Many Requests**
- Rate limit exceeded, wait before retrying
- Consider using rate limit bypass key if available

**500 Internal Server Error**
- Check worker logs in CloudFlare dashboard
- Verify environment variables are set correctly

**502/503 Errors**
- Worker may be temporarily unavailable
- Check CloudFlare status page

### Getting Help

1. Check the worker logs in CloudFlare dashboard
2. Verify environment variable configuration
3. Test with simple requests first (health check)
4. Check API key and authentication format
5. Review the wrangler.toml configuration

---

## 📋 Checklist

- [ ] Health check endpoint responds correctly
- [ ] Authentication works for all endpoints
- [ ] Chat completions work with different models
- [ ] Assistant CRUD operations function properly
- [ ] Thread and message management works
- [ ] File upload and retrieval works
- [ ] Error handling provides meaningful messages
- [ ] Rate limiting is enforced appropriately
- [ ] CORS headers are set correctly
- [ ] Provider fallback works (if configured)
- [ ] Garbage collection admin endpoints work (if needed)

This comprehensive testing guide covers all major functionality of the OpenAI Compatible Assistant API. Use these curl commands to thoroughly test your deployed CloudFlare Worker before going to production.