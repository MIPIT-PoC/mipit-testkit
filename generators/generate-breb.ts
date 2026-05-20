/**
 * P10 — Bre-B dataset generator (NEW, was missing entirely per audit G3).
 *
 * Bre-B is Colombia's BanRep instant payment rail launched 2025-09 and
 * generally available 2025-10-06. The PoC routes COP-native traffic
 * through it. This generator picks a random destination rail (PIX or SPEI)
 * so we exercise the 6 directional rail-pairs (BRE_B→PIX and BRE_B→SPEI;
 * the inverse pairs are produced by generate-pix.ts / generate-spei.ts
 * with the `--breb` flag and by generate-batch.ts).
 *
 * Bre-B llaves accepted:
 *   - CC (cédula 8-10 digits)
 *   - NIT (9-10 digits + DIAN mod-11 check)
 *   - +57 mobile (`+57` + `3` + 9 digits — mobile-only per BanRep TR-002)
 *   - email
 *   - ALIAS (`@` + alphanumeric/._)
 */
import {
  randomAmount,
  randomBrebKey,
  randomPixKey,
  randomClabe,
  randomName,
  randomPurpose,
} from './utils.js';
import fs from 'node:fs';

type DestRail = 'PIX' | 'SPEI';

interface BrebDataset {
  amount: number;
  currency: string;
  debtor: { alias: string; name: string };
  creditor: { alias: string; name: string };
  purpose: string;
  reference: string;
}

function generateBrebPayload(dest: DestRail | 'RANDOM' = 'RANDOM'): BrebDataset {
  const chosenDest: DestRail =
    dest === 'RANDOM' ? (Math.random() > 0.5 ? 'PIX' : 'SPEI') : dest;

  const creditorAlias =
    chosenDest === 'PIX'
      ? `PIX-${randomPixKey()}`
      : `SPEI-${randomClabe()}`;

  return {
    amount: randomAmount(),
    // P10 — Bre-B native currency is COP.
    currency: 'COP',
    debtor: {
      alias: `BREB-${randomBrebKey()}`,
      name: randomName(),
    },
    creditor: {
      alias: creditorAlias,
      name: randomName(),
    },
    purpose: randomPurpose(),
    reference: `MIPIT-POC-${Date.now()}`,
  };
}

// CLI: `tsx generate-breb.ts <count> [PIX|SPEI|RANDOM]`
const count = parseInt(process.argv[2] ?? '10', 10);
const destArg = (process.argv[3] ?? 'RANDOM').toUpperCase() as DestRail | 'RANDOM';
const output = Array.from({ length: count }, () => generateBrebPayload(destArg));

const tag = destArg === 'RANDOM' ? 'mixed' : destArg.toLowerCase();
const filename = `datasets/breb/breb-to-${tag}-${count}.json`;
fs.mkdirSync('datasets/breb', { recursive: true });
fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(`Generated ${count} Bre-B → ${destArg} payloads → ${filename}`);
