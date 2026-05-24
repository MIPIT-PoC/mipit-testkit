/**
 * @file report.ts
 * @description Aggregates raw batch-run JSON files from evidence/ into a single summary with success/failure/rejected counts and p50/p95/p99 latency percentiles.
 * @author Nicolás Calderón
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
import fs from 'node:fs';
import path from 'node:path';

interface BatchResult {
  payment_id: string;
  latency_ms: number;
  status: string;
}

interface BatchReport {
  results: BatchResult[];
  summary: {
    completed: number;
    failed: number;
    rejected: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

function findEvidenceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full);
    } else if (entry.isDirectory()) {
      files.push(...findEvidenceFiles(full));
    }
  }
  return files;
}

function main() {
  const evidenceDir = 'evidence';
  const files = findEvidenceFiles(evidenceDir);

  console.log('=== MiPIT Test Evidence Report ===');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Evidence files found: ${files.length}`);
  console.log('');

  for (const file of files) {
    const relative = path.relative(evidenceDir, file);
    console.log(`--- ${relative} ---`);

    try {
      const content = JSON.parse(fs.readFileSync(file, 'utf-8'));

      if (relative.includes('batch-load')) {
        const report = content as BatchReport;
        console.log(`  Total payments: ${report.results.length}`);
        console.log(`  Completed: ${report.summary.completed}`);
        console.log(`  Failed: ${report.summary.failed}`);
        console.log(`  Rejected: ${report.summary.rejected}`);
        console.log(`  Latency p50: ${report.summary.p50}ms`);
        console.log(`  Latency p95: ${report.summary.p95}ms`);
        console.log(`  Latency p99: ${report.summary.p99}ms`);
        const rate = report.summary.completed / report.results.length;
        console.log(`  Success rate: ${(rate * 100).toFixed(1)}%`);
      } else if (relative.includes('health')) {
        console.log(`  Status: ${JSON.stringify(content)}`);
      } else {
        console.log(`  Keys: ${Object.keys(content).join(', ')}`);
      }
    } catch {
      console.log(`  (could not parse)`);
    }

    console.log('');
  }

  const summaryPath = path.join(evidenceDir, 'report-summary.json');
  const summary = {
    generated_at: new Date().toISOString(),
    evidence_files: files.map((f) => path.relative(evidenceDir, f)),
    total_files: files.length,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary written to ${summaryPath}`);
}

main();
