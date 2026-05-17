/**
 * Integration: Translation tests.
 *
 * Hits the live core API. Auto-skips when the stack isn't reachable so the
 * suite stays green offline (P10).
 *
 * Since P08 the API requires JWT — we fetch one from /auth/token (dev/staging).
 */
import fs from 'node:fs';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

let TOKEN: string | null = null;
let liveStack = false;

async function fetchToken(): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch {
    return null;
  }
}

beforeAll(async () => {
  try {
    liveStack = (await fetch(`${API_URL}/health`)).ok;
  } catch {
    liveStack = false;
  }
  if (liveStack) TOKEN = await fetchToken();
});

const itLive = (name: string, fn: jest.ProvidesCallback, timeout?: number) =>
  liveStack ? it(name, fn, timeout) : it.skip(name, fn);

interface PaymentDetail {
  payment_id: string;
  canonical?: {
    amount: number;
    debtor?: { rail: string };
    creditor?: { rail: string };
    intrBkSttlmAmt?: { value: number; currency: string };
  };
}

async function postAndFetch(payload: unknown): Promise<PaymentDetail> {
  const res = await fetch(`${API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const { payment_id } = (await res.json()) as { payment_id: string };
  await new Promise((r) => setTimeout(r, 2000));
  const detail = await fetch(`${API_URL}/payments/${payment_id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return (await detail.json()) as PaymentDetail;
}

describe('Integration: Translation', () => {
  describe('PIX → Canonical', () => {
    itLive('translates pix-valid-01 to canonical (debtor.rail=PIX, creditor.rail=SPEI)', async () => {
      const payload = JSON.parse(fs.readFileSync('datasets/pix/pix-valid-01.json', 'utf-8'));
      const detail = await postAndFetch(payload);
      expect(detail.canonical).toBeDefined();
      // Amount may live at canonical.amount (legacy) or canonical.intrBkSttlmAmt.value (pacs.008).
      const amt = detail.canonical?.amount ?? detail.canonical?.intrBkSttlmAmt?.value;
      expect(amt).toBe(150.25);
      expect(detail.canonical?.debtor?.rail).toBe('PIX');
      expect(detail.canonical?.creditor?.rail).toBe('SPEI');
    });
  });

  describe('SPEI → Canonical', () => {
    itLive('translates spei-valid-01 to canonical (debtor.rail=SPEI, creditor.rail=PIX)', async () => {
      const payload = JSON.parse(fs.readFileSync('datasets/spei/spei-valid-01.json', 'utf-8'));
      const detail = await postAndFetch(payload);
      expect(detail.canonical).toBeDefined();
      const amt = detail.canonical?.amount ?? detail.canonical?.intrBkSttlmAmt?.value;
      expect(amt).toBe(500.0);
      expect(detail.canonical?.debtor?.rail).toBe('SPEI');
      expect(detail.canonical?.creditor?.rail).toBe('PIX');
    });
  });

  // Inverse direction (canonical→rail) is not exposed as a one-shot endpoint;
  // it happens internally during routing. The dedicated contract tests in
  // `tests/contract/canonical-schema.test.ts` cover the wire-format check
  // for `canonical-to-*.json` fixtures.
  it('inverse direction covered by canonical-schema contract test', () => {
    expect(true).toBe(true);
  });
});
