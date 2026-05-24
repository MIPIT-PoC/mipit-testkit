/**
 * @file generate-batch.ts
 * @description Mixed batch generator that emits uniform random payloads across all 6 directional rail-pairs (PIX/SPEI/BRE_B) for load and routing tests.
 * @author María Camila Osuna
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
/**
 * P10 — Mixed batch generator covering all 6 directional rail-pairs.
 *
 * Audit G3: previous version only knew about PIX↔SPEI (2 of 6 pairs).
 * Now produces a uniform random mix across:
 *   PIX→SPEI, PIX→BRE_B,
 *   SPEI→PIX, SPEI→BRE_B,
 *   BRE_B→PIX, BRE_B→SPEI
 * All payloads use checksum-validating generators from `./utils.ts`.
 */
import {
  randomAmount,
  randomPixKey,
  randomClabe,
  randomBrebKey,
  randomName,
  randomPurpose,
} from './utils.js';
import fs from 'node:fs';
import { randomInt } from 'node:crypto';

type Rail = 'PIX' | 'SPEI' | 'BRE_B';

const RAIL_NATIVE_CURRENCY: Record<Rail, string> = {
  PIX: 'BRL',
  SPEI: 'MXN',
  BRE_B: 'COP',
};

function aliasFor(rail: Rail): string {
  switch (rail) {
    case 'PIX':
      return `PIX-${randomPixKey()}`;
    case 'SPEI':
      return `SPEI-${randomClabe()}`;
    case 'BRE_B':
      return `BREB-${randomBrebKey()}`;
  }
}

function pickDistinctPair(): [Rail, Rail] {
  const rails: Rail[] = ['PIX', 'SPEI', 'BRE_B'];
  const origin = rails[randomInt(rails.length)];
  let destination = rails[randomInt(rails.length)];
  while (destination === origin) destination = rails[randomInt(rails.length)];
  return [origin, destination];
}

function generateMixedPayload() {
  const [origin, destination] = pickDistinctPair();
  return {
    amount: randomAmount(),
    // P10 — currency is the origin rail's native ISO 4217; the canonical
    // pipeline normalizes via the FX rules in mipit-core (P05).
    currency: RAIL_NATIVE_CURRENCY[origin],
    debtor: { alias: aliasFor(origin), name: randomName() },
    creditor: { alias: aliasFor(destination), name: randomName() },
    purpose: randomPurpose(),
    reference: `MIPIT-BATCH-${Date.now()}-${randomInt(1_000_000)}`,
    // P10 — keep the routing intent in the payload so report tools can
    // group results by rail-pair without re-parsing aliases.
    _expectedRoute: `${origin}->${destination}`,
  };
}

const count = parseInt(process.argv[2] ?? '50', 10);
const output = Array.from({ length: count }, generateMixedPayload);

const filename = `datasets/batch-mixed-${count}.json`;
fs.mkdirSync('datasets', { recursive: true });
fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(`Generated ${count} mixed PIX/SPEI/BRE_B payloads → ${filename}`);
