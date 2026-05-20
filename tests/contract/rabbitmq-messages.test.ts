/**
 * P10 — Contract test: RabbitMQ topology + envelope shape.
 *
 * Audit finding G5: was 6 placebo `expect(true).toBe(true)` tests. Now:
 *   - Static assertions over canonical message envelopes using zod
 *     (already a testkit dep) so the suite is green offline.
 *   - Live assertions over the actual RabbitMQ Management API (port 15672)
 *     for exchange / queue / binding presence, auto-skipped when the
 *     broker isn't reachable.
 *
 * Source of truth for queue/exchange names: `mipit-core/src/config/constants.ts`.
 *   EXCHANGES   = { PAYMENTS: 'mipit.payments', DLX: 'mipit.dlx' }
 *   ROUTING_KEYS = { ROUTE_PIX/SPEI/BREB, ACK_PIX/SPEI/BREB, DLQ: 'dlq.#' }
 *   QUEUES      = { ACK: 'payments.ack', DLQ: 'payments.dlq' }
 */
import { z } from 'zod';

const RABBIT_MGMT =
  process.env.RABBITMQ_MGMT_URL ?? 'http://guest:guest@localhost:15672';

const VHOST = process.env.RABBITMQ_VHOST ?? '%2F';

let liveBroker = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${RABBIT_MGMT}/api/overview`);
    liveBroker = r.ok;
  } catch {
    liveBroker = false;
  }
});

const itLive = (name: string, fn: jest.ProvidesCallback, timeout?: number) =>
  liveBroker ? it(name, fn, timeout) : it.skip(name, fn);

// ---- Envelope schemas (the canonical wire format) -----------------------

/**
 * `route.<rail>` message — published by the core to the adapter for that rail.
 * The PoC payload is the *canonical pacs.008-derived JSON* (subset) plus a
 * minimal routing envelope.
 */
const RouteMessageSchema = z.object({
  payment_id: z.string().regex(/^PMT-/),
  origin: z.enum(['PIX', 'SPEI', 'BRE_B']),
  destination: z.enum(['PIX', 'SPEI', 'BRE_B']),
  canonical: z.object({
    payment_id: z.string().regex(/^PMT-/),
    pmtId: z.object({
      endToEndId: z.string().max(35),
      uetr: z.string().uuid(),
    }),
    intrBkSttlmAmt: z.object({
      value: z.number().positive(),
      currency: z.string().length(3),
    }),
  }).passthrough(),
}).passthrough();

/** `ack.<rail>` — adapter → core ack. */
const AckMessageSchema = z.object({
  payment_id: z.string().regex(/^PMT-/),
  status: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
  rail_tx_id: z.string().min(1).optional(),
  error: z.string().optional(),
  acked_at: z.string().datetime().optional(),
}).passthrough();

/** Audit event — published per pipeline state change. */
const AuditEventSchema = z.object({
  payment_id: z.string().regex(/^PMT-/),
  event_type: z.string().min(1),
  timestamp: z.string().datetime(),
  trace_id: z.string().min(1).optional(),
  data: z.record(z.unknown()).optional(),
}).passthrough();

describe('Contract: RabbitMQ Topology + Envelope', () => {
  describe('Route envelope (payment.route)', () => {
    it('accepts a well-formed PIX→SPEI envelope', () => {
      const sample = {
        payment_id: 'PMT-01J5ABCDEF1234567890',
        origin: 'PIX',
        destination: 'SPEI',
        canonical: {
          payment_id: 'PMT-01J5ABCDEF1234567890',
          pmtId: {
            endToEndId: 'E2E-12345',
            uetr: '550e8400-e29b-41d4-a716-446655440000',
          },
          intrBkSttlmAmt: { value: 100.5, currency: 'MXN' },
        },
      };
      expect(() => RouteMessageSchema.parse(sample)).not.toThrow();
    });

    it('rejects an envelope missing canonical.pmtId.uetr', () => {
      const bad = {
        payment_id: 'PMT-XYZ',
        origin: 'PIX',
        destination: 'SPEI',
        canonical: {
          payment_id: 'PMT-XYZ',
          pmtId: { endToEndId: 'E2E-1' },
          intrBkSttlmAmt: { value: 1, currency: 'BRL' },
        },
      };
      expect(() => RouteMessageSchema.parse(bad)).toThrow();
    });
  });

  describe('Ack envelope (payment.ack)', () => {
    it('accepts ACCEPTED with rail_tx_id', () => {
      expect(() =>
        AckMessageSchema.parse({
          payment_id: 'PMT-01J5ABCDEF1234567890',
          status: 'ACCEPTED',
          rail_tx_id: 'SPEI-TX-12345',
          acked_at: new Date().toISOString(),
        }),
      ).not.toThrow();
    });

    it('accepts REJECTED with error', () => {
      expect(() =>
        AckMessageSchema.parse({
          payment_id: 'PMT-01J5ABCDEF1234567890',
          status: 'REJECTED',
          error: 'INVALID_CLABE',
        }),
      ).not.toThrow();
    });

    it('rejects unknown status values', () => {
      expect(() =>
        AckMessageSchema.parse({
          payment_id: 'PMT-X',
          status: 'BANANA',
        }),
      ).toThrow();
    });
  });

  describe('Audit event envelope', () => {
    it('accepts a well-formed audit event', () => {
      expect(() =>
        AuditEventSchema.parse({
          payment_id: 'PMT-X',
          event_type: 'PAYMENT_CANONICALIZED',
          timestamp: new Date().toISOString(),
          trace_id: 'abc123',
          data: { rail: 'PIX' },
        }),
      ).not.toThrow();
    });
  });

  describe('Live broker topology', () => {
    itLive('exchange mipit.payments exists', async () => {
      const r = await fetch(`${RABBIT_MGMT}/api/exchanges/${VHOST}/mipit.payments`);
      expect(r.status).toBe(200);
      const ex = (await r.json()) as { type?: string };
      expect(ex.type).toBe('topic');
    });

    itLive('dead-letter exchange mipit.dlx exists', async () => {
      const r = await fetch(`${RABBIT_MGMT}/api/exchanges/${VHOST}/mipit.dlx`);
      expect(r.status).toBe(200);
    });

    itLive('queue payments.ack is bound to mipit.payments for all 3 rails', async () => {
      const r = await fetch(
        `${RABBIT_MGMT}/api/queues/${VHOST}/payments.ack/bindings`,
      );
      expect(r.status).toBe(200);
      const bindings = (await r.json()) as Array<{ routing_key: string; source: string }>;
      const keys = bindings.map((b) => b.routing_key);
      expect(keys).toEqual(expect.arrayContaining(['ack.pix', 'ack.spei', 'ack.breb']));
    });

    itLive('queue payments.dlq exists', async () => {
      const r = await fetch(`${RABBIT_MGMT}/api/queues/${VHOST}/payments.dlq`);
      expect(r.status).toBe(200);
    });
  });

  if (process.env.CI === 'true') {
    it('CI guard: live broker is reachable', () => {
      expect(liveBroker).toBe(true);
    });
  }
});
