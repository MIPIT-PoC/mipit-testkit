/**
 * P10 — PIX dataset generator.
 *
 * Audit finding G2: previous version emitted random base64-ish strings as
 * "PIX keys" and 18 random digits as a CLABE. Real adapters / DICT / STP
 * would reject 9/10 of those. Now we use the new validating generators in
 * `./utils.ts`.
 *
 * Output: PIX→SPEI test payloads (BRL→MXN with implicit FX) using checksum-
 * bearing PIX keys (CPF / phone / email / EVP) and valid CLABEs.
 */
import {
  randomAmount,
  randomPixKey,
  randomClabe,
  randomName,
  randomPurpose,
} from './utils.js';
import fs from 'node:fs';

interface PixDataset {
  amount: number;
  currency: string;
  debtor: { alias: string; name: string };
  creditor: { alias: string; name: string };
  purpose: string;
  reference: string;
}

function generatePixPayload(): PixDataset {
  return {
    amount: randomAmount(),
    // P10 — PIX uses BRL natively; canonical normalization handles FX.
    currency: 'BRL',
    debtor: {
      // P10 — `PIX-` prefix is the PoC convention; payload is a valid DICT key.
      alias: `PIX-${randomPixKey()}`,
      name: randomName(),
    },
    creditor: {
      // P10 — Mexican CLABE with proper mod-10 check digit.
      alias: `SPEI-${randomClabe()}`,
      name: randomName(),
    },
    purpose: randomPurpose(),
    reference: `MIPIT-POC-${Date.now()}`,
  };
}

const count = parseInt(process.argv[2] ?? '10', 10);
const output = Array.from({ length: count }, generatePixPayload);

const filename = `datasets/pix/pix-generated-${count}.json`;
fs.mkdirSync('datasets/pix', { recursive: true });
fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(`Generated ${count} PIX payloads → ${filename}`);
