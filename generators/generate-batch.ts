import { randomAmount, randomPixKey, randomClabe, randomName, randomPurpose } from './utils.js';
import fs from 'node:fs';

type Rail = 'PIX' | 'SPEI';

function generateMixedPayload() {
  const originRail: Rail = Math.random() > 0.5 ? 'PIX' : 'SPEI';
  const destRail: Rail = originRail === 'PIX' ? 'SPEI' : 'PIX';

  const debtorAlias = originRail === 'PIX'
    ? `PIX-${randomPixKey()}`
    : `SPEI-${randomClabe()}`;

  const creditorAlias = destRail === 'PIX'
    ? `PIX-${randomPixKey()}`
    : `SPEI-${randomClabe()}`;

  return {
    amount: randomAmount(),
    currency: 'USD',
    debtor: { alias: debtorAlias, name: randomName() },
    creditor: { alias: creditorAlias, name: randomName() },
    purpose: randomPurpose(),
    reference: `MIPIT-BATCH-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  };
}

const count = parseInt(process.argv[2] ?? '50', 10);
const output = Array.from({ length: count }, generateMixedPayload);

const filename = `datasets/batch-mixed-${count}.json`;
fs.mkdirSync('datasets', { recursive: true });
fs.writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(`Generated ${count} mixed PIX/SPEI payloads → ${filename}`);
