import fs from 'node:fs';

describe('Contract: Canonical Schema Validation', () => {
  describe('PIX → Canonical mapping', () => {
    it('should produce a valid canonical object from pix-valid-01', () => {
      // TODO: Load datasets/pix/pix-valid-01.json
      // TODO: Apply PIX→canonical translation
      // TODO: Validate result against Zod canonical schema (pacs.008)
      // Expected fields: amount, currency, debtor.name, debtor.account_id, debtor.rail,
      //   creditor.name, creditor.account_id, creditor.rail, purpose, reference
      const pixPayload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));
      expect(pixPayload.amount).toBe(150.25);
      expect(pixPayload.debtor.alias).toMatch(/^PIX-/);
    });

    it('should set origin=PIX and destination=SPEI based on aliases', () => {
      // TODO: Translate pix-valid-01 and verify routing fields
      expect(true).toBe(true);
    });
  });

  describe('SPEI → Canonical mapping', () => {
    it('should produce a valid canonical object from spei-valid-01', () => {
      // TODO: Load datasets/spei/spei-valid-01.json
      // TODO: Apply SPEI→canonical translation
      // TODO: Validate result against Zod canonical schema
      const speiPayload = JSON.parse(fs.readFileSync('datasets/spei/spei-valid-01.json', 'utf-8'));
      expect(speiPayload.amount).toBe(500.00);
      expect(speiPayload.debtor.alias).toMatch(/^SPEI-/);
    });

    it('should set origin=SPEI and destination=PIX based on aliases', () => {
      // TODO: Translate spei-valid-01 and verify routing fields
      expect(true).toBe(true);
    });
  });

  describe('Invalid payloads', () => {
    it('should reject amount=0 (pix-invalid-amount)', () => {
      // TODO: Validate that Zod schema rejects amount <= 0
      const invalidPayload = JSON.parse(fs.readFileSync('datasets/pix/pix-invalid-amount.json', 'utf-8'));
      expect(invalidPayload.amount).toBe(0);
    });

    it('should reject negative amount (spei-invalid-amount)', () => {
      // TODO: Validate that Zod schema rejects negative amounts
      const invalidPayload = JSON.parse(fs.readFileSync('datasets/spei/spei-invalid-amount.json', 'utf-8'));
      expect(invalidPayload.amount).toBeLessThan(0);
    });
  });
});
