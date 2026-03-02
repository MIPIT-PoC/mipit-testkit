#!/bin/bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"

echo "==> Smoke Test: MiPIT PoC"
echo "    API: $API_URL"
echo ""

# Health check
echo "1. Health check..."
curl -sf "$API_URL/health" | jq .
echo ""

# Create PIX → SPEI payment
echo "2. Creating PIX → SPEI payment..."
IDEM_KEY=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-$(date +%s)")

RESPONSE=$(curl -sf -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{
    "amount": 100.50,
    "currency": "USD",
    "debtor": { "alias": "PIX-smoke.test.key", "name": "Smoke Test" },
    "creditor": { "alias": "SPEI-012345678901234567", "name": "Smoke Dest" },
    "purpose": "P2P",
    "reference": "SMOKE-TEST"
  }')

PAYMENT_ID=$(echo "$RESPONSE" | jq -r '.payment_id')
echo "   payment_id: $PAYMENT_ID"
echo "   status: $(echo "$RESPONSE" | jq -r '.status')"
echo ""

# Wait and poll
echo "3. Waiting for completion (max 30s)..."
for i in $(seq 1 30); do
  DETAIL=$(curl -sf "$API_URL/payments/$PAYMENT_ID")
  STATUS=$(echo "$DETAIL" | jq -r '.status')

  if [ "$STATUS" = "COMPLETED" ] || [ "$STATUS" = "REJECTED" ] || [ "$STATUS" = "FAILED" ]; then
    echo "   Final status: $STATUS (after ${i}s)"
    echo "$DETAIL" | jq .
    break
  fi

  sleep 1
done

echo ""
echo "==> Smoke test complete!"
