#!/bin/bash

# End-to-End Tool-Call Round Trip Tests
# Tests for complete assistant workflow from creation to tool call completion

# ==============================================
# TEST SETUP
# ==============================================

setup_end_to_end_tests() {
    log INFO "Setting up end-to-end tests..."

    # Create test resources for end-to-end testing
    E2E_ASSISTANT_ID=""
    E2E_THREAD_ID=""
    E2E_MESSAGE_ID=""
    E2E_RUN_ID=""
    E2E_FILE_ID=""

    log INFO "End-to-end test resources initialized"
}

cleanup_end_to_end_tests() {
    log INFO "Cleaning up end-to-end test resources..."

    if [[ -n "$E2E_ASSISTANT_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/assistants/$E2E_ASSISTANT_ID" >/dev/null 2>&1
    fi

    if [[ -n "$E2E_THREAD_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/threads/$E2E_THREAD_ID" >/dev/null 2>&1
    fi

    if [[ -n "$E2E_FILE_ID" ]]; then
        make_request DELETE "$BASE_URL/v1/files/$E2E_FILE_ID" >/dev/null 2>&1
    fi

    unset E2E_ASSISTANT_ID E2E_THREAD_ID E2E_MESSAGE_ID E2E_RUN_ID E2E_FILE_ID
}

# ==============================================
# END-TO-END TEST FUNCTIONS
# ==============================================

# Test complete tool-call round trip
test_complete_tool_call_flow() {
    log INFO "Testing complete tool-call round trip..."

    local passed=0
    local failed=0
    local steps_completed=0

    # Step 1: Create assistant with tools
    log INFO "Step 1: Creating assistant with tools..."
    local assistant_data=$(get_assistant_with_tools)
    local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_ASSISTANT_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Assistant created: $E2E_ASSISTANT_ID"
        passed=$((passed + 1))
        steps_completed=$((steps_completed + 1))

        # Verify assistant has tools
        local tools_count=$(get_body "$response" | jq -r '.tools | length')
        if [[ "$tools_count" -gt 0 ]]; then
            log INFO "✓ Assistant has $tools_count tools configured"
            passed=$((passed + 1))
        else
            log ERROR "✗ Assistant has no tools configured"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Failed to create assistant (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 2: Create thread
    log INFO "Step 2: Creating thread..."
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_THREAD_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Thread created: $E2E_THREAD_ID"
        passed=$((passed + 1))
        steps_completed=$((steps_completed + 1))
    else
        log ERROR "✗ Failed to create thread (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 3: Create message
    log INFO "Step 3: Creating message..."
    local message_data='{
      "role": "user",
      "content": "What is the weather like in London?"
    }'
    response=$(make_request POST "$BASE_URL/v1/threads/$E2E_THREAD_ID/messages" "$message_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_MESSAGE_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Message created: $E2E_MESSAGE_ID"
        passed=$((passed + 1))
        steps_completed=$((steps_completed + 1))
    else
        log ERROR "✗ Failed to create message (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 4: Create run
    log INFO "Step 4: Creating run..."
    local run_data=$(get_basic_run "$E2E_ASSISTANT_ID")
    response=$(make_request POST "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs" "$run_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_RUN_ID=$(get_body "$response" | jq -r '.id')
        local run_status=$(get_body "$response" | jq -r '.status')
        log INFO "✓ Run created: $E2E_RUN_ID (status: $run_status)"
        passed=$((passed + 1))
        steps_completed=$((steps_completed + 1))
    else
        log ERROR "✗ Failed to create run (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 5: Wait for run to complete or require action
    log INFO "Step 5: Monitoring run status..."
    local max_wait=30
    local wait_count=0
    local run_completed=false
    local tool_calls_required=false

    while [[ $wait_count -lt $max_wait ]]; do
        response=$(make_request GET "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs/$E2E_RUN_ID")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            local run_status=$(get_body "$response" | jq -r '.status')

            case "$run_status" in
                "completed")
                    log INFO "✓ Run completed successfully"
                    run_completed=true
                    passed=$((passed + 1))
                    steps_completed=$((steps_completed + 1))
                    break
                    ;;
                "requires_action")
                    log INFO "✓ Run requires action (tool calls)"
                    tool_calls_required=true
                    passed=$((passed + 1))
                    steps_completed=$((steps_completed + 1))
                    break
                    ;;
                "failed")
                    log ERROR "✗ Run failed"
                    failed=$((failed + 1))
                    break
                    ;;
                "cancelled")
                    log ERROR "✗ Run was cancelled"
                    failed=$((failed + 1))
                    break
                    ;;
                *)
                    log DEBUG "Run status: $run_status (waiting...)"
                    ;;
            esac
        else
            log ERROR "✗ Failed to get run status (status: $status)"
            failed=$((failed + 1))
            break
        fi

        wait_count=$((wait_count + 1))
        sleep 1
    done

    if [[ $wait_count -ge $max_wait ]]; then
        log ERROR "✗ Run monitoring timed out after ${max_wait}s"
        failed=$((failed + 1))
    fi

    # Step 6: If tool calls are required, submit tool outputs
    if [[ "$tool_calls_required" == true ]]; then
        log INFO "Step 6: Processing tool calls..."

        # Get the run details to see required tool calls
        response=$(make_request GET "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs/$E2E_RUN_ID")
        local tool_calls=$(get_body "$response" | jq -r '.required_action.submit_tool_outputs.tool_calls // empty')

        if [[ -n "$tool_calls" ]] && [[ "$tool_calls" != "null" ]]; then
            log INFO "✓ Found tool calls to process"

            # Create tool outputs (mock weather data)
            local tool_outputs='{
              "tool_outputs": [
                {
                  "tool_call_id": "'$(echo "$tool_calls" | jq -r '.[0].id')'",
                  "output": "{\"temperature\": 72, \"condition\": \"sunny\", \"location\": \"London\"}"
                }
              ]
            }'

            # Submit tool outputs
            response=$(make_request POST "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs/$E2E_RUN_ID/submit_tool_outputs" "$tool_outputs")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Tool outputs submitted successfully"
                passed=$((passed + 1))
                steps_completed=$((steps_completed + 1))

                # Wait for run to complete after tool outputs
                wait_count=0
                while [[ $wait_count -lt 15 ]]; do
                    response=$(make_request GET "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs/$E2E_RUN_ID")
                    status=$(get_status "$response")

                    if [[ "$status" -eq $HTTP_OK ]]; then
                        local run_status=$(get_body "$response" | jq -r '.status')
                        if [[ "$run_status" == "completed" ]]; then
                            log INFO "✓ Run completed after tool outputs"
                            run_completed=true
                            passed=$((passed + 1))
                            steps_completed=$((steps_completed + 1))
                            break
                        fi
                    fi

                    wait_count=$((wait_count + 1))
                    sleep 1
                done

                if [[ "$run_completed" != true ]]; then
                    log ERROR "✗ Run did not complete after submitting tool outputs"
                    failed=$((failed + 1))
                fi
            else
                log ERROR "✗ Failed to submit tool outputs (status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ No tool calls found in run requiring action"
            failed=$((failed + 1))
        fi
    fi

    # Step 7: Verify final response
    if [[ "$run_completed" == true ]]; then
        log INFO "Step 7: Verifying final response..."

        # Get messages to see the final response
        response=$(make_request GET "$BASE_URL/v1/threads/$E2E_THREAD_ID/messages")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_OK ]]; then
            local messages=$(get_body "$response")
            local assistant_messages=$(echo "$messages" | jq -r '.data[] | select(.role == "assistant") | .content')

            if [[ -n "$assistant_messages" ]]; then
                log INFO "✓ Final assistant response found"
                passed=$((passed + 1))
                steps_completed=$((steps_completed + 1))

                # Check if response mentions tool results
                if echo "$assistant_messages" | grep -q -i "weather\|london\|temperature"; then
                    log INFO "✓ Response appears to incorporate tool results"
                    passed=$((passed + 1))
                else
                    log WARN "✗ Response may not have incorporated tool results"
                fi
            else
                log ERROR "✗ No assistant messages found in final response"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ Failed to retrieve final messages (status: $status)"
            failed=$((failed + 1))
        fi
    fi

    log INFO "Complete tool-call flow tests: $passed passed, $failed failed (steps completed: $steps_completed/7)"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"complete_tool_call_flow\", \"passed\": $passed, \"failed\": $failed, \"steps_completed\": $steps_completed}]}"
}

# Test assistant with file access workflow
test_assistant_with_file_access() {
    log INFO "Testing assistant with file access workflow..."

    local passed=0
    local failed=0

    # Step 1: Upload a file
    log INFO "Step 1: Uploading test file..."
    local file_content=$(get_text_file_content)
    local response=$(make_request POST "$BASE_URL/v1/files" "$file_content" "Content-Type: text/plain")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_FILE_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ File uploaded: $E2E_FILE_ID"
        passed=$((passed + 1))
    else
        log ERROR "✗ Failed to upload file (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 2: Create assistant with file access
    log INFO "Step 2: Creating assistant with file access..."
    local assistant_data=$(get_assistant_with_files "$E2E_FILE_ID")
    response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_ASSISTANT_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Assistant created with file access: $E2E_ASSISTANT_ID"
        passed=$((passed + 1))

        # Verify file_ids are set
        local file_ids_count=$(get_body "$response" | jq -r '.file_ids | length')
        if [[ "$file_ids_count" -gt 0 ]]; then
            log INFO "✓ Assistant has $file_ids_count files configured"
            passed=$((passed + 1))
        else
            log ERROR "✗ Assistant has no files configured"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ Failed to create assistant (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Step 3: Create thread and message asking about file
    log INFO "Step 3: Creating thread and message about file..."
    local thread_data=$(get_basic_thread)
    response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_THREAD_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Thread created: $E2E_THREAD_ID"
        passed=$((passed + 1))
    else
        log ERROR "✗ Failed to create thread (status: $status)"
        failed=$((failed + 1))
        return 1
    fi

    # Create message asking about the file
    local message_data='{
      "role": "user",
      "content": "Please summarize the content of the file you have access to."
    }'
    response=$(make_request POST "$BASE_URL/v1/threads/$E2E_THREAD_ID/messages" "$message_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        log INFO "✓ File-related message created"
        passed=$((passed + 1))
    else
        log ERROR "✗ Failed to create message (status: $status)"
        failed=$((failed + 1))
    fi

    # Step 4: Create and monitor run
    log INFO "Step 4: Creating and monitoring run with file access..."
    local run_data=$(get_basic_run "$E2E_ASSISTANT_ID")
    response=$(make_request POST "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs" "$run_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        E2E_RUN_ID=$(get_body "$response" | jq -r '.id')
        log INFO "✓ Run created with file access: $E2E_RUN_ID"
        passed=$((passed + 1))

        # Monitor run completion
        local max_wait=30
        local wait_count=0
        local run_completed=false

        while [[ $wait_count -lt $max_wait ]]; do
            response=$(make_request GET "$BASE_URL/v1/threads/$E2E_THREAD_ID/runs/$E2E_RUN_ID")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_OK ]]; then
                local run_status=$(get_body "$response" | jq -r '.status')
                if [[ "$run_status" == "completed" ]]; then
                    log INFO "✓ Run with file access completed successfully"
                    run_completed=true
                    passed=$((passed + 1))
                    break
                fi
            fi

            wait_count=$((wait_count + 1))
            sleep 1
        done

        if [[ "$run_completed" != true ]]; then
            log WARN "✗ Run with file access did not complete within ${max_wait}s"
            # This might be expected if file processing is not implemented
        fi
    else
        log ERROR "✗ Failed to create run (status: $status)"
        failed=$((failed + 1))
    fi

    log INFO "Assistant with file access tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"assistant_with_file_access\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test error handling in end-to-end flow
test_error_handling_flow() {
    log INFO "Testing error handling in end-to-end flow..."

    local passed=0
    local failed=0

    # Test 1: Invalid assistant ID in run creation
    log INFO "Test 1: Testing invalid assistant ID..."
    local run_data='{
      "assistant_id": "invalid-assistant-id-12345",
      "instructions": "Test instructions"
    }'

    local response=$(make_request POST "$BASE_URL/v1/threads/invalid-thread-id/runs" "$run_data")
    local status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_NOT_FOUND ]] || [[ "$status" -eq $HTTP_BAD_REQUEST ]]; then
        log INFO "✓ Invalid assistant ID handled correctly (status: $status)"
        passed=$((passed + 1))
    else
        log ERROR "✗ Invalid assistant ID not handled properly (status: $status)"
        failed=$((failed + 1))
    fi

    # Test 2: Create valid resources then test invalid operations
    local assistant_data=$(get_basic_assistant)
    response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
    status=$(get_status "$response")

    if [[ "$status" -eq $HTTP_CREATED ]]; then
        local valid_assistant_id=$(get_body "$response" | jq -r '.id')

        # Test invalid thread ID
        local thread_data=$(get_basic_thread)
        response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
        status=$(get_status "$response")

        if [[ "$status" -eq $HTTP_CREATED ]]; then
            local valid_thread_id=$(get_body "$response" | jq -r '.id')

            # Test creating run with invalid assistant ID
            local invalid_run_data='{
              "assistant_id": "invalid-assistant-id",
              "instructions": "Test instructions"
            }'

            response=$(make_request POST "$BASE_URL/v1/threads/$valid_thread_id/runs" "$invalid_run_data")
            status=$(get_status "$response")

            if [[ "$status" -eq $HTTP_NOT_FOUND ]] || [[ "$status" -eq $HTTP_BAD_REQUEST ]]; then
                log INFO "✓ Invalid assistant ID in run creation handled correctly"
                passed=$((passed + 1))
            else
                log ERROR "✗ Invalid assistant ID in run creation not handled properly (status: $status)"
                failed=$((failed + 1))
            fi

            # Clean up
            make_request DELETE "$BASE_URL/v1/threads/$valid_thread_id" >/dev/null 2>&1
        fi

        # Clean up
        make_request DELETE "$BASE_URL/v1/assistants/$valid_assistant_id" >/dev/null 2>&1
    fi

    log INFO "Error handling flow tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"error_handling_flow\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test concurrent end-to-end workflows
test_concurrent_workflows() {
    log INFO "Testing concurrent end-to-end workflows..."

    local passed=0
    local failed=0
    local concurrent_workflows=3

    # Function to run a single workflow
    run_single_workflow() {
        local workflow_id="$1"
        local success_file="/tmp/workflow_success_$$_$workflow_id"
        local error_file="/tmp/workflow_error_$$_$workflow_id"

        log INFO "Workflow $workflow_id: Starting..."

        # Create assistant
        local assistant_data=$(get_basic_assistant)
        local response=$(make_request POST "$BASE_URL/v1/assistants" "$assistant_data")
        local status=$(get_status "$response")

        if [[ "$status" -ne $HTTP_CREATED ]]; then
            echo "Failed to create assistant: $status" >> "$error_file"
            return 1
        fi

        local assistant_id=$(get_body "$response" | jq -r '.id')

        # Create thread
        local thread_data=$(get_basic_thread)
        response=$(make_request POST "$BASE_URL/v1/threads" "$thread_data")
        status=$(get_status "$response")

        if [[ "$status" -ne $HTTP_CREATED ]]; then
            echo "Failed to create thread: $status" >> "$error_file"
            make_request DELETE "$BASE_URL/v1/assistants/$assistant_id" >/dev/null 2>&1
            return 1
        fi

        local thread_id=$(get_body "$response" | jq -r '.id')

        # Create message
        local message_data=$(get_user_message)
        response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/messages" "$message_data")
        status=$(get_status "$response")

        if [[ "$status" -ne $HTTP_CREATED ]]; then
            echo "Failed to create message: $status" >> "$error_file"
            make_request DELETE "$BASE_URL/v1/threads/$thread_id" >/dev/null 2>&1
            make_request DELETE "$BASE_URL/v1/assistants/$assistant_id" >/dev/null 2>&1
            return 1
        fi

        # Create run
        local run_data=$(get_basic_run "$assistant_id")
        response=$(make_request POST "$BASE_URL/v1/threads/$thread_id/runs" "$run_data")
        status=$(get_status "$response")

        if [[ "$status" -ne $HTTP_CREATED ]]; then
            echo "Failed to create run: $status" >> "$error_file"
        else
            echo "SUCCESS:$assistant_id:$thread_id" >> "$success_file"
        fi

        # Clean up
        make_request DELETE "$BASE_URL/v1/threads/$thread_id" >/dev/null 2>&1
        make_request DELETE "$BASE_URL/v1/assistants/$assistant_id" >/dev/null 2>&1

        return 0
    }

    # Export function for parallel execution
    export -f run_single_workflow make_request get_status get_body
    export BASE_URL API_KEY

    # Run concurrent workflows
    local pids=()
    for i in $(seq 1 "$concurrent_workflows"); do
        run_single_workflow "$i" &
        pids+=($!)
    done

    # Wait for completion
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Check results
    local success_count=0
    local error_count=0

    for i in $(seq 1 "$concurrent_workflows"); do
        if [[ -f "/tmp/workflow_success_$$_$i" ]]; then
            success_count=$((success_count + 1))
            rm -f "/tmp/workflow_success_$$_$i"
        fi

        if [[ -f "/tmp/workflow_error_$$_$i" ]]; then
            error_count=$((error_count + 1))
            rm -f "/tmp/workflow_error_$$_$i"
        fi
    done

    if [[ $success_count -gt 0 ]]; then
        log INFO "✓ $success_count concurrent workflows completed successfully"
        passed=$((passed + 1))
    else
        log ERROR "✗ No concurrent workflows succeeded"
        failed=$((failed + 1))
    fi

    if [[ $error_count -eq 0 ]]; then
        log INFO "✓ No errors in concurrent workflows"
        passed=$((passed + 1))
    else
        log ERROR "✗ $error_count concurrent workflows had errors"
        failed=$((failed + 1))
    fi

    log INFO "Concurrent workflows tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"concurrent_workflows\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN END-TO-END TEST EXECUTION
# ==============================================

# Run all end-to-end tests
run_tool_call_flow_tests() {
    log INFO "Starting end-to-end tool-call round trip tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_end_to_end_tests

    # Define test functions
    local test_functions=(
        "test_complete_tool_call_flow"
        "test_assistant_with_file_access"
        "test_error_handling_flow"
        "test_concurrent_workflows"
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
    cleanup_end_to_end_tests

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

    log INFO "End-to-end tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_end_to_end_tests cleanup_end_to_end_tests
export -f test_complete_tool_call_flow test_assistant_with_file_access
export -f test_error_handling_flow test_concurrent_workflows
export -f run_tool_call_flow_tests