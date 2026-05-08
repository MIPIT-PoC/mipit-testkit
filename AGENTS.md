# AGENTS.md

<purpose>
This repository contains the testing toolkit for MiPIT-PoC: synthetic data generators, static test datasets, contract tests, integration tests, end-to-end tests, and evidence generation tools.

It is responsible for:
- synthetic dataset generators for PIX, SPEI, and mixed batches (generators/),
- static test data: valid payloads, invalid payloads, expected translation results (datasets/),
- contract tests: OpenAPI validation, Zod canonical schema, RabbitMQ message structure (tests/contract/),
- integration tests: core API, translation round-trips, routing rules, idempotency, pipeline (tests/integration/),
- end-to-end tests: PIX→SPEI flow, SPEI→PIX flow, error scenarios, idempotency E2E, batch load (tests/e2e/),
- operational tools: smoke-test.sh, run-e2e.sh, generate-evidence.sh, report.ts (tools/).

Treat shipped test code and datasets as the primary source of truth for expected behavior.
When tests and documents disagree, prefer:
1. current test implementations and assertions,
2. current API behavior from mipit-core,
3. documentation in mipit-docs.
</purpose>

<project_scope>
This repo tests the PoC system, not production scenarios.
Tests run against local Docker Compose or VM-deployed services.
Datasets use synthetic data only — no real PII or financial data.
Batch tests target moderate load (50-100 concurrent transactions).
</project_scope>

<instruction_priority>
- User instructions override default style, tone, and initiative preferences.
- Safety, honesty, privacy, and permission constraints do not yield.
</instruction_priority>

<workflow>
  <phase name="clarify">
  - Before changes, clarify: which test type? (contract, integration, E2E, generator, tool)
  - Does the change affect expected behavior assertions?
  - Does it require the full stack to be running?
  </phase>

  <phase name="research">
  - Check current test assertions against actual mipit-core API behavior.
  - Check datasets against canonical Zod schema and adapter payload formats.
  - Check generators produce data that passes validation.
  - Cross-reference with OpenAPI spec in mipit-docs and Zod schemas in mipit-core.
  </phase>

  <phase name="implement">
  - Contract tests validate schemas and message formats, not business logic.
  - Integration tests hit real services but test one module at a time.
  - E2E tests validate the full payment lifecycle: create → poll → verify final state.
  - Generators use utility functions from generators/utils.ts for consistent random data.
  - Tools are shell scripts that can be run independently.
  - Use Jest with ts-jest for all test files.
  - Use descriptive test names that explain the expected behavior.
  </phase>

  <phase name="verify">
  - Run `npm test` to execute all tests (requires services to be running for integration/E2E).
  - Run `npm run test:contract` for contract tests only (may not need full stack).
  - Run `npm run test:e2e` for end-to-end tests (requires full stack).
  - Verify evidence generation produces valid JSON in evidence/.
  </phase>

  <phase name="document">
  - Update README.md when test categories, commands, or prerequisites change.
  - Update .env.example when test configuration changes.
  </phase>
</workflow>

<testing_rules>
- E2E tests use real HTTP calls to mipit-core API.
- E2E tests poll GET /payments/:id until terminal status (COMPLETED/FAILED/REJECTED) or timeout.
- E2E timeout: 35s for single transactions, 90s for batch.
- Batch test: send N transactions in parallel, wait, poll all, compute p50/p95/p99 latency.
- Idempotency test: same Idempotency-Key → same response; same key + different body → 409.
- Contract tests validate against Zod schemas imported or replicated from mipit-core.
- Integration tests may mock RabbitMQ but use real PostgreSQL.
- All tests should be deterministic when run against a clean environment.
</testing_rules>

<dataset_rules>
- Static datasets in datasets/ have naming convention: {rail}-{validity}-{number}.json.
- Expected results in datasets/expected/ mirror input naming: {direction}-{number}.json.
- Batch files: {rail}-batch-{count}.json containing arrays of payloads.
- Invalid datasets test specific validation failures: missing fields, wrong formats, out-of-range values.
- All amounts use realistic ranges (10-10000 USD equivalent).
- All aliases use PoC-safe synthetic identifiers.
</dataset_rules>

<default_commands>
- Generate PIX data: `npm run generate:pix -- 10`
- Generate SPEI data: `npm run generate:spei -- 10`
- Generate mixed batch: `npm run generate:batch -- 50`
- Run all tests: `npm test`
- Run contract tests: `npm run test:contract`
- Run integration tests: `npm run test:integration`
- Run E2E tests: `npm run test:e2e` or `npm run e2e`
- Smoke test: `npm run smoke`
- Generate evidence: `npm run evidence`
- Generate report: `npm run report`
</default_commands>
