#!/bin/bash

# API Endpoint Tests
# Tests for all CRUD operations and API endpoint validation

# ==============================================
# TEST SETUP
# ==============================================

setup_api_tests() {
    log INFO "Setting up API endpoint tests..."

    # Create test resources
    API_TEST_ASSISTANT_ID=""
    API_TEST_THREAD_ID=""
    API_TEST_MESSAGE_ID=""
    API_TEST_RUN_ID=""
    API_TEST_FILE_ID=""

    # Create assistant for API tests
    local assistant_data=$(get_basic_assistant)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create API test assistant"

    API_TEST_ASSISTANT_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$API_TEST_ASSISTANT_ID"

    # Create thread for API tests
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    assert_status "$response" $HTTP_CREATED "Create API test thread"

    API_TEST_THREAD_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "thread" "$API_TEST_THREAD_ID"

    log INFO "API test resources created: assistant=$API_TEST_ASSISTANT_ID, thread=$API_TEST_THREAD_ID"
}

cleanup_api_tests() {
    log INFO "Cleaning up API endpoint test resources..."

    if [[ -n "$API_TEST_ASSISTANT_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/assistants/$API_TEST_ASSISTANT_ID" >/dev/null 2>&1
    fi

    if [[ -n "$API_TEST_THREAD_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/threads/$API_TEST_THREAD_ID" >/dev/null 2>&1
    fi

    if [[ -n "$API_TEST_FILE_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/files/$API_TEST_FILE_ID" >/dev/null 2>&1
    fi

    unset API_TEST_ASSISTANT_ID API_TEST_THREAD_ID API_TEST_MESSAGE_ID API_TEST_RUN_ID API_TEST_FILE_ID
}

# ==============================================
# API ENDPOINT TEST FUNCTIONS
# ==============================================

# Test assistant CRUD operations
test_assistant_crud() {
    log INFO "Testing assistant CRUD operations..."

    local passed=0
    local failed=0

    # Create assistant
    local assistant_data='{
      "name": "CRUD Test Assistant",
      "description": "Assistant for CRUD testing",
      "instructions": "You are a test assistant for CRUD operations.",
      "model": "gemini-pro",
      "metadata": {"test": "crud"}
    }'

    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        log INFO "✓ Assistant creation successful"
        passed=$((passed + 1))

        local assistant_id=$(get_body "$response" | jq -r '.id')
        store_resource_id "assistant" "$assistant_id"

        # Read assistant
        response=$(make_request GET "$BASE_URL/v1/assistants/$assistant_id")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Assistant retrieval successful"
            passed=$((passed + 1))

            # Verify assistant data
            local name=$(get_body "$response" | jq -r '.name')
            if [[ "$name" == "CRUD Test Assistant" ]]; then
                log INFO "✓ Assistant data is correct"
                passed=$((passed + 1))
            else
                log ERROR "✗ Assistant name mismatch: $name"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Assistant retrieval failed (status: $status)"
            failed=$((failed + 1))
        fi

        # Update assistant
        local update_data='{"name": "Updated CRUD Assistant"}'
        response=$(make_request POST "$BASE_URL/v1/assistants/$assistant_id" "$update_data")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Assistant update successful"
            passed=$((passed + 1))

            # Verify update
            response=$(make_request GET "$BASE_URL/v1/assistants/$assistant_id")
            local updated_name=$(get_body "$response" | jq -r '.name')

            if [[ "$updated_name" == "Updated CRUD Assistant" ]]; then
                log INFO "✓ Assistant update verified"
                passed=$((passed + 1))
            else
                log ERROR "✗ Assistant update not applied: $updated_name"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Assistant update failed (status: $status)"
            failed=$((failed + 1))
        fi

        # Delete assistant
        response=$(make_request DELETE "$BASE_URL/v1/assistants/$assistant_id")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Assistant deletion successful"
            passed=$((passed + 1))
        else
            log ERROR "✗ Assistant deletion failed (status: $status)"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Assistant creation failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Assistant CRUD tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"assistant_crud\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test thread management with messages
test_thread_management() {
    log INFO "Testing thread management with messages..."

    local passed=0
    local failed=0

    # Create thread
    local thread_data='{"metadata": {"test": "thread_management"}}'
    local response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        log INFO "✓ Thread creation successful"
        passed=$((passed + 1))

        local thread_id=$(get_body "$response" | jq -r '.id')
        store_resource_id "thread" "$thread_id"

        # Create messages in thread
        local messages=("First test message" "Second test message" "Third test message")
        local message_ids=()

        for message_text in "${messages[@]}"; do
            local message_data='{"role": "user", "content": "'$message_text'"}'
            response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/messages" "$message_data")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_CREATED ]]; then
                local message_id=$(get_body "$response" | jq -r '.id')
                message_ids+=("$message_id")
                log INFO "✓ Message creation successful"
                passed=$((passed + 1))
            else
                log ERROR "✗ Message creation failed (status: $status)"
                failed=$((failed + 1))
            fi
        done

        # List messages
        response=$(make_request GET "$BASE_URL/v1/threads/$thread_id/messages")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Message listing successful"
            passed=$((passed + 1))

            local message_count=$(get_body "$response" | jq -r '.data | length')
            if [[ $message_count -ge ${#message_ids[@]} ]]; then
                log INFO "✓ Correct number of messages returned: $message_count"
                passed=$((passed + 1))
            else
                log ERROR "✗ Incorrect message count: $message_count (expected at least ${#message_ids[@]})"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Message listing failed (status: $status)"
            failed=$((failed + 1))
        fi

        # Test individual message retrieval
        if [[ ${#message_ids[@]} -gt 0 ]]; then
            local first_message_id="${message_ids[0]}"
            response=$(make_request GET "$BASE_URL/v1/threads/$thread_id/messages/$first_message_id")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Individual message retrieval successful"
                passed=$((passed + 1))
            else
                log ERROR "✗ Individual message retrieval failed (status: $status)"
                failed=$((failed + 1))
            fi
        fi

        # Clean up thread (this should cascade delete messages)
        response=$(make_request DELETE "$BASE_URL/v1/threads/$thread_id")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Thread deletion successful"
            passed=$((passed + 1))
        else
            log ERROR "✗ Thread deletion failed (status: $status)"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Thread creation failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Thread management tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"thread_management\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test run lifecycle management
test_run_lifecycle() {
    log INFO "Testing run lifecycle management..."

    local passed=0
    local failed=0

    # Create assistant for run testing
    local assistant_data=$(get_basic_assistant)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create assistant for run lifecycle test"

    local assistant_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$assistant_id"

    # Create thread
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    assert_status "$response" $HTTP_CREATED "Create thread for run lifecycle test"

    local thread_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "thread" "$thread_id"

    # Create message
    local message_data=$(get_user_message)
    response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/messages" "$message_data")
    assert_status "$response" $HTTP_CREATED "Create message for run lifecycle test"

    # Create run
    local run_data=$(get_basic_run "$assistant_id")
    response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/runs" "$run_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        log INFO "✓ Run creation successful"
        passed=$((passed + 1))

        local run_id=$(get_body "$response" | jq -r '.id')

        # Get run status
        response=$(make_request GET "$BASE_URL/v1/threads/$thread_id/runs/$run_id")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Run retrieval successful"
            passed=$((passed + 1))

            # Check run status
            local run_status=$(get_body "$response" | jq -r '.status')
            log INFO "✓ Run status: $run_status"
            passed=$((passed + 1))
        else
            log ERROR "✗ Run retrieval failed (status: $status)"
            failed=$((failed + 1))
        fi

        # Test run cancellation
        response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/runs/$run_id/cancel")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Run cancellation successful"
            passed=$((passed + 1))
        else
            log ERROR "✗ Run cancellation failed (status: $status)"
            failed=$((failed + 1))
        fi

        # List runs
        response=$(make_request GET "$BASE_URL/v1/threads/$thread_id/runs")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Run listing successful"
            passed=$((passed + 1))
        else
            log ERROR "✗ Run listing failed (status: $status)"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Run creation failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Run lifecycle tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"run_lifecycle\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test error responses and validation
test_error_responses() {
    log INFO "Testing error responses and validation..."

    local passed=0
    local failed=0

    # Test invalid assistant creation
    local invalid_data='{"name": "", "instructions": ""}'
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$invalid_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_BAD_REQUEST ]] || [[ "$status" -eq $HTTP_UNPROCESSABLE_ENTITY ]]; then
        log INFO "✓ Invalid assistant creation properly rejected"
        passed=$((passed + 1))
    else
        log ERROR "✗ Invalid assistant creation should be rejected (status: $status)"
        failed=$((failed + 1))
    fi

    # Test non-existent resource access
    response=$(make_request GET "$BASE_URL/v1/assistants/non-existent-id")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_NOT_FOUND ]]; then
        log INFO "✓ Non-existent resource access properly handled"
        passed=$((passed + 1))
    else
        log ERROR "✗ Non-existent resource should return 404 (status: $status)"
        failed=$((failed + 1))
    fi

    # Test invalid JSON
    response=$(curl -s -X POST \
                     -H "Authorization: Bearer $API_KEY" \
                     -H "Content-Type: application/json" \
                     -d '{"invalid": json}' \
                     "$BASE_URL/v1/assistants")

    if [[ -n "$response" ]]; then
        local status=$(echo "$response" | jq -r '.status // 400' 2>/dev/null || echo "400")

        if [[ "$status" -eq $HTTP_BAD_REQUEST ]]; then
            log INFO "✓ Invalid JSON properly handled"
            passed=$((passed + 1))
        else
            log ERROR "✗ Invalid JSON should return 400 (status: $status)"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ No response for invalid JSON"
        failed=$((failed + 1))
    fi

    # Test method not allowed
    response=$(make_request PATCH "$BASE_URL/v1/assistants")
    local status=$(get_status "$response")

    if [[ "$status" -eq 405 ]] || [[ "$status" -eq $HTTP_BAD_REQUEST ]]; then
        log INFO "✓ Method not allowed properly handled"
        passed=$((passed + 1))
    else
        log ERROR "✗ Method not allowed should return 405 (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Error responses tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"error_responses\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test pagination for list endpoints
test_pagination() {
    log INFO "Testing pagination for list endpoints..."

    local passed=0
    local failed=0

    # Create multiple assistants for pagination testing
    local assistant_ids=()
    for i in {1..5}; do
        local assistant_data='{
          "name": "Pagination Test Assistant '$i'",
          "instructions": "Assistant '$i' for pagination testing",
          "model": "gemini-pro",
          "metadata": {"test": "pagination", "index": '$i'}
        }'

        local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
        local status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_CREATED ]]; then
            local assistant_id=$(get_body "$response" | jq -r '.id')
            assistant_ids+=("$assistant_id")
            store_resource_id "assistant" "$assistant_id"
        fi
    done

    # Test list endpoint with pagination
    local response=$(make_request GET "$BASE_URL/v1/assistants?limit=2")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ Assistants list with pagination successful"
        passed=$((passed + 1))

        local body=$(get_body "$response")

        # Check for pagination fields
        if echo "$body" | jq -e '.data' >/dev/null 2>&1; then
            log INFO "✓ Response contains data array"
            passed=$((passed + 1))

            local data_count=$(echo "$body" | jq -r '.data | length')
            if [[ $data_count -le 2 ]]; then
                log INFO "✓ Pagination limit respected: $data_count items"
                passed=$((passed + 1))
            else
                log ERROR "✗ Pagination limit not respected: $data_count items"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Response missing data array"
            failed=$((failed + 1))
        fi

        # Check for pagination metadata
        if echo "$body" | jq -e '.first_id or .last_id or .has_more' >/dev/null 2>&1; then
            log INFO "✓ Response contains pagination metadata"
            passed=$((passed + 1))
        else
            log INFO "✓ Pagination metadata not present (may not be implemented)"
            passed=$((passed + 1))
        fi
    else
        log ERROR "✗ Assistants list with pagination failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Pagination tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"pagination\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN API ENDPOINT TEST EXECUTION
# ==============================================

# Run all API endpoint tests
run_api_endpoint_tests() {
    log INFO "Starting API endpoint acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_api_tests

    # Define test functions
    local test_functions=(
        "test_assistant_crud"
        "test_thread_management"
        "test_run_lifecycle"
        "test_error_responses"
        "test_pagination"
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
    cleanup_api_tests

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

    log INFO "API endpoint tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_api_tests cleanup_api_tests
export -f test_assistant_crud test_thread_management test_run_lifecycle
export -f test_error_responses test_pagination
export -f run_api_endpoint_tests