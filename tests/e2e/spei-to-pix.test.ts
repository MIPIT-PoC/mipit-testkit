const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('E2E: SPEI → PIX', () => {
  it('should complete a SPEI to PIX payment end-to-end', async () => {
    const createRes = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 500.00,
        currency: 'USD',
        debtor: { alias: 'SPEI-987654321098765437', name: 'Carlos Rodríguez' },
        creditor: { alias: 'PIX-fernanda.pereira.br', name: 'Fernanda Pereira' },
        purpose: 'REMITTANCE',
        reference: 'E2E-SPEI-PIX-TEST',
      }),
    });

    expect(createRes.status).toBe(202);
    const { payment_id, status, destination } = await createRes.json();
    expect(payment_id).toMatch(/^PMT-/);
    expect(status).toBe('RECEIVED');
    expect(destination).toBe('PIX');

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
    expect(detail.origin).toBe('SPEI');
    expect(detail.destination).toBe('PIX');

    expect(detail.original).toBeTruthy();
    expect(detail.canonical).toBeTruthy();

    expect(detail.timestamps.created_at).toBeTruthy();

    if (detail.status === 'COMPLETED') {
      expect(detail.rail_ack).toBeTruthy();
      expect(detail.rail_ack.status).toBe('ACCEPTED');
      expect(detail.rail_ack.rail_tx_id).toMatch(/^PIX-/);
    }
  }, 35_000);

  it('should handle idempotency (same key = same response)', async () => {
    const idempotencyKey = crypto.randomUUID();
    const body = {
      amount: 250,
      currency: 'USD',
      debtor: { alias: 'SPEI-111111111111111115', name: 'Test SPEI' },
      creditor: { alias: 'PIX-test.idem.spei', name: 'Test PIX' },
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
        amount: 300,
        currency: 'USD',
        debtor: { alias: 'SPEI-222222222222222220' },
        creditor: { alias: 'PIX-conflict.spei.test' },
      }),
    });

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        amount: 888,
        currency: 'USD',
        debtor: { alias: 'SPEI-333333333333333335' },
        creditor: { alias: 'PIX-conflict.spei.other' },
      }),
    });

    expect(res2.status).toBe(409);
  });
});
