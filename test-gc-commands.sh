#!/bin/bash

# Manual GC Testing Commands
# Copy and paste these commands to test the GC system

# Configuration - Update these values
DOMAIN="http://localhost:8787"
ADMIN_KEY="your-gc-admin-key"

# 1. Get GC configuration
echo "=== Getting GC Configuration ==="
curl -X GET "$DOMAIN/admin/gc/config" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" | jq '.'

echo -e "\n\n"

# 2. Dry run - test cleanup without actually deleting
echo "=== Dry Run Test (safe testing) ==="
curl -X POST "$DOMAIN/admin/gc/dry-run" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceTypes": ["thread", "message"],
    "maxObjectsPerType": 10,
    "batchSize": 5
  }' | jq '.'

echo -e "\n\n"

# 3. Full cleanup operation
echo "=== Full GC Operation ==="
curl -X POST "$DOMAIN/admin/gc" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "cleanup",
    "resourceTypes": ["message", "run"],
    "maxObjectsPerType": 50,
    "batchSize": 10
  }' | jq '.'

echo -e "\n\n"

# 4. Specific resource cleanup
echo "=== Clean Only Files ==="
curl -X POST "$DOMAIN/admin/gc" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "cleanup",
    "resourceTypes": ["file"],
    "maxObjectsPerType": 100
  }' | jq '.'

echo -e "\n\n"

# 5. High-frequency cleanup (for active testing)
echo "=== High-Frequency Cleanup ==="
curl -X POST "$DOMAIN/admin/gc" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "cleanup",
    "resourceTypes": ["run"],
    "maxObjectsPerType": 200,
    "batchSize": 20
  }' | jq '.'

echo -e "\n\n"

# 6. Test authentication failure
echo "=== Test Authentication Failure ==="
curl -X POST "$DOMAIN/admin/gc/dry-run" \
  -H "Content-Type: application/json" \
  -d '{"resourceTypes": ["thread"]}' | jq '.'

echo -e "\n\n"

# 7. Test invalid request
echo "=== Test Invalid Request ==="
curl -X POST "$DOMAIN/admin/gc" \
  -H "X-GC-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"invalid": "request"}' | jq '.'

echo -e "\n\n"

# 8. Test CORS preflight
echo "=== Test CORS Preflight ==="
curl -X OPTIONS "$DOMAIN/admin/gc" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -v

echo -e "\n\n"

# 9. Test rate limiting (run multiple times quickly)
echo "=== Test Rate Limiting (run multiple times) ==="
for i in {1..3}; do
  echo "Request $i:"
  curl -X POST "$DOMAIN/admin/gc/dry-run" \
    -H "X-GC-Admin-Key: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d '{"resourceTypes": ["message"]}' \
    -w "Status: %{http_code}\n" \
    -s | jq '.success, .error.message' 2>/dev/null || echo "Rate limited or error"
  sleep 0.1
done

echo -e "\n\n=== Testing Complete ==="
echo "Check the responses above for:"
echo "- Success status and operation IDs"
echo "- Processing statistics"
echo "- Error handling"
echo "- Rate limiting behavior"
echo "- Authentication requirements"