import fs from 'node:fs';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Integration: Core API', () => {
  describe('POST /payments', () => {
    it('should accept a valid PIX payment and return 202', async () => {
      // TODO: POST datasets/pix/pix-valid-01.json
      // TODO: Verify response: { payment_id: /^PMT-/, status: 'RECEIVED', destination: 'SPEI' }
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.payment_id).toMatch(/^PMT-/);
      expect(data.status).toBe('RECEIVED');
    });

    it('should accept a valid SPEI payment and return 202', async () => {
      // TODO: POST datasets/spei/spei-valid-01.json
      const payload = JSON.parse(fs.readFileSync('datasets/spei/spei-valid-01.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.payment_id).toMatch(/^PMT-/);
    });

    it('should reject invalid amount with 400', async () => {
      // TODO: POST datasets/pix/pix-invalid-amount.json → expect 400
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-invalid-amount.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
    });

    it('should reject invalid alias with 400', async () => {
      // TODO: POST datasets/pix/pix-invalid-alias.json → expect 400
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-invalid-alias.json', 'utf-8'));

      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /payments/:id', () => {
    it('should return payment detail after creation', async () => {
      // TODO: Create payment, then GET /payments/:id
      // TODO: Verify fields: payment_id, status, origin, destination, canonical, timestamps
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));

      const createRes = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const { payment_id } = await createRes.json();

      const getRes = await fetch(`${API_URL}/payments/${payment_id}`);
      expect(getRes.status).toBe(200);

      const detail = await getRes.json();
      expect(detail.payment_id).toBe(payment_id);
      expect(detail.origin).toBe('PIX');
      expect(detail.destination).toBe('SPEI');
    });

    it('should return 404 for non-existent payment', async () => {
      const res = await fetch(`${API_URL}/payments/PMT-NONEXISTENT`);
      expect(res.status).toBe(404);
    });
  });
});
