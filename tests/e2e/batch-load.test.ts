import fs from 'node:fs';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('E2E: Batch Load Test', () => {
  it('should process 50 transactions and measure latencies', async () => {
    const batch = JSON.parse(fs.readFileSync('datasets/pix/pix-batch-50.json', 'utf-8'));
    const results: { payment_id: string; latency_ms: number; status: string }[] = [];

    const promises = batch.map(async (payload: any, i: number) => {
      const start = Date.now();
      const res = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return { payment_id: data.payment_id, sent_at: start };
    });

    const sent = await Promise.all(promises);

    await new Promise((r) => setTimeout(r, 15_000));

    for (const { payment_id, sent_at } of sent) {
      const res = await fetch(`${API_URL}/payments/${payment_id}`);
      const detail = await res.json();
      results.push({
        payment_id,
        latency_ms: Date.now() - sent_at,
        status: detail.status,
      });
    }

    const completed = results.filter((r) => r.status === 'COMPLETED').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;
    const rejected = results.filter((r) => r.status === 'REJECTED').length;
    const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`\n=== Batch Load Results ===`);
    console.log(`Total:     ${results.length}`);
    console.log(`Completed: ${completed}`);
    console.log(`Failed:    ${failed}`);
    console.log(`Rejected:  ${rejected}`);
    console.log(`Latency p50: ${p50}ms`);
    console.log(`Latency p95: ${p95}ms`);
    console.log(`Latency p99: ${p99}ms`);

    fs.mkdirSync('evidence', { recursive: true });
    fs.writeFileSync('evidence/batch-load-results.json', JSON.stringify({ results, summary: { completed, failed, rejected, p50, p95, p99 } }, null, 2));

    const successRate = completed / results.length;
    expect(successRate).toBeGreaterThanOrEqual(0.9);
  }, 90_000);
});
