import { randomAmount, randomClabe, randomName, randomPurpose } from './utils.js';
import fs from 'node:fs';

function generateSpeiPayload() {
  return {
    amount: randomAmount(),
    currency: 'USD',
    debtor: {
      alias: `SPEI-${randomClabe()}`,
      name: randomName(),
    },
    creditor: {
      alias: `PIX-${Array.from({ length: 12 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('')}`,
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
