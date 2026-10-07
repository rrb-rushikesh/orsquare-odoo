# Current repository status — 2026-10-08

> **Picking this up?** Read [docs/HANDOFF.md](docs/HANDOFF.md) first: it says how to start the stack, what exists, what is left (in priority order), and the traps already hit. The older day-by-day notes are in [docs/status-history.md](docs/status-history.md).

The product is **not finished**. The Odoo backend, the platform backend, the governance layer and the Developer Console are built and tested. The restored retailer screens are only partly connected. A few local flows working does not prove production readiness.

Odoo is the only accounting, stock and tax authority. One account = one shop = one database. Legacy repositories are sources for screens, terminology and requirements only. Read [context](context.md), [agent rules](AGENTS.md), [backend decisions](docs/backend-decisions.md) and the tab specification before changing a workflow. Preserve the original retailer UI ([design philosophy](frontend/DESIGN.md)).

## What exists and is verified

| Area | State | Where |
| --- | --- | --- |
| Odoo shop backend (sales, stock, purchases, accounts, daybook, sync, realtime) | built; 250 tests pass | `addons/orsquare/`, [architecture](docs/backend-architecture.md), [API reference](docs/backend-api-reference.md) |
| Governance (roles, tab grants as groups, server-side API gate, plan entitlements, change log, two-step sign-in, sign-in directory) | built; tested; browser-verified | [docs/governance.md](docs/governance.md) |
| Platform backend (fleet registry, plans, operators with admin/support levels, provisioning, archive/delete, audit) | built; 24 tests pass; benchmarked at 10,000 shops | `addons/orsquare_platform/` |
| Developer Console (`/dev`): Fleet, shop drawer (overview, Business Studio, Team, Activity), Plans, Operators, Audit, System | built; browser-verified | `frontend/src/features/dev/`, [tab spec](docs/tabs/dev-console.md) |
| Retailer Settings: Business Studio, Team & Access, Security & activity | built; browser-verified | `frontend/src/features/governance/`, `frontend/src/pages/SettingsPage.tsx` |
| Stock tab variants (standard / WineStock matrix) and Accounts variants (standard / Advanced workspace), chosen per shop | built; ported from the live repo | `WineStockPage.tsx`, `AdvancedAccountsPage.tsx`, routed in `App.tsx` |
| Retailer screens (Sales, Products, Purchases, Stock, Accounts, Cash Flow, Ledger, Dashboard) | partly connected through Odoo adapters | [restoration evidence](docs/retailer-restoration.md) |
| Offline outbox, delta sync, realtime | built; offline correctness not proven through every screen | `frontend/src/lib/sync.ts`, [tenancy/offline](docs/tenancy-and-offline-architecture.md) |
| Astro public site | built; 11 pages checked earlier | `landing/` |

## Evidence (re-run it, do not trust it)

Last run 2026-10-08 on the local Docker stack:

- Shop suite `scripts/run_tests.sh /orsquare orsquare_dev`: **250 passed**.
- Platform suite `scripts/run_platform_tests.sh`: **24 passed**.
- Frontend `npm test`: **125 passed, 1 skipped** (physical printer). `npx tsc --noEmit` clean. `npm run build` passes.
- 10,000-shop registry benchmark `scripts/bench_platform.py`: fleet page about 3 ms, search about 21 ms, audit 15 to 23 ms, sign-in lookup 0.18 ms (single local PostgreSQL; a measurement, not a guarantee).
- Landing `npm run check` and a restore drill on another host were **not** re-run.

## What is left (short list; the detail and the order are in HANDOFF.md)

1. **Owner decisions:** capacity/sharding plan for 10,000 shop databases; what each plan allows (built-in plans have no limits); production domain, TLS and edge routing; permission to push `main` (it must name the destination, see Git below).
2. **Retailer features still unavailable** (buttons are disabled with a reason): returns and exchanges, purchase editing and history, stock movement history, product opening stock / import / deletion, product variants and box packing, account edits, payment against a chosen bill.
3. **Settings pages still disconnected:** Data Control (shift-cutoff view, wipe, restore) and Tables (floors and table generator). Their backend services exist.
4. **Deferred by design:** Daybook and Calendar screens, Sheet register, AI, Closing Stock Audit, Product Master Library (excluded), multi-shop (cancelled).
5. **Unproven:** offline/reconnect through the restored screens, multi-tab sequencing, role isolation end to end, physical printers, mobile parity, full comparison with the original app, production TLS and routing, restore drill.
6. **Known defects to investigate:** the offline device sequence counter lives in `localStorage` and is not atomic with the IndexedDB enqueue; purchase retries create a new client reference (an ambiguous-response retry could double-post).
7. **Housekeeping:** `orsquare_shop_bench` is a leftover database without the ORSquare module (not a shop; safe to drop once you are sure); no automated browser test covers `/dev` yet.

## Rules that must not be broken

[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) are identical (run `scripts/sync-agent-files.ps1` after editing one). Section 15 (governance is enforced on the server) and section 13 (the Developer Console is never shown to shop users) are the most recent. Reuse Odoo and OCA first; no business math in the UI.

## Git

All work up to this status is committed locally on `main` in logical groups. **Nothing has been pushed**: the approval review requires an explicit instruction naming the destination (`https://github.com/rrb-rushikesh/orsquare-odoo.git`) and the publication of all committed code and documentation. Do not retry a push without that exact approval.
