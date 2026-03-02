#!/bin/bash
set -euo pipefail

EVIDENCE_DIR="evidence/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$EVIDENCE_DIR"

echo "==> Generating evidence bundle in $EVIDENCE_DIR"

# 1. API health
curl -sf http://localhost:8080/health > "$EVIDENCE_DIR/health.json" 2>/dev/null || echo '{"error":"unreachable"}' > "$EVIDENCE_DIR/health.json"

# 2. Prometheus metrics snapshot
curl -sf http://localhost:9090/api/v1/query?query=mipit_payments_total > "$EVIDENCE_DIR/metrics-payments-total.json" 2>/dev/null || true
curl -sf "http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,sum(rate(mipit_payment_latency_ms_bucket[1h]))by(le))" > "$EVIDENCE_DIR/metrics-latency-p95.json" 2>/dev/null || true

# 3. Recent audit events (via API or direct DB query)
echo "Evidence bundle saved: $EVIDENCE_DIR"
echo "Contents:"
ls -la "$EVIDENCE_DIR"
