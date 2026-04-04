#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
TOKEN="${TOKEN:?Set TOKEN env var with a valid JWT}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

send_payment() {
  local label="$1"
  local origin_alias="$2"
  local creditor_alias="$3"
  local amount="$4"
  local currency="$5"
  local idem_key="$6"

  TOTAL=$((TOTAL + 1))

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/payments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $idem_key" \
    -d "{
      \"amount\": $amount,
      \"currency\": \"$currency\",
      \"debtor\": { \"alias\": \"$origin_alias\", \"name\": \"Test Sender\" },
      \"creditor\": { \"alias\": \"$creditor_alias\", \"name\": \"Test Receiver\" },
      \"purpose\": \"E2E_TEST\",
      \"reference\": \"roundtrip-$idem_key\"
    }" 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" == "201" || "$http_code" == "200" ]]; then
    local payment_id
    payment_id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('payment_id','?'))" 2>/dev/null || echo "?")
    echo -e "  ${GREEN}PASS${NC} [$label] HTTP $http_code → payment_id=$payment_id"
    PASS=$((PASS + 1))

    sleep 2

    local status_resp
    status_resp=$(curl -s "$BASE_URL/payments/$payment_id" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    local status
    status=$(echo "$status_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
    local rail_ack_status
    rail_ack_status=$(echo "$status_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); ra=d.get('rail_ack',{}); print(ra.get('status','N/A') if ra else 'N/A')" 2>/dev/null || echo "N/A")
    local rail_ack_error
    rail_ack_error=$(echo "$status_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); ra=d.get('rail_ack',{}); print(ra.get('error_code','') if ra else '')" 2>/dev/null || echo "")
    local dest_rail
    dest_rail=$(echo "$status_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('destination_rail','?'))" 2>/dev/null || echo "?")

    local extra=""
    if [[ -n "$rail_ack_error" ]]; then
      extra=" error=$rail_ack_error"
    fi
    echo -e "        → status=${CYAN}$status${NC}  dest=$dest_rail  ack=$rail_ack_status$extra"
    echo "$payment_id"
  else
    echo -e "  ${RED}FAIL${NC} [$label] HTTP $http_code"
    echo "$body" | python3 -m json.tool 2>/dev/null | head -5 || echo "$body" | head -3
    FAIL=$((FAIL + 1))
    echo ""
  fi
}

echo ""
echo "========================================================"
echo "  MIPIT E2E Round-Trip Tests"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================"
echo ""

# ─── Test 1: PIX → SPEI ───
echo -e "${YELLOW}═══ Test 1: PIX → SPEI ═══${NC}"
send_payment "PIX→SPEI" \
  "PIX-joao@email.com" \
  "SPEI-012180000118359784" \
  1500 BRL \
  "rt-pix-spei-$(date +%s)-1"

echo ""

# ─── Test 2: SPEI → PIX ───
echo -e "${YELLOW}═══ Test 2: SPEI → PIX ═══${NC}"
send_payment "SPEI→PIX" \
  "SPEI-014180000228456711" \
  "PIX-maria@banco.br" \
  2500 MXN \
  "rt-spei-pix-$(date +%s)-2"

echo ""

# ─── Test 3: PIX → BRE-B ───
echo -e "${YELLOW}═══ Test 3: PIX → BRE-B ═══${NC}"
send_payment "PIX→BRE_B" \
  "PIX-carlos@pix.com" \
  "BREB-+573001234567" \
  800 BRL \
  "rt-pix-breb-$(date +%s)-3"

echo ""

# ─── Test 4: BRE-B → PIX ───
echo -e "${YELLOW}═══ Test 4: BRE-B → PIX ═══${NC}"
send_payment "BRE_B→PIX" \
  "BREB-+573109876543" \
  "PIX-ana@banco.br" \
  5000000 COP \
  "rt-breb-pix-$(date +%s)-4"

echo ""

# ─── Test 5: SPEI → BRE-B ───
echo -e "${YELLOW}═══ Test 5: SPEI → BRE-B ═══${NC}"
send_payment "SPEI→BRE_B" \
  "SPEI-002180000334567894" \
  "BREB-+573205551234" \
  3000 MXN \
  "rt-spei-breb-$(date +%s)-5"

echo ""

# ─── Test 6: BRE-B → SPEI ───
echo -e "${YELLOW}═══ Test 6: BRE-B → SPEI ═══${NC}"
send_payment "BRE_B→SPEI" \
  "BREB-+573001112233" \
  "SPEI-012180000445678905" \
  10000000 COP \
  "rt-breb-spei-$(date +%s)-6"

echo ""

# ─── Test 7: Same-rail PIX → PIX ───
echo -e "${YELLOW}═══ Test 7: PIX → PIX (same-rail) ═══${NC}"
send_payment "PIX→PIX" \
  "PIX-sender@banco.br" \
  "PIX-receiver@outro.br" \
  250 BRL \
  "rt-pix-pix-$(date +%s)-7"

echo ""

# ─── Test 8: Same-rail SPEI → SPEI ───
echo -e "${YELLOW}═══ Test 8: SPEI → SPEI (same-rail) ═══${NC}"
send_payment "SPEI→SPEI" \
  "SPEI-002180000556789010" \
  "SPEI-014180000667890129" \
  1000 MXN \
  "rt-spei-spei-$(date +%s)-8"

echo ""

# ─── Test 9: Same-rail BRE-B → BRE-B ───
echo -e "${YELLOW}═══ Test 9: BRE-B → BRE-B (same-rail) ═══${NC}"
send_payment "BRE_B→BRE_B" \
  "BREB-+573002223344" \
  "BREB-+573003334455" \
  2000000 COP \
  "rt-breb-breb-$(date +%s)-9"

echo ""

echo "========================================================"
echo -e "  Results: ${GREEN}$PASS passed${NC} / ${RED}$FAIL failed${NC} / $TOTAL total"
echo "========================================================"
echo ""
