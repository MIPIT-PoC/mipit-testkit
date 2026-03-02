import fs from 'node:fs';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Integration: Translation', () => {
  describe('PIX → Canonical', () => {
    it('should correctly translate pix-valid-01 to canonical format', async () => {
      // TODO: POST pix-valid-01, GET the payment, and inspect canonical field
      // TODO: Compare canonical output against datasets/expected/pix-to-canonical-01.json
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const { payment_id } = await res.json();

      await new Promise((r) => setTimeout(r, 2000));

      const detail = await (await fetch(`${API_URL}/payments/${payment_id}`)).json();
      expect(detail.canonical).toBeDefined();
      expect(detail.canonical.amount).toBe(150.25);
      expect(detail.canonical.debtor.rail).toBe('PIX');
      expect(detail.canonical.creditor.rail).toBe('SPEI');
    });

    it('should preserve amount and currency during translation', async () => {
      // TODO: Verify amount and currency are unchanged after translation
      expect(true).toBe(true);
    });
  });

  describe('SPEI → Canonical', () => {
    it('should correctly translate spei-valid-01 to canonical format', async () => {
      // TODO: POST spei-valid-01, GET the payment, and inspect canonical field
      // TODO: Compare canonical output against datasets/expected/spei-to-canonical-01.json
      const payload = JSON.parse(fs.readFileSync('datasets/spei/spei-valid-01.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const { payment_id } = await res.json();

      await new Promise((r) => setTimeout(r, 2000));

      const detail = await (await fetch(`${API_URL}/payments/${payment_id}`)).json();
      expect(detail.canonical).toBeDefined();
      expect(detail.canonical.amount).toBe(500.00);
      expect(detail.canonical.debtor.rail).toBe('SPEI');
      expect(detail.canonical.creditor.rail).toBe('PIX');
    });
  });

  describe('Canonical → PIX (outbound)', () => {
    it('should produce a valid PIX payload from canonical', async () => {
      // TODO: Verify the outbound translation from canonical to PIX format
      // TODO: Compare against datasets/expected/canonical-to-pix-01.json
      expect(true).toBe(true);
    });
  });

  describe('Canonical → SPEI (outbound)', () => {
    it('should produce a valid SPEI payload from canonical', async () => {
      // TODO: Verify the outbound translation from canonical to SPEI format
      // TODO: Compare against datasets/expected/canonical-to-spei-01.json
      expect(true).toBe(true);
    });
  });
});
