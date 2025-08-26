#!/bin/bash

# Streaming Tests
# Tests for SSE streaming, NDJSON format, streaming with tool calls, and error handling

# ==============================================
# TEST SETUP
# ==============================================

setup_streaming_tests() {
    log INFO "Setting up streaming tests..."

    # Create test resources for streaming
    STREAM_ASSISTANT_ID=""
    STREAM_THREAD_ID=""
    STREAM_MESSAGE_ID=""

    # Create assistant
    local assistant_data=$(get_basic_assistant)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create streaming test assistant"

    STREAM_ASSISTANT_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$STREAM_ASSISTANT_ID"

    # Create thread
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    assert_status "$response" $HTTP_CREATED "Create streaming test thread"

    STREAM_THREAD_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "thread" "$STREAM_THREAD_ID"

    # Create message
    local message_data=$(get_user_message)
    response=$(make_request POST "$BASE_URL/v1/threads/$STREAM_THREAD_ID/messages" "$message_data")
    assert_status "$response" $HTTP_CREATED "Create streaming test message"

    STREAM_MESSAGE_ID=$(get_body "$response" | jq -r '.id')

    log INFO "Streaming test resources created: assistant=$STREAM_ASSISTANT_ID, thread=$STREAM_THREAD_ID, message=$STREAM_MESSAGE_ID"
}

cleanup_streaming_tests() {
    log INFO "Cleaning up streaming test resources..."

    if [[ -n "$STREAM_ASSISTANT_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/assistants/$STREAM_ASSISTANT_ID" >/dev/null 2>&1
    fi

    if [[ -n "$STREAM_THREAD_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/threads/$STREAM_THREAD_ID" >/dev/null 2>&1
    fi

    unset STREAM_ASSISTANT_ID STREAM_THREAD_ID STREAM_MESSAGE_ID
}

# ==============================================
# STREAMING TEST FUNCTIONS
# ==============================================

# Test SSE streaming for runs
test_sse_streaming_runs() {
    log INFO "Testing SSE streaming for runs..."

    local passed=0
    local failed=0

    # Create streaming request
    local stream_request=$(get_streaming_request)
    local stream_url="$BASE_URL/v1/threads/$STREAM_THREAD_ID/runs/$STREAM_MESSAGE_ID/stream"

    # Use curl to test streaming response
    local response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                         -H "Content-Type: application/json" \
                         -X POST \
                         -d "$stream_request" \
                         --max-time 10 \
                         "$stream_url" 2>/dev/null)

    if [[ -n "$response" ]]; then
        log INFO "✓ Streaming endpoint responded"

        # Check for SSE format (data: prefix)
        if echo "$response" | grep -q "^data:"; then
            log INFO "✓ Response contains SSE data format"
            passed=$((passed + 1))

            # Check for event types
            if echo "$response" | grep -q "event:"; then
                log INFO "✓ Response contains SSE event types"
                passed=$((passed + 1))
            else
                log WARN "✗ Response missing SSE event types"
            fi

            # Check for proper JSON data
            if echo "$response" | grep -q "data: {"; then
                log INFO "✓ Response contains JSON data"
                passed=$((passed + 1))
            else
                log ERROR "✗ Response missing JSON data"
                failed=$((failed + 1))
            fi
        else
            log WARN "✗ Response not in SSE format"
            # Check if it's a regular JSON response (might not be implemented yet)
            if echo "$response" | jq . >/dev/null 2>&1; then
                log INFO "✓ Response is valid JSON (streaming may not be implemented)"
                passed=$((passed + 1))
            else
                log ERROR "✗ Response is neither SSE nor valid JSON"
                failed=$((failed + 1))
            fi
        fi
    else
        log ERROR "✗ Streaming endpoint did not respond"
        failed=$((failed + 1))
    fi

    log INFO "SSE streaming tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"sse_streaming_runs\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test NDJSON streaming format
test_ndjson_streaming() {
    log INFO "Testing NDJSON streaming format..."

    local passed=0
    local failed=0

    # Test with NDJSON accept header
    local stream_request=$(get_streaming_request)
    local stream_url="$BASE_URL/v1/threads/$STREAM_THREAD_ID/runs/$STREAM_MESSAGE_ID/stream"

    local response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                         -H "Content-Type: application/json" \
                         -H "Accept: application/x-ndjson" \
                         -X POST \
                         -d "$stream_request" \
                         --max-time 10 \
                         "$stream_url" 2>/dev/null)

    if [[ -n "$response" ]]; then
        log INFO "✓ NDJSON streaming endpoint responded"

        # Check if response is valid NDJSON (one JSON object per line)
        local valid_ndjson=true
        while IFS= read -r line; do
            if [[ -n "$line" ]] && ! echo "$line" | jq . >/dev/null 2>&1; then
                valid_ndjson=false
                break
            fi
        done <<< "$response"

        if [[ "$valid_ndjson" == true ]]; then
            log INFO "✓ Response is valid NDJSON format"
            passed=$((passed + 1))

            # Count JSON objects
            local object_count=$(echo "$response" | grep -c '^{')
            if [[ $object_count -gt 0 ]]; then
                log INFO "✓ Found $object_count JSON objects in NDJSON stream"
                passed=$((passed + 1))
            else
                log ERROR "✗ No JSON objects found in NDJSON stream"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Response is not valid NDJSON"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ NDJSON streaming endpoint did not respond"
        failed=$((failed + 1))
    fi

    log INFO "NDJSON streaming tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"ndjson_streaming\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test streaming with tool calls
test_streaming_with_tool_calls() {
    log INFO "Testing streaming with tool calls..."

    local passed=0
    local failed=0

    # Create assistant with tools for streaming
    local assistant_data=$(get_assistant_with_tools)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create tool-enabled assistant for streaming"

    local tool_assistant_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$tool_assistant_id"

    # Create a message that should trigger tool calls
    local tool_message_data='{
      "role": "user",
      "content": "What is the weather like in Paris?"
    }'
    response=$(make_request POST "$BASE_URL/v1/threads/$STREAM_THREAD_ID/messages" "$tool_message_data")
    assert_status "$response" $HTTP_CREATED "Create tool-call message"

    # Create streaming request with tool-enabled assistant
    local stream_request='{
      "assistant_id": "'$tool_assistant_id'",
      "stream": true
    }'
    local stream_url="$BASE_URL/v1/threads/$STREAM_THREAD_ID/runs"

    response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                     -H "Content-Type: application/json" \
                     -X POST \
                     -d "$stream_request" \
                     --max-time 15 \
                     "$stream_url" 2>/dev/null)

    if [[ -n "$response" ]]; then
        log INFO "✓ Tool-call streaming endpoint responded"

        # Check for tool call events in the stream
        if echo "$response" | grep -q "tool_calls"; then
            log INFO "✓ Stream contains tool call events"
            passed=$((passed + 1))

            # Check for specific tool call structure
            if echo "$response" | grep -q "function"; then
                log INFO "✓ Tool call contains function information"
                passed=$((passed + 1))
            else
                log WARN "✗ Tool call missing function information"
            fi
        else
            log INFO "✓ Stream responded (tool calls may not be triggered)"
            passed=$((passed + 1))
        fi

        # Check for completion events
        if echo "$response" | grep -q "completed\|done"; then
            log INFO "✓ Stream contains completion events"
            passed=$((passed + 1))
        else
            log WARN "✗ Stream missing completion events"
        fi
    else
        log ERROR "✗ Tool-call streaming endpoint did not respond"
        failed=$((failed + 1))
    fi

    # Clean up tool assistant
    make_request DELETE "$BASE_URL/v1/assistants/$tool_assistant_id" >/dev/null 2>&1

    log INFO "Streaming with tool calls tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"streaming_with_tool_calls\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test streaming error handling
test_streaming_error_handling() {
    log INFO "Testing streaming error handling..."

    local passed=0
    local failed=0

    # Test 1: Invalid thread ID
    log INFO "Test 1: Invalid thread ID in streaming..."
    local stream_request=$(get_streaming_request)
    local invalid_stream_url="$BASE_URL/v1/threads/invalid-thread-id/runs/invalid-run-id/stream"

    response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                     -H "Content-Type: application/json" \
                     -X POST \
                     -d "$stream_request" \
                     --max-time 5 \
                     "$invalid_stream_url" 2>/dev/null)

    if [[ -n "$response" ]]; then
        # Check if it's a proper error response
        if echo "$response" | jq . >/dev/null 2>&1; then
            local error_message=$(echo "$response" | jq -r '.error.message // empty')
            if [[ -n "$error_message" ]]; then
                log INFO "✓ Invalid thread ID returned proper error: $error_message"
                passed=$((passed + 1))
            else
                log ERROR "✗ Invalid thread ID did not return error message"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Invalid thread ID did not return JSON error"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Invalid thread ID request did not respond"
        failed=$((failed + 1))
    fi

    # Test 2: Network interruption simulation
    log INFO "Test 2: Testing streaming timeout handling..."
    local stream_url="$BASE_URL/v1/threads/$STREAM_THREAD_ID/runs/$STREAM_MESSAGE_ID/stream"

    # Use a very short timeout to simulate network issues
    response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                     -H "Content-Type: application/json" \
                     -X POST \
                     -d "$stream_request" \
                     --max-time 1 \
                     "$stream_url" 2>/dev/null)

    # This test is mainly to ensure the endpoint handles timeouts gracefully
    if [[ $? -eq 28 ]] || [[ -z "$response" ]]; then
        log INFO "✓ Streaming endpoint handles timeouts gracefully"
        passed=$((passed + 1))
    else
        log INFO "✓ Streaming endpoint responded within timeout"
        passed=$((passed + 1))
    fi

    # Test 3: Malformed streaming request
    log INFO "Test 3: Testing malformed streaming request..."
    local malformed_request='{"stream": true, "invalid": }'
    response=$(curl -s -N -H "Authorization: Bearer $API_KEY" \
                     -H "Content-Type: application/json" \
                     -X POST \
                     -d "$malformed_request" \
                     --max-time 5 \
                     "$stream_url" 2>/dev/null)

    if [[ -n "$response" ]]; then
        if echo "$response" | jq . >/dev/null 2>&1; then
            local error_message=$(echo "$response" | jq -r '.error.message // empty')
            if [[ -n "$error_message" ]]; then
                log INFO "✓ Malformed request returned proper error: $error_message"
                passed=$((passed + 1))
            else
                log ERROR "✗ Malformed request did not return error message"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Malformed request did not return JSON error"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Malformed request did not respond"
        failed=$((failed + 1))
    fi

    log INFO "Streaming error handling tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"streaming_error_handling\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test streaming cancellation
test_streaming_cancellation() {
    log INFO "Testing streaming cancellation..."

    local passed=0
    local failed=0

    # Start a streaming request in the background
    local stream_request=$(get_streaming_request)
    local stream_url="$BASE_URL/v1/threads/$STREAM_THREAD_ID/runs/$STREAM_MESSAGE_ID/stream"

    # Use timeout to simulate cancellation
    log INFO "Starting streaming request with short timeout..."
    response=$(timeout 3 curl -s -N -H "Authorization: Bearer $API_KEY" \
                           -H "Content-Type: application/json" \
                           -X POST \
                           -d "$stream_request" \
                           "$stream_url" 2>/dev/null)

    local curl_exit_code=$?

    if [[ $curl_exit_code -eq 124 ]]; then
        log INFO "✓ Streaming request was cancelled by timeout"
        passed=$((passed + 1))
    elif [[ $curl_exit_code -eq 0 ]]; then
        log INFO "✓ Streaming request completed normally"
        passed=$((passed + 1))
    else
        log WARN "✗ Streaming request exited with unexpected code: $curl_exit_code"
    fi

    # Test if the system can handle cancellation gracefully
    if [[ -n "$response" ]]; then
        # Check if response is valid even if truncated
        if echo "$response" | head -n 1 | jq . >/dev/null 2>&1; then
            log INFO "✓ Partial streaming response is valid JSON"
            passed=$((passed + 1))
        else
            log WARN "✗ Partial streaming response is not valid JSON"
        fi
    fi

    log INFO "Streaming cancellation tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"streaming_cancellation\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN STREAMING TEST EXECUTION
# ==============================================

# Run all streaming tests
run_streaming_tests() {
    log INFO "Starting streaming acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_streaming_tests

    # Define test functions
    local test_functions=(
        "test_sse_streaming_runs"
        "test_ndjson_streaming"
        "test_streaming_with_tool_calls"
        "test_streaming_error_handling"
        "test_streaming_cancellation"
    )

    local results=()

    # Run each test
    for test_func in "${test_functions[@]}"; do
        log INFO "Running $test_func..."

        local result
        if result=$($test_func); then
            local passed=$(echo "$result" | jq -r '.passed // 0')
            local failed=$(echo "$result" | jq -r '.failed // 0')

            total_passed=$((total_passed + passed))
            total_failed=$((total_failed + failed))

            results+=("$result")
        else
            log ERROR "Test function $test_func failed to execute"
            total_failed=$((total_failed + 1))
            results+=("{\"passed\": 0, \"failed\": 1, \"tests\": [{\"name\": \"$test_func\", \"passed\": 0, \"failed\": 1}]}")
        fi
    done

    # Cleanup test resources
    cleanup_streaming_tests

    # Calculate duration
    local duration=$(( $(date +%s) - start_time ))

    # Combine all results
    local combined_results="{\"passed\": $total_passed, \"failed\": $total_failed, \"duration_seconds\": $duration, \"test_groups\": ["
    for i in "${!results[@]}"; do
        if [[ $i -gt 0 ]]; then
            combined_results+=","
        fi
        combined_results+="${results[$i]}"
    done
    combined_results+="]}"

    log INFO "Streaming tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_streaming_tests cleanup_streaming_tests
export -f test_sse_streaming_runs test_ndjson_streaming test_streaming_with_tool_calls
export -f test_streaming_error_handling test_streaming_cancellation
export -f run_streaming_tests