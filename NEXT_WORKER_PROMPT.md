# Copy-ready prompt for the next AI worker

Paste everything below the line.

---

You are taking over the ORSquare (OR²) project in `C:\Repo\orsquare-odoo` (git repo, branch `main`). The owner is a product designer, not a developer: explain in plain language, give reasons and trade-offs, and ask before architecture changes.

**Read first, completely, before any decision:** `HANDOVER.md` (authoritative), `AGENTS.md`, `context.md`, everything in `docs/` (including `docs/tabs/*`, `docs/backend-api-reference.md`, `docs/tenancy-and-offline-architecture.md`, `docs/astra-landing-optimization.md`, `docs/existing-repos-audit.md`). Locked decisions must not be redesigned.

## Situation
The Odoo 18 backend (`addons/orsquare`, 208 tests green) is finished and verified. A new platform module (`addons/orsquare_platform`) for the Developer Console exists with passing tests. The Astra landing page is already copied unchanged into `landing/`. **Keep all of that.**

The previous worker then made a serious mistake on the retailer frontend: instead of preserving the original live app, it hand-wrote NEW screens (Sales, Stock, Products, Purchases, Accounts, Cash Flow, Dashboard, shell, login) that changed the visual identity. The owner rejected this. **Do not continue that work. Do not redesign anything.**

## Your mission
Rebuild `frontend/` as a **mirror-to-mirror recreation of the original retailer app** at `C:\Users\rushi\Music\production-hot-fix`: same tabs, layouts, spacing, typography, buttons, icons, controls, tables, drawers, dialogs, states, interactions, responsive behaviour and desktop experience. Do not modernise, simplify, "improve" or reinterpret. If an optimisation would visibly change the UI, do not do it. Preserve every capability of the old app (reproduce it against Odoo even if the old implementation was messy); remove only legacy backend calls, frontend business maths (tax/price/stock/valuation), old database assumptions and abandoned architecture.

Underneath the unchanged UI, connect to the new architecture:
- **Odoo is the only authority** for pricing, tax, accounting, stock, valuation. The frontend never recomputes them: use `sales.quote` / `sales.settle`, `purchases.preview_bill` / `record_bill`, stock/accounts/cashflow/reports services (see `docs/backend-api-reference.md`). The only exception is the labelled offline estimate in `lib/estimate.ts`.
- **Offline/local-first** (locked): Dexie, single bootstrap, delta sync, durable outbox, idempotency/`client_ref`, batch flush, reconnect, only the approved offline workflows, all invisible in the UI.
- **Realtime** (locked): Odoo events -> Centrifugo/Redis; a push only triggers a delta pull; a dead publisher must never block billing (already fixed in the backend, keep it that way).
- Guardrails from `AGENTS.md` section 4 (server-side gate, no landing page for signed-in users, stable deep links, role routing).

## How to do it (recommended)
1. Reuse the already-built plumbing in `frontend/src/lib` (`api.ts`, `db.ts`, `sync.ts`, `realtime.ts`, `print.ts`, `estimate.ts`), `auth/AuthContext.tsx` and `data/workspace.ts`. They contain no visual design.
2. Restore the original screens from `production-hot-fix` (copies also parked in `frontend/src/_pending/pages|components|lib`). Keep their JSX and CSS. Re-implement the old `lib/repo.ts`, `useData()` and `useAuth()` **with the same shapes the original pages expect**, implemented over `call(service, method, params)`, so the page code barely changes.
3. Replace the hand-written pages (`frontend/src/pages/*`, `components/AppShell.tsx`, `pages/LoginPage.tsx`, `App.tsx`) with the original ones. The only allowed login change is a shop-code field styled exactly like the existing fields.
4. Go screen by screen: port -> swap data calls -> delete only legacy backend/business-logic code -> compare side by side with the original in the browser -> commit that screen. Never batch a redesign.
5. Where the old UI needs data the API lacks, add a small additive read method in the backend with a test (run `scripts/run_tests.sh`); never rewrite working foundations. Where a capability has no Odoo equivalent yet (Sheet/WineStock, Closing Stock Audit, AI, multi-shop, importer), keep the original control, disabled with the original look, and list it in `HANDOVER.md` section 7. Variants = clean placeholder. Daybook and Calendar: the owner said to skip for now.
6. **Developer Console:** reproduce `C:\Repo\orsquare-tryton\frontend\src\features\dev` (+ `prototypes/console`) visually identically in its own folder/route (`/dev`, lazy-loaded, no retailer code in it), backed by `platform.*`. First finish verifying the platform HTTP flow listed in `HANDOVER.md` section 2 (developer login with shop `orsquare_platform`, `/api/call` `platform.*`, gate 302 to `/dev`, shop user refused, suspended shop login 403).
7. **Landing:** do not touch `landing/`; wire `deploy/Caddyfile` to serve its `dist/` and keep the gate behaviour.

## Working rules
- Fidelity over cleverness. Compare to the original after every screen.
- Measure cashier-flow latency; no render loops or extra network calls on the hot path (memoize every object/array used as an effect dependency; one request loop already happened).
- Run tests/type-check/build and browser-verify each screen; fix regressions before moving on. Keep `HANDOVER.md` updated at the end of every chunk (status, log, next steps) so any later worker can continue.
- Commit per screen/chunk with clear messages (`Co-Authored-By` line as configured). Do not rewrite git history.
- Demo access (local dev only): shop `orsquare_shop1` / `krishna_owner` / `Krishna#Owner2026`; platform DB `orsquare_platform` / `dev_ops` / `Dev#Ops2026Local`. Run: Docker Desktop, `cd scratch/odoo18-spike && docker compose up -d`, Odoo :8088, preview config `retailer-app` (`.claude/launch.json`, Vite :5173 proxying `/api` to :8088). Restart `odoo18-spike-web` after Python changes.

The owner's goal in one line: **same original retailer frontend, same experience, new Odoo + offline + realtime architecture underneath. Optimise the implementation, never the identity.**
