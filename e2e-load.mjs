#!/usr/bin/env node
/**
 * MIPIT Load Test — Node.js version (async HTTP, no fork overhead)
 * Usage: TOKEN=xxx node e2e-load.mjs [totalRequests] [concurrency]
 */

import { createTraceLogger, fetchWithTrace } from './logging.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }
const logger = createTraceLogger('e2e-load');

const TOTAL = parseInt(process.argv[2] || '1000', 10);
const CONCURRENCY = parseInt(process.argv[3] || '20', 10);

const PIX_ALIASES = ['PIX-joao@email.com','PIX-maria@banco.br','PIX-pedro@pix.com','PIX-ana@gmail.com','PIX-lucas@hotmail.com'];
const SPEI_ALIASES = ['SPEI-012180000118359784','SPEI-014180000228456711','SPEI-002180000334567894'];
const BREB_ALIASES = ['BREB-+573001234567','BREB-+573205551234','BREB-+573109876543'];
const ALL_DEST = [...PIX_ALIASES,...SPEI_ALIASES,...BREB_ALIASES];

const SPEI_ORIGINS = ['SPEI-014180000228456711','SPEI-002180000334567894','SPEI-012180000118359784'];

const stats = { ok: 0, fail: 0, latencies: [], destCounts: {}, errors: [] };

async function sendPayment(idx) {
  const originAlias = SPEI_ORIGINS[idx % SPEI_ORIGINS.length];
  const destAlias = ALL_DEST[Math.floor(Math.random() * ALL_DEST.length)];
  const amount = 100 + Math.floor(Math.random() * 99900);
  const idemKey = `load-${idx}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  const start = performance.now();
  try {
    const res = await fetchWithTrace(logger, `load-payment-${idx}`, `${BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        amount,
        currency: 'MXN',
        debtor: { alias: originAlias, name: `LoadSender${idx}` },
        creditor: { alias: destAlias, name: `LoadReceiver${idx}` },
        purpose: 'E2E_LOAD_TEST',
        reference: `load-${idemKey}`,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = res.elapsedMs ?? Math.round(performance.now() - start);
    stats.latencies.push(elapsed);

    if (res.ok) {
      const data = res.body;
      stats.ok++;
      const destRail = data.destination_rail || '?';
      stats.destCounts[destRail] = (stats.destCounts[destRail] || 0) + 1;
      logger.event(`load-payment-${idx}-accepted`, {
        payment_id: data.payment_id,
        destination_rail: destRail,
        status: data.status,
        elapsed_ms: elapsed,
      });
    } else {
      stats.fail++;
      const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      stats.errors.push(`[${idx}] HTTP ${res.status}: ${body.slice(0,100)}`);
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    stats.latencies.push(elapsed);
    stats.fail++;
    stats.errors.push(`[${idx}] ${err.message || err}`);
  }
}

async function runBatch(startIdx, count) {
  const promises = [];
  for (let i = startIdx; i < startIdx + count; i++) {
    promises.push(sendPayment(i));
  }
  await Promise.all(promises);
}

async function main() {
  logger.banner('START e2e-load');
  logger.step('configuration', {
    BASE_URL,
    TOTAL,
    CONCURRENCY,
  });
  console.log('');
  console.log('========================================================');
  console.log('  MIPIT Load Test (Node.js)');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Total requests: ${TOTAL}`);
  console.log(`  Concurrency:    ${CONCURRENCY}`);
  console.log(`  Origin rail:    SPEI`);
  console.log(`  Destinations:   PIX / SPEI / BRE_B (random)`);
  console.log('========================================================');
  console.log('');

  const globalStart = performance.now();

  let sent = 0;
  while (sent < TOTAL) {
    const batch = Math.min(CONCURRENCY, TOTAL - sent);
    await runBatch(sent, batch);
    sent += batch;
    if (sent % 100 === 0 || sent === TOTAL) {
      console.log(`  Sent ${sent} / ${TOTAL}`);
    }
  }

  const totalTime = Math.round(performance.now() - globalStart);
  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const n = sorted.length;

  console.log('');
  console.log('========================================================');
  console.log('  RESULTS');
  console.log('========================================================');
  console.log(`  Total sent:     ${n}`);
  console.log(`  Succeeded:      ${stats.ok}`);
  console.log(`  Failed:         ${stats.fail}`);
  console.log(`  Success rate:   ${n > 0 ? Math.round(stats.ok * 100 / n) : 0}%`);
  console.log(`  Total time:     ${totalTime}ms`);
  console.log(`  Throughput:     ~${totalTime > 0 ? Math.round(n * 1000 / totalTime) : 0} req/s`);
  console.log('');
  if (n > 0) {
    const p = (pct) => sorted[Math.min(Math.floor(n * pct), n - 1)];
    console.log('  Latency (ms):');
    console.log(`    min:   ${sorted[0]}ms`);
    console.log(`    p50:   ${p(0.5)}ms`);
    console.log(`    p90:   ${p(0.9)}ms`);
    console.log(`    p95:   ${p(0.95)}ms`);
    console.log(`    p99:   ${p(0.99)}ms`);
    console.log(`    max:   ${sorted[n - 1]}ms`);
  }
  console.log('');
  console.log('  Destination distribution:');
  for (const rail of ['PIX', 'SPEI', 'BRE_B', '?']) {
    if (stats.destCounts[rail]) {
      console.log(`    ${rail}: ${stats.destCounts[rail]}`);
    }
  }
  console.log('');
  if (stats.errors.length > 0) {
    console.log(`  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`    ${e}`));
    if (stats.errors.length > 10) console.log(`    ... and ${stats.errors.length - 10} more`);
  }
  console.log('========================================================');
  console.log('');
}

main().catch(console.error);
