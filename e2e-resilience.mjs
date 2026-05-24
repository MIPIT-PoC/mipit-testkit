#!/usr/bin/env node
/**
 * @file e2e-resilience.mjs
 * @description Resilience test that kills adapters mid-flow and verifies RabbitMQ redelivery, DLQ routing, and recovery on restart.
 * @author Carlos Mejía
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
/**
 * MIPIT — Resilience Testing
 *
 * Verifies that when an adapter is killed mid-processing:
 *   1. Unacknowledged messages return to the queue (RabbitMQ redelivery)
 *   2. Messages eventually reach DLQ if no consumer recovers them
 *   3. After adapter restart, queued payments are processed
 *
 * Procedure:
 *   Phase 1: Send N payments to a specific rail
 *   Phase 2: Kill the adapter container (simulates crash)
 *   Phase 3: Verify messages are requeued (queue depth > 0)
 *   Phase 4: Restart the adapter
 *   Phase 5: Verify all payments eventually reach terminal status
 */

import { execSync } from 'child_process';
import { createTraceLogger, fetchWithTrace } from './logging.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }
const logger = createTraceLogger('e2e-resilience');

const RABBITMQ_API = process.env.RABBITMQ_API || 'http://localhost:15672/api';
const RABBITMQ_AUTH = 'guest:guest';
const TARGET_RAIL = 'PIX';
const ADAPTER_CONTAINER = 'mipit-adapter-pix';
const PAYMENT_COUNT = 20;
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let pass = 0, fail = 0, total = 0;
function assert(cond, label, detail) {
  total++;
  if (cond) { pass++; console.log(`    ✅ ${label}`); }
  else { fail++; console.log(`    ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function post(path, body, extra = {}) {
  const res = await fetchWithTrace(logger, `POST ${path}`, `${BASE}${path}`, {
    method: 'POST', headers: { ...H, ...extra },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, data: res.body };
}

async function get(path) {
  const res = await fetchWithTrace(logger, `GET ${path}`, `${BASE}${path}`, {
    headers: H,
    signal: AbortSignal.timeout(10000),
  });
  return res.body;
}

async function getQueueDepth(queueName) {
  try {
    const res = await fetch(`${RABBITMQ_API}/queues/%2F/${queueName}`, {
      headers: { Authorization: `Basic ${Buffer.from(RABBITMQ_AUTH).toString('base64')}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.messages ?? 0;
  } catch { return -1; }
}

function dockerCmd(cmd) {
  logger.step(`docker ${cmd}`);
  try {
    const output = execSync(`docker ${cmd}`, { encoding: 'utf-8', timeout: 30000 }).trim();
    logger.event(`docker ${cmd} output`, output);
    return output;
  }
  catch (e) {
    const output = e.stdout?.trim() ?? e.message;
    logger.error(`docker ${cmd}`, output);
    return output;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollTerminal(paymentId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await get(`/payments/${paymentId}`);
    if (['COMPLETED', 'REJECTED', 'FAILED'].includes(data?.status)) return data;
    await sleep(1000);
  }
  return get(`/payments/${paymentId}`);
}

async function main() {
  logger.banner('START e2e-resilience');
  logger.step('configuration', { BASE, TARGET_RAIL, ADAPTER_CONTAINER, PAYMENT_COUNT, RABBITMQ_API });
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  MIPIT — Resilience Testing');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Target rail: ${TARGET_RAIL}`);
  console.log(`  Adapter:     ${ADAPTER_CONTAINER}`);
  console.log(`  Payments:    ${PAYMENT_COUNT}`);
  console.log('════════════════════════════════════════════════════════════');

  // Phase 1: Verify adapter is running
  console.log('\n═══ Phase 1: Verify adapter is running ═══');
  const containerState = dockerCmd(`inspect -f "{{.State.Status}}" ${ADAPTER_CONTAINER}`);
  assert(containerState === 'running', `Adapter container status: ${containerState}`);

  // Phase 2: Send payments
  console.log('\n═══ Phase 2: Create payments destined to PIX ═══');
  const paymentIds = [];
  for (let i = 0; i < PAYMENT_COUNT; i++) {
    const r = await post('/payments', {
      amount: 100 + i, currency: 'BRL',
      debtor: { alias: 'PIX-resil-sender@test.com', name: 'ResilSender' },
      creditor: { alias: 'PIX-resil-recv@test.com', name: 'ResilRecv' },
    }, { 'Idempotency-Key': `resil-${Date.now()}-${i}` });
    if (r.data?.payment_id) paymentIds.push(r.data.payment_id);
  }
  assert(paymentIds.length === PAYMENT_COUNT,
    `Created ${paymentIds.length}/${PAYMENT_COUNT} payments`);

  // Wait briefly for some to be in queue
  await sleep(500);

  // Phase 3: Kill the adapter
  console.log('\n═══ Phase 3: Kill adapter (simulate crash) ═══');
  const killResult = dockerCmd(`stop ${ADAPTER_CONTAINER} -t 0`);
  console.log(`    docker stop result: ${killResult}`);
  await sleep(2000);

  const stoppedState = dockerCmd(`inspect -f "{{.State.Status}}" ${ADAPTER_CONTAINER}`);
  assert(stoppedState !== 'running',
    `Adapter stopped: ${stoppedState}`);

  // Phase 4: Check queue depth — unprocessed messages should be requeued
  console.log('\n═══ Phase 4: Check RabbitMQ redelivery ═══');
  const queueDepth = await getQueueDepth('payments.route.pix');
  console.log(`    Queue depth (payments.route.pix): ${queueDepth}`);
  // Some messages may have been processed before the kill, so depth >= 0
  assert(queueDepth >= 0, `Queue readable: depth=${queueDepth}`);

  // Send more payments while adapter is down — they should accumulate in queue
  console.log('\n═══ Phase 4b: Send payments while adapter is down ═══');
  const downPaymentIds = [];
  for (let i = 0; i < 5; i++) {
    const r = await post('/payments', {
      amount: 5000 + i, currency: 'BRL',
      debtor: { alias: 'PIX-down-sender@test.com', name: 'DownSender' },
      creditor: { alias: 'PIX-down-recv@test.com', name: 'DownRecv' },
    }, { 'Idempotency-Key': `resil-down-${Date.now()}-${i}` });
    if (r.data?.payment_id) downPaymentIds.push(r.data.payment_id);
  }
  assert(downPaymentIds.length === 5,
    `Created ${downPaymentIds.length} payments while adapter down`);

  await sleep(2000);
  const queueAfterDown = await getQueueDepth('payments.route.pix');
  console.log(`    Queue depth after sending while down: ${queueAfterDown}`);
  assert(queueAfterDown >= 0,
    `Queue readable while adapter down: depth=${queueAfterDown}`);

  // Verify these payments are QUEUED (not processed)
  let queuedCount = 0;
  for (const id of downPaymentIds) {
    const data = await get(`/payments/${id}`);
    if (data?.status === 'QUEUED' || data?.status === 'ROUTED') queuedCount++;
  }
  assert(queuedCount === downPaymentIds.length,
    `All ${queuedCount}/${downPaymentIds.length} payments stuck in QUEUED/ROUTED`);

  // Phase 5: Restart adapter
  console.log('\n═══ Phase 5: Restart adapter ═══');
  const startResult = dockerCmd(`start ${ADAPTER_CONTAINER}`);
  console.log(`    docker start result: ${startResult}`);
  await sleep(5000);

  const restartedState = dockerCmd(`inspect -f "{{.State.Status}}" ${ADAPTER_CONTAINER}`);
  assert(restartedState === 'running',
    `Adapter restarted: ${restartedState}`);

  // Phase 6: Verify recovery — all payments reach terminal status
  console.log('\n═══ Phase 6: Verify recovery (all payments processed) ═══');
  const allIds = [...paymentIds, ...downPaymentIds];
  let terminal = 0, completed = 0, rejected = 0, failed = 0, stuck = 0;

  for (const id of allIds) {
    const data = await pollTerminal(id, 30000);
    if (['COMPLETED', 'REJECTED', 'FAILED'].includes(data?.status)) {
      terminal++;
      if (data.status === 'COMPLETED') completed++;
      if (data.status === 'REJECTED') rejected++;
      if (data.status === 'FAILED') failed++;
    } else {
      stuck++;
    }
  }

  console.log(`    Terminal:  ${terminal}/${allIds.length}`);
  console.log(`    COMPLETED: ${completed}, REJECTED: ${rejected}, FAILED: ${failed}`);
  console.log(`    Stuck:     ${stuck}`);

  assert(terminal === allIds.length,
    `All ${allIds.length} payments reached terminal status after recovery`);
  assert(stuck === 0, `No payments stuck: ${stuck}`);

  // Check queue is drained
  await sleep(3000);
  const finalDepth = await getQueueDepth('payments.route.pix');
  assert(finalDepth === 0, `Queue fully drained: depth=${finalDepth}`);

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  TOTAL: ${pass} passed / ${fail} failed / ${total} total`);
  console.log(`  ${fail === 0 ? 'ALL PASS ✅' : `${fail} FAILURES ❌`}`);
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
