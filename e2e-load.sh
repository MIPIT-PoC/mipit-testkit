#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
TOKEN="${TOKEN:?Set TOKEN env var with a valid JWT}"
TOTAL_REQUESTS="${TOTAL_REQUESTS:-1000}"
CONCURRENCY="${CONCURRENCY:-50}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TEMP_DIR=$(mktemp -d)
RESULTS_FILE="$TEMP_DIR/results.csv"
ERRORS_FILE="$TEMP_DIR/errors.log"
touch "$RESULTS_FILE" "$ERRORS_FILE"

RAILS=("PIX" "SPEI" "BRE_B")
PIX_ALIASES=("PIX-joao@email.com" "PIX-maria@banco.br" "PIX-pedro@pix.com" "PIX-ana@gmail.com" "PIX-lucas@hotmail.com")
SPEI_ALIASES=("SPEI-012180000118359784" "SPEI-014180000228456711" "SPEI-002180000334567894")
BREB_ALIASES=("BREB-+573001234567" "BREB-+573205551234" "BREB-+573109876543")

get_random_dest_alias() {
  local origin_rail="$1"
  local roll=$((RANDOM % 3))
  case $roll in
    0)
      local arr=("${PIX_ALIASES[@]}")
      echo "${arr[$((RANDOM % ${#arr[@]}))]}"
      ;;
    1)
      local arr=("${SPEI_ALIASES[@]}")
      echo "${arr[$((RANDOM % ${#arr[@]}))]}"
      ;;
    2)
      local arr=("${BREB_ALIASES[@]}")
      echo "${arr[$((RANDOM % ${#arr[@]}))]}"
      ;;
  esac
}

send_one() {
  local idx="$1"
  local origin_alias="SPEI-014180000228456711"
  local dest_alias
  dest_alias=$(get_random_dest_alias "SPEI")
  local amount=$((100 + RANDOM % 99900))
  local idem_key="load-${idx}-$(date +%s%N)"

  local start_ms=$(($(date +%s) * 1000))

  local response
  response=$(curl -s -w "\n%{http_code}" \
    --max-time 30 \
    -X POST "$BASE_URL/payments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $idem_key" \
    -d "{
      \"amount\": $amount,
      \"currency\": \"MXN\",
      \"debtor\": { \"alias\": \"$origin_alias\", \"name\": \"Load Test Sender $idx\" },
      \"creditor\": { \"alias\": \"$dest_alias\", \"name\": \"Load Test Receiver $idx\" },
      \"purpose\": \"E2E_LOAD_TEST\",
      \"reference\": \"load-$idem_key\"
    }" 2>/dev/null) || true

  local end_ms=$(($(date +%s) * 1000))
  local latency=$((end_ms - start_ms))

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  local status="UNKNOWN"
  local dest_rail="UNKNOWN"
  if [[ "$http_code" == "201" || "$http_code" == "200" ]]; then
    status="OK"
    dest_rail=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('destination_rail','?'))" 2>/dev/null || echo "?")
  else
    status="FAIL"
    echo "[$idx] HTTP $http_code: $(echo "$body" | head -1)" >> "$ERRORS_FILE"
  fi

  echo "$idx,$http_code,$latency,$dest_rail,$status,$dest_alias" >> "$RESULTS_FILE"
}

echo ""
echo "========================================================"
echo "  MIPIT Load Test"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Total requests: $TOTAL_REQUESTS"
echo "  Concurrency:    $CONCURRENCY"
echo "  Origin rail:    SPEI"
echo "  Destinations:   PIX / SPEI / BRE_B (random)"
echo "========================================================"
echo ""

GLOBAL_START=$(($(date +%s) * 1000))

active=0
sent=0
for i in $(seq 1 "$TOTAL_REQUESTS"); do
  send_one "$i" &
  active=$((active + 1))
  sent=$((sent + 1))

  if ((active >= CONCURRENCY)); then
    wait -n 2>/dev/null || true
    active=$((active - 1))
  fi

  if ((sent % 100 == 0)); then
    echo -e "  ${CYAN}Sent $sent / $TOTAL_REQUESTS${NC}"
  fi
done

wait

GLOBAL_END=$(($(date +%s) * 1000))
TOTAL_TIME=$((GLOBAL_END - GLOBAL_START))

echo ""
echo "========================================================"
echo "  RESULTS"
echo "========================================================"

total_ok=$(grep -c ",OK," "$RESULTS_FILE" 2>/dev/null || true)
total_ok=${total_ok:-0}
total_fail=$(grep -c ",FAIL," "$RESULTS_FILE" 2>/dev/null || true)
total_fail=${total_fail:-0}
total_lines=$(wc -l < "$RESULTS_FILE" | tr -d ' ')

echo -e "  Total sent:     $total_lines"
echo -e "  ${GREEN}Succeeded:      $total_ok${NC}"
echo -e "  ${RED}Failed:         $total_fail${NC}"

if [[ "$total_lines" -gt 0 ]]; then
  success_pct=$((total_ok * 100 / total_lines))
  echo -e "  Success rate:   ${success_pct}%"
fi

echo -e "  Total time:     ${TOTAL_TIME}ms"
if [[ "$TOTAL_TIME" -gt 0 ]]; then
  rps=$((total_lines * 1000 / TOTAL_TIME))
  echo -e "  Throughput:     ~${rps} req/s"
fi

latencies=$(awk -F',' '{print $3}' "$RESULTS_FILE" | sort -n)
if [[ -n "$latencies" ]]; then
  p50=$(echo "$latencies" | awk "NR==int($total_lines*0.50)+1{print}")
  p90=$(echo "$latencies" | awk "NR==int($total_lines*0.90)+1{print}")
  p95=$(echo "$latencies" | awk "NR==int($total_lines*0.95)+1{print}")
  p99=$(echo "$latencies" | awk "NR==int($total_lines*0.99)+1{print}")
  min_lat=$(echo "$latencies" | head -1)
  max_lat=$(echo "$latencies" | tail -1)
  echo ""
  echo "  Latency (ms):"
  echo "    min:   ${min_lat}ms"
  echo "    p50:   ${p50}ms"
  echo "    p90:   ${p90}ms"
  echo "    p95:   ${p95}ms"
  echo "    p99:   ${p99}ms"
  echo "    max:   ${max_lat}ms"
fi

echo ""
echo "  Destination distribution:"
for rail in PIX SPEI BRE_B; do
  count=$(grep -c ",$rail," "$RESULTS_FILE" 2>/dev/null || true)
  count=${count:-0}
  echo "    $rail: $count"
done

echo ""
if [[ -s "$ERRORS_FILE" ]]; then
  error_count=$(wc -l < "$ERRORS_FILE" | tr -d ' ')
  echo -e "  ${RED}Errors ($error_count):${NC}"
  head -10 "$ERRORS_FILE" | while read -r line; do
    echo "    $line"
  done
  if [[ "$error_count" -gt 10 ]]; then
    echo "    ... and $((error_count - 10)) more"
  fi
fi

echo ""
echo "  Raw results: $RESULTS_FILE"
echo "  Error log:   $ERRORS_FILE"
echo "========================================================"
echo ""

rm -rf "$TEMP_DIR"
