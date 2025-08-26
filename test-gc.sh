#!/bin/bash

# Garbage Collection System Testing Script
# This script provides comprehensive testing for the GC system

set -e

# Configuration
DOMAIN="${DOMAIN:-http://localhost:8787}"
ADMIN_KEY="${ADMIN_KEY:-test-admin-key}"
TIMEOUT=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
run_test() {
    local test_name="$1"
    local test_command="$2"

    ((TESTS_RUN++))
    log_info "Running test: $test_name"

    if eval "$test_command"; then
        ((TESTS_PASSED++))
        log_success "✓ $test_name passed"
        return 0
    else
        ((TESTS_FAILED++))
        log_error "✗ $test_name failed"
        return 1
    fi
}

# API testing functions
test_endpoint() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local expected_status="${4:-200}"

    local cmd="curl -s -X $method '$DOMAIN$endpoint' \
        -H 'Content-Type: application/json' \
        -H 'X-GC-Admin-Key: $ADMIN_KEY' \
        -w '\nHTTP_STATUS:%{http_code}'"

    if [ -n "$data" ]; then
        cmd="$cmd -d '$data'"
    fi

    local response=$(eval "$cmd")
    local http_status=$(echo "$response" | grep 'HTTP_STATUS:' | cut -d: -f2)
    local body=$(echo "$response" | sed '/HTTP_STATUS:/d')

    if [ "$http_status" -eq "$expected_status" ]; then
        echo "$body"
        return 0
    else
        log_error "Expected status $expected_status, got $http_status"
        echo "$body" >&2
        return 1
    fi
}

# Test 1: Get GC configuration
test_gc_config() {
    local response=$(test_endpoint GET "/admin/gc/config")
    echo "$response" | jq '.success' 2>/dev/null | grep -q 'true'
}

# Test 2: Dry run GC operation
test_gc_dry_run() {
    local data='{
        "resourceTypes": ["thread", "message"],
        "maxObjectsPerType": 10,
        "batchSize": 5
    }'

    local response=$(test_endpoint POST "/admin/gc/dry-run" "$data")
    echo "$response" | jq '.success' 2>/dev/null | grep -q 'true'
}

# Test 3: Full GC operation
test_gc_full() {
    local data='{
        "mode": "cleanup",
        "resourceTypes": ["message"],
        "maxObjectsPerType": 5,
        "batchSize": 2
    }'

    local response=$(test_endpoint POST "/admin/gc" "$data")
    echo "$response" | jq '.success' 2>/dev/null | grep -q 'true'
}

# Test 4: Authentication failure
test_auth_failure() {
    local response=$(curl -s -X POST "$DOMAIN/admin/gc" \
        -H 'Content-Type: application/json' \
        -w '\nHTTP_STATUS:%{http_code}')

    local http_status=$(echo "$response" | grep 'HTTP_STATUS:' | cut -d: -f2)

    [ "$http_status" -eq 401 ] || [ "$http_status" -eq 403 ]
}

# Test 5: Invalid request body
test_invalid_request() {
    local data='{"invalid": "json"}'

    local response=$(curl -s -X POST "$DOMAIN/admin/gc/dry-run" \
        -H 'Content-Type: application/json' \
        -H "X-GC-Admin-Key: $ADMIN_KEY" \
        -d '$data' \
        -w '\nHTTP_STATUS:%{http_code}')

    local http_status=$(echo "$response" | grep 'HTTP_STATUS:' | cut -d: -f2)

    [ "$http_status" -eq 400 ]
}

# Test 6: Rate limiting test (basic)
test_rate_limiting() {
    log_info "Testing rate limiting with multiple requests..."

    local success_count=0
    local rate_limit_count=0

    for i in {1..5}; do
        local response=$(curl -s -X POST "$DOMAIN/admin/gc/dry-run" \
            -H 'Content-Type: application/json' \
            -H "X-GC-Admin-Key: $ADMIN_KEY" \
            -d '{"resourceTypes": ["message"]}' \
            -w '\nHTTP_STATUS:%{http_code}')

        local http_status=$(echo "$response" | grep 'HTTP_STATUS:' | cut -d: -f2)

        if [ "$http_status" -eq 200 ]; then
            ((success_count++))
        elif [ "$http_status" -eq 429 ]; then
            ((rate_limit_count++))
        fi

        # Small delay between requests
        sleep 0.1
    done

    # We expect at least some requests to succeed
    [ "$success_count" -gt 0 ]
}

# Test 7: CORS preflight
test_cors_preflight() {
    local response=$(curl -s -X OPTIONS "$DOMAIN/admin/gc" \
        -H 'Origin: http://localhost:3000' \
        -H 'Access-Control-Request-Method: POST' \
        -w '\nHTTP_STATUS:%{http_code}')

    local http_status=$(echo "$response" | grep 'HTTP_STATUS:' | cut -d: -f2)

    [ "$http_status" -eq 200 ]
}

# Test 8: Security headers
test_security_headers() {
    local response=$(curl -s -I "$DOMAIN/admin/gc/config" \
        -H "X-GC-Admin-Key: $ADMIN_KEY")

    echo "$response" | grep -q 'X-Content-Type-Options: nosniff' && \
    echo "$response" | grep -q 'X-Frame-Options: DENY'
}

# Main test execution
main() {
    log_info "Starting GC System Tests"
    log_info "Domain: $DOMAIN"
    log_info "Admin Key: ${ADMIN_KEY:0:8}..."
    echo

    # Test 1: Configuration endpoint
    run_test "GC Configuration" "test_gc_config"

    # Test 2: Dry run operation
    run_test "GC Dry Run" "test_gc_dry_run"

    # Test 3: Full GC operation
    run_test "GC Full Operation" "test_gc_full"

    # Test 4: Authentication
    run_test "Authentication Failure" "test_auth_failure"

    # Test 5: Invalid request
    run_test "Invalid Request Handling" "test_invalid_request"

    # Test 6: Rate limiting
    run_test "Rate Limiting" "test_rate_limiting"

    # Test 7: CORS
    run_test "CORS Preflight" "test_cors_preflight"

    # Test 8: Security headers
    run_test "Security Headers" "test_security_headers"

    echo
    log_info "Test Results Summary:"
    log_info "Total tests: $TESTS_RUN"
    log_success "Passed: $TESTS_PASSED"
    if [ "$TESTS_FAILED" -gt 0 ]; then
        log_error "Failed: $TESTS_FAILED"
        exit 1
    else
        log_success "All tests passed!"
    fi
}

# Health check before running tests
health_check() {
    log_info "Performing health check..."

    if ! curl -s "$DOMAIN/admin/gc/config" \
        -H "X-GC-Admin-Key: $ADMIN_KEY" \
        -w '\nHTTP_STATUS:%{http_code}' | \
        grep -q 'HTTP_STATUS:200'; then
        log_error "Health check failed. Is the server running?"
        exit 1
    fi

    log_success "Health check passed"
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Test script for the Garbage Collection system.

OPTIONS:
    -d, --domain DOMAIN     API domain (default: http://localhost:8787)
    -k, --key KEY           Admin key (default: test-admin-key)
    -h, --help              Show this help message

ENVIRONMENT VARIABLES:
    DOMAIN                  Same as -d
    ADMIN_KEY               Same as -k

EXAMPLES:
    $0
    $0 -d https://api.example.com -k my-admin-key
    DOMAIN=https://api.example.com ADMIN_KEY=my-key $0

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            shift 2
            ;;
        -k|--key)
            ADMIN_KEY="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Health check
health_check

# Run tests
main