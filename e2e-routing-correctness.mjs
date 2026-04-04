#!/usr/bin/env node
/**
 * MIPIT Routing Correctness Test
 * 
 * Verifies that N payments destined to PIX all arrive at PIX,
 * and N payments destined to BRE_B all arrive at BRE_B.
 * No cross-contamination, no lost payments.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }

const RAILS_TO_TEST = (process.argv[2] || 'PIX,SPEI,BRE_B').split(',');
const PER_RAIL = parseInt(process.argv[3] || '333', 10);
const CONCURRENCY = parseInt(process.argv[4] || '15', 10);
const POLL_WAIT_MS = parseInt(process.argv[5] || '15000', 10);

const PIX_DEST_ALIASES = [
  'PIX-joao@email.com',
  'PIX-maria@banco.br',
  'PIX-pedro@pix.com',
  'PIX-ana@gmail.com',
  'PIX-lucas@hotmail.com',
];

const BREB_DEST_ALIASES = [
  'BREB-+573001234567',
  'BREB-+573205551234',
  'BREB-+573109876543',
  'BREB-+573004445566',
  'BREB-+573007778899',
];

const SPEI_DEST_ALIASES = [
  'SPEI-012180000118359784',
  'SPEI-014180000228456711',
  'SPEI-002180000334567894',
  'SPEI-012180000445678905',
  'SPEI-002180000556789010',
];

const SPEI_ORIGIN = 'SPEI-014180000228456711';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

function getAliasesForRail(rail) {
  switch (rail) {
    case 'PIX': return PIX_DEST_ALIASES;
    case 'SPEI': return SPEI_DEST_ALIASES;
    case 'BRE_B': return BREB_DEST_ALIASES;
    default: return PIX_DEST_ALIASES;
  }
}

async function createPayment(idx, expectedRail) {
  const aliases = getAliasesForRail(expectedRail);
  const destAlias = aliases[idx % aliases.length];
  const idemKey = `routing-${expectedRail}-${idx}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': idemKey },
    body: JSON.stringify({
      amount: 1000 + idx,
      currency: 'MXN',
      debtor: { alias: SPEI_ORIGIN, name: `Sender-${expectedRail}-${idx}` },
      creditor: { alias: destAlias, name: `Receiver-${expectedRail}-${idx}` },
      purpose: 'ROUTING_TEST',
      reference: `rt-${expectedRail}-${idx}`,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { idx, expectedRail, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
  }

  const data = await res.json();
  return {
    idx,
    expectedRail,
    paymentId: data.payment_id,
    destAlias,
    createdDestRail: data.destination_rail,
  };
}

async function checkPayment(paymentId) {
  const res = await fetch(`${BASE_URL}/payments/${paymentId}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function runBatch(items, fn) {
  const results = [];
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    i += CONCURRENCY;
  }
  return results;
}

async function main() {
  const totalPayments = PER_RAIL * RAILS_TO_TEST.length;

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  MIPIT Routing Correctness Test');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Rails tested:      ${RAILS_TO_TEST.join(', ')}`);
  console.log(`  Payments per rail: ${PER_RAIL}`);
  console.log(`  Total payments:    ${totalPayments}`);
  console.log(`  Concurrency:       ${CONCURRENCY}`);
  console.log(`  Origin:            SPEI`);
  console.log('════════════════════════════════════════════════════════');
  console.log('');

  // ─── Phase 1: Create all payments ───
  console.log('Phase 1: Creating payments...');
  const createStart = performance.now();

  const allJobs = [];
  for (const rail of RAILS_TO_TEST) {
    for (let i = 0; i < PER_RAIL; i++) {
      allJobs.push({ idx: i, rail });
    }
  }

  // Shuffle to interleave PIX and BRE_B (real-world pattern)
  for (let i = allJobs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allJobs[i], allJobs[j]] = [allJobs[j], allJobs[i]];
  }

  const createResults = await runBatch(allJobs, (job) => createPayment(job.idx, job.rail));

  const createTime = Math.round(performance.now() - createStart);
  const created = createResults.filter(r => r.paymentId);
  const createErrors = createResults.filter(r => r.error);

  console.log(`  Created: ${created.length} / ${totalPayments} in ${createTime}ms`);
  if (createErrors.length > 0) {
    console.log(`  Creation errors: ${createErrors.length}`);
    createErrors.slice(0, 5).forEach(e => console.log(`    [${e.expectedRail}-${e.idx}] ${e.error}`));
  }

  // ─── Phase 2: Wait for adapter processing ───
  console.log('');
  console.log(`Phase 2: Waiting ${POLL_WAIT_MS}ms for adapters to process...`);
  await new Promise(r => setTimeout(r, POLL_WAIT_MS));

  // ─── Phase 3: Verify routing ───
  console.log('');
  console.log('Phase 3: Verifying routing correctness...');
  const verifyStart = performance.now();

  const verifyResults = await runBatch(created, async (payment) => {
    const detail = await checkPayment(payment.paymentId);
    return {
      ...payment,
      actualDestRail: detail?.destination_rail ?? 'UNKNOWN',
      status: detail?.status ?? 'UNKNOWN',
      railAckStatus: detail?.rail_ack?.status ?? 'N/A',
      railAckError: detail?.rail_ack?.error_code ?? '',
    };
  });

  const verifyTime = Math.round(performance.now() - verifyStart);

  // ─── Phase 4: Analyze results ───
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  ROUTING CORRECTNESS RESULTS');
  console.log('════════════════════════════════════════════════════════');

  let correctRoutes = 0;
  let misrouted = 0;
  let lost = 0;
  const misroutedDetails = [];
  const lostDetails = [];

  const railResults = {};
  for (const rail of RAILS_TO_TEST) {
    railResults[rail] = { correct: 0, misrouted: 0, lost: 0, completed: 0, rejected: 0, failed: 0, queued: 0, other: 0 };
  }

  for (const r of verifyResults) {
    const bucket = railResults[r.expectedRail] ?? railResults[RAILS_TO_TEST[0]];

    if (r.actualDestRail === 'UNKNOWN') {
      lost++;
      bucket.lost++;
      lostDetails.push(r);
    } else if (r.actualDestRail === r.expectedRail) {
      correctRoutes++;
      bucket.correct++;
    } else {
      misrouted++;
      bucket.misrouted++;
      misroutedDetails.push(r);
    }

    switch (r.status) {
      case 'COMPLETED': bucket.completed++; break;
      case 'REJECTED': bucket.rejected++; break;
      case 'FAILED': bucket.failed++; break;
      case 'QUEUED': case 'ROUTED': case 'CANONICALIZED': bucket.queued++; break;
      default: bucket.other++; break;
    }
  }

  const totalVerified = verifyResults.length;
  const routingAccuracy = totalVerified > 0 ? ((correctRoutes / totalVerified) * 100).toFixed(2) : '0';

  console.log('');
  console.log(`  Total verified:     ${totalVerified}`);
  console.log(`  Correctly routed:   ${correctRoutes}`);
  console.log(`  Misrouted:          ${misrouted}`);
  console.log(`  Lost (unknown):     ${lost}`);
  console.log(`  Routing accuracy:   ${routingAccuracy}%`);

  for (const rail of RAILS_TO_TEST) {
    const r = railResults[rail];
    console.log('');
    console.log(`  ── ${rail} destination ──`);
    console.log(`    Expected:   ${PER_RAIL}`);
    console.log(`    Correct:    ${r.correct}`);
    console.log(`    Misrouted:  ${r.misrouted}`);
    console.log(`    Lost:       ${r.lost}`);
    console.log(`    Statuses:   COMPLETED=${r.completed} REJECTED=${r.rejected} FAILED=${r.failed} QUEUED=${r.queued}`);
  }

  if (misroutedDetails.length > 0) {
    console.log('');
    console.log(`  MISROUTED PAYMENTS (${misroutedDetails.length}):`);
    misroutedDetails.slice(0, 20).forEach(r => {
      console.log(`    ${r.paymentId}: expected=${r.expectedRail} actual=${r.actualDestRail} alias=${r.destAlias}`);
    });
    if (misroutedDetails.length > 20) {
      console.log(`    ... and ${misroutedDetails.length - 20} more`);
    }
  }

  if (lostDetails.length > 0) {
    console.log('');
    console.log(`  LOST PAYMENTS (${lostDetails.length}):`);
    lostDetails.slice(0, 10).forEach(r => {
      console.log(`    ${r.paymentId}: expected=${r.expectedRail} alias=${r.destAlias}`);
    });
  }

  console.log('');
  console.log(`  Timings: create=${createTime}ms verify=${verifyTime}ms`);
  console.log('════════════════════════════════════════════════════════');

  // Exit code: 0 if 100% routing accuracy, 1 otherwise
  if (misrouted > 0 || lost > 0) {
    console.log('');
    console.log('  VERDICT: FAIL — routing integrity compromised');
    process.exit(1);
  } else {
    console.log('');
    console.log('  VERDICT: PASS — all payments routed correctly');
    process.exit(0);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
