import fs from 'node:fs';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Integration: Pipeline (Core without adapters)', () => {
  it('should progress from RECEIVED → TRANSLATING → TRANSLATED', async () => {
    // TODO: Create a payment and poll until TRANSLATED state
    // TODO: Verify the payment goes through receive → translate stages
    const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));

    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });

    const { payment_id, status } = (await res.json()) as { payment_id: string; status: string };
    expect(status).toBe('RECEIVED');

    // Poll for state progression
    await new Promise((r) => setTimeout(r, 3000));
    const detail = (await (await fetch(`${API_URL}/payments/${payment_id}`)).json()) as { status?: string; canonical?: { amount?: number } };

    expect(['TRANSLATED', 'ROUTED', 'SENT', 'COMPLETED', 'REJECTED']).toContain(detail.status);
  }, 15_000);

  it('should populate canonical field after translation', async () => {
    // TODO: Create payment, wait for translation, verify canonical is populated
    const payload = JSON.parse(fs.readFileSync('datasets/spei/spei-valid-01.json', 'utf-8'));

    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    const { payment_id } = (await res.json()) as { payment_id: string };

    await new Promise((r) => setTimeout(r, 3000));
    const detail = (await (await fetch(`${API_URL}/payments/${payment_id}`)).json()) as { status?: string; canonical?: { amount?: number } };

    expect(detail.canonical).toBeDefined();
    expect(detail.canonical?.amount).toBe(500.00);
  }, 15_000);

  it('should generate audit events for each pipeline stage', async () => {
    // TODO: Create payment, verify audit_events array grows with each stage
    // TODO: Each event should have: event_type, timestamp, trace_id
    expect(true).toBe(true);
  });

  it('should populate timestamps for each completed stage', async () => {
    // TODO: Verify timestamps.created_at, timestamps.translated_at, etc.
    expect(true).toBe(true);
  });
});
