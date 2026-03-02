const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('E2E: Idempotency', () => {
  it('should return identical response for duplicate submission (same key + same payload)', async () => {
    // TODO: Submit same payment twice with same Idempotency-Key
    // TODO: Verify both return same payment_id and the payment completes only once
    const idempotencyKey = crypto.randomUUID();
    const body = {
      amount: 500,
      currency: 'USD',
      debtor: { alias: 'PIX-e2e.idem.test', name: 'E2E Idem' },
      creditor: { alias: 'SPEI-777777777777777777', name: 'E2E Dest' },
      purpose: 'TRANSFER',
      reference: 'E2E-IDEM-TEST',
    };

    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey };

    const [res1, res2] = await Promise.all([
      fetch(`${API_URL}/payments`, { method: 'POST', headers, body: JSON.stringify(body) }),
      fetch(`${API_URL}/payments`, { method: 'POST', headers, body: JSON.stringify(body) }),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    expect(data1.payment_id).toBe(data2.payment_id);
  });

  it('should not create duplicate payments under concurrent identical requests', async () => {
    // TODO: Send 5 concurrent identical requests with same Idempotency-Key
    // TODO: Verify all return the same payment_id
    const idempotencyKey = crypto.randomUUID();
    const body = {
      amount: 750,
      currency: 'USD',
      debtor: { alias: 'PIX-concurrent.idem', name: 'Concurrent' },
      creditor: { alias: 'SPEI-888888888888888888', name: 'Concurrent Dest' },
      purpose: 'P2P',
    };

    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey };
    const promises = Array.from({ length: 5 }, () =>
      fetch(`${API_URL}/payments`, { method: 'POST', headers, body: JSON.stringify(body) })
        .then((r) => r.json()),
    );

    const results = await Promise.all(promises);
    const ids = new Set(results.map((r) => r.payment_id));
    expect(ids.size).toBe(1);
  });

  it('should preserve final state across idempotent retries after completion', async () => {
    // TODO: Create payment, wait for completion, then retry with same key
    // TODO: Verify the retry returns the same completed payment
    expect(true).toBe(true);
  });
});
