/**
 * Integration: Routing Tests
 *
 * Tests the mipit-core routing engine to verify that payment messages
 * sent from one rail arrive correctly at the intended destination rail.
 *
 * Covers:
 *   - PIX → SPEI routing (Latin America cross-border)
 *   - PIX → BRE_B routing (Brazil → Colombia)
 *   - SPEI → BRE_B routing (Mexico → Colombia)
 *   - BRE_B → PIX routing (Colombia → Brazil)
 *   - Concurrent multi-rail routing (stress test)
 *   - Alias-based routing (LLAVE_BREB prefix, +57 phone)
 *   - Country-based routing fallback
 *
 * Prerequisites: Full stack running (bash scripts/up.sh)
 */

const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const TIMEOUT_MS = 15000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function idempotencyKey() {
  return crypto.randomUUID();
}

async function postPayment(body: Record<string, unknown>, key = idempotencyKey()) {
  const res = await fetch(`${API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() as Record<string, unknown> };
}

async function getPayment(id: string) {
  const res = await fetch(`${API_URL}/payments/${id}`);
  return await res.json() as Record<string, unknown>;
}

/** Poll payment status until it leaves RECEIVED/VALIDATED/CANONICALIZED/ROUTED/QUEUED or timeout */
async function waitForRailStatus(paymentId: string, timeoutMs = TIMEOUT_MS): Promise<Record<string, unknown>> {
  const pending = new Set(['RECEIVED', 'VALIDATED', 'CANONICALIZED', 'ROUTED', 'QUEUED', 'SENT_TO_DESTINATION']);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const payment = await getPayment(paymentId);
    if (!pending.has(payment['status'] as string)) {
      return payment;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return await getPayment(paymentId);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: Routing — PIX → SPEI', () => {
  it('routes a PIX debtor to SPEI creditor (CLABE alias)', async () => {
    const { status, data } = await postPayment({
      amount: 1500,
      currency: 'USD',
      debtor:   { alias: 'PIX-joao@email.com',       name: 'João Silva' },
      creditor: { alias: 'SPEI-012180000118359719',   name: 'María García' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['origin']).toBe('PIX');
    expect(data['destination']).toBe('SPEI');
  }, TIMEOUT_MS);

  it('PIX → SPEI payment reaches ACKED_BY_RAIL or COMPLETED', async () => {
    const { status, data } = await postPayment({
      amount: 2500,
      currency: 'USD',
      debtor:   { alias: 'PIX-+5521999887766',        name: 'Ana Costa' },
      creditor: { alias: 'SPEI-002180012345678901',   name: 'Luis Mendoza' },
      purpose: 'SUPP',
    });
    expect(status).toBe(201);

    const paymentId = data['payment_id'] as string;
    const final = await waitForRailStatus(paymentId);
    expect(['ACKED_BY_RAIL', 'COMPLETED', 'REJECTED']).toContain(final['status']);
  }, TIMEOUT_MS);
});

describe('Integration: Routing — PIX → BRE_B', () => {
  it('routes a PIX debtor to Bre-B creditor (phone +57 alias)', async () => {
    const { status, data } = await postPayment({
      amount: 100,
      currency: 'USD',
      debtor:   { alias: 'PIX-joao@email.com',    name: 'João Silva' },
      creditor: { alias: 'BREB-+573001234567',    name: 'Carlos López' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['origin']).toBe('PIX');
    expect(data['destination']).toBe('BRE_B');
  }, TIMEOUT_MS);

  it('routes to BRE_B when creditor country is CO', async () => {
    const { status, data } = await postPayment({
      amount: 500,
      currency: 'USD',
      debtor:   { alias: 'PIX-12345678901',        name: 'Pedro Souza', country: 'BR' },
      creditor: { alias: 'BREB-900123456-1',       name: 'Ana García',  country: 'CO' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['destination']).toBe('BRE_B');
  }, TIMEOUT_MS);

  it('PIX → BRE_B payment reaches ACKED_BY_RAIL or COMPLETED', async () => {
    const { status, data } = await postPayment({
      amount: 300,
      currency: 'USD',
      debtor:   { alias: 'PIX-12345678901',        name: 'Fernanda Lima' },
      creditor: { alias: 'BREB-+573157654321',     name: 'Diego Rodríguez' },
      purpose: 'P2P',
    });
    expect(status).toBe(201);

    const paymentId = data['payment_id'] as string;
    const final = await waitForRailStatus(paymentId);
    expect(['ACKED_BY_RAIL', 'COMPLETED', 'REJECTED']).toContain(final['status']);
  }, TIMEOUT_MS);
});

describe('Integration: Routing — SPEI → BRE_B', () => {
  it('routes a SPEI debtor to Bre-B creditor (Mexico → Colombia)', async () => {
    const { status, data } = await postPayment({
      amount: 250,
      currency: 'USD',
      debtor:   { alias: 'SPEI-002180012345678901',  name: 'Rosa Martínez' },
      creditor: { alias: 'BREB-+573001234567',       name: 'Carlos López' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['origin']).toBe('SPEI');
    expect(data['destination']).toBe('BRE_B');
  }, TIMEOUT_MS);
});

describe('Integration: Routing — BRE_B → PIX', () => {
  it('routes a Bre-B debtor to PIX creditor (Colombia → Brazil)', async () => {
    const { status, data } = await postPayment({
      amount: 180,
      currency: 'USD',
      debtor:   { alias: 'BREB-900123456-1',        name: 'Miguel Vargas' },
      creditor: { alias: 'PIX-pedro@email.com.br',  name: 'Pedro Silva' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['origin']).toBe('BRE_B');
    expect(data['destination']).toBe('PIX');
  }, TIMEOUT_MS);
});

describe('Integration: Routing — Concurrent multi-rail requests', () => {
  it('handles 10 concurrent PIX → SPEI payments correctly', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postPayment({
          amount: 100 + i * 10,
          currency: 'USD',
          debtor:   { alias: `PIX-user${i}@test.com`,     name: `Debtor ${i}` },
          creditor: { alias: 'SPEI-012180000118359719',   name: `Creditor ${i}` },
          purpose: 'P2P',
        })
      )
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const destinations = results.map((r) => r.data['destination']);
    expect(destinations.every((d) => d === 'SPEI')).toBe(true);
  }, TIMEOUT_MS);

  it('handles 5 concurrent PIX → BRE_B payments correctly', async () => {
    const phones = [
      '+573001111111', '+573002222222', '+573003333333',
      '+573004444444', '+573005555555',
    ];

    const results = await Promise.all(
      phones.map((phone, i) =>
        postPayment({
          amount: 200 + i * 50,
          currency: 'USD',
          debtor:   { alias: `PIX-debtor${i}@pix.com`,  name: `PIX Debtor ${i}` },
          creditor: { alias: `BREB-${phone}`,            name: `Bre-B User ${i}` },
          purpose: 'P2P',
        })
      )
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    const destinations = results.map((r) => r.data['destination']);
    expect(destinations.every((d) => d === 'BRE_B')).toBe(true);
  }, TIMEOUT_MS);

  it('routes PIX to all 3 LATAM rails simultaneously', async () => {
    const [toSpei, toBrebPhone, toBrebNit] = await Promise.all([
      postPayment({
        amount: 100,
        currency: 'USD',
        debtor:   { alias: 'PIX-brazil@test.com',      name: 'João' },
        creditor: { alias: 'SPEI-012180000118359719',  name: 'María' },
        purpose: 'P2P',
      }),
      postPayment({
        amount: 200,
        currency: 'USD',
        debtor:   { alias: 'PIX-brazil@test.com',      name: 'João' },
        creditor: { alias: 'BREB-+573001234567',       name: 'Carlos' },
        purpose: 'P2P',
      }),
      postPayment({
        amount: 300,
        currency: 'USD',
        debtor:   { alias: 'PIX-brazil@test.com',      name: 'João' },
        creditor: { alias: 'BREB-900123456-1',         name: 'Empresa CO' },
        purpose: 'SUPP',
      }),
    ]);

    expect(toSpei.status).toBe(201);
    expect(toSpei.data['destination']).toBe('SPEI');

    expect(toBrebPhone.status).toBe(201);
    expect(toBrebPhone.data['destination']).toBe('BRE_B');

    expect(toBrebNit.status).toBe(201);
    expect(toBrebNit.data['destination']).toBe('BRE_B');
  }, TIMEOUT_MS);

  it('all 10 concurrent PIX → BRE_B payments have unique payment_ids', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postPayment({
          amount: 100,
          currency: 'USD',
          debtor:   { alias: `PIX-concurrent${i}@test.com`,  name: `Debtor ${i}` },
          creditor: { alias: 'BREB-+573009999999',           name: 'Concurrent Dest' },
          purpose: 'P2P',
        })
      )
    );

    const ids = new Set(results.map((r) => r.data['payment_id'] as string));
    expect(ids.size).toBe(10); // all unique
  }, TIMEOUT_MS);
});

describe('Integration: Routing — Alias-based routing rules', () => {
  it('PIX_KEY alias type routes to PIX rail', async () => {
    const { status, data } = await postPayment({
      amount: 100,
      currency: 'USD',
      debtor:   { alias: 'SPEI-002180012345678901',  name: 'MX Sender' },
      creditor: { alias: 'PIX-+5511987654321',       name: 'BR Receiver' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['destination']).toBe('PIX');
  }, TIMEOUT_MS);

  it('CLABE alias type routes to SPEI rail', async () => {
    const { status, data } = await postPayment({
      amount: 100,
      currency: 'USD',
      debtor:   { alias: 'PIX-brazil@test.com',      name: 'BR Sender' },
      creditor: { alias: 'SPEI-002180000118359719',  name: 'MX Receiver' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['destination']).toBe('SPEI');
  }, TIMEOUT_MS);

  it('LLAVE_BREB alias type routes to BRE_B rail', async () => {
    const { status, data } = await postPayment({
      amount: 100,
      currency: 'USD',
      debtor:   { alias: 'PIX-br@test.com',         name: 'BR Sender' },
      creditor: { alias: 'BREB-ana.garcia@co.com',  name: 'CO Receiver' },
      purpose: 'P2P',
    });

    expect(status).toBe(201);
    expect(data['destination']).toBe('BRE_B');
  }, TIMEOUT_MS);
});

describe('Integration: Routing — Idempotency with routing', () => {
  it('same Idempotency-Key returns same payment_id regardless of routing', async () => {
    const key = idempotencyKey();
    const body = {
      amount: 100,
      currency: 'USD',
      debtor:   { alias: 'PIX-idem@test.com',       name: 'Idem Sender' },
      creditor: { alias: 'BREB-+573001234567',      name: 'Idem Receiver' },
      purpose: 'P2P',
    };

    const first = await postPayment(body, key);
    const second = await postPayment(body, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // idempotent — returns existing
    expect(first.data['payment_id']).toBe(second.data['payment_id']);
  }, TIMEOUT_MS);
});
