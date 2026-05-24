/**
 * @file generate-spei.ts
 * @description SPEI→PIX test dataset generator (MXN→BRL) emitting CLABE accounts with valid mod-10 weighted check digit and DICT-shaped PIX keys on the creditor side.
 * @author María Camila Osuna
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
/**
 * P10 — SPEI dataset generator.
 *
 * Audit finding G2: was emitting 18 *random* digits as CLABE (no mod-10
 * weighted checksum) and 12 base64-ish chars as a "PIX key". Now uses the
 * validating generators in `./utils.ts`.
 *
 * Output: SPEI→PIX test payloads (MXN→BRL) with proper CLABE check digit
 * and a real DICT-shaped PIX key on the creditor side.
 */
import {
  randomAmount,
  randomClabe,
  randomPixKey,
  randomName,
  randomPurpose,
} from './utils.js';
import fs from 'node:fs';

interface SpeiDataset {
  amount: number;
  currency: string;
  debtor: { alias: string; name: string };
  creditor: { alias: string; name: string };
  purpose: string;
  reference: string;
}

function generateSpeiPayload(): SpeiDataset {
  return {
    amount: randomAmount(),
    // P10 — SPEI native currency is MXN.
    currency: 'MXN',
    debtor: {
      alias: `SPEI-${randomClabe()}`,
      name: randomName(),
    },
    creditor: {
      alias: `PIX-${randomPixKey()}`,
      name: randomName(),
    },
    purpose: randomPurpose(),
    reference: `MIPIT-POC-${Date.now()}`,
  };
}

const count = parseInt(process.argv[2] ?? '10', 10);
const output = Array.from({ length: count }, generateSpeiPayload);

const filename = `datasets/spei/spei-generated-${count}.json`;
fs.mkdirSync('datasets/spei', { recursive: true });
fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(`Generated ${count} SPEI payloads → ${filename}`);
