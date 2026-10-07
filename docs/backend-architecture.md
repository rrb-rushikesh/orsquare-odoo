# ORSquare Backend Architecture (as built)

**Status:** Milestone 1 backend is built and verified. 182 automated tests pass on both an incrementally upgraded
database and a pristine from-scratch install; the concurrency, gateway and benchmark scripts run against real
PostgreSQL/Odoo/Caddy. This document describes what exists, not what was planned. Decisions and the reasons behind
them are in [`backend-decisions.md`](backend-decisions.md); the method-by-method API is in the generated
[`backend-api-reference.md`](backend-api-reference.md); running it is in [`operations-runbook.md`](operations-runbook.md).

---

## 1. The shape of the system

```
React SPA ──HTTPS──▶ Caddy ──▶ Odoo 18 Community (module `orsquare`, thin) ──▶ PostgreSQL 16
 (Dexie outbox)        │              ▲  JSON API /api/*                          one DATABASE per shop
                       │              │                                          (orsquare_shop1, …)
                       └─▶ Centrifugo ◀── events (after commit) ── Redis
```

* **Odoo is the only authority** for stock (`stock.quant`, `stock.move`, `stock.valuation.layer`), money
  (`account.move`, `account.payment`, `pos.order`), tax (`account.tax`) and identity (`res.users`, `res.groups`).
  The `orsquare` module only orchestrates, guards and projects. It contains **no inventory, valuation, costing or tax
  engine of its own**.
* **One account = one shop = one database.** A request can only ever reach the database its session names; wiping,
  backing up or upgrading one shop cannot touch another.
* **Services, not scattered endpoints.** All business operations are `AbstractModel` services (`orsquare.*.service`).
  A thin HTTP layer exposes an explicit whitelist of them (`api_registry.py`).

## 2. Module map (`addons/orsquare`)

| Area | Files | What it owns |
|---|---|---|
| Shop settings | `models/res_company.py`, `staff_service.py` | Business Studio toggles, cutoff hour, cost policy, bill branding; Staff Access |
| Topology | `stock_warehouse.py`, `stock_service.py` | `WH/Stock/{Godown,Counter,Opened}`, transfers, row locks, Auto-Godown |
| Checkout | `sale_service.py`, `pos_extensions.py` | `settle()`: sale / return / exchange, idempotent, atomic |
| Open bottles | `opened_bottle.py` | Peg sales, per-bottle location, finish/scrap |
| Daybook | `business_day.py`, `business_date.py` | Business date, cash drawer, sealing, snapshot, audited re-audit |
| Purchases | `purchase_service.py`, `tax_regime.py` | Simple/advanced bills, landed cost, TCS, round-off, returns/exchange |
| Back office | `accounts_service.py`, `cashflow_service.py`, `reports_service.py`, `stock_reports.py` | Khata/suppliers/employees, cash diary, dashboard, ledger, stock |
| Catalog | `catalog_service.py`, `product.py` | Units (two-tier), brands, categories, products, pegs, portions, margin rules, tables |
| Printing | `bill_service.py` | Bill document, thermal text, ESC/POS, UPI QR |
| Sync | `sync_service.py`, `event.py` | bootstrap / delta / flush, domain events |
| Safety | `wipe_service.py`, `login_throttle.py`, `security_utils.py` | Data wipe + backup, brute-force guard, role gates |
| Tenant | `shop_bootstrap.py` | Idempotent per-shop setup, `configure_shop`, accounts, POS config |
| HTTP | `controllers/main.py`, `api_registry.py`, `api_facade.py` | Routes, whitelist, ID-based wrappers |

## 3. Core invariants (each one is enforced by a test)

1. **Single inventory authority.** Stock is only ever read from `stock.quant` and changed by validated pickings.
   `orsquare.opened_bottle` stores no volume; remaining ml is `quant × capacity`.
2. **Zero overselling, zero negative stock (online).** `settle()` locks the product's quant rows (`SELECT … FOR UPDATE`,
   ordered by id), re-reads quantities, pulls the shortfall from the Godown if enabled, and raises a clean message
   otherwise. Proven with real concurrent transactions (`scripts/concurrency_test.sh`: 10 cashiers / last bottle,
   20 buyers / 14 units, 6 pegs / 750 ml bottle, one bill replayed 8× → exactly one order).
3. **Offline is accepted and flagged, never silently dropped.** An offline-rung sale that exceeds system stock is posted
   and recorded in `orsquare.stock_discrepancy` for the owner (physical reality is not rewritten).
4. **Exactly-once.** `client_ref` (sales/purchases) and `mutation_id` + per-device `device_seq` (sync) make every write
   idempotent; replays return the stored answer.
5. **Immutability.** Posted entries and stock moves are corrected only by reversals/adjustments. A sealed business day
   rejects dated documents; its snapshot changes only through the logged `action_reaudit`. Audit rows cannot be edited
   or deleted.
6. **Business date.** Every document gets an immutable `orsquare_business_date` (shop timezone − cutoff hour).
   Exactly at the cutoff a new day starts. Live documents after an early seal roll forward to the next day; dated
   (offline / back-dated) documents into a sealed day are rejected.
7. **Money never leaks.** Amounts are removed from API results *and* the event feed/realtime channel unless the user
   has `can_see_money`; costs/margins/valuation need `can_see_valuation`. Masked values are `null`, never `0`.
8. **Precision.** Bottle unit rounding is `0.000001`; `Product Price` has 6 decimals and `Discount` 4, so a rate
   derived from a total reproduces the printed line total exactly.
   *Qualification (unchanged from the spec):* 6 decimals is the validated minimum for the tested bottle/portion
   combinations (750/700/650/375/1000 ml); any new combination must pass the same conservation tests.

## 4. Operations in detail

### 4.1 Checkout — `sales.settle(payload)`

```jsonc
{
  "client_ref": "uuid",                // REQUIRED idempotency key
  "partner_id": 12,                    // optional; required for Khata or a tax invoice
  "to_invoice": false,                 // true => GST tax invoice (needs shop address+state, customer)
  "offline": false,                    // true only from the outbox flush
  "created_at": "2026-10-07T20:31:00Z",// honoured only when offline (clamped to now+5min)
  "lines": [
    {"product_id": 5, "qty": 2, "price": 1500.0, "discount": 5.0},          // normal line
    {"peg": {"bottle_id": 9, "ml": 60}, "price": 120.0},                    // peg from an opened bottle
    {"refund_of_line_id": 77, "qty": 1}                                     // return, priced at the ORIGINAL rate
  ],
  "bill_discount": {"kind": "percent|amount", "value": 10},   // pre-tax trade discount, prorated
  "settlement_concession": 24.0,       // post-tax short-pay → "Cash Settlement Difference" ledger
  "payments": [{"method": "cash|upi|khata", "amount": 1500.0}] // cash may over-tender (change is returned)
}
```
Result: `{order_id, name, total, tax, change, business_date, invoice_id, pickings[], auto_godown_transfer, flagged,
duplicate, rolled_forward}`.

* **Taxes are computed server-side** from the product's taxes (regime) and fiscal position; the client's numbers are
  never trusted.
* **Discount classification:** trade discount (pre-tax) = line `discount` / `bill_discount`; statutory round-off =
  POS cash rounding (native); settlement concession = a separate tender that books to expense without touching tax.
* **Returns/exchanges are transaction-type-aware.** Lines may mix `refund_of_line_id` and new items. A counter slip nets
  on one receipt; if the returned goods were sold on a tax invoice the backend issues a **paired Credit Note
  (`reversed_entry_id` → original) and a new Tax Invoice**. Needs `can_manage_returns`.
* Kitchen/untracked products never create a delivery. A refunded peg reverses revenue but does not pour liquid back.

### 4.2 Open bottles

`day.open_bottle(product_id)` moves 1 unit Counter → a new location `WH/Stock/Opened/<label>` (`RC #01`).
A peg line moves `ml / capacity` bottles out of that location. `day.finish_bottle(bottle_id)` scraps the exact remaining
quant so quant and asset value are exactly 0. `bottles.tray()` returns live ml / % / colour level, oldest first.

### 4.3 Daybook — `day.day_open / day_current / day_seal / day_reaudit`

`day_open(opening_float)` opens a native POS session. **Expected cash** = opening float + net cash sales + cash in/out
(petty cash, native) + customer cash receipts − supplier cash payments (outside POS). `day_seal(counted_cash, note)`
requires a reason when the variance exceeds the *cash materiality threshold*; Odoo itself books the cash difference.
Sealing freezes the Z-report snapshot (bill count, gross/refund/net sales, tax, COGS, profit, cash/UPI/Khata split,
retail vs kitchen, top SKUs, hourly curve). `day_reaudit(date, reason)` (owner) recomputes including later-dated
returns/credit notes and appends an immutable log row (actor, time, previous vs new snapshot, reason).

### 4.4 Purchases — `purchases.record_bill / preview_bill / return_to_supplier`

Simple bill: supplier + lines (`rate` **or** `amount` — bi-directional) → PO → receipt into the Godown → vendor bill.
Advanced bill adds `supplier_invoice_no`, `tp_no/tp_date`, item discounts (`discount_pct` or `discount_amount`),
`adjustments` (`discount` / `expense`, each with optional `capitalize`), `tcs {rate, amount?}` and `stated_total`.

* **Costing is Odoo's.** Goods enter at the PO price (AVCO). Capitalised discounts and charges become a native
  `stock.landed.cost` (discounts are negative lines) allocated by value; non-capitalised ones post to Discount
  Received / Freight expense. The shop's *cost policy* (`discounts`, `expenses`, `taxes`) sets the default; each line can
  override it.
* **TCS** is an asset (receivable) line, never stock cost. Calculated = rate × (goods − discounts + charges); an explicit
  `amount` overrides it.
* **`stated_total`** = the supplier's printed total; any difference up to the penny tolerance (default ₹5) is a
  Round-off line, beyond it the bill is refused.
* The reference test reproduces the real *Anand Wines* invoice to the paisa (₹69,260 − ₹2,150 + ₹15 + ₹1,342 =
  ₹68,467; inventory ₹67,125; payable exactly ₹68,467).
* `return_to_supplier` = return picking Godown → Vendor + Vendor Credit Note linked to the bill (with proportional TCS).
  With `exchange` the replacement is a separate bill (own rates/taxes) reconciled against the credit note on the
  supplier ledger.

### 4.5 Tax regimes

`orsquare.tax_regime` bundles native taxes + a TCS rate and attaches to product categories; a new product inherits its
category's taxes. Seeded: *Alcoholic Liquor – Maharashtra (reference)*, GST 0/5/12/18/28 %, Exempt. **No state rate is
hard-coded:** State VAT ships at 0 % until the operator sets the statutory rate (`catalog.set_regime_tax_rate`).
Liquor VAT sits in its own tax group/ledger and in its own bucket of `reports.gst_report`.

### 4.6 Back office

Accounts (Khata, suppliers, employees), the cash diary, dashboard, calendar, trial balance, P&L, balance sheet, GST
report and registers are **read projections of Odoo's ledger** (balances are always sums of posted lines; settlements are
real `account.payment` records reconciled oldest-first). The OCA financial-report modules are not installed; these native
services cover the spec's reports (see decision D12).

## 5. HTTP API

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | liveness (public) |
| `/api/session/login` | POST | `{shop, login, password}` → session cookie + `me`. `shop` is needed only on a shared host; brute force → 429 |
| `/api/session/logout`, `/api/session/me` | POST/GET | |
| `/api/session/gate` | GET | for the proxy: **302 → app when signed in, 204 for guests** |
| `/api/sync/bootstrap` | GET | one-round-trip workspace seed |
| `/api/sync/delta?since_seq=N&since_ts=…` | GET | events after N + patches |
| `/api/sync/flush` | POST | the offline outbox |
| `/api/call` | POST | `{service, method, params}` — whitelisted service methods |

Rules: unauthenticated → **401 JSON, never a redirect**; business error → 422 `{code:"rejected", message}`; forbidden →
403; mutating calls require `Content-Type: application/json` and a trusted `Origin`; unknown method/service → 403.
All routes are `auth='none'` and decide authentication themselves, so a guest on a multi-shop host never needs a database
(the module must be a *server-wide module*; see the runbook).

## 6. Sync protocol

* **Bootstrap** returns `{seq, server_ts, me, products, units, brands, categories, regimes, stock, open_bottles, day,
  customers, payment_modes, floors, discrepancies_open}`; amounts/costs are masked per permission.
* **Delta**: `events` after `since_seq` (monotonic, commit-ordered) plus patches (`stock`, `open_bottles`, `day`, `me`,
  `customers`, changed `products`). The catalogue patch re-sends a 2-minute overlap because Odoo stamps `write_date`
  with the transaction *start*; clients upsert by id so duplicates are harmless. `reset: true` means "re-bootstrap".
* **Flush** — each mutation `{id, device_id, device_seq, kind, created_at, payload}`:
  `sale · purchase · stock_transfer · open_bottle · finish_bottle · cash_entry · khata_receipt`. Per device the sequence
  must be exactly `last + 1`; a gap yields `out_of_order` for it and everything after it; a replay returns
  `duplicate` with the stored result; a business error is `error` (stored, cursor advances, later ones still run).
  Not allowed offline: new products, sealing the day, settings, wipe.

## 7. Realtime

`orsquare.event` is one append-only feed. After commit the event is pushed to Centrifugo's HTTP API
(`orsquare.centrifugo_url`, `orsquare.centrifugo_api_key`): channel `shop:<id>` carries **no amounts**;
`shop:<id>:money` carries the full event and must be subscribable only by `can_see_money` users (gateway rule — see the
runbook). A push failure never affects the business transaction; devices recover from `delta`.

## 8. Security model

Roles are native groups: *Owner*, *Cashier*, *Stockkeeper* + three flags (`can_see_money`, `can_see_valuation`,
`can_manage_returns`). Tab grants intersect the shop's enabled tabs. Every service re-checks its role (services run
privileged *after* the check, keeping the real caller as `create_uid`). Passwords ≥ 8 chars; the template's `admin`
password is randomised on provisioning; staff cannot remove their own owner access. See decisions D14–D16.

## 9. What is intentionally *not* built (per the locked scope)

Closing Stock Audit & Reconciliation, WineStock matrix / Sheet register, Product Master Library & importer (skipped),
the React/Astro frontends, and the platform Developer Console UI. Their data hooks exist where cheap (e.g.
`stock_discrepancy`, `bill_document.excise_matrix`).
