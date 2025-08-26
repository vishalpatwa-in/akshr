#!/bin/bash

# Concurrency Acceptance Tests
# Tests for concurrent operations, conflict resolution, and optimistic concurrency control

# ==============================================
# TEST SETUP
# ==============================================

setup_concurrency_tests() {
    log INFO "Setting up concurrency tests..."

    # Create shared test resources
    TEST_CONCURRENCY_ASSISTANT_ID=""
    TEST_CONCURRENCY_THREAD_ID=""

    # Create assistant for concurrency testing
    local assistant_data=$(get_basic_assistant)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    assert_status "$response" $HTTP_CREATED "Create concurrency test assistant"

    TEST_CONCURRENCY_ASSISTANT_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "assistant" "$TEST_CONCURRENCY_ASSISTANT_ID"

    # Create thread for concurrency testing
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    assert_status "$response" $HTTP_CREATED "Create concurrency test thread"

    TEST_CONCURRENCY_THREAD_ID=$(get_body "$response" | jq -r '.id')
    store_resource_id "thread" "$TEST_CONCURRENCY_THREAD_ID"

    log INFO "Created concurrency test resources: assistant=$TEST_CONCURRENCY_ASSISTANT_ID, thread=$TEST_CONCURRENCY_THREAD_ID"
}

cleanup_concurrency_tests() {
    log INFO "Cleaning up concurrency test resources..."

    if [[ -n "$TEST_CONCURRENCY_ASSISTANT_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" >/dev/null 2>&1
    fi

    if [[ -n "$TEST_CONCURRENCY_THREAD_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID" >/dev/null 2>&1
    fi

    unset TEST_CONCURRENCY_ASSISTANT_ID
    unset TEST_CONCURRENCY_THREAD_ID
}

# ==============================================
# CONCURRENCY TEST FUNCTIONS
# ==============================================

# Test ETag CAS conflict handling
test_etag_cas_conflicts() {
    log INFO "Testing ETag CAS conflict handling..."

    local passed=0
    local failed=0

    # First, get the assistant with ETag
    local response=$(make_request GET "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_OK ]]; then
        # Check if ETag header is present
        local etag=$(echo "$response" | grep -i "etag:" | cut -d: -f2- | tr -d '\r')

        if [[ -n "$etag" ]]; then
            log INFO "✓ ETag header present: $etag"
            passed=$((passed + 1))

            # Try to update with wrong ETag (should conflict)
            local updated_data='{"name": "Updated Name"}'
            local headers="If-Match: \"wrong-etag\""
            response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$updated_data" "$headers")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_CONFLICT ]]; then
                log INFO "✓ CAS conflict detected correctly"
                passed=$((passed + 1))
            else
                log ERROR "✗ Expected conflict (409), got status $status"
                failed=$((failed + 1))
            fi

            # Try to update with correct ETag (should succeed)
            headers="If-Match: $etag"
            response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$updated_data" "$headers")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ CAS update with correct ETag succeeded"
                passed=$((passed + 1))
            else
                log ERROR "✗ CAS update with correct ETag failed (status $status)"
                failed=$((failed + 1))
            fi
        else
            log WARN "✗ ETag header not present - CAS may not be implemented"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Could not retrieve assistant for ETag testing (status $status)"
        failed=$((failed + 1))
    fi

    log INFO "ETag CAS tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"etag_cas_conflicts\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test optimistic concurrency control
test_optimistic_concurrency() {
    log INFO "Testing optimistic concurrency control..."

    local passed=0
    local failed=0

    # Test concurrent updates to the same resource
    local update_data='{"name": "Concurrent Update Test"}'

    # Launch multiple concurrent updates
    local pids=()
    local results=()

    for i in {1..5}; do
        (
            local response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$update_data")
            local status=$(get_status "$response")
            echo "$status" >> "/tmp/concurrent_test_$$_$i"
        ) &
        pids+=($!)
    done

    # Wait for all requests to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Check results
    local success_count=0
    local conflict_count=0
    local error_count=0

    for i in {1..5}; do
        if [[ -f "/tmp/concurrent_test_$$_$i" ]]; then
            local status=$(cat "/tmp/concurrent_test_$$_$i")
            if [[ "$status" -eq $HTTP_OK ]]; then
                success_count=$((success_count + 1))
            elif [[ "$status" -eq $HTTP_CONFLICT ]]; then
                conflict_count=$((conflict_count + 1))
            else
                error_count=$((error_count + 1))
            fi
            rm -f "/tmp/concurrent_test_$$_$i"
        fi
    done

    if [[ $success_count -gt 0 ]]; then
        log INFO "✓ At least one concurrent update succeeded ($success_count total)"
        passed=$((passed + 1))
    else
        log ERROR "✗ No concurrent updates succeeded"
        failed=$((failed + 1))
    fi

    if [[ $conflict_count -gt 0 ]]; then
        log INFO "✓ Conflict detection working ($conflict_count conflicts)"
        passed=$((passed + 1))
    else
        log WARN "✗ No conflicts detected - may indicate lack of concurrency control"
    fi

    if [[ $error_count -eq 0 ]]; then
        log INFO "✓ No unexpected errors during concurrent updates"
        passed=$((passed + 1))
    else
        log ERROR "✗ Unexpected errors during concurrent updates ($error_count)"
        failed=$((failed + 1))
    fi

    log INFO "Optimistic concurrency tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"optimistic_concurrency\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test concurrent run creation and updates
test_concurrent_run_operations() {
    log INFO "Testing concurrent run creation and updates..."

    local passed=0
    local failed=0

    # Test creating multiple runs concurrently
    local run_data=$(get_basic_run "$TEST_CONCURRENCY_ASSISTANT_ID")

    local pids=()
    local run_ids=()

    for i in {1..3}; do
        (
            local response=$(make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs" "$run_data")
            local status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_CREATED ]]; then
                local run_id=$(get_body "$response" | jq -r '.id')
                echo "SUCCESS:$run_id" >> "/tmp/concurrent_runs_$$_$i"
            else
                echo "FAILED:$status" >> "/tmp/concurrent_runs_$$_$i"
            fi
        ) &
        pids+=($!)
    done

    # Wait for all requests to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Check results
    local success_count=0
    local created_runs=()

    for i in {1..3}; do
        if [[ -f "/tmp/concurrent_runs_$$_$i" ]]; then
            local result=$(cat "/tmp/concurrent_runs_$$_$i")
            if [[ "$result" == SUCCESS:* ]]; then
                success_count=$((success_count + 1))
                local run_id=$(echo "$result" | cut -d: -f2)
                created_runs+=("$run_id")
                store_resource_id "run" "$run_id"
            fi
            rm -f "/tmp/concurrent_runs_$$_$i"
        fi
    done

    if [[ $success_count -gt 0 ]]; then
        log INFO "✓ Concurrent run creation succeeded ($success_count runs created)"
        passed=$((passed + 1))

        # Test concurrent updates to different runs
        if [[ ${#created_runs[@]} -gt 1 ]]; then
            local update_data='{"metadata": {"concurrent_test": true}}'
            pids=()

            for run_id in "${created_runs[@]}"; do
                (
                    local response=$(make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs/$run_id" "$update_data")
                    local status=$(get_status "$response")
                    echo "$status" >> "/tmp/concurrent_run_updates_$$_$run_id"
                ) &
                pids+=($!)
            done

            # Wait for updates
            for pid in "${pids[@]}"; do
                wait "$pid"
            done

            # Check update results
            local update_success=0
            for run_id in "${created_runs[@]}"; do
                if [[ -f "/tmp/concurrent_run_updates_$$_$run_id" ]]; then
                    local status=$(cat "/tmp/concurrent_run_updates_$$_$run_id")
                    if [[ "$status" -eq $HTTP_OK ]]; then
                        update_success=$((update_success + 1))
                    fi
                    rm -f "/tmp/concurrent_run_updates_$$_$run_id"
                fi
            done

            if [[ $update_success -gt 0 ]]; then
                log INFO "✓ Concurrent run updates succeeded ($update_success updates)"
                passed=$((passed + 1))
            else
                log ERROR "✗ No concurrent run updates succeeded"
                failed=$((failed + 1))
            fi
        fi
    else
        log ERROR "✗ No concurrent run creation succeeded"
        failed=$((failed + 1))
    fi

    # Clean up created runs
    for run_id in "${created_runs[@]}"; do
        make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs/$run_id/cancel" >/dev/null 2>&1
    done

    log INFO "Concurrent run operations tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"concurrent_run_operations\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test retry logic on 409 conflicts
test_retry_logic_on_conflicts() {
    log INFO "Testing retry logic on 409 conflicts..."

    local passed=0
    local failed=0

    # Create a resource and then try concurrent modifications
    local original_name="Original Name"
    local update_data="{\"name\": \"$original_name\"}"

    # First, update the assistant to a known state
    local response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$update_data")
    assert_status "$response" $HTTP_OK "Set initial state for retry test"

    # Get the current ETag
    response=$(make_request GET "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID")
    local etag=$(echo "$response" | grep -i "etag:" | cut -d: -f2- | tr -d '\r')

    if [[ -n "$etag" ]]; then
        # Function to perform update with retry logic
        perform_update_with_retry() {
            local max_attempts=3
            local attempt=1
            local final_status=""

            while [[ $attempt -le $max_attempts ]]; do
                log DEBUG "Retry attempt $attempt/$max_attempts"

                # Use stale ETag to force conflicts
                local headers="If-Match: \"stale-etag-$attempt\""
                local response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$update_data" "$headers")
                local status=$(get_status "$response")

                if [[ "$status" -eq $HTTP_OK ]]; then
                    final_status="SUCCESS"
                    break
                elif [[ "$status" -eq $HTTP_CONFLICT ]]; then
                    if [[ $attempt -lt $max_attempts ]]; then
                        # Get fresh ETag and retry
                        local fresh_response=$(make_request GET "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID")
                        local fresh_etag=$(echo "$fresh_response" | grep -i "etag:" | cut -d: -f2- | tr -d '\r')

                        if [[ -n "$fresh_etag" ]]; then
                            # Retry with fresh ETag
                            headers="If-Match: $fresh_etag"
                            response=$(make_request POST "$BASE_URL/v1/assistants/$TEST_CONCURRENCY_ASSISTANT_ID" "$update_data" "$headers")
                            status=$(get_status "$response")

                            if [[ "$status" -eq $HTTP_OK ]]; then
                                final_status="SUCCESS_AFTER_RETRY"
                                break
                            fi
                        fi
                    fi
                else
                    final_status="ERROR:$status"
                    break
                fi

                attempt=$((attempt + 1))
                sleep 0.1  # Small delay between retries
            done

            echo "$final_status"
        }

        # Test the retry logic
        local result=$(perform_update_with_retry)

        if [[ "$result" == "SUCCESS" ]] || [[ "$result" == "SUCCESS_AFTER_RETRY" ]]; then
            log INFO "✓ Retry logic succeeded: $result"
            passed=$((passed + 1))

            if [[ "$result" == "SUCCESS_AFTER_RETRY" ]]; then
                log INFO "✓ Conflict resolution worked correctly"
                passed=$((passed + 1))
            fi
        else
            log ERROR "✗ Retry logic failed: $result"
            failed=$((failed + 1))
        fi
    else
        log WARN "✗ No ETag support - skipping retry logic test"
        failed=$((failed + 1))
    fi

    log INFO "Retry logic tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"retry_logic_on_conflicts\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test state transition safety
test_state_transition_safety() {
    log INFO "Testing state transition safety..."

    local passed=0
    local failed=0

    # Create a run and test concurrent state transitions
    local run_data=$(get_basic_run "$TEST_CONCURRENCY_ASSISTANT_ID")
    local response=$(make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs" "$run_data")
    assert_status "$response" $HTTP_CREATED "Create run for state transition test"

    local run_id=$(get_body "$response" | jq -r '.id')
    store_resource_id "run" "$run_id"

    # Test concurrent operations on the same run
    local operations=("cancel" "cancel" "cancel")  # All try to cancel
    local pids=()
    local results=()

    for i in {0..2}; do
        (
            local op="${operations[$i]}"
            local response=$(make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs/$run_id/$op")
            local status=$(get_status "$response")
            echo "$op:$status" >> "/tmp/state_transition_$$_$i"
        ) &
        pids+=($!)
    done

    # Wait for all operations to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Analyze results
    local success_count=0
    local conflict_count=0
    local invalid_state_count=0

    for i in {0..2}; do
        if [[ -f "/tmp/state_transition_$$_$i" ]]; then
            local result=$(cat "/tmp/state_transition_$$_$i")
            local status=$(echo "$result" | cut -d: -f2)

            if [[ "$status" -eq $HTTP_OK ]]; then
                success_count=$((success_count + 1))
            elif [[ "$status" -eq $HTTP_CONFLICT ]]; then
                conflict_count=$((conflict_count + 1))
            elif [[ "$status" -eq $HTTP_UNPROCESSABLE_ENTITY ]]; then
                invalid_state_count=$((invalid_state_count + 1))
            fi

            rm -f "/tmp/state_transition_$$_$i"
        fi
    done

    # At least one operation should succeed
    if [[ $success_count -gt 0 ]]; then
        log INFO "✓ At least one state transition succeeded"
        passed=$((passed + 1))
    else
        log ERROR "✗ No state transitions succeeded"
        failed=$((failed + 1))
    fi

    # Subsequent operations should either conflict or be rejected due to invalid state
    if [[ $conflict_count -gt 0 ]] || [[ $invalid_state_count -gt 0 ]]; then
        log INFO "✓ State transition conflicts handled correctly"
        passed=$((passed + 1))
    else
        log WARN "✗ No state transition conflicts detected"
    fi

    # Clean up
    make_request POST "$BASE_URL/v1/threads/$TEST_CONCURRENCY_THREAD_ID/runs/$run_id/cancel" >/dev/null 2>&1

    log INFO "State transition safety tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"state_transition_safety\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN CONCURRENCY TEST EXECUTION
# ==============================================

# Run all concurrency tests
run_concurrency_tests() {
    log INFO "Starting concurrency acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_concurrency_tests

    # Define test functions
    local test_functions=(
        "test_etag_cas_conflicts"
        "test_optimistic_concurrency"
        "test_concurrent_run_operations"
        "test_retry_logic_on_conflicts"
        "test_state_transition_safety"
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
    cleanup_concurrency_tests

    # Calculate duration
    local duration=$(( $(date + %s) - start_time ))

    # Combine all results
    local combined_results="{\"passed\": $total_passed, \"failed\": $total_failed, \"duration_seconds\": $duration, \"test_groups\": ["
    for i in "${!results[@]}"; do
        if [[ $i -gt 0 ]]; then
            combined_results+=","
        fi
        combined_results+="${results[$i]}"
    done
    combined_results+="]}"

    log INFO "Concurrency tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_concurrency_tests cleanup_concurrency_tests
export -f test_etag_cas_conflicts test_optimistic_concurrency test_concurrent_run_operations
export -f test_retry_logic_on_conflicts test_state_transition_safety
export -f run_concurrency_tests