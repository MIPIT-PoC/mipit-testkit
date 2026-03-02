#!/bin/bash
set -euo pipefail

echo "==> MiPIT E2E Test Suite"
echo ""

# Ensure API is up
API_URL="${API_URL:-http://localhost:8080}"
echo "Checking API at $API_URL..."
curl -sf "$API_URL/health" > /dev/null || { echo "ERROR: API not reachable"; exit 1; }

echo "Running E2E tests..."
npx jest --testPathPattern=tests/e2e --runInBand --verbose

echo ""
echo "==> E2E tests complete. Evidence saved in evidence/"
