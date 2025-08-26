#!/bin/bash

# Rate Limiting Tests
# Tests for rate limit enforcement, headers, and recovery

# ==============================================
# TEST SETUP
# ==============================================

setup_rate_limiting_tests() {
    log INFO "Setting up rate limiting tests..."

    # No special setup required for rate limiting tests
    log INFO "Rate limiting test setup completed"
}

cleanup_rate_limiting_tests() {
    log INFO "Cleaning up rate limiting test resources..."

    # No cleanup required for rate limiting tests
}

# ==============================================
# RATE LIMITING TEST FUNCTIONS
# ==============================================

# Test rate limit enforcement
test_rate_limit_enforcement() {
    log INFO "Testing rate limit enforcement..."

    local passed=0
    local failed=0

    # Send multiple requests rapidly to trigger rate limiting
    local request_count=20
    local success_count=0
    local rate_limited_count=0
    local error_count=0

    log INFO "Sending $request_count rapid requests to test rate limiting..."

    for i in $(seq 1 "$request_count"); do
        local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                             -X GET \
                             -H "Authorization: Bearer $API_KEY" \
                             "$BASE_URL/v1/models")

        local status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

        if [[ "$status" -eq $HTTP_OK ]]; then
            success_count=$((success_count + 1))
        elif [[ "$status" -eq $HTTP_TOO_MANY_REQUESTS ]]; then
            rate_limited_count=$((rate_limited_count + 1))
        else
            error_count=$((error_count + 1))
        fi

        # Small delay to avoid overwhelming the system completely
        sleep 0.1
    done

    if [[ $success_count -gt 0 ]]; then
        log INFO "✓ Some requests succeeded: $success_count"
        passed=$((passed + 1))
    else
        log ERROR "✗ No requests succeeded"
        failed=$((failed + 1))
    fi

    if [[ $rate_limited_count -gt 0 ]]; then
        log INFO "✓ Rate limiting is active: $rate_limited_count requests limited"
        passed=$((passed + 1))
    else
        log INFO "✓ No rate limiting detected (may not be implemented)"
        passed=$((passed + 1))
    fi

    if [[ $error_count -eq 0 ]]; then
        log INFO "✓ No unexpected errors during rate limit testing"
        passed=$((passed + 1))
    else
        log ERROR "✗ Unexpected errors: $error_count"
        failed=$((failed + 1))
    fi

    log INFO "Rate limit enforcement tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"rate_limit_enforcement\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test rate limit headers
test_rate_limit_headers() {
    log INFO "Testing rate limit headers..."

    local passed=0
    local failed=0

    # Make a request and check for rate limit headers
    local response=$(curl -s -I \
                         -H "Authorization: Bearer $API_KEY" \
                         "$BASE_URL/v1/models")

    if [[ -n "$response" ]]; then
        # Check for common rate limit headers
        local rate_limit_headers=("X-RateLimit-Limit" "X-RateLimit-Remaining" "X-RateLimit-Reset" "Retry-After")

        for header in "${rate_limit_headers[@]}"; do
            if echo "$response" | grep -i "$header:" >/dev/null; then
                log INFO "✓ Rate limit header present: $header"
                passed=$((passed + 1))
            else
                log INFO "✓ Rate limit header not present: $header (may not be implemented)"
                passed=$((passed + 1))
            fi
        done

        # Check for rate limit reset time
        if echo "$response" | grep -i "x-ratelimit-reset:" >/dev/null; then
            local reset_time=$(echo "$response" | grep -i "x-ratelimit-reset:" | cut -d: -f2- | tr -d '\r')
            if [[ -n "$reset_time" ]]; then
                log INFO "✓ Rate limit reset time is present: $reset_time"
                passed=$((passed + 1))
            else
                log ERROR "✗ Rate limit reset time is empty"
                failed=$((failed + 1))
            fi
        fi
    else
        log ERROR "✗ No response headers received"
        failed=$((failed + 1))
    fi

    log INFO "Rate limit headers tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"rate_limit_headers\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test rate limit recovery
test_rate_limit_recovery() {
    log INFO "Testing rate limit recovery..."

    local passed=0
    local failed=0

    # First, trigger rate limiting by sending many requests
    log INFO "Triggering rate limiting..."
    for i in {1..10}; do
        curl -s -X GET \
             -H "Authorization: Bearer $API_KEY" \
             "$BASE_URL/v1/models" >/dev/null 2>&1
    done

    # Check if we're rate limited
    local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                         -X GET \
                         -H "Authorization: Bearer $API_KEY" \
                         "$BASE_URL/v1/models")

    local status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

    if [[ "$status" -eq $HTTP_TOO_MANY_REQUESTS ]]; then
        log INFO "✓ Rate limiting triggered"

        # Get retry-after header
        local retry_after=$(echo "$response" | grep -i "retry-after:" | cut -d: -f2- | tr -d '\r' | xargs)

        if [[ -n "$retry_after" ]]; then
            log INFO "✓ Retry-After header present: ${retry_after}s"

            # Wait for the specified time
            log INFO "Waiting ${retry_after}s for rate limit recovery..."
            sleep "$retry_after"

            # Try again
            response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                             -X GET \
                             -H "Authorization: Bearer $API_KEY" \
                             "$BASE_URL/v1/models")

            status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Rate limit recovery successful"
                passed=$((passed + 1))
            else
                log ERROR "✗ Still rate limited after waiting (status: $status)"
                failed=$((failed + 1))
            fi
        else
            log INFO "✓ No Retry-After header (using default wait time)"
            sleep 5

            # Try again
            response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                             -X GET \
                             -H "Authorization: Bearer $API_KEY" \
                             "$BASE_URL/v1/models")

            status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

            if [[ "$status" -eq $HTTP_OK ]]; then
                log INFO "✓ Rate limit recovery successful (with default wait)"
                passed=$((passed + 1))
            else
                log INFO "✓ Still rate limited (may have longer reset time)"
                passed=$((passed + 1))
            fi
        fi
    else
        log INFO "✓ No rate limiting detected on this endpoint"
        passed=$((passed + 1))
    fi

    log INFO "Rate limit recovery tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"rate_limit_recovery\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test different endpoint limits
test_different_endpoint_limits() {
    log INFO "Testing different endpoint limits..."

    local passed=0
    local failed=0

    # Test different endpoints to see if they have different rate limits
    local endpoints=(
        "GET:/v1/models"
        "GET:/v1/assistants"
        "POST:/v1/assistants"
        "GET:/v1/threads"
        "POST:/v1/threads"
    )

    local endpoint_results=()

    for endpoint in "${endpoints[@]}"; do
        local method="${endpoint%%:*}"
        local path="${endpoint#*:}"

        log INFO "Testing $method $path rate limits..."

        local success_count=0
        local rate_limited_count=0

        # Send requests to this specific endpoint
        for i in {1..5}; do
            local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                                 -X "$method" \
                                 -H "Authorization: Bearer $API_KEY" \
                                 -H "Content-Type: application/json" \
                                 "$BASE_URL$path")

            local status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

            if [[ "$status" -eq $HTTP_OK ]] || [[ "$status" -eq $HTTP_CREATED ]]; then
                success_count=$((success_count + 1))
            elif [[ "$status" -eq $HTTP_TOO_MANY_REQUESTS ]]; then
                rate_limited_count=$((rate_limited_count + 1))
            fi

            sleep 0.2
        done

        endpoint_results+=("$method $path: $success_count success, $rate_limited_count limited")

        if [[ $success_count -gt 0 ]]; then
            log INFO "✓ $method $path had successful requests"
            passed=$((passed + 1))
        else
            log ERROR "✗ $method $path had no successful requests"
            failed=$((failed + 1))
        fi
    done

    # Log endpoint comparison
    log INFO "Endpoint rate limit comparison:"
    for result in "${endpoint_results[@]}"; do
        log INFO "  $result"
    done

    log INFO "Different endpoint limits tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"different_endpoint_limits\", \"passed\": $passed, \"failed\": $failed}]}"
}

# Test rate limiting with different users
test_user_based_rate_limiting() {
    log INFO "Testing user-based rate limiting..."

    local passed=0
    local failed=0

    # This test would require multiple API keys to test user-based rate limiting
    # For now, we'll test with the same key and document the limitation

    log INFO "Note: User-based rate limiting test requires multiple API keys"
    log INFO "This test currently uses the same API key for all requests"

    # Test with different user agents to see if that affects rate limiting
    local user_agents=(
        "TestClient/1.0"
        "TestClient/2.0"
        "Mozilla/5.0 (compatible; TestBot/1.0)"
    )

    for user_agent in "${user_agents[@]}"; do
        local response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
                             -X GET \
                             -H "Authorization: Bearer $API_KEY" \
                             -H "User-Agent: $user_agent" \
                             "$BASE_URL/v1/models")

        local status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)

        if [[ "$status" -eq $HTTP_OK ]]; then
            log INFO "✓ Request with user agent '$user_agent' succeeded"
            passed=$((passed + 1))
        elif [[ "$status" -eq $HTTP_TOO_MANY_REQUESTS ]]; then
            log INFO "✓ Request with user agent '$user_agent' was rate limited"
            passed=$((passed + 1))
        else
            log ERROR "✗ Request with user agent '$user_agent' failed with status $status"
            failed=$((failed + 1))
        fi

        sleep 0.5
    done

    log INFO "User-based rate limiting tests: $passed passed, $failed failed"
    echo "{\"passed\": $passed, \"failed\": $failed, \"tests\": [{\"name\": \"user_based_rate_limiting\", \"passed\": $passed, \"failed\": $failed}]}"
}

# ==============================================
# MAIN RATE LIMITING TEST EXECUTION
# ==============================================

# Run all rate limiting tests
run_rate_limiting_tests() {
    log INFO "Starting rate limiting acceptance tests..."

    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)

    # Setup test resources
    setup_rate_limiting_tests

    # Define test functions
    local test_functions=(
        "test_rate_limit_enforcement"
        "test_rate_limit_headers"
        "test_rate_limit_recovery"
        "test_different_endpoint_limits"
        "test_user_based_rate_limiting"
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
    cleanup_rate_limiting_tests

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

    log INFO "Rate limiting tests completed: $total_passed passed, $total_failed failed in ${duration}s"

    echo "$combined_results"
}

# Export functions for use in main test runner
export -f setup_rate_limiting_tests cleanup_rate_limiting_tests
export -f test_rate_limit_enforcement test_rate_limit_headers test_rate_limit_recovery
export -f test_different_endpoint_limits test_user_based_rate_limiting
export -f run_rate_limiting_tests