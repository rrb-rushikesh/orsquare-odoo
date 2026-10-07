# Measured Performance (baseline)

> **Status review — 2026-10-07:** Results below are historical local measurements, not a new cleanup benchmark or a production capacity guarantee. The 50–100 shop and fan-out targets still require realistic load proof. See [current status](../STATUS.md).

> Figures are **measured**, not promised. They were taken on a developer laptop (Docker Desktop, WSL2), a single Odoo
> process (`workers=0`), PostgreSQL 16 in a container, **service-level** (no network/proxy). They are a baseline to
> compare against, and a reason to re-run `scripts/benchmark.sh` on production-like hardware before quoting any number.
> The spec's targets (e.g. ~150 ms bootstrap) are *targets*; this page says where we are against them.

Reproduce: `scripts/benchmark.sh orsquare_dev 2000` (throwaway clone, seeded with 2,000 stocked products).
Concurrency: `scripts/concurrency_test.sh`. Gateway: `scripts/e2e_gateway.sh`.

## Results (2,000 products, run of 2026-10-07)

| Operation | p50 | p95 | Notes |
|---|---|---|---|
| Checkout, 1 line, cash, real-time stock | **78 ms** | 84 ms | row lock + delivery + valuation + order + payment |
| Checkout, 5 lines | 175 ms | 182 ms | ≈ 35 ms per extra line (one stock move + valuation layer each) |
| Peg (30 ml) from an opened bottle | 70 ms | 71 ms | |
| Checkout needing an auto-Godown transfer | 107 ms | 115 ms | adds one validated internal transfer |
| Offline outbox flush (100 bills) | **88 ms / bill** | — | whole batch 8.8 s; replay of the same 100 = 54 ms (all duplicates) |
| Bootstrap, 2,000 products | **203 ms** | — | 960 KB raw, **45 KB gzip**; ≈ 100 ms at 1,000 products |
| Dashboard (332 orders in the day) | 211 ms | — | live figures |
| Stock position (all products) | 95 ms | — | one grouped query |
| Seal a day with 332 orders | 1.1 s | — | native session close + snapshot |
| Trial balance / P&L / balance sheet | 2–3 ms | — | after the above data |
| Provision a new shop | **≈1.8 s** clone (+ ≈2 s configure) | — | SQL + filestore copy |

## Against the spec's targets

| Target (spec) | Result |
|---|---|
| Bootstrap ≈150 ms, ≈200 KB | **Met for ≲1,500 products** (203 ms @2,000). Payload is 45 KB gzipped, well under 200 KB. |
| Tenant provisioning < 1 s | **Not met with filestore**: ≈1.8 s (SQL-only clone alone was 217 ms in the Milestone-0 spike). Provisioning is rare; not a customer-facing path. |
| Sub-millisecond / <10 ms local queries (Dexie), <100 ms print dispatch | **Frontend/hardware targets** — not measurable from the backend. |
| <10 ms real-time fan-out | Not measured: needs Centrifugo + Redis under load (see runbook, "not yet verified"). |

## Concurrency (real transactions, see `concurrency_test.sh`)

| Scenario | Outcome |
|---|---|
| 10 cashiers, 1 bottle | exactly 1 sale; 9 clean stock-outs; stock = 0, never negative |
| 8 cashiers × 3 bottles, 12 available (auto-Godown on) | exactly 4 bills; Godown+Counter = 0; every transfer audited |
| 6 cashiers × 180 ml from a 750 ml bottle | exactly 4 succeed; 30 ml remain; asset after scrap = ₹0.00 |
| 1 bill replayed by 8 threads | exactly 1 order, 8 answers, stock deducted once |
| 20 buyers, 14 units | exactly 14 succeed; valuation nets to ₹0.00; revenue = 14 × price |

Contended checkouts of the *same* product serialize by design (20 buyers of one SKU took ≈9.6 s end to end); different
products do not contend.

## Honest limits

* Single-process numbers; production runs several workers, which helps throughput but not single-bill latency.
* Hot-SKU contention (e.g. one popular bottle at festival rush) is serialized; if it ever matters, the lever is
  reducing the work inside the lock (valuation/accounting) — measure first.
* No HTTP/TLS/proxy time and no real-network latency are included.

## Platform registry at 10,000 shops (2026-10-08)

`scripts/bench_platform.py`: 10,000 shops, 300,000 audit rows and 30,000 sign-in keys are seeded inside one transaction, the
console's calls are timed (7 runs, median), and the transaction is rolled back. Single local PostgreSQL, warm cache.

| Call | Median |
|---|---|
| Fleet first page (50), page 100, filters (expiring, trial, plan), sort by expiry or name | 2.6 - 3.9 ms |
| Fleet search by name fragment / phone fragment / no result | 20.6 / 21.9 / 21.0 ms |
| Audit first page / one shop / action + date range | 22.9 / 14.7 / 21.4 ms |
| Audit free-text search over 300,000 rows | 155 ms |
| System diagnostics, plans with shop counts | 18.8 ms, 1.3 ms |
| Sign-in directory lookup (one key of 30,000) | 0.18 ms |

Honest limits: this measures the registry, not 10,000 *databases*. Memory per loaded Odoo registry, backup/upgrade time per
database and worker-pool sizing are not measured and are the open capacity question (see [governance.md](governance.md)).

