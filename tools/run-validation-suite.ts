import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

type ScenarioStatus = 'passed' | 'failed' | 'skipped';

type ScenarioResult = {
  id: string;
  title: string;
  category: 'historical' | 'local' | 'core-e2e' | 'e2e' | 'benchmark' | 'resilience';
  status: ScenarioStatus;
  exitCode: number | null;
  durationMs: number;
  command?: string;
  workdir?: string;
  logPath?: string;
  summary?: Record<string, unknown>;
  notes?: string[];
};

type SuiteReport = {
  generatedAt: string;
  mode: string;
  environment: {
    baseUrl: string;
    apiReachable: boolean;
    dockerAvailable: boolean;
    tokenIssued: boolean;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  scenarios: ScenarioResult[];
};

type CommandOutcome = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const repoRoot = path.resolve(process.cwd());
const thesisRoot = path.resolve(repoRoot, '..');
const evidenceRoot = path.join(repoRoot, 'evidence', 'suite');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(evidenceRoot, stamp);

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Load env file BEFORE evaluating defaults so RUN_REPO_TESTS, BASE_URL, etc.
// from .env.validation actually take effect.
loadEnvFile(path.join(repoRoot, '.env.validation'));

const defaults = {
  mode: process.env.VALIDATION_MODE ?? 'local',
  baseUrl: process.env.BASE_URL ?? 'http://localhost:8080',
  authPath: process.env.AUTH_PATH ?? '/auth/token',
  skipTlsValidation: (process.env.ALLOW_INVALID_CERTS ?? 'true') === 'true',
  runRepoTests: (process.env.RUN_REPO_TESTS ?? 'true') === 'true',
  runCoreE2E: (process.env.RUN_CORE_E2E ?? 'true') === 'true',
  runHistoricalScripts: (process.env.RUN_HISTORICAL_SCRIPTS ?? 'true') === 'true',
  runBenchmarks: (process.env.RUN_BENCHMARKS ?? 'true') === 'true',
  runResilience: (process.env.RUN_RESILIENCE ?? 'true') === 'true',
  coreDir: process.env.MIPIT_CORE_DIR ?? path.join(thesisRoot, 'mipit-core'),
  pixDir: process.env.MIPIT_ADAPTER_PIX_DIR ?? path.join(thesisRoot, 'mipit-adapter-pix'),
  speiDir: process.env.MIPIT_ADAPTER_SPEI_DIR ?? path.join(thesisRoot, 'mipit-adapter-spei'),
  brebDir: process.env.MIPIT_ADAPTER_BREB_DIR ?? path.join(thesisRoot, 'mipit-adapter-breb'),
  uiDir: process.env.MIPIT_UI_DIR ?? path.join(thesisRoot, 'mipit-ui'),
};

let cachedToken: string | null = null;

if (defaults.skipTlsValidation) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function ensureRunDir() {
  await fsp.mkdir(runDir, { recursive: true });
}

async function runCommand(
  command: string,
  args: string[],
  workdir: string,
  env?: NodeJS.ProcessEnv,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: workdir,
      env: { ...process.env, ...env },
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

async function writeLog(name: string, outcome: CommandOutcome) {
  const safeName = name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const logPath = path.join(runDir, `${safeName}.log`);
  const content = [
    `# stdout`,
    outcome.stdout,
    '',
    `# stderr`,
    outcome.stderr,
  ].join('\n');
  await fsp.writeFile(logPath, content, 'utf8');
  return logPath;
}

function summarizeJest(text: string): Record<string, unknown> | undefined {
  const suites = text.match(/Test Suites:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/i)
    ?? text.match(/Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/i);
  const tests = text.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/i)
    ?? text.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/i);

  const summary: Record<string, unknown> = {};
  if (suites) {
    if (suites.length === 4) {
      summary.suites_failed = Number(suites[1]);
      summary.suites_passed = Number(suites[2]);
      summary.suites_total = Number(suites[3]);
    } else {
      summary.suites_failed = 0;
      summary.suites_passed = Number(suites[1]);
      summary.suites_total = Number(suites[2]);
    }
  }
  if (tests) {
    if (tests.length === 4) {
      summary.tests_failed = Number(tests[1]);
      summary.tests_passed = Number(tests[2]);
      summary.tests_total = Number(tests[3]);
    } else {
      summary.tests_failed = 0;
      summary.tests_passed = Number(tests[1]);
      summary.tests_total = Number(tests[2]);
    }
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function summarizeLoad(text: string): Record<string, unknown> | undefined {
  const get = (regex: RegExp) => text.match(regex)?.[1];
  const succeeded = get(/Succeeded:\s+(\d+)/i);
  const failed = get(/Failed:\s+(\d+)/i);
  const successRate = get(/Success rate:\s+(\d+)%/i);
  const throughput = get(/Throughput:\s+~(\d+)\s+req\/s/i);
  const p50 = get(/p50:\s+(\d+)ms/i);
  const p95 = get(/p95:\s+(\d+)ms/i);
  const p99 = get(/p99:\s+(\d+)ms/i);
  if (!succeeded && !failed) return undefined;
  return {
    succeeded: succeeded ? Number(succeeded) : undefined,
    failed: failed ? Number(failed) : undefined,
    success_rate_pct: successRate ? Number(successRate) : undefined,
    throughput_rps: throughput ? Number(throughput) : undefined,
    latency_p50_ms: p50 ? Number(p50) : undefined,
    latency_p95_ms: p95 ? Number(p95) : undefined,
    latency_p99_ms: p99 ? Number(p99) : undefined,
  };
}

function summarizeRouting(text: string): Record<string, unknown> | undefined {
  const get = (regex: RegExp) => text.match(regex)?.[1];
  const verified = get(/Total verified:\s+(\d+)/i);
  const correct = get(/Correctly routed:\s+(\d+)/i);
  const misrouted = get(/Misrouted:\s+(\d+)/i);
  const lost = get(/Lost \(unknown\):\s+(\d+)/i);
  const accuracy = get(/Routing accuracy:\s+([\d.]+)%/i);
  if (!verified) return undefined;
  return {
    verified: Number(verified),
    correctly_routed: correct ? Number(correct) : undefined,
    misrouted: misrouted ? Number(misrouted) : undefined,
    lost: lost ? Number(lost) : undefined,
    routing_accuracy_pct: accuracy ? Number(accuracy) : undefined,
  };
}

function summarizeVerifications(text: string): Record<string, unknown> | undefined {
  const match = text.match(/TOTAL:\s+(\d+)\s+passed\s+\/\s+(\d+)\s+failed\s+\/\s+(\d+)\s+total/i);
  if (!match) return undefined;
  return {
    assertions_passed: Number(match[1]),
    assertions_failed: Number(match[2]),
    assertions_total: Number(match[3]),
  };
}

function summarizeCoreValidation(text: string): Record<string, unknown> | undefined {
  const match = text.match(/"total":\s*(\d+)[\s\S]*"passed":\s*(\d+)[\s\S]*"failed":\s*(\d+)[\s\S]*"warnings":\s*(\d+)[\s\S]*"skipped":\s*(\d+)/i);
  if (!match) return undefined;
  return {
    total_checks: Number(match[1]),
    passed: Number(match[2]),
    failed: Number(match[3]),
    warnings: Number(match[4]),
    skipped: Number(match[5]),
  };
}

function summarizeBenchmark(text: string): Record<string, unknown> | undefined {
  const sections = ['POST /payments', 'POST /translate/preview', 'POST /translate', 'GET /payments/:id'];
  const result: Record<string, unknown> = {};
  for (const section of sections) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = text.match(new RegExp(`${escaped}:[\\s\\S]*?requests:\\s+(\\d+)[\\s\\S]*?errors:\\s+(\\d+)[\\s\\S]*?avg:\\s+(\\d+)ms[\\s\\S]*?p95:\\s+(\\d+)ms[\\s\\S]*?p99:\\s+(\\d+)ms`, 'i'));
    if (block) {
      result[section] = {
        requests: Number(block[1]),
        errors: Number(block[2]),
        avg_ms: Number(block[3]),
        p95_ms: Number(block[4]),
        p99_ms: Number(block[5]),
      };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function summarizeHistoricalLoad(): Record<string, unknown> {
  return {
    source_document: 'mipit-docs/testing/testing-completo.md',
    script: 'mipit-testkit/e2e-load.mjs',
    total_sent: 1000,
    succeeded: 1000,
    failed: 0,
    success_rate_pct: 100,
    throughput_rps: 30,
    latency_p50_ms: 45,
    latency_p95_ms: 120,
    latency_p99_ms: 250,
  };
}

function summarizeHistoricalRouting(): Record<string, unknown> {
  return {
    source_document: 'mipit-docs/testing/testing-completo.md',
    script: 'mipit-testkit/e2e-routing-correctness.mjs',
    total_payments: 999,
    correctly_routed: 999,
    misrouted: 0,
    lost: 0,
    routing_accuracy_pct: 100,
  };
}

function summarizeHistoricalVerifications(): Record<string, unknown> {
  return {
    source_document: 'mipit-testkit/E2E-VERIFICATION-RESULTS.md',
    script: 'mipit-testkit/e2e-verifications.mjs',
    assertions_passed: 76,
    assertions_failed: 0,
    assertions_total: 76,
  };
}

async function apiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${defaults.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function issueToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const res = await fetch(`${defaults.baseUrl}${defaults.authPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.access_token) {
      cachedToken = body.access_token as string;
      return cachedToken;
    }
    return null;
  } catch {
    return null;
  }
}

async function dockerAvailable(): Promise<boolean> {
  const outcome = await runCommand('docker', ['ps'], repoRoot).catch(() => null);
  return Boolean(outcome && outcome.exitCode === 0);
}

async function executeScenario(
  spec: {
    id: string;
    title: string;
    category: ScenarioResult['category'];
    command?: string;
    args?: string[];
    workdir?: string;
    env?: NodeJS.ProcessEnv;
    skipReason?: string;
    summary?: Record<string, unknown>;
    parser?: (text: string) => Record<string, unknown> | undefined;
    notes?: string[];
  },
): Promise<ScenarioResult> {
  const started = Date.now();

  if (spec.skipReason) {
    return {
      id: spec.id,
      title: spec.title,
      category: spec.category,
      status: 'skipped',
      exitCode: null,
      durationMs: 0,
      summary: spec.summary,
      notes: spec.notes ? [...spec.notes, spec.skipReason] : [spec.skipReason],
    };
  }

  if (!spec.command || !spec.workdir) {
    return {
      id: spec.id,
      title: spec.title,
      category: spec.category,
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - started,
      summary: spec.summary,
      notes: spec.notes,
    };
  }

  const outcome = await runCommand(spec.command, spec.args ?? [], spec.workdir, spec.env);
  const logPath = await writeLog(spec.id, outcome);
  const mergedText = `${outcome.stdout}\n${outcome.stderr}`;
  const parsed = spec.parser ? spec.parser(mergedText) : undefined;

  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    status: outcome.exitCode === 0 ? 'passed' : 'failed',
    exitCode: outcome.exitCode,
    durationMs: Date.now() - started,
    command: [spec.command, ...(spec.args ?? [])].join(' '),
    workdir: spec.workdir,
    logPath,
    summary: parsed ?? spec.summary,
    notes: spec.notes,
  };
}

function buildMarkdown(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push('# MiPIT Validation Suite Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Base URL: ${report.environment.baseUrl}`);
  lines.push(`- API reachable: ${report.environment.apiReachable ? 'yes' : 'no'}`);
  lines.push(`- Docker available: ${report.environment.dockerAvailable ? 'yes' : 'no'}`);
  lines.push(`- Token issued: ${report.environment.tokenIssued ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total scenarios: ${report.summary.total}`);
  lines.push(`- Passed: ${report.summary.passed}`);
  lines.push(`- Failed: ${report.summary.failed}`);
  lines.push(`- Skipped: ${report.summary.skipped}`);
  lines.push('');
  lines.push('## Scenario Matrix');
  lines.push('');
  lines.push('| ID | Category | Title | Status | Duration ms |');
  lines.push('|---|---|---|---|---:|');
  for (const item of report.scenarios) {
    lines.push(`| ${item.id} | ${item.category} | ${item.title} | ${item.status.toUpperCase()} | ${item.durationMs} |`);
  }
  lines.push('');
  lines.push('## Details');
  lines.push('');
  for (const item of report.scenarios) {
    lines.push(`### ${item.id} - ${item.title}`);
    lines.push('');
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Status: ${item.status.toUpperCase()}`);
    lines.push(`- Duration ms: ${item.durationMs}`);
    if (item.exitCode !== null) lines.push(`- Exit code: ${item.exitCode}`);
    if (item.command) lines.push(`- Command: \`${item.command}\``);
    if (item.workdir) lines.push(`- Workdir: \`${item.workdir}\``);
    if (item.logPath) lines.push(`- Log: \`${item.logPath}\``);
    if (item.notes && item.notes.length > 0) {
      for (const note of item.notes) {
        lines.push(`- Note: ${note}`);
      }
    }
    if (item.summary) {
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(item.summary, null, 2));
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  await ensureRunDir();

  const apiOk = await apiReachable();
  const token = apiOk ? await issueToken() : null;
  const dockerOk = await dockerAvailable();

  const sharedEnv: NodeJS.ProcessEnv = {
    BASE_URL: defaults.baseUrl,
    API_URL: defaults.baseUrl,
    TOKEN: token ?? '',
    NODE_TLS_REJECT_UNAUTHORIZED: defaults.skipTlsValidation ? '0' : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    API_PROTOCOL: defaults.baseUrl.startsWith('https://') ? 'https' : 'http',
    API_HOST: new URL(defaults.baseUrl).hostname,
    PORT: new URL(defaults.baseUrl).port || (defaults.baseUrl.startsWith('https://') ? '443' : '80'),
    PIX_MOCK_URL: process.env.PIX_MOCK_URL,
    SPEI_MOCK_URL: process.env.SPEI_MOCK_URL,
    BREB_MOCK_URL: process.env.BREB_MOCK_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
  };

  const scenarios: ScenarioResult[] = [];

  scenarios.push(await executeScenario({
    id: 'historical-load',
    title: 'Carga histórica de 1000 pagos documentada',
    category: 'historical',
    summary: summarizeHistoricalLoad(),
    notes: ['Resultado histórico documentado, no re-ejecutado en esta corrida.'],
  }));

  scenarios.push(await executeScenario({
    id: 'historical-routing',
    title: 'Correctitud histórica de routing de 999 pagos documentada',
    category: 'historical',
    summary: summarizeHistoricalRouting(),
    notes: ['Resultado histórico documentado, no re-ejecutado en esta corrida.'],
  }));

  scenarios.push(await executeScenario({
    id: 'historical-verifications',
    title: '8 verificaciones E2E históricas documentadas',
    category: 'historical',
    summary: summarizeHistoricalVerifications(),
    notes: ['Resultado histórico documentado, no re-ejecutado en esta corrida.'],
  }));

  if (defaults.runRepoTests) {
    const repoTests = [
      { id: 'repo-core-jest', title: 'mipit-core Jest suite', dir: defaults.coreDir },
      { id: 'repo-adapter-pix-jest', title: 'mipit-adapter-pix Jest suite', dir: defaults.pixDir },
      { id: 'repo-adapter-spei-jest', title: 'mipit-adapter-spei Jest suite', dir: defaults.speiDir },
      { id: 'repo-adapter-breb-jest', title: 'mipit-adapter-breb Jest suite', dir: defaults.brebDir },
      { id: 'repo-ui-jest', title: 'mipit-ui Jest suite', dir: defaults.uiDir },
    ];

    for (const repo of repoTests) {
      scenarios.push(await executeScenario({
        id: repo.id,
        title: repo.title,
        category: 'local',
        command: 'npm.cmd',
        args: ['test', '--', '--runInBand'],
        workdir: repo.dir,
        parser: summarizeJest,
      }));
    }
  }

  if (defaults.runCoreE2E) {
    const skipCoreApi = apiOk ? undefined : 'API no accesible desde este entorno local';
    const coreCases = [
      {
        id: 'core-validation',
        title: 'Core validation runner',
        command: 'npm.cmd',
        args: ['run', 'validate:core'],
        parser: summarizeCoreValidation,
      },
      {
        id: 'core-e2e-carlos-simplified',
        title: 'Carlos - 12 pruebas simplificadas',
        command: 'npx.cmd',
        args: ['jest', 'test/e2e/error-scenarios-simplified.test.ts', '--forceExit', '--detectOpenHandles'],
        parser: summarizeJest,
      },
      {
        id: 'core-e2e-carlos-full',
        title: 'Carlos - escenarios de error completos',
        command: 'npx.cmd',
        args: ['jest', 'test/e2e/error-scenarios.test.ts', '--forceExit', '--detectOpenHandles'],
        parser: summarizeJest,
      },
      {
        id: 'core-e2e-routing',
        title: 'Core - routing e2e',
        command: 'npx.cmd',
        args: ['jest', 'test/e2e/routing.test.ts', '--forceExit', '--detectOpenHandles'],
        parser: summarizeJest,
      },
    ];

    for (const test of coreCases) {
      scenarios.push(await executeScenario({
        id: test.id,
        title: test.title,
        category: 'core-e2e',
        command: test.command,
        args: test.args,
        workdir: defaults.coreDir,
        env: sharedEnv,
        parser: test.parser,
        skipReason: skipCoreApi,
      }));
    }
  }

  if (defaults.runHistoricalScripts) {
    const skipE2E = apiOk && token ? undefined : 'API o token de autenticación no disponibles';
    scenarios.push(await executeScenario({
      id: 'e2e-verifications',
      title: '8 verificaciones E2E',
      category: 'e2e',
      command: 'node',
      args: ['e2e-verifications.mjs'],
      workdir: repoRoot,
      env: sharedEnv,
      parser: summarizeVerifications,
      skipReason: skipE2E,
    }));

    scenarios.push(await executeScenario({
      id: 'e2e-routing-correctness',
      title: 'Routing correctness (999 pagos por defecto)',
      category: 'e2e',
      command: 'node',
      args: ['e2e-routing-correctness.mjs'],
      workdir: repoRoot,
      env: sharedEnv,
      parser: summarizeRouting,
      skipReason: skipE2E,
    }));

    scenarios.push(await executeScenario({
      id: 'e2e-load',
      title: 'Load test',
      category: 'e2e',
      command: 'node',
      args: ['e2e-load.mjs', process.env.LOAD_TOTAL_REQUESTS ?? '100', process.env.LOAD_CONCURRENCY ?? '10'],
      workdir: repoRoot,
      env: sharedEnv,
      parser: summarizeLoad,
      skipReason: skipE2E,
    }));
  }

  if (defaults.runBenchmarks) {
    scenarios.push(await executeScenario({
      id: 'e2e-benchmark-latency',
      title: 'Latency benchmark',
      category: 'benchmark',
      command: 'node',
      args: ['e2e-benchmark-latency.mjs', process.env.BENCHMARK_DURATION_S ?? '5', process.env.BENCHMARK_RPS_TARGET ?? '20'],
      workdir: repoRoot,
      env: sharedEnv,
      parser: summarizeBenchmark,
      skipReason: apiOk && token ? undefined : 'API o token de autenticación no disponibles',
    }));
  }

  if (defaults.runResilience) {
    const skipResilience = apiOk && token && dockerOk
      ? undefined
      : 'Se requiere API accesible, token válido y Docker disponible para escenarios resilience/retry/schema';

    const optional = [
      { id: 'e2e-resilience', title: 'Crash/recovery resilience', file: 'e2e-resilience.mjs' },
      { id: 'e2e-retry-timeout', title: 'Timeout/retry verification', file: 'e2e-retry-timeout.mjs' },
      { id: 'e2e-schema-evolution', title: 'Schema evolution verification', file: 'e2e-schema-evolution.mjs' },
    ];

    for (const item of optional) {
      scenarios.push(await executeScenario({
        id: item.id,
        title: item.title,
        category: 'resilience',
        command: 'node',
        args: [item.file],
        workdir: repoRoot,
        env: sharedEnv,
        skipReason: skipResilience,
      }));
    }
  }

  const report: SuiteReport = {
    generatedAt: new Date().toISOString(),
    mode: defaults.mode,
    environment: {
      baseUrl: defaults.baseUrl,
      apiReachable: apiOk,
      dockerAvailable: dockerOk,
      tokenIssued: Boolean(token),
    },
    summary: {
      total: scenarios.length,
      passed: scenarios.filter((item) => item.status === 'passed').length,
      failed: scenarios.filter((item) => item.status === 'failed').length,
      skipped: scenarios.filter((item) => item.status === 'skipped').length,
    },
    scenarios,
  };

  const jsonPath = path.join(runDir, 'validation-suite-report.json');
  const mdPath = path.join(runDir, 'validation-suite-report.md');
  await fsp.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await fsp.writeFile(mdPath, buildMarkdown(report), 'utf8');

  console.log(`Validation suite JSON report: ${jsonPath}`);
  console.log(`Validation suite Markdown report: ${mdPath}`);

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Validation suite failed:', error);
  process.exitCode = 1;
});
