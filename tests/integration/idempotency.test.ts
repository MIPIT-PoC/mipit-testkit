const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Integration: Idempotency', () => {
  it('should return same payment_id for duplicate request with same key', async () => {
    // TODO: Send same payload twice with same Idempotency-Key
    // TODO: Verify both responses have the same payment_id
    const idempotencyKey = crypto.randomUUID();
    const body = {
      amount: 100,
      currency: 'USD',
      debtor: { alias: 'PIX-idem.test.dup', name: 'Idem Test' },
      creditor: { alias: 'SPEI-333333333333333335', name: 'Idem Dest' },
      purpose: 'P2P',
    };

    const res1 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const data1 = (await res1.json()) as { payment_id?: string };

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const data2 = (await res2.json()) as { payment_id?: string };

    expect(data1.payment_id).toBe(data2.payment_id);
  });

  it('should return 409 for different payload with same key', async () => {
    // TODO: Send different payloads with same Idempotency-Key
    // TODO: Verify second response is 409
    const idempotencyKey = crypto.randomUUID();

    await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        amount: 200,
        currency: 'USD',
        debtor: { alias: 'PIX-idem.conflict.a', name: 'Test A' },
        creditor: { alias: 'SPEI-444444444444444440', name: 'Dest A' },
      }),
    });

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        amount: 999,
        currency: 'USD',
        debtor: { alias: 'PIX-idem.conflict.b', name: 'Test B' },
        creditor: { alias: 'SPEI-555555555555555555', name: 'Dest B' },
      }),
    });

    expect(res2.status).toBe(409);
  });

  it('should allow same payload with different keys', async () => {
    // TODO: Send same payload with different Idempotency-Keys
    // TODO: Verify two different payment_ids are returned
    const body = {
      amount: 300,
      currency: 'USD',
      debtor: { alias: 'PIX-idem.diff.keys', name: 'Diff Keys' },
      creditor: { alias: 'SPEI-666666666666666660', name: 'Dest Keys' },
      purpose: 'TRANSFER',
    };

    const res1 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const data1 = (await res1.json()) as { payment_id?: string };

    const res2 = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const data2 = (await res2.json()) as { payment_id?: string };

    expect(data1.payment_id).not.toBe(data2.payment_id);
  });
});
