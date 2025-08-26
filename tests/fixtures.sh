#!/bin/bash

# Test Fixtures
# This file contains sample data and fixtures for various test scenarios

# ==============================================
# ASSISTANT FIXTURES
# ==============================================

# Basic assistant fixture
get_basic_assistant() {
    cat << 'EOF'
{
  "name": "Test Assistant",
  "description": "A basic test assistant for acceptance testing",
  "instructions": "You are a helpful test assistant. Respond to user queries in a helpful and accurate manner.",
  "model": "gemini-pro",
  "tools": [],
  "metadata": {
    "test": true,
    "fixture": "basic_assistant"
  }
}
EOF
}

# Assistant with tools fixture
get_assistant_with_tools() {
    cat << 'EOF'
{
  "name": "Tool Assistant",
  "description": "Test assistant with various tools",
  "instructions": "You are a test assistant with access to various tools. Use the tools when appropriate to help answer user queries.",
  "model": "gemini-pro",
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
              "description": "City and country, e.g., 'London, UK'"
            }
          },
          "required": ["location"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "calculate",
        "description": "Perform mathematical calculations",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {
              "type": "string",
              "description": "Mathematical expression to evaluate"
            }
          },
          "required": ["expression"]
        }
      }
    }
  ],
  "metadata": {
    "test": true,
    "fixture": "assistant_with_tools"
  }
}
EOF
}

# Assistant with file IDs fixture
get_assistant_with_files() {
    cat << EOF
{
  "name": "File Assistant",
  "description": "Test assistant with file access",
  "instructions": "You are a test assistant with access to files. Use the file contents to help answer user queries.",
  "model": "gemini-pro",
  "tools": [],
  "file_ids": ["$1"],
  "metadata": {
    "test": true,
    "fixture": "assistant_with_files"
  }
}
EOF
}

# ==============================================
# THREAD FIXTURES
# ==============================================

# Basic thread fixture
get_basic_thread() {
    cat << 'EOF'
{
  "metadata": {
    "test": true,
    "fixture": "basic_thread"
  }
}
EOF
}

# ==============================================
# MESSAGE FIXTURES
# ==============================================

# User message fixture
get_user_message() {
    cat << 'EOF'
{
  "role": "user",
  "content": "Hello! Can you help me with a test query?"
}
EOF
}

# Assistant message fixture
get_assistant_message() {
    cat << 'EOF'
{
  "role": "assistant",
  "content": "Hello! I'm here to help with your test query. What would you like to know?"
}
EOF
}

# System message fixture
get_system_message() {
    cat << 'EOF'
{
  "role": "system",
  "content": "You are a helpful assistant in a test environment."
}
EOF
}

# ==============================================
# RUN FIXTURES
# ==============================================

# Basic run fixture (requires assistant_id)
get_basic_run() {
    local assistant_id="$1"
    cat << EOF
{
  "assistant_id": "$assistant_id",
  "instructions": "Please respond to the user query in a helpful manner.",
  "metadata": {
    "test": true,
    "fixture": "basic_run"
  }
}
EOF
}

# Run with specific instructions fixture
get_run_with_instructions() {
    local assistant_id="$1"
    cat << EOF
{
  "assistant_id": "$assistant_id",
  "instructions": "You are in test mode. Please respond with detailed explanations and include the word 'TESTING' in your response.",
  "metadata": {
    "test": true,
    "fixture": "run_with_instructions"
  }
}
EOF
}

# ==============================================
# FILE FIXTURES
# ==============================================

# Text file content
get_text_file_content() {
    cat << 'EOF'
This is a test file for acceptance testing.

It contains multiple lines of text content that can be used to test file upload and retrieval functionality.

The file includes:
- Multiple paragraphs
- Various text content
- Test data for verification

End of test file content.
EOF
}

# JSON file content
get_json_file_content() {
    cat << 'EOF'
{
  "name": "Test Data",
  "version": "1.0.0",
  "description": "Test JSON file for acceptance testing",
  "data": {
    "users": [
      {
        "id": 1,
        "name": "Test User 1",
        "email": "test1@example.com"
      },
      {
        "id": 2,
        "name": "Test User 2",
        "email": "test2@example.com"
      }
    ],
    "settings": {
      "theme": "dark",
      "language": "en",
      "notifications": true
    }
  },
  "metadata": {
    "test": true,
    "created": "2024-01-01T00:00:00Z"
  }
}
EOF
}

# Binary file content (base64 encoded)
get_binary_file_content() {
    # Generate some random binary data (1000 bytes)
    head -c 1000 /dev/urandom | base64
}

# ==============================================
# GC FIXTURES
# ==============================================

# GC trigger request fixture
get_gc_trigger_request() {
    local mode="${1:-cleanup}"
    cat << EOF
{
  "mode": "$mode",
  "dryRun": false,
  "continueOnErrors": true,
  "batchSize": 100,
  "timeoutSeconds": 300,
  "resourceTypes": ["assistant", "thread", "message", "run", "file"],
  "olderThanHours": 24
}
EOF
}

# GC dry run request fixture
get_gc_dry_run_request() {
    cat << 'EOF'
{
  "mode": "dry_run",
  "dryRun": true,
  "continueOnErrors": true,
  "batchSize": 50,
  "timeoutSeconds": 60,
  "resourceTypes": ["assistant", "thread", "message", "run", "file"],
  "olderThanHours": 168
}
EOF
}

# ==============================================
# ERROR RESPONSE FIXTURES
# ==============================================

# Validation error fixture
get_validation_error() {
    cat << 'EOF'
{
  "error": {
    "message": "Validation failed",
    "details": [
      {
        "field": "name",
        "message": "Name is required"
      }
    ]
  }
}
EOF
}

# Not found error fixture
get_not_found_error() {
    cat << 'EOF'
{
  "error": {
    "message": "Resource not found"
  }
}
EOF
}

# Unauthorized error fixture
get_unauthorized_error() {
    cat << 'EOF'
{
  "error": {
    "message": "Unauthorized access"
  }
}
EOF
}

# Rate limit error fixture
get_rate_limit_error() {
    cat << 'EOF'
{
  "error": {
    "message": "Rate limit exceeded"
  }
}
EOF
}

# ==============================================
# STREAMING FIXTURES
# ==============================================

# Streaming request fixture
get_streaming_request() {
    local model="${1:-gemini-pro}"
    cat << EOF
{
  "model": "$model",
  "messages": [
    {
      "role": "user",
      "content": "Tell me a story about testing"
    }
  ],
  "stream": true,
  "max_tokens": 100
}
EOF
}

# ==============================================
# CONCURRENCY TEST FIXTURES
# ==============================================

# Generate multiple concurrent requests
generate_concurrent_requests() {
    local count="$1"
    local requests=()

    for i in $(seq 1 "$count"); do
        requests+=("$(cat << EOF
{
  "name": "Concurrent Assistant $i",
  "description": "Test assistant $i for concurrency testing",
  "instructions": "You are test assistant number $i.",
  "model": "gemini-pro",
  "metadata": {
    "test": true,
    "concurrent": true,
    "index": $i
  }
}
EOF
)")
    done

    # Output all requests (one per line, base64 encoded to handle newlines)
    for request in "${requests[@]}"; do
        echo "$request" | base64
    done
}

# ==============================================
# RATE LIMITING TEST FIXTURES
# ==============================================

# Generate rate limiting test data
get_rate_limit_test_data() {
    local count="$1"
    local data=()

    for i in $(seq 1 "$count"); do
        data+=("$(cat << EOF
{
  "model": "gemini-pro",
  "messages": [
    {
      "role": "user",
      "content": "Rate limit test message $i"
    }
  ]
}
EOF
)")
    done

    # Output all data items
    for item in "${data[@]}"; do
        echo "$item"
    done
}

# ==============================================
# END-TO-END TEST FIXTURES
# ==============================================

# Complete end-to-end test scenario data
get_end_to_end_scenario() {
    cat << 'EOF'
{
  "scenario": "tool_call_flow",
  "description": "Complete assistant creation to tool call completion",
  "steps": [
    {
      "name": "create_assistant",
      "data": {
        "name": "Weather Assistant",
        "description": "Assistant with weather tool",
        "instructions": "You are a helpful assistant that can check the weather.",
        "model": "gemini-pro",
        "tools": [
          {
            "type": "function",
            "function": {
              "name": "get_weather",
              "description": "Get current weather",
              "parameters": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "Location for weather"
                  }
                },
                "required": ["location"]
              }
            }
          }
        ]
      }
    },
    {
      "name": "create_thread",
      "data": {}
    },
    {
      "name": "create_message",
      "data": {
        "role": "user",
        "content": "What's the weather like in London?"
      }
    },
    {
      "name": "create_run",
      "data": {
        "assistant_id": "{ASSISTANT_ID}",
        "instructions": "Check the weather for the user."
      }
    },
    {
      "name": "submit_tool_outputs",
      "data": {
        "tool_outputs": [
          {
            "tool_call_id": "{TOOL_CALL_ID}",
            "output": "Sunny, 72°F, light breeze"
          }
        ]
      }
    }
  ]
}
EOF
}

# Export all functions
export -f get_basic_assistant get_assistant_with_tools get_assistant_with_files
export -f get_basic_thread
export -f get_user_message get_assistant_message get_system_message
export -f get_basic_run get_run_with_instructions
export -f get_text_file_content get_json_file_content get_binary_file_content
export -f get_gc_trigger_request get_gc_dry_run_request
export -f get_validation_error get_not_found_error get_unauthorized_error get_rate_limit_error
export -f get_streaming_request
export -f generate_concurrent_requests get_rate_limit_test_data
export -f get_end_to_end_scenario