#!/bin/bash

# OpenAI Assistant API Acceptance Test Runner
# This script runs comprehensive acceptance tests for the Cloudflare Workers OpenAI Assistant API

set -e  # Exit on any error

# ==============================================
# SCRIPT CONFIGURATION
# ==============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load configuration and utilities
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/utils.sh"
source "$SCRIPT_DIR/fixtures.sh"

# Test categories
TEST_CATEGORIES=(
    "ttl-gc"
    "concurrency"
    "end-to-end"
    "streaming"
    "file-upload"
    "authentication"
    "api-endpoints"
    "rate-limiting"
)

# ==============================================
# TEST EXECUTION FUNCTIONS
# ==============================================

# Run all tests
run_all_tests() {
    log INFO "Starting comprehensive acceptance test suite"

    # Validate configuration
    if ! validate_config; then
        log ERROR "Configuration validation failed"
        exit 1
    fi

    # Create output directory
    mkdir -p "$OUTPUT_DIR"

    # Initialize test results
    local start_time=$(date +%s)
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    local results_file="$OUTPUT_DIR/test-results-$(date +%Y%m%d-%H%M%S).json"

    echo "{
  \"test_run\": {
    \"start_time\": \"$(get_timestamp)\",
    \"configuration\": {
      \"base_url\": \"$BASE_URL\",
      \"timeout\": $TEST_TIMEOUT,
      \"parallel_jobs\": $PARALLEL_JOBS
    },
    \"categories\": []
  }
}" > "$results_file"

    # Run test categories
    for category in "${TEST_CATEGORIES[@]}"; do
        log INFO "Running test category: $category"

        local category_start=$(date +%s)
        local category_results

        case "$category" in
            "ttl-gc")
                category_results=$(run_ttl_gc_tests)
                ;;
            "concurrency")
                category_results=$(run_concurrency_tests)
                ;;
            "end-to-end")
                category_results=$(run_end_to_end_tests)
                ;;
            "streaming")
                category_results=$(run_streaming_tests)
                ;;
            "file-upload")
                category_results=$(run_file_upload_tests)
                ;;
            "authentication")
                category_results=$(run_authentication_tests)
                ;;
            "api-endpoints")
                category_results=$(run_api_endpoint_tests)
                ;;
            "rate-limiting")
                category_results=$(run_rate_limiting_tests)
                ;;
            *)
                log ERROR "Unknown test category: $category"
                continue
                ;;
        esac

        local category_duration=$(( $(date +%s) - category_start ))

        # Parse category results (assuming JSON format)
        local category_passed=$(echo "$category_results" | jq -r '.passed // 0')
        local category_failed=$(echo "$category_results" | jq -r '.failed // 0')
        local category_total=$((category_passed + category_failed))

        total_tests=$((total_tests + category_total))
        passed_tests=$((passed_tests + category_passed))
        failed_tests=$((failed_tests + category_failed))

        # Update results file
        local temp_file=$(mktemp)
        jq --arg category "$category" \
           --argjson results "$category_results" \
           --arg duration "$category_duration" \
           '.test_run.categories += [{
             "name": $category,
             "duration_seconds": $duration,
             "results": $results
           }]' "$results_file" > "$temp_file"
        mv "$temp_file" "$results_file"

        log INFO "$category: $category_passed passed, $category_failed failed (${category_duration}s)"
    done

    # Finalize results
    local total_duration=$(( $(date +%s) - start_time ))
    local temp_file=$(mktemp)
    jq --arg end_time "$(get_timestamp)" \
       --arg total_duration "$total_duration" \
       --arg total_tests "$total_tests" \
       --arg passed_tests "$passed_tests" \
       --arg failed_tests "$failed_tests" \
       '.test_run.end_time = $end_time
        | .test_run.duration_seconds = $total_duration
        | .test_run.summary = {
          "total_tests": $total_tests,
          "passed_tests": $passed_tests,
          "failed_tests": $failed_tests,
          "success_rate": (if $total_tests > 0 then ($passed_tests / $total_tests * 100) else 0 end)
        }' "$results_file" > "$temp_file"
    mv "$temp_file" "$results_file"

    # Print summary
    log INFO "========================================"
    log INFO "TEST SUITE COMPLETED"
    log INFO "========================================"
    log INFO "Total Tests: $total_tests"
    log INFO "Passed: $passed_tests"
    log INFO "Failed: $failed_tests"
    log INFO "Duration: ${total_duration}s"
    log INFO "Success Rate: $(echo "scale=2; $passed_tests * 100 / $total_tests" | bc -l 2>/dev/null || echo "0")%"
    log INFO "========================================"
    log INFO "Results saved to: $results_file"

    # Cleanup resources
    cleanup_resources

    # Exit with appropriate code
    if [[ $failed_tests -gt 0 ]]; then
        log ERROR "Test suite completed with failures"
        exit 1
    else
        log INFO "All tests passed successfully"
        exit 0
    fi
}

# Run specific test category
run_category_tests() {
    local category="$1"

    if [[ ! " ${TEST_CATEGORIES[*]} " =~ " $category " ]]; then
        log ERROR "Unknown test category: $category"
        log INFO "Available categories: ${TEST_CATEGORIES[*]}"
        exit 1
    fi

    # Validate configuration
    if ! validate_config; then
        log ERROR "Configuration validation failed"
        exit 1
    fi

    log INFO "Running test category: $category"

    case "$category" in
        "ttl-gc")
            run_ttl_gc_tests
            ;;
        "concurrency")
            run_concurrency_tests
            ;;
        "end-to-end")
            run_end_to_end_tests
            ;;
        "streaming")
            run_streaming_tests
            ;;
        "file-upload")
            run_file_upload_tests
            ;;
        "authentication")
            run_authentication_tests
            ;;
        "api-endpoints")
            run_api_endpoint_tests
            ;;
        "rate-limiting")
            run_rate_limiting_tests
            ;;
    esac
}

# ==============================================
# TEST CATEGORY FUNCTIONS
# ==============================================

# TTL/GC Tests
run_ttl_gc_tests() {
    log INFO "Running TTL/GC tests..."

    # Source the TTL/GC test script
    source "$SCRIPT_DIR/tests/test-ttl-gc.sh"

    # Run TTL/GC specific tests
    run_gc_tests
}

# Concurrency Tests
run_concurrency_tests() {
    log INFO "Running concurrency tests..."

    # Source the concurrency test script
    source "$SCRIPT_DIR/tests/test-concurrency.sh"

    # Run concurrency specific tests
    run_concurrency_tests
}

# End-to-End Tests
run_end_to_end_tests() {
    log INFO "Running end-to-end tests..."

    # Source the end-to-end test script
    source "$SCRIPT_DIR/tests/test-end-to-end.sh"

    # Run end-to-end specific tests
    run_tool_call_flow_tests
}

# Streaming Tests
run_streaming_tests() {
    log INFO "Running streaming tests..."

    # Source the streaming test script
    source "$SCRIPT_DIR/tests/test-streaming.sh"

    # Run streaming specific tests
    run_streaming_tests
}

# File Upload Tests
run_file_upload_tests() {
    log INFO "Running file upload tests..."

    # Source the file upload test script
    source "$SCRIPT_DIR/tests/test-file-upload.sh"

    # Run file upload specific tests
    run_file_upload_tests
}

# Authentication Tests
run_authentication_tests() {
    log INFO "Running authentication tests..."

    # Source the authentication test script
    source "$SCRIPT_DIR/tests/test-authentication.sh"

    # Run authentication specific tests
    run_authentication_tests
}

# API Endpoint Tests
run_api_endpoint_tests() {
    log INFO "Running API endpoint tests..."

    # Source the API endpoint test script
    source "$SCRIPT_DIR/tests/test-api-endpoints.sh"

    # Run API endpoint specific tests
    run_api_endpoint_tests
}

# Rate Limiting Tests
run_rate_limiting_tests() {
    log INFO "Running rate limiting tests..."

    # Source the rate limiting test script
    source "$SCRIPT_DIR/tests/test-rate-limiting.sh"

    # Run rate limiting specific tests
    run_rate_limiting_tests
}

# Streaming Tests
run_streaming_tests() {
    log INFO "Running streaming tests..."

    # Source the streaming test script
    source "$SCRIPT_DIR/tests/test-streaming.sh"

    # Run streaming specific tests
    run_streaming_tests
}

# File Upload Tests
run_file_upload_tests() {
    log INFO "Running file upload tests..."

    # Source the file upload test script
    source "$SCRIPT_DIR/tests/test-file-upload.sh"

    # Run file upload specific tests
    run_file_upload_tests
}

# Authentication Tests
run_authentication_tests() {
    log INFO "Running authentication tests..."

    # Source the authentication test script
    source "$SCRIPT_DIR/tests/test-authentication.sh"

    # Run authentication specific tests
    run_authentication_tests
}

# API Endpoint Tests
run_api_endpoint_tests() {
    log INFO "Running API endpoint tests..."

    # Source the API endpoint test script
    source "$SCRIPT_DIR/tests/test-api-endpoints.sh"

    # Run API endpoint specific tests
    run_api_endpoint_tests
}

# Rate Limiting Tests
run_rate_limiting_tests() {
    log INFO "Running rate limiting tests..."

    # Source the rate limiting test script
    source "$SCRIPT_DIR/tests/test-rate-limiting.sh"

    # Run rate limiting specific tests
    run_rate_limiting_tests
}

# ==============================================
# UTILITY FUNCTIONS
# ==============================================

# Show help
show_help() {
    cat << EOF
OpenAI Assistant API Acceptance Test Runner

USAGE:
    $0 [OPTIONS] [CATEGORY]

ARGUMENTS:
    CATEGORY    Run specific test category (${TEST_CATEGORIES[*]})

OPTIONS:
    -h, --help          Show this help message
    -v, --verbose       Enable verbose logging
    -d, --debug         Enable debug logging
    -c, --config FILE   Use custom configuration file
    -o, --output DIR    Output directory for results
    --dry-run           Show what would be tested without running
    --cleanup-only      Only cleanup previous test resources

ENVIRONMENT VARIABLES:
    BASE_URL            Base URL of deployed Cloudflare Worker
    API_KEY             API key for authentication
    GC_ADMIN_KEY        Admin key for GC operations
    TEST_TIMEOUT        Test timeout in seconds
    LOG_LEVEL           Logging level (DEBUG, INFO, WARN, ERROR)

EXAMPLES:
    $0                          # Run all tests
    $0 authentication           # Run only authentication tests
    $0 --verbose ttl-gc         # Run TTL/GC tests with verbose logging
    $0 --dry-run                # Show what would be tested

CONFIGURATION:
    Edit tests/config.sh to customize test behavior and endpoints.

EOF
}

# ==============================================
# MAIN SCRIPT LOGIC
# ==============================================

# Parse command line arguments
DRY_RUN=false
CLEANUP_ONLY=false
CUSTOM_CONFIG=""
SPECIFIC_CATEGORY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            export LOG_LEVEL="DEBUG"
            shift
            ;;
        -d|--debug)
            export LOG_LEVEL="DEBUG"
            export HTTP_DEBUG=true
            shift
            ;;
        -c|--config)
            CUSTOM_CONFIG="$2"
            shift 2
            ;;
        -o|--output)
            export OUTPUT_DIR="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --cleanup-only)
            CLEANUP_ONLY=true
            shift
            ;;
        *)
            if [[ -z "$SPECIFIC_CATEGORY" ]]; then
                SPECIFIC_CATEGORY="$1"
            else
                log ERROR "Multiple categories specified. Please specify only one category."
                exit 1
            fi
            shift
            ;;
    esac
done

# Load custom configuration if specified
if [[ -n "$CUSTOM_CONFIG" ]]; then
    if [[ -f "$CUSTOM_CONFIG" ]]; then
        source "$CUSTOM_CONFIG"
        log INFO "Loaded custom configuration: $CUSTOM_CONFIG"
    else
        log ERROR "Custom configuration file not found: $CUSTOM_CONFIG"
        exit 1
    fi
fi

# Handle cleanup only mode
if [[ "$CLEANUP_ONLY" == true ]]; then
    log INFO "Running cleanup only..."
    cleanup_resources
    log INFO "Cleanup completed"
    exit 0
fi

# Handle dry run mode
if [[ "$DRY_RUN" == true ]]; then
    log INFO "DRY RUN MODE - No actual tests will be executed"

    # Validate configuration
    if ! validate_config; then
        log ERROR "Configuration validation failed"
        exit 1
    fi

    # Show what would be tested
    echo "========================================"
    echo "DRY RUN - Test Categories"
    echo "========================================"
    for category in "${TEST_CATEGORIES[@]}"; do
        echo "✓ $category"
    done
    echo "========================================"
    echo "Configuration:"
    echo "  Base URL: $BASE_URL"
    echo "  Test Timeout: ${TEST_TIMEOUT}s"
    echo "  Parallel Jobs: $PARALLEL_JOBS"
    echo "  Output Directory: $OUTPUT_DIR"
    echo "========================================"

    exit 0
fi

# Run tests
if [[ -n "$SPECIFIC_CATEGORY" ]]; then
    run_category_tests "$SPECIFIC_CATEGORY"
else
    run_all_tests
fi