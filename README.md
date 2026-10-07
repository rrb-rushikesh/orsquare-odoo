# ORSquare (OR²)

High-speed retail operations platform for bottle/beverage counters (optional restaurant mode).
**Odoo 18 Community** is the only accounting/inventory/tax authority; a thin custom module (`addons/orsquare`) adds what is
unique to the product; a React app (later) talks to it over a JSON API; an Astro site is the public marketing page.

**Read this first:** [`context.md`](context.md) → [`docs/backend-architecture.md`](docs/backend-architecture.md) →
[`docs/backend-decisions.md`](docs/backend-decisions.md) → [`docs/operations-runbook.md`](docs/operations-runbook.md).
Working rules for agents: [`AGENTS.md`](AGENTS.md).

## State

Milestone 1 (backend) is built and verified — 182 automated tests (also green on a from-scratch install), real-concurrency,
gateway and realtime proofs, measured benchmarks. The React app, Astro site and Developer Console UI are not started.

## Quick start (Windows + Docker Desktop)

```bash
cd scratch/odoo18-spike && docker compose up -d      # Odoo 18 + PostgreSQL 16 (Docker Desktop must be running)
scripts/run_tests.sh                                 # upgrade the module + run all tests (dev DB: orsquare_dev)
scripts/concurrency_test.sh                          # zero-overselling proof (real concurrent transactions)
scripts/build_template.sh                            # shop template database from zero (~45 s)
scripts/provision_shop.sh orsquare_shop1 "My Shop" owner 'S3cure#Pass'   # one shop = one database
scripts/e2e_gateway.sh && scripts/e2e_realtime.sh    # proxy + realtime guardrail proofs
scripts/benchmark.sh                                 # measured performance baseline
```

## Layout

```
addons/orsquare/   the Odoo module (models = services, controllers = HTTP, tests = 182)
deploy/            Caddy gate, compose, Odoo prod config, Centrifugo (templates; Caddyfile validated)
docs/              specs (docs/tabs), architecture, decisions, runbook, benchmarks, generated API reference
scripts/           test / provision / upgrade / benchmark / end-to-end proof scripts
```
