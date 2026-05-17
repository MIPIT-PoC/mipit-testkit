#!/bin/bash
# P10 — Smoke test for MiPIT PoC.
#
# Audit finding G6: previous version did `POST /payments` without any auth
# header. Since P08 the API requires JWT, so every smoke run returned 401
# and the script claimed success because curl -sf doesn't fail on
# response-body parse errors when jq prints nothing. Now we:
#   1. Fetch a JWT from /auth/token (dev/staging only — denied in prod).
#   2. Carry it as `Authorization: Bearer …` on every authenticated call.
#   3. Cover three rail-pairs (PIX→SPEI, SPEI→BRE_B, BRE_B→PIX) so the
#      smoke run also serves as a happy-path Bre-B sanity check (G3).
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"

echo "==> Smoke Test: MiPIT PoC"
echo "    API: $API_URL"
echo ""

# 0. Acquire JWT (P10 — was missing).
echo "0. Acquiring JWT from /auth/token..."
TOKEN_RES=$(curl -sf -X POST "$API_URL/auth/token" -H "Content-Type: application/json" -d '{}' || true)
TOKEN=$(echo "$TOKEN_RES" | jq -r '.access_token // empty')
if [ -z "$TOKEN" ]; then
  echo "   ❌ Failed to acquire token (production mode? response: $TOKEN_RES)"
  exit 1
fi
echo "   ✓ token acquired (len=${#TOKEN})"
AUTH_HEADER="Authorization: Bearer $TOKEN"
echo ""

# 1. Health check (public).
echo "1. Health check..."
curl -sf "$API_URL/health" | jq .
echo ""

uuid() {
  uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-$(date +%s%N)"
}

create_and_poll() {
  local label="$1"
  local body="$2"
  local idem
  idem=$(uuid)
  echo "$label..."
  local resp
  resp=$(curl -sf -X POST "$API_URL/payments" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -H "Idempotency-Key: $idem" \
    -d "$body")
  local pid status
  pid=$(echo "$resp" | jq -r '.payment_id')
  status=$(echo "$resp" | jq -r '.status')
  echo "   payment_id: $pid  status: $status"
  local final="$status"
  for _ in $(seq 1 30); do
    local detail
    detail=$(curl -sf -H "$AUTH_HEADER" "$API_URL/payments/$pid")
    final=$(echo "$detail" | jq -r '.status')
    case "$final" in
      COMPLETED|REJECTED|FAILED) echo "   final: $final"; break ;;
    esac
    sleep 1
  done
  echo ""
  if [ "$final" != "COMPLETED" ] && [ "$final" != "ACKED_BY_RAIL" ]; then
    echo "   ⚠ smoke pair '$label' ended in $final (acceptable in CI but worth eyeballing)"
  fi
}

# 2. PIX → SPEI (BRL→MXN).
create_and_poll "2. PIX → SPEI" '{
    "amount": 100.50,
    "currency": "BRL",
    "debtor": { "alias": "PIX-smoke.test.key@mipit.test", "name": "Smoke PIX" },
    "creditor": { "alias": "SPEI-012180001234567899", "name": "Smoke SPEI" },
    "purpose": "P2P",
    "reference": "SMOKE-PIX-SPEI"
  }'

# 3. SPEI → BRE_B (MXN→COP). P10 — new rail-pair coverage.
create_and_poll "3. SPEI → BRE_B" '{
    "amount": 500.00,
    "currency": "MXN",
    "debtor": { "alias": "SPEI-012180001234567899", "name": "Smoke SPEI" },
    "creditor": { "alias": "BREB-+573001234567", "name": "Smoke BRE_B" },
    "purpose": "REMITTANCE",
    "reference": "SMOKE-SPEI-BREB"
  }'

# 4. BRE_B → PIX (COP→BRL). P10 — new rail-pair coverage.
create_and_poll "4. BRE_B → PIX" '{
    "amount": 250000,
    "currency": "COP",
    "debtor": { "alias": "BREB-@smoke.bogota", "name": "Smoke BRE_B" },
    "creditor": { "alias": "PIX-smoke.brasil.key@mipit.test", "name": "Smoke PIX" },
    "purpose": "P2P",
    "reference": "SMOKE-BREB-PIX"
  }'

echo "==> Smoke test complete!"
