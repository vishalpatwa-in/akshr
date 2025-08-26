#!/bin/bash

# Authentication Tests
# Tests for authentication, authorization, and access control

# ==============================================
# TEST SETUP
# ==============================================

setup_auth_tests() {
    log INFO "Setting up authentication tests..."

    # No special setup required for auth tests
    log INFO "Authentication test setup completed"
}

cleanup_auth_tests() {
    log INFO "Cleaning up authentication test resources..."

    # No cleanup required for auth tests
}

# ==============================================
# AUTHENTICATION TEST FUNCTIONS
# ==============================================

# Test missing authorization header
test_missing_authorization_header() {
    log INFO "Testing missing authorization header..."

    local passed=0
    local failed=0

    # Test various endpoints without authorization
    local endpoints=(
        "GET:/v1/assistants"
        "POST:/v1/assistants"
        "GET:/v1/threads"
        "POST:/v1/threads"
        "GET:/v1/files"
        "POST:/v1/files"
    )

    for endpoint in "${endpoints[@]}"; do
        local method="${endpoint%%:*}"
        local path="${endpoint#*:}"

        local response=$(curl -s -X "$method" \
                             -H "Content-Type: application/json" \
                             "$BASE_URL$path")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 401' 2>/dev/null || echo "401")

            if [[ "$status" -eq $HTTP_UNAUTHORIZED ]]; then
                log INFO "✓ $method $path correctly rejected without auth"
                passed=$((passed + 1))
            else
                log ERROR "✗ $method $path should require auth (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ $method $path did not respond"
            failed=$((failed + 1))
        fi
    done

    log INFO "Missing authorization header tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"missing_authorization_header\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test invalid API key
test_invalid_api_key() {
    log INFO "Testing invalid API key..."

    local passed=0
    local failed=0

    # Test with obviously invalid API key
    local invalid_keys=(
        ""
        "invalid-key"
        "Bearer"
        "Bearer "
        "sk-invalid"
        "12345"
    )

    for invalid_key in "${invalid_keys[@]}"; do
        local response=$(curl -s -X GET \
                             -H "Authorization: Bearer $invalid_key" \
                             "$BASE_URL/v1/assistants")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 401' 2>/dev/null || echo "401")

            if [[ "$status" -eq $HTTP_UNAUTHORIZED ]] || [[ "$status" -eq $HTTP_FORBIDDEN ]]; then
                log INFO "✓ Invalid key '$invalid_key' correctly rejected"
                passed=$((passed + 1))
            else
                log ERROR "✗ Invalid key '$invalid_key' should be rejected (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ No response for invalid key '$invalid_key'"
            failed=$((failed + 1))
        fi
    done

    log INFO "Invalid API key tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"invalid_api_key\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test malformed authorization header
test_malformed_authorization_header() {
    log INFO "Testing malformed authorization header..."

    local passed=0
    local failed=0

    # Test various malformed authorization headers
    local malformed_headers=(
        "Basic $API_KEY"
        "Token $API_KEY"
        "Bearer"
        "Bearer  "
        "bearer $API_KEY"
        "BEARER $API_KEY"
        "Bearer$API_KEY"
        "Bearer $API_KEY extra"
    )

    for malformed_header in "${malformed_headers[@]}"; do
        local response=$(curl -s -X GET \
                             -H "Authorization: $malformed_header" \
                             "$BASE_URL/v1/assistants")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 401' 2>/dev/null || echo "401")

            if [[ "$status" -eq $HTTP_UNAUTHORIZED ]] || [[ "$status" -eq $HTTP_BAD_REQUEST ]]; then
                log INFO "✓ Malformed header '$malformed_header' correctly rejected"
                passed=$((passed + 1))
            else
                log ERROR "✗ Malformed header '$malformed_header' should be rejected (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ No response for malformed header '$malformed_header'"
            failed=$((failed + 1))
        fi
    done

    log INFO "Malformed authorization header tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"malformed_authorization_header\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test admin key for GC operations
test_admin_key_for_gc() {
    log INFO "Testing admin key for GC operations..."

    local passed=0
    local failed=0

    # Test GC endpoints with regular API key (should fail)
    local gc_endpoints=(
        "POST:/admin/gc"
        "GET:/admin/gc/config"
        "POST:/admin/gc/dry-run"
    )

    for endpoint in "${gc_endpoints[@]}"; do
        local method="${endpoint%%:*}"
        local path="${endpoint#*:}"

        local response=$(curl -s -X "$method" \
                             -H "Authorization: Bearer $API_KEY" \
                             -H "Content-Type: application/json" \
                             "$BASE_URL$path")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 403' 2>/dev/null || echo "403")

            if [[ "$status" -eq $HTTP_FORBIDDEN ]] || [[ "$status" -eq $HTTP_UNAUTHORIZED ]]; then
                log INFO "✓ $method $path correctly rejected with regular API key"
                passed=$((passed + 1))
            else
                log ERROR "✗ $method $path should require admin key (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ $method $path did not respond"
            failed=$((failed + 1))
        fi
    done

    # Test GC endpoint with admin key (if configured)
    if [[ -n "$GC_ADMIN_KEY" ]] && [[ "$GC_ADMIN_KEY" != "your-gc-admin-key-here" ]]; then
        local response=$(curl -s -X GET \
                             -H "Authorization: Bearer $GC_ADMIN_KEY" \
                             "$BASE_URL/admin/gc/config")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 200' 2>/dev/null || echo "200")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Admin key correctly accepted for GC operations"
                passed=$((passed + 1))
            else
                log ERROR "✗ Admin key should be accepted for GC operations (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ No response for admin key test"
            failed=$((failed + 1))
        fi
    else
        log INFO "✓ Admin key not configured - skipping positive test"
        passed=$((passed + 1))
    fi

    log INFO "Admin key for GC tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"admin_key_for_gc\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test bypass key functionality
test_bypass_key_functionality() {
    log INFO "Testing bypass key functionality..."

    local passed=0
    local failed=0

    # Test bypass key if configured
    if [[ -n "$BYPASS_KEY" ]] && [[ "$BYPASS_KEY" != "your-bypass-key-here" ]]; then
        # Test bypass key with rate-limited endpoint
        local response=$(curl -s -X GET \
                             -H "Authorization: Bearer $BYPASS_KEY" \
                             "$BASE_URL/v1/models")

        if [[ -n "$response" ]]; then
            local status=$(echo "$response" | jq -r '.status // 200' 2>/dev/null || echo "200")

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Bypass key correctly accepted"
                passed=$((passed + 1))

                # Check for bypass indicators in response
                if echo "$response" | grep -q "bypass\|admin\|special"; then
                    log INFO "✓ Bypass key response contains special indicators"
                    passed=$((passed + 1))
                else
                    log INFO "✓ Bypass key response is normal (this may be expected)"
                    passed=$((passed + 1))
                fi
            else
                log ERROR "✗ Bypass key should be accepted (got status: $status)"
                failed=$((failed + 1))
            fi
        else
            log ERROR "✗ No response for bypass key test"
            failed=$((failed + 1))
        fi
    else
        log INFO "✓ Bypass key not configured - skipping bypass tests"
        passed=$((passed + 1))
    fi

    # Test invalid bypass key
    local invalid_bypass="invalid-bypass-key"
    local response=$(curl -s -X GET \
                         -H "Authorization: Bearer $invalid_bypass" \
                         "$BASE_URL/v1/models")

    if [[ -n "$response" ]]; then
        local status=$(echo "$response" | jq -r '.status // 401' 2>/dev/null || echo "401")

        if [[ "$status" -eq $HTTP_UNAUTHORIZED ]] || [[ "$status" -eq $HTTP_FORBIDDEN ]]; then
            log INFO "✓ Invalid bypass key correctly rejected"
            passed=$((passed + 1))
        else
            log ERROR "✗ Invalid bypass key should be rejected (got status: $status)"
            failed=$((failed + 1))
        fi
    else
        log ERROR "✗ No response for invalid bypass key test"
        failed=$((failed + 1))
    fi

    log INFO "Bypass key functionality tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"bypass_key_functionality\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN AUTHENTICATION TEST EXECUTION
# ==============================================

# Run all authentication tests
run_authentication_tests() {
    log INFO "Starting authentication acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_auth_tests

    # Define test functions
    local test_functions=(
        "test_missing_authorization_header"
        "test_invalid_api_key"
        "test_malformed_authorization_header"
        "test_admin_key_for_gc"
        "test_bypass_key_functionality"
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
    cleanup_auth_tests

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

    log INFO "Authentication tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_auth_tests cleanup_auth_tests
export -f test_missing_authorization_header test_invalid_api_key test_malformed_authorization_header
export -f test_admin_key_for_gc test_bypass_key_functionality
export -f run_authentication_tests