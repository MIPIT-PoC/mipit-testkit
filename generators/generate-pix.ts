import { randomAmount, randomPixKey, randomName, randomPurpose } from './utils.js';
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
    currency: 'USD',
    debtor: {
      alias: `PIX-${randomPixKey()}`,
      name: randomName(),
    },
    creditor: {
      alias: `SPEI-${Array.from({ length: 18 }, () => Math.floor(Math.random() * 10)).join('')}`,
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
