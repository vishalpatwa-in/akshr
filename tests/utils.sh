#!/bin/bash

# Test Utility Functions
# This file contains utility functions for making HTTP requests, assertions, and test helpers

# ==============================================
# HTTP UTILITY FUNCTIONS
# ==============================================

# Make an HTTP request with proper headers and error handling
# Usage: make_request METHOD URL [DATA] [HEADERS]
make_request() {
    local method="$1"
    local url="$2"
    local data="$3"
    local headers="$4"

    # Build curl command
    local curl_cmd=(curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X "$method")

    # Add authorization header if API key is set
    if [[ -n "$API_KEY" ]]; then
        curl_cmd+=(-H "Authorization: Bearer $API_KEY")
    fi

    # Add content type for POST/PUT/PATCH requests
    if [[ "$method" =~ ^(POST|PUT|PATCH)$ ]] && [[ -n "$data" ]]; then
        curl_cmd+=(-H "Content-Type: application/json")
    fi

    # Add custom headers
    if [[ -n "$headers" ]]; then
        # Parse headers (format: "Header1: value1\nHeader2: value2")
        while IFS= read -r header; do
            if [[ -n "$header" ]]; then
                curl_cmd+=(-H "$header")
            fi
        done <<< "$headers"
    fi

    # Add request data
    if [[ -n "$data" ]]; then
        curl_cmd+=(--data "$data")
    fi

    # Add URL
    curl_cmd+=("$url")

    # Enable debug mode if requested
    if [[ "$HTTP_DEBUG" == "true" ]]; then
        log DEBUG "Making request: ${curl_cmd[*]}"
    fi

    # Execute request and capture both body and status
    local response
    response=$("${curl_cmd[@]}")

    # Extract body and status
    local body
    local status
    body=$(echo "$response" | sed -n '1,/^HTTP_STATUS:/{/^HTTP_STATUS:/!p;}')
    status=$(echo "$response" | grep "^HTTP_STATUS:" | cut -d: -f2)

    # Return both body and status (separated by null byte for safe parsing)
    printf "%s\x00%s" "$body" "$status"
}

# Parse response from make_request
# Usage: parse_response RESPONSE_DATA
parse_response() {
    local response="$1"
    # Split on null byte to get body and status
    echo "$response" | tr '\0' '\n'
}

# Extract HTTP status from response
get_status() {
    local response="$1"
    echo "$response" | tail -n1
}

# Extract response body from response
get_body() {
    local response="$1"
    echo "$response" | head -n -1
}

# ==============================================
# ASSERTION FUNCTIONS
# ==============================================

# Assert HTTP status code
# Usage: assert_status RESPONSE EXPECTED_STATUS [MESSAGE]
assert_status() {
    local response="$1"
    local expected="$2"
    local message="${3:-Status assertion failed}"

    local actual=$(get_status "$response")

    if [[ "$actual" -ne "$expected" ]]; then
        log ERROR "$message: expected $expected, got $actual"
        if [[ "$HTTP_DEBUG" == "true" ]]; then
            log DEBUG "Response body: $(get_body "$response")"
        fi
        return 1
    fi

    log DEBUG "$message: status $actual matches expected $expected"
    return 0
}

# Assert JSON field exists and has expected value
# Usage: assert_json_field RESPONSE JSON_PATH EXPECTED_VALUE [MESSAGE]
assert_json_field() {
    local response="$1"
    local json_path="$2"
    local expected="$3"
    local message="${4:-JSON field assertion failed}"

    local body=$(get_body "$response")
    local actual

    # Use jq if available, otherwise fall back to grep/awk
    if command -v jq >/dev/null 2>&1; then
        actual=$(echo "$body" | jq -r "$json_path" 2>/dev/null)
    else
        # Simple fallback for basic field extraction
        if [[ "$json_path" == ".id" ]]; then
            actual=$(echo "$body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        elif [[ "$json_path" == ".object" ]]; then
            actual=$(echo "$body" | grep -o '"object":"[^"]*"' | cut -d'"' -f4)
        else
            actual=""
        fi
    fi

    if [[ "$actual" != "$expected" ]]; then
        log ERROR "$message: $json_path expected '$expected', got '$actual'"
        return 1
    fi

    log DEBUG "$message: $json_path = '$actual' matches expected '$expected'"
    return 0
}

# Assert JSON field exists (regardless of value)
# Usage: assert_json_field_exists RESPONSE JSON_PATH [MESSAGE]
assert_json_field_exists() {
    local response="$1"
    local json_path="$2"
    local message="${3:-JSON field existence assertion failed}"

    local body=$(get_body "$response")
    local value

    if command -v jq >/dev/null 2>&1; then
        value=$(echo "$body" | jq -r "$json_path" 2>/dev/null)
        if [[ "$value" == "null" ]] || [[ -z "$value" ]]; then
            log ERROR "$message: $json_path does not exist or is null"
            return 1
        fi
    else
        # Simple check for basic fields
        if ! echo "$body" | grep -q "${json_path#.}"; then
            log ERROR "$message: $json_path not found in response"
            return 1
        fi
    fi

    log DEBUG "$message: $json_path exists"
    return 0
}

# Assert response contains error message
# Usage: assert_error_response RESPONSE EXPECTED_ERROR [MESSAGE]
assert_error_response() {
    local response="$1"
    local expected_error="$2"
    local message="${3:-Error response assertion failed}"

    local body=$(get_body "$response")
    local error_message

    if command -v jq >/dev/null 2>&1; then
        error_message=$(echo "$body" | jq -r '.error.message // empty' 2>/dev/null)
    else
        error_message=$(echo "$body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
    fi

    if [[ "$error_message" != *"$expected_error"* ]]; then
        log ERROR "$message: expected error containing '$expected_error', got '$error_message'"
        return 1
    fi

    log DEBUG "$message: error message contains '$expected_error'"
    return 0
}

# ==============================================
# TEST HELPER FUNCTIONS
# ==============================================

# Wait for a condition with timeout
# Usage: wait_for_condition TIMEOUT_SECONDS CONDITION_FUNCTION [MESSAGE]
wait_for_condition() {
    local timeout="$1"
    local condition="$2"
    local message="${3:-Waiting for condition}"

    local start_time=$(date +%s)
    local end_time=$((start_time + timeout))

    log DEBUG "$message (timeout: ${timeout}s)"

    while [[ $(date +%s) -lt $end_time ]]; do
        if eval "$condition" >/dev/null 2>&1; then
            log DEBUG "$message: condition met"
            return 0
        fi
        sleep 1
    done

    log ERROR "$message: condition not met within ${timeout}s"
    return 1
}

# Retry a command with exponential backoff
# Usage: retry_command MAX_RETRIES COMMAND [DESCRIPTION]
retry_command() {
    local max_retries="$1"
    local command="$2"
    local description="${3:-Command}"

    local attempt=0
    local delay=1

    while [[ $attempt -lt $max_retries ]]; do
        log DEBUG "$description: attempt $((attempt + 1))/$max_retries"

        if eval "$command"; then
            log DEBUG "$description: succeeded on attempt $((attempt + 1))"
            return 0
        fi

        attempt=$((attempt + 1))
        if [[ $attempt -lt $max_retries ]]; then
            log DEBUG "$description: retrying in ${delay}s"
            sleep $delay
            delay=$((delay * 2))  # Exponential backoff
        fi
    done

    log ERROR "$description: failed after $max_retries attempts"
    return 1
}

# Generate test data
generate_test_data() {
    local data_type="$1"
    local size="${2:-small}"

    case "$data_type" in
        "assistant")
            cat << EOF
{
  "name": "Test Assistant $(generate_test_id)",
  "description": "Test assistant for acceptance testing",
  "instructions": "You are a test assistant. Respond helpfully to test queries.",
  "model": "gemini-pro",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "test_function",
        "description": "A test function",
        "parameters": {
          "type": "object",
          "properties": {
            "input": {
              "type": "string",
              "description": "Test input"
            }
          }
        }
      }
    }
  ],
  "metadata": {
    "test": true,
    "created_by": "acceptance-test"
  }
}
EOF
            ;;
        "thread")
            cat << EOF
{
  "metadata": {
    "test": true,
    "created_by": "acceptance-test"
  }
}
EOF
            ;;
        "message")
            cat << EOF
{
  "role": "user",
  "content": "Hello, this is a test message for acceptance testing."
}
EOF
            ;;
        "file")
            # Generate file content based on size
            case "$size" in
                "small")
                    echo "This is a small test file content for acceptance testing."
                    ;;
                "medium")
                    head -c $MEDIUM_FILE_SIZE /dev/urandom | base64
                    ;;
                "large")
                    head -c $LARGE_FILE_SIZE /dev/urandom | base64
                    ;;
                *)
                    echo "Default test file content."
                    ;;
            esac
            ;;
        *)
            echo "{}"
            ;;
    esac
}

# ==============================================
# RESOURCE MANAGEMENT FUNCTIONS
# ==============================================

# Store a resource ID for cleanup
store_resource_id() {
    local resource_type="$1"
    local resource_id="$2"

    # Store in a temporary file for cleanup
    local cleanup_file="$OUTPUT_DIR/cleanup_ids.txt"
    mkdir -p "$OUTPUT_DIR"
    echo "$resource_type:$resource_id" >> "$cleanup_file"
}

# Clean up all stored resources
cleanup_resources() {
    local cleanup_file="$OUTPUT_DIR/cleanup_ids.txt"

    if [[ -f "$cleanup_file" ]]; then
        log INFO "Cleaning up test resources..."

        while IFS=: read -r resource_type resource_id; do
            case "$resource_type" in
                "assistant")
                    make_request DELETE "$BASE_URL/v1/assistants/$resource_id" >/dev/null 2>&1
                    ;;
                "thread")
                    make_request DELETE "$BASE_URL/v1/threads/$resource_id" >/dev/null 2>&1
                    ;;
                "file")
                    make_request DELETE "$BASE_URL/v1/files/$resource_id" >/dev/null 2>&1
                    ;;
            esac
        done < "$cleanup_file"

        rm -f "$cleanup_file"
        log INFO "Cleanup completed"
    fi
}

# ==============================================
# CONCURRENT TEST FUNCTIONS
# ==============================================

# Run multiple requests concurrently
# Usage: run_concurrent REQUESTS TIMEOUT [DESCRIPTION]
run_concurrent() {
    local requests="$1"
    local timeout="$2"
    local description="${3:-Concurrent test}"

    log INFO "$description: running $requests concurrent requests"

    # Create temporary files for results
    local results_file=$(mktemp)
    local errors_file=$(mktemp)

    # Function to make a single request
    make_single_request() {
        local url="$1"
        local method="${2:-GET}"
        local data="$3"

        local response=$(make_request "$method" "$url" "$data")
        local status=$(get_status "$response")

        if [[ "$status" -ge 200 ]] && [[ "$status" -lt 300 ]]; then
            echo "SUCCESS:$status" >> "$results_file"
        else
            echo "ERROR:$status:$(get_body "$response")" >> "$errors_file"
        fi
    }

    # Export function for parallel execution
    export -f make_single_request make_request get_status get_body
    export BASE_URL API_KEY

    # Run requests in parallel
    local pids=()
    for i in $(seq 1 "$requests"); do
        make_single_request "$BASE_URL/v1/models" &
        pids+=($!)
    done

    # Wait for completion with timeout
    local start_time=$(date +%s)
    local end_time=$((start_time + timeout))

    while [[ $(date +%s) -lt $end_time ]] && [[ ${#pids[@]} -gt 0 ]]; do
        local new_pids=()
        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                new_pids+=("$pid")
            fi
        done
        pids=("${new_pids[@]}")
        sleep 0.1
    done

    # Kill any remaining processes
    for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null
    done

    # Count results
    local success_count=$(grep -c "^SUCCESS:" "$results_file" 2>/dev/null || echo 0)
    local error_count=$(grep -c "^ERROR:" "$errors_file" 2>/dev/null || echo 0)

    # Clean up temp files
    rm -f "$results_file" "$errors_file"

    log INFO "$description: $success_count successful, $error_count errors"

    # Return success if we have at least some successful requests
    if [[ $success_count -gt 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Export functions for use in other scripts
export -f make_request parse_response get_status get_body
export -f assert_status assert_json_field assert_json_field_exists assert_error_response
export -f wait_for_condition retry_command generate_test_data
export -f store_resource_id cleanup_resources run_concurrent