# HANDOVER: live state of the ORSquare build

> **Any model/engineer taking over: read this file first, then `AGENTS.md`, `context.md`, `docs/`. Update this file at the end of every work chunk (the "Log" and "Status" sections). If you are cut off, the next person continues from "NEXT STEPS".**
> Owner: product designer (not a developer): explain simply, ask before architecture changes (see `AGENTS.md`). Owner has granted autonomy for the backend and the frontend build ("do not compromise").

## 1. Product in one paragraph
ORSquare (OR²): retail counter platform for bottle/beverage shops (optional restaurant mode). **Odoo 18 Community is the only authority** for accounting, tax, pricing, stock, valuation. One shop = one database. React retailer app (`frontend/`), Developer Console, and an Astra marketing site are separate front ends with hard boundaries. Offline-first POS (Dexie outbox + idempotent flush). Realtime = Odoo events -> Centrifugo/Redis (never blocks a sale).

## 2. Repos / locations
| What | Where |
|---|---|
| This repo (backend + new frontend) | `C:\Repo\orsquare-odoo` |
| Odoo module | `addons/orsquare/` (services in `models/`, HTTP in `controllers/main.py`, 208 tests in `tests/`) |
| Retailer app (React 19 + Vite) | `frontend/` |
| Old live retailer app (REFERENCE ONLY for screens/UX, never its backend/business logic) | `C:\Users\rushi\Music\production-hot-fix` |
| Old repo for Developer Console + Astra landing (REFERENCE/SOURCE for those two only) | `C:\Repo\orsquare-tryton` (`landing/`, `prototypes/console`; its `frontend/` is NOT the retailer source) |
| Specs | `docs/tabs/*.md`, `docs/*.md`, `context.md`; API reference `docs/backend-api-reference.md` (generated: `scripts/gen_api_docs.sh`) |

## 3. Run it (Windows, Git Bash)
```
Docker Desktop must be running.  cd scratch/odoo18-spike && docker compose up -d      # Odoo :8088, PG
scripts/run_tests.sh                       # backend: must stay green (208)
scripts/e2e_realtime.sh / e2e_gateway.sh / concurrency_test.sh / benchmark.sh
cd frontend && npm install && npx tsc --noEmit && npx vite build
preview server: .claude/launch.json -> "retailer-app" (Vite :5173, proxies /api -> :8088)
Demo login: shop code orsquare_shop1 / krishna_owner / Krishna#Owner2026  (local dev only)
```
Dev shop DBs: `orsquare_dev` (tests), `orsquare_shop1` (demo; origin allow-list param `orsquare.allowed_origins` includes http://localhost:5173), `orsquare_template`.
Schema/bootstrap change => bump manifest version + `migrations/<ver>/post-migration.py`; then `scripts/upgrade_shops.sh`; **restart `odoo18-spike-web`** after python changes (config params are ormcache'd).

## 4. Architecture rules that must not be broken (summary of locked decisions)
1. **No business math in the UI.** Prices/tax/discount via `sales.quote` (read-only, same engine as `settle`); stock/valuation/accounting from Odoo reads. Offline-only exception: `lib/estimate.ts` (labelled estimate, never authority).
2. Every backend call goes through `frontend/src/lib/api.ts` (`call(service, method, params)` -> `POST /api/call`, whitelist in `api_registry.py`). Cookie session (httpOnly); 401 => login; network error => offline path.
3. Local-first: `lib/db.ts` (Dexie per shop+user), `lib/sync.ts` (snapshot from `/api/sync/bootstrap`, `/api/sync/delta` poll 15 s, durable outbox -> `/api/sync/flush`, idempotency key = `client_ref`, per-device `device_seq` last+1). Only offline-capable: billing (sales), purchases-as-specified, stock transfers per spec; online-only areas must say so.
4. Realtime push is **after-commit, background thread, 30 s circuit breaker** (`models/event.py`); never in the request path.
5. Guardrails: authenticated users never get the landing page (Caddy `forward_auth` -> `/api/session/gate`); deep links stable on refresh (splash while hydrating; `/login` only on explicit 401); landing `orsquare.com`, app `app.orsquare.com`, console `app.orsquare.com/dev`.
6. Roles = Odoo groups (owner/cashier/stockkeeper + flags can_see_money/can_see_valuation/can_manage_returns + per-user tab grants). Masked values are `null`, not 0.
7. Hierarchy: Odoo core -> OCA -> thin custom module. Do not redesign locked decisions; do not casually change backend foundations (run the 208 tests).

## 5. Status (update me)
### Backend: COMPLETE, 208 tests green, realtime E2E 8/8, gateway E2E 14/14, concurrency proof
Added in session 2: `sales.quote`, product rows carry `product_id`/`category`/`low_stock_qty`, async push + breaker.
Open owner items: confirm TCS-never-in-cost (D6); set real State VAT (ships 0%); prod stack on a real host/TLS/restore drill not verified.

### Frontend
| Area | State |
|---|---|
| Foundation (api client, Dexie store, outbox, auth, shell, login with shop code, workspace hook) | DONE, verified in browser |
| Sales counter: search/scan, live Odoo quote, two-step F8/F9 pay, offline estimate + outbox | DONE (basic). TODO: pegs/open bottle, returns/exchanges, tables/tabs, promo UX, print |
| Stock: levels, transfer, history, open-bottle list | DONE (basic) |
| Products (list, form w/ pegs + opening stock + Odoo price suggestion, masters drawer) | DONE, verified in browser |
| Purchases (register, simple/advanced bill with Odoo reverse-rate preview, offline-queueable, return/exchange drawer) | DONE (return/exchange UI built, not yet browser-verified) |
| Accounts / Cash Flow / Dashboard | DONE, verified in browser (Dashboard refreshes on sync; realtime tickers pending Centrifugo client) |
| Sales extras: open-bottle tray + pegs, returns/exchanges (bill finder), restaurant tables + autosave + KOT, printing (lib/print.ts: QZ raw ESC/POS or browser dialog; offline provisional slip) | DONE, verified in browser except physical printing |
| Settings (Team & Access, Business Studio), Ledger | TODO |
| Daybook, Calendar | SKIPPED by owner for now |
| Variants | placeholder only |
| Developer Console | TODO (source: orsquare-tryton `prototypes/console` + its frontend `features/dev`) |
| Astra landing | TODO: copy `orsquare-tryton/landing` unchanged into `landing/` here; do NOT redesign |
| Old screens waiting to be ported | `frontend/src/_pending/` (excluded from tsconfig) |

## 6. Gotchas learned
- Root `.gitignore` had `lib/`; negated for `frontend/src/lib/` (use `git add -f` for `_pending/lib`).
- `odoo shell` scripts exit right after commit: background push threads die (test scripts must join `orsquare-push` threads).
- Use the Write tool / Python scripts for files; long bash heredocs with quotes break. Avoid Odoo reserved attrs (`_order`, `_table`) as method names.
- Windows paths inside Python string literals need raw strings.
- A sale once took 16 s because a dead Centrifugo URL blocked the request: fixed (125 ms). Always measure.

## 7. Log (newest first)
- 2026-10-07 s2: Sales extras done and browser-verified (peg bill, 495 exchange refund, table 2 bill + KOT). Bugs found+fixed by measuring: per-render array identity caused a request loop (always memoize derived payload objects used as effect deps); settings change now forces full re-bootstrap; SNAPSHOT_VERSION=3. Tabs `_render` now returns `peg`.
- 2026-10-07 s2: Products + Purchases done. Backend adds: purchases.list_bills/bill_detail, preview_bill returns per-line rate/amount, bootstrap+delta carry suppliers, product rows carry po_uom/uoms/uom_id/brand_id/regime_id. Frontend snapshot has SNAPSHOT_VERSION (bump when sections change, else stale devices show gaps).
- 2026-10-07 s2: frontend foundation + Sales + Stock committed; backend quote/async push committed. Handover file created. Starting: Dashboard, Products, Purchases, Accounts, Cash Flow, Sales extras, Console, landing.

## 8. NEXT STEPS (ordered)
1. Products -> Purchases -> Accounts -> Cash Flow -> Dashboard (real Odoo, all states, tests/build/browser check each).
2. Sales extras: pegs/open bottle, returns/exchanges, tables+KOT, print (ESC/POS from `bills.escpos`).
3. Settings (Team & Access, Business Studio) and Ledger.
4. Developer Console (own folder/route), landing in `landing/`, Caddy wiring per `deploy/Caddyfile`.
5. Latency measurements of key flows into `docs/benchmarks.md`.
