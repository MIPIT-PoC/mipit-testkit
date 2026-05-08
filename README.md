# mipit-testkit

MiPIT PoC — Test suite, datasets, generators, and evidence tools.

## Overview

This package provides everything needed to test and demonstrate the MiPIT cross-rail payment interoperability proof of concept:

- **Datasets**: Synthetic PIX and SPEI payment payloads (valid, invalid, batch)
- **Generators**: Scripts to create new synthetic datasets on demand
- **Tests**: Contract, integration, and E2E test suites
- **Tools**: Shell scripts for smoke testing, E2E runs, and evidence generation

## Quick Start

```bash
npm install

# Generate datasets
npm run generate:pix -- 50
npm run generate:spei -- 50

# Run tests (requires API running at API_URL)
npm run test:contract
npm run test:integration
npm run test:e2e

# Smoke test
npm run smoke

# Full E2E suite
npm run e2e

# Generate evidence bundle
npm run evidence
npm run report

# Unified validation suite
npm run validate:suite
```

## Directory Structure

```
datasets/       Synthetic payment payloads
  pix/          PIX-format payloads
  spei/         SPEI-format payloads
  expected/     Expected translation outputs
generators/     Dataset generation scripts
tests/
  contract/     Schema & contract validation
  integration/  API & translation tests
  e2e/          Full end-to-end flows
tools/          Shell scripts & report generator
evidence/       Generated test reports
```

## Environment Variables

| Variable  | Default                  | Description        |
|-----------|--------------------------|--------------------|
| `API_URL` | `http://localhost:8080`  | MiPIT Core API URL |

## Validation Suite

The unified validation suite wraps:

- historical documented scenarios already present in this repo,
- local Jest suites across the main repos,
- `mipit-core` validation runner,
- Carlos' core E2E scenarios,
- load/routing/benchmark scripts,
- resilience/retry/schema-evolution scripts when the environment supports them.

Configuration:

1. Copy `.env.validation.example` to `.env.validation`
2. Adjust `BASE_URL` and optional infra URLs
3. Run `npm run validate:suite`

Artifacts are written under `evidence/suite/<timestamp>/`:

- `validation-suite-report.json`
- `validation-suite-report.md`
- one `.log` file per executed scenario

## License

MIT
