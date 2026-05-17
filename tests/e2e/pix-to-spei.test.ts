const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('E2E: PIX → SPEI', () => {
  it('should complete a PIX to SPEI payment end-to-end', async () => {
    const createRes = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 150.25,
        currency: 'USD',
        debtor: { alias: 'PIX-alice.silva.2026', name: 'Alice Silva' },
        creditor: { alias: 'SPEI-012345678901234568', name: 'Bob García' },
        purpose: 'P2P',
        reference: 'E2E-TEST',
      }),
    });

    expect(createRes.status).toBe(202);
    const { payment_id, status, destination } = await createRes.json();
    expect(payment_id).toMatch(/^PMT-/);
    expect(status).toBe('RECEIVED');
    expect(destination).toBe('SPEI');

    let detail;
    const maxWait = 30_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const getRes = await fetch(`${API_URL}/payments/${payment_id}`);
      detail = await getRes.json();

      if (['COMPLETED', 'REJECTED', 'FAILED'].includes(detail.status)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(detail).toBeDefined();
    expect(['COMPLETED', 'REJECTED']).toContain(detail.status);
    expect(detail.origin).toBe('PIX');
    expect(detail.destination).toBe('SPEI');

    expect(detail.original).toBeTruthy();
    expect(detail.canonical).toBeTruthy();

    expect(detail.timestamps.created_at).toBeTruthy();

    if (detail.status === 'COMPLETED') {
      expect(detail.rail_ack).toBeTruthy();
      expect(detail.rail_ack.status).toBe('ACCEPTED');
      expect(detail.rail_ack.rail_tx_id).toMatch(/^SPEI-/);
    }
  }, 35_000);

  it('should handle idempotency (same key = same response)', async () => {
    const idempotencyKey = crypto.randomUUID();
    const body = {
      amount: 100,
      currency: 'USD',
      debtor: { alias: 'PIX-test.idem.key', name: 'Test' },
      creditor: { alias: 'SPEI-111111111111111115', name: 'Test Dest' },
    };

    const res1 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const data2 = await res2.json();

    expect(data1.payment_id).toBe(data2.payment_id);
  });

  it('should reject different payload with same idempotency key', async () => {
    const idempotencyKey = crypto.randomUUID();

    await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        amount: 200,
        currency: 'USD',
        debtor: { alias: 'PIX-conflict.test' },
        creditor: { alias: 'SPEI-222222222222222220' },
      }),
    });

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        amount: 999,
        currency: 'USD',
        debtor: { alias: 'PIX-conflict.test' },
        creditor: { alias: 'SPEI-333333333333333335' },
      }),
    });

    expect(res2.status).toBe(409);
  });
});
