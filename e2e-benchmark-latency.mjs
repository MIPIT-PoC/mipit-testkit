#!/usr/bin/env node
/**
 * MIPIT — Latency Benchmark (k6-equivalent in Node.js)
 *
 * Measures p50/p90/p95/p99/max latency for:
 *   1. POST /payments (end-to-end payment creation)
 *   2. POST /translate/preview (translation to all 6 target rails)
 *   3. POST /translate (direct PIX→SPEI translation)
 *   4. GET /payments/:id (payment detail lookup)
 *
 * Runs sustained load for a configurable duration, reports percentiles,
 * throughput (req/s), and error rates.
 */

import { createTraceLogger, fetchWithTrace } from './logging.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }
const logger = createTraceLogger('e2e-benchmark-latency');

const DURATION_S = parseInt(process.argv[2] || '30', 10);
const RPS_TARGET = parseInt(process.argv[3] || '50', 10);
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const PIX_ALIASES = ['PIX-bench1@email.com','PIX-bench2@banco.br','PIX-bench3@pix.com'];
const SPEI_ALIASES = ['SPEI-012180000118359784','SPEI-014180000228456711'];
const BREB_ALIASES = ['BREB-+573001234567','BREB-+573205551234'];
const ALL_DEST = [...PIX_ALIASES, ...SPEI_ALIASES, ...BREB_ALIASES];

const SAMPLE_PIX_PAYLOAD = {
  endToEndId: 'E2626422020260404120012345678901',
  valor: { original: '1500.00' },
  pagador: { ispb: '26264220', nome: 'João Silva', cpf: '12345678901',
             contaTransacional: { numero: '123456-7', tipoConta: 'CACC' } },
  recebedor: { ispb: '60701190', nome: 'Maria Santos', cpf: '98765432100' },
  chave: 'maria@email.com', tipoChave: 'EMAIL', tipo: 'TRANSF',
};

function percentile(sorted, p) {
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx];
}

function formatStats(label, latencies, errors) {
  if (latencies.length === 0) return `  ${label}: no data`;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / n);
  return [
    `  ${label}:`,
    `    requests:  ${n}`,
    `    errors:    ${errors}`,
    `    avg:       ${avg}ms`,
    `    p50:       ${percentile(sorted, 0.5)}ms`,
    `    p90:       ${percentile(sorted, 0.9)}ms`,
    `    p95:       ${percentile(sorted, 0.95)}ms`,
    `    p99:       ${percentile(sorted, 0.99)}ms`,
    `    max:       ${sorted[n - 1]}ms`,
    `    min:       ${sorted[0]}ms`,
    `    throughput: ${(n / DURATION_S).toFixed(1)} req/s`,
  ].join('\n');
}

async function timedFetch(url, opts) {
  const start = performance.now();
  try {
    const res = await fetchWithTrace(logger, `benchmark ${opts.method ?? 'GET'} ${url}`, url, {
      ...opts,
      signal: AbortSignal.timeout(15000),
    }, 'text');
    const elapsed = res.elapsedMs ?? Math.round(performance.now() - start);
    return { elapsed, ok: res.ok, status: res.status };
  } catch {
    return { elapsed: Math.round(performance.now() - start), ok: false, status: 0 };
  }
}

async function benchmarkPayments() {
  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_S * 1000;
  let idx = 0;
  const interval = 1000 / RPS_TARGET;

  while (Date.now() < deadline) {
    const batch = Math.min(RPS_TARGET, Math.ceil((deadline - Date.now()) / interval));
    const promises = [];
    for (let i = 0; i < Math.min(batch, 10); i++) {
      const dest = ALL_DEST[idx % ALL_DEST.length];
      const idem = `bench-pay-${Date.now()}-${idx++}`;
      promises.push(timedFetch(`${BASE}/payments`, {
        method: 'POST', headers: { ...H, 'Idempotency-Key': idem },
        body: JSON.stringify({
          amount: 100 + (idx % 9900), currency: 'MXN',
          debtor: { alias: 'SPEI-014180000228456711', name: 'BenchSender' },
          creditor: { alias: dest, name: 'BenchRecv' },
          purpose: 'BENCHMARK',
        }),
      }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      latencies.push(r.elapsed);
      if (!r.ok) errors++;
    }
    const elapsed = results.reduce((a, r) => Math.max(a, r.elapsed), 0);
    const sleepTime = Math.max(0, (1000 / (RPS_TARGET / 10)) - elapsed);
    if (sleepTime > 0) await new Promise(r => setTimeout(r, sleepTime));
  }
  return { latencies, errors };
}

async function benchmarkTranslatePreview() {
  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_S * 1000;

  while (Date.now() < deadline) {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(timedFetch(`${BASE}/translate/preview`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ sourceRail: 'PIX', payload: SAMPLE_PIX_PAYLOAD }),
      }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      latencies.push(r.elapsed);
      if (!r.ok) errors++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return { latencies, errors };
}

async function benchmarkTranslateDirect() {
  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_S * 1000;
  const pairs = [
    ['PIX', 'SPEI'], ['PIX', 'SWIFT_MT103'], ['PIX', 'ISO20022_MX'],
    ['PIX', 'ACH_NACHA'], ['PIX', 'FEDNOW'], ['PIX', 'BRE_B'],
  ];
  let pairIdx = 0;

  while (Date.now() < deadline) {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const [src, dst] = pairs[pairIdx++ % pairs.length];
      promises.push(timedFetch(`${BASE}/translate`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          sourceRail: src, destinationRail: dst, payload: SAMPLE_PIX_PAYLOAD,
        }),
      }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      latencies.push(r.elapsed);
      if (!r.ok) errors++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return { latencies, errors };
}

async function benchmarkGetPayment() {
  // First create a payment to query
  const idem = `bench-get-${Date.now()}`;
  const createRes = await fetch(`${BASE}/payments`, {
    method: 'POST', headers: { ...H, 'Idempotency-Key': idem },
    body: JSON.stringify({
      amount: 500, currency: 'BRL',
      debtor: { alias: 'PIX-bench-get@email.com', name: 'GetSender' },
      creditor: { alias: 'PIX-bench-get-recv@email.com', name: 'GetRecv' },
    }),
  });
  const { payment_id } = await createRes.json();

  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + DURATION_S * 1000;

  while (Date.now() < deadline) {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(timedFetch(`${BASE}/payments/${payment_id}`, { headers: H }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      latencies.push(r.elapsed);
      if (!r.ok) errors++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return { latencies, errors };
}

async function main() {
  logger.banner('START e2e-benchmark-latency');
  logger.step('configuration', { BASE, DURATION_S, RPS_TARGET });
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  MIPIT — Latency Benchmark');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Duration:    ${DURATION_S}s per endpoint`);
  console.log(`  RPS target:  ${RPS_TARGET} (for POST /payments)`);
  console.log('════════════════════════════════════════════════════════════');

  console.log('\n[1/4] POST /payments (payment creation)...');
  const payRes = await benchmarkPayments();
  console.log(formatStats('POST /payments', payRes.latencies, payRes.errors));

  console.log('\n[2/4] POST /translate/preview (PIX → 6 rails)...');
  const prevRes = await benchmarkTranslatePreview();
  console.log(formatStats('POST /translate/preview', prevRes.latencies, prevRes.errors));

  console.log('\n[3/4] POST /translate (direct, rotating pairs)...');
  const dirRes = await benchmarkTranslateDirect();
  console.log(formatStats('POST /translate', dirRes.latencies, dirRes.errors));

  console.log('\n[4/4] GET /payments/:id (detail lookup)...');
  const getRes = await benchmarkGetPayment();
  console.log(formatStats('GET /payments/:id', getRes.latencies, getRes.errors));

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK COMPLETE');
  console.log('════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
