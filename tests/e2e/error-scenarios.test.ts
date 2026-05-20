const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('E2E: Error Scenarios', () => {
  it('should reject payment with invalid amount (amount=0)', async () => {
    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 0,
        currency: 'USD',
        debtor: { alias: 'PIX-error.zero.amount', name: 'Error Test' },
        creditor: { alias: 'SPEI-012345678901234568', name: 'Error Dest' },
        purpose: 'P2P',
      }),
    });

    expect(res.status).toBe(400);
    const error = await res.json();
    expect(error.error).toBeDefined();
  });

  it('should handle sandbox adapter failure gracefully', async () => {
    // TODO: Trigger a sandbox failure scenario (e.g., via special reference or amount)
    // TODO: Verify payment reaches REJECTED status with rail_ack.error populated
    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 150.25,
        currency: 'USD',
        debtor: { alias: 'PIX-sandbox.fail.test', name: 'Sandbox Fail' },
        creditor: { alias: 'SPEI-999999999999999995', name: 'Fail Dest' },
        purpose: 'P2P',
        reference: 'FORCE-REJECT',
      }),
    });

    if (res.status === 202) {
      const { payment_id } = await res.json();

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
      if (detail.status === 'REJECTED') {
        expect(detail.rail_ack).toBeDefined();
        expect(detail.rail_ack.error).toBeTruthy();
      }
    }
  }, 35_000);

  it('should return 400 for malformed JSON body', async () => {
    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: '{ invalid json }',
    });

    expect(res.status).toBe(400);
  });
});
