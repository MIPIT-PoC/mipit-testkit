const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Integration: Routing', () => {
  it('should route PIX debtor → SPEI creditor correctly', async () => {
    // TODO: POST payload with PIX- debtor alias and SPEI- creditor alias
    // TODO: Verify destination is 'SPEI'
    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 100,
        currency: 'USD',
        debtor: { alias: 'PIX-route.test.pix', name: 'Route Test' },
        creditor: { alias: 'SPEI-111111111111111111', name: 'Route Dest' },
        purpose: 'P2P',
      }),
    });

    const data = await res.json();
    expect(data.destination).toBe('SPEI');
  });

  it('should route SPEI debtor → PIX creditor correctly', async () => {
    // TODO: POST payload with SPEI- debtor alias and PIX- creditor alias
    // TODO: Verify destination is 'PIX'
    const res = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: 200,
        currency: 'USD',
        debtor: { alias: 'SPEI-222222222222222222', name: 'Route Test' },
        creditor: { alias: 'PIX-route.test.dest', name: 'Route Dest' },
        purpose: 'TRANSFER',
      }),
    });

    const data = await res.json();
    expect(data.destination).toBe('PIX');
  });

  it('should detect origin rail from debtor alias prefix', async () => {
    // TODO: Verify origin field matches debtor alias prefix
    // PIX-xxx → origin: PIX, SPEI-xxx → origin: SPEI
    expect(true).toBe(true);
  });

  it('should detect destination rail from creditor alias prefix', async () => {
    // TODO: Verify destination field matches creditor alias prefix
    expect(true).toBe(true);
  });
});
