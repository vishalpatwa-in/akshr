#!/bin/bash

# Test Configuration File
# This file contains all configuration variables for the acceptance test suite

# ==============================================
# DEPLOYMENT CONFIGURATION
# ==============================================

# Base URL of the deployed Cloudflare Worker
# Update this with your actual deployed worker URL
export BASE_URL="${BASE_URL:-https://your-worker.your-subdomain.workers.dev}"

# Alternative: Use localhost for local development
# export BASE_URL="${BASE_URL:-http://localhost:8787}"

# ==============================================
# AUTHENTICATION CONFIGURATION
# ==============================================

# API Key for authentication (Bearer token)
export API_KEY="${API_KEY:-your-api-key-here}"

# Admin key for GC operations (if different from API key)
export GC_ADMIN_KEY="${GC_ADMIN_KEY:-your-gc-admin-key-here}"

# Bypass key for special operations
export BYPASS_KEY="${BYPASS_KEY:-your-bypass-key-here}"

# ==============================================
# TEST EXECUTION CONFIGURATION
# ==============================================

# Test timeout in seconds
export TEST_TIMEOUT="${TEST_TIMEOUT:-30}"

# Number of parallel test executions (for parallel test runner)
export PARALLEL_JOBS="${PARALLEL_JOBS:-3}"

# Retry configuration
export MAX_RETRIES="${MAX_RETRIES:-3}"
export RETRY_DELAY="${RETRY_DELAY:-2}"

# ==============================================
# TEST DATA CONFIGURATION
# ==============================================

# Test data sizes
export SMALL_FILE_SIZE="${SMALL_FILE_SIZE:-1024}"      # 1KB
export MEDIUM_FILE_SIZE="${MEDIUM_FILE_SIZE:-1048576}"  # 1MB
export LARGE_FILE_SIZE="${LARGE_FILE_SIZE:-10485760}"   # 10MB

# Concurrency test configuration
export CONCURRENT_USERS="${CONCURRENT_USERS:-5}"
export CONCURRENT_REQUESTS="${CONCURRENT_REQUESTS:-20}"

# Rate limiting test configuration
export RATE_LIMIT_REQUESTS="${RATE_LIMIT_REQUESTS:-100}"
export RATE_LIMIT_WINDOW="${RATE_LIMIT_WINDOW:-60}"

# ==============================================
# OUTPUT CONFIGURATION
# ==============================================

# Output directory for test results and logs
export OUTPUT_DIR="${OUTPUT_DIR:-./test-results}"

# Log level (DEBUG, INFO, WARN, ERROR)
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

# Enable detailed HTTP logging (true/false)
export HTTP_DEBUG="${HTTP_DEBUG:-false}"

# ==============================================
# ENVIRONMENT VALIDATION
# ==============================================

# Validate required configuration
validate_config() {
    local errors=()

    if [[ "$BASE_URL" == "https://your-worker.your-subdomain.workers.dev" ]]; then
        errors+=("BASE_URL is not configured. Please set your deployed worker URL.")
    fi

    if [[ "$API_KEY" == "your-api-key-here" ]]; then
        errors+=("API_KEY is not configured. Please set your API key.")
    fi

    if [[ "$GC_ADMIN_KEY" == "your-gc-admin-key-here" ]]; then
        errors+=("GC_ADMIN_KEY is not configured. Please set your GC admin key.")
    fi

    if [[ ${#errors[@]} -gt 0 ]]; then
        echo "Configuration errors found:"
        for error in "${errors[@]}"; do
            echo "  - $error"
        done
        echo ""
        echo "Please update the configuration in tests/config.sh or set environment variables."
        return 1
    fi

    return 0
}

# ==============================================
# UTILITY FUNCTIONS
# ==============================================

# Generate a random test ID
generate_test_id() {
    echo "test-$(date +%s)-$RANDOM"
}

# Get current timestamp in ISO format
get_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Log a message with timestamp
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(get_timestamp)

    # Only log if level is at or above configured log level
    case "$LOG_LEVEL:$level" in
        "DEBUG:DEBUG"|"INFO:INFO"|"INFO:DEBUG"|"WARN:WARN"|"WARN:INFO"|"WARN:DEBUG"|"ERROR:ERROR"|"ERROR:WARN"|"ERROR:INFO"|"ERROR:DEBUG")
            echo "[$timestamp] [$level] $message" >&2
            ;;
    esac
}

# ==============================================
# TEST CONSTANTS
# ==============================================

# Standard HTTP status codes
export HTTP_OK=200
export HTTP_CREATED=201
export HTTP_BAD_REQUEST=400
export HTTP_UNAUTHORIZED=401
export HTTP_FORBIDDEN=403
export HTTP_NOT_FOUND=404
export HTTP_CONFLICT=409
export HTTP_UNPROCESSABLE_ENTITY=422
export HTTP_TOO_MANY_REQUESTS=429
export HTTP_INTERNAL_SERVER_ERROR=500

# Test resource IDs (will be set during test execution)
export TEST_ASSISTANT_ID=""
export TEST_THREAD_ID=""
export TEST_MESSAGE_ID=""
export TEST_RUN_ID=""
export TEST_FILE_ID=""

# Export the validation function
export -f validate_config
export -f generate_test_id
export -f get_timestamp
export -f log