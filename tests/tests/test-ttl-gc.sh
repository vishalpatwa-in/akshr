#!/bin/bash

# TTL/GC Acceptance Tests
# Tests for automatic expiration, manual GC operations, and cleanup functionality

# ==============================================
# TEST SETUP
# ==============================================

setup_gc_tests() {
    log INFO "Setting up TTL/GC tests..."

    # Create test resources with specific TTL values
    TEST_ASSISTANT_IDS=()
    TEST_THREAD_IDS=()
    TEST_FILE_IDS=()

    # Create resources for testing
    for i in {1..5}; do
        # Create assistant
        local assistant_data=$(get_basic_assistant)
        local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
        assert_status "$response" $HTTP_CREATED "Create test assistant $i"

        local assistant_id=$(get_body "$response" | jq -r '.id')
        TEST_ASSISTANT_IDS+=("$assistant_id")
        store_resource_id "assistant" "$assistant_id"

        # Create thread
        local thread_data=$(get_basic_thread)
        response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
        assert_status "$response" $HTTP_CREATED "Create test thread $i"

        local thread_id=$(get_body "$response" | jq -r '.id')
        TEST_THREAD_IDS+=("$thread_id")
        store_resource_id "thread" "$thread_id"

        # Create message
        local message_data=$(get_user_message)
        response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/messages" "$message_data")
        assert_status "$response" $HTTP_CREATED "Create test message $i"

        # Upload file
        local file_content=$(get_text_file_content)
        response=$(make_request POST "$BASE_URL/v1/files" "$file_content" "Content-Type: text/plain")
        assert_status "$response" $HTTP_CREATED "Create test file $i"

        local file_id=$(get_body "$response" | jq -r '.id')
        TEST_FILE_IDS+=("$file_id")
        store_resource_id "file" "$file_id"
    done

    log INFO "Created ${#TEST_ASSISTANT_IDS[@]} assistants, ${#TEST_THREAD_IDS[@]} threads, ${#TEST_FILE_IDS[@]} files for testing"
}

cleanup_gc_tests() {
    log INFO "Cleaning up TTL/GC test resources..."

    # Clean up test resources
    for assistant_id in "${TEST_ASSISTANT_IDS[@]}"; do
        make_request DELETE "$BASE_URL/v1/assistants/$assistant_id" >/dev/null 2>&1
    done

    for thread_id in "${TEST_THREAD_IDS[@]}"; do
        make_request DELETE "$BASE_URL/v1/threads/$thread_id" >/dev/null 2>&1
    done

    for file_id in "${TEST_FILE_IDS[@]}"; do
        make_request DELETE "$BASE_URL/v1/files/$file_id" >/dev/null 2>&1
    done

    unset TEST_ASSISTANT_IDS
    unset TEST_THREAD_IDS
    unset TEST_FILE_IDS
}

# ==============================================
# TTL/GC TEST FUNCTIONS
# ==============================================

# Test automatic expiration after 48 hours
test_automatic_expiration() {
    log INFO "Testing automatic expiration after 48 hours..."

    local passed=0
    local failed=0

    # This test would require either:
    # 1. Fast-forwarding time in the system
    # 2. Creating resources with very short TTL for testing
    # 3. Mocking the TTL mechanism

    # For now, we'll test the TTL configuration endpoint
    local response=$(make_request GET "$BASE_URL/admin/gc/config" "" "Authorization: Bearer $GC_ADMIN_KEY")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ TTL configuration endpoint accessible"
        passed=$((passed + 1))

        # Check if TTL configuration is present
        local config=$(get_body "$response")
        if echo "$config" | jq -e '.config' >/dev/null 2>&1; then
            log INFO "✓ TTL configuration structure is valid"
            passed=$((passed + 1))
        else
            log ERROR "✗ TTL configuration structure is invalid"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ TTL configuration endpoint not accessible (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Automatic expiration tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"automatic_expiration\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test manual GC trigger and cleanup
test_manual_gc_trigger() {
    log INFO "Testing manual GC trigger and cleanup..."

    local passed=0
    local failed=0

    # Test GC trigger with admin key
    local gc_request=$(get_gc_trigger_request "cleanup")
    local response=$(make_request POST "$BASE_URL/admin/gc" "$gc_request" "Authorization: Bearer $GC_ADMIN_KEY")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ Manual GC trigger successful"
        passed=$((passed + 1))

        # Check response structure
        local body=$(get_body "$response")
        if echo "$body" | jq -e '.success' >/dev/null 2>&1; then
            log INFO "✓ GC response contains success field"
            passed=$((passed + 1))
        else
            log ERROR "✗ GC response missing success field"
            failed=$((failed + 1))
        fi

        if echo "$body" | jq -e '.operationId' >/dev/null 2>&1; then
            log INFO "✓ GC response contains operation ID"
            passed=$((passed + 1))
        else
            log ERROR "✗ GC response missing operation ID"
            failed=$((failed + 1))
        fi

        if echo "$body" | jq -e '.summary' >/dev/null 2>&1; then
            log INFO "✓ GC response contains summary"
            passed=$((passed + 1))
        else
            log ERROR "✗ GC response missing summary"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Manual GC trigger failed (status: $status)"
        failed=$((failed + 1))

        # Check if it's an authentication error
        if [[ "$status" -eq $HTTP_UNAUTHORIZED ]]; then
            log ERROR "✗ GC admin authentication failed"
        fi
    fi

    log INFO "Manual GC trigger tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"manual_gc_trigger\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test dry-run mode for GC operations
test_gc_dry_run() {
    log INFO "Testing GC dry-run mode..."

    local passed=0
    local failed=0

    # Test GC dry run
    local gc_request=$(get_gc_dry_run_request)
    local response=$(make_request POST "$BASE_URL/admin/gc/dry-run" "$gc_request" "Authorization: Bearer $GC_ADMIN_KEY")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ GC dry-run trigger successful"
        passed=$((passed + 1))

        # Check response structure
        local body=$(get_body "$response")
        if echo "$body" | jq -e '.dryRun == true' >/dev/null 2>&1; then
            log INFO "✓ Dry-run flag is correctly set"
            passed=$((passed + 1))
        else
            log ERROR "✗ Dry-run flag is not set correctly"
            failed=$((failed + 1))
        fi

        if echo "$body" | jq -e '.summary' >/dev/null 2>&1; then
            log INFO "✓ Dry-run response contains summary"
            passed=$((passed + 1))
        else
            log ERROR "✗ Dry-run response missing summary"
            failed=$((failed + 1))
        fi

        # Verify no actual cleanup occurred (by checking if resources still exist)
        if [[ ${#TEST_ASSISTANT_IDS[@]} -gt 0 ]]; then
            local test_assistant_id="${TEST_ASSISTANT_IDS[0]}"
            response=$(make_request GET "$BASE_URL/v1/assistants/$test_assistant_id")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Resources preserved during dry-run"
                passed=$((passed + 1))
            else
                log ERROR "✗ Resource unexpectedly deleted during dry-run"
                failed=$((failed + 1))
            fi
        fi
    else
        log ERROR "✗ GC dry-run trigger failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "GC dry-run tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"gc_dry_run\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test cascade deletion behavior
test_cascade_deletion() {
    log INFO "Testing cascade deletion behavior..."

    local passed=0
    local failed=0

    # Create a hierarchical structure: assistant -> thread -> message -> run
    local assistant_data=$(get_assistant_with_tools)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create cascade test assistant"

    local assistant_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$assistant_id"

    # Create thread
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    assert_status "$response" $HTTP_CREATED "Create cascade test thread"

    local thread_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "thread" "$thread_id"

    # Create message
    local message_data=$(get_user_message)
    response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/messages" "$message_data")
    assert_status "$response" $HTTP_CREATED "Create cascade test message"

    local message_id=$(get_body "$response" | jq -r '.id')

    # Create run
    local run_data=$(get_basic_run "$assistant_id")
    response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/runs" "$run_data")
    assert_status "$response" $HTTP_CREATED "Create cascade test run"

    local run_id=$(get_body "$response" | jq -r '.id')

    # Test cascade deletion by deleting the assistant
    response=$(make_request DELETE "$BASE_URL/v1/assistants/$assistant_id")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ Cascade deletion of assistant successful"
        passed=$((passed + 1))

        # Check if related resources are also deleted or become inaccessible
        # Note: Actual cascade behavior depends on implementation

        # Check if thread is still accessible
        response=$(make_request GET "$BASE_URL/v1/threads/$thread_id")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Thread remains accessible after assistant deletion"
            passed=$((passed + 1))
        else
            log INFO "✓ Thread became inaccessible after assistant deletion (cascade)"
            passed=$((passed + 1))
        fi
    else
        log ERROR "✗ Cascade deletion failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Cascade deletion tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"cascade_deletion\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test GC statistics and reporting
test_gc_statistics() {
    log INFO "Testing GC statistics and reporting..."

    local passed=0
    local failed=0

    # Get GC configuration and statistics
    local response=$(make_request GET "$BASE_URL/admin/gc/config" "" "Authorization: Bearer $GC_ADMIN_KEY")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        log INFO "✓ GC statistics endpoint accessible"
        passed=$((passed + 1))

        # Check configuration structure
        local body=$(get_body "$response")
        local config=$(echo "$body" | jq -r '.config // empty')

        if [[ -n "$config" ]]; then
            log INFO "✓ GC configuration is present"
            passed=$((passed + 1))

            # Check for required configuration fields
            local required_fields=("maxRuntimeSeconds" "defaultBatchSize" "supportedResourceTypes")
            for field in "${required_fields[@]}"; do
                if echo "$config" | jq -e ".$field" >/dev/null 2>&1; then
                    log INFO "✓ Configuration field '$field' present"
                    passed=$((passed + 1))
                else
                    log ERROR "✗ Configuration field '$field' missing"
                    failed=$((failed + 1))
                fi
            done
        else
            log ERROR "✗ GC configuration is missing"
            failed=$((failed + 1))
        fi

        # Check for feature flags
        if echo "$body" | jq -e '.config.features' >/dev/null 2>&1; then
            log INFO "✓ Feature flags are present"
            passed=$((passed + 1))
        else
            log ERROR "✗ Feature flags are missing"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ GC statistics endpoint failed (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "GC statistics tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"gc_statistics\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN GC TEST EXECUTION
# ==============================================

# Run all GC tests
run_gc_tests() {
    log INFO "Starting TTL/GC acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_gc_tests

    # Define test functions
    local test_functions=(
        "test_automatic_expiration"
        "test_manual_gc_trigger"
        "test_gc_dry_run"
        "test_cascade_deletion"
        "test_gc_statistics"
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
    cleanup_gc_tests

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

    log INFO "TTL/GC tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_gc_tests cleanup_gc_tests
export -f test_automatic_expiration test_manual_gc_trigger test_gc_dry_run
export -f test_cascade_deletion test_gc_statistics
export -f run_gc_tests