# Backend Decision Log

> **Status review — 2026-10-07:** These decisions describe the implemented backend baseline and supersede conflicting earlier plans. They do not certify complete UI behavior or production readiness. See [current status](../STATUS.md).

Each entry: **what was decided → why → what was rejected → consequence.** Entries marked **⚠ spec change** deviate
from, or sharpen, an earlier written spec; they are consolidated in §3. Evidence (tests, scripts, measurements) is named
so each claim can be re-checked.

---

## 1. Decisions

### D1 — The sale engine is the native `pos.order` ⚠ spec change
* **Why:** Odoo POS already provides cash control (opening float, closing count, cash difference), pay-later (Khata),
  session-closing journal entries, refunds linked to invoices, AVCO COGS and GST invoices. A hand-built
  `account.move + account.payment + stock.picking` path would re-implement all of that and be the first place for
  accounting drift. Verified empirically: a sale posted exact COGS and balanced session entries.
* **Rejected:** the `orsquare.sale.service.action_complete_retail_sale()` described in `odoo-module-architecture.md`
  (picking + invoice + payment by hand).
* **Consequence:** the Daybook wraps one `pos.session`; "bills" are POS orders (an invoice exists only when requested);
  dashboards project `pos.order`, not `account.move`.

### D2 — Odoo 18 product model ⚠ spec change
Odoo 18 has no `detailed_type`. Storable = `type='consu'` + `is_storable=True`; kitchen/untracked = `consu` +
`is_storable=False` (+ `is_kitchen`). Specs that said `detailed_type='product'` are corrected.

### D3 — Overselling is prevented by ORSquare, because POS will not
* **Finding (read from source):** `stock.picking._create_picking_from_pos_order_lines` marks quantities done and wraps
  `_action_done()` in `try/except … pass`. POS therefore allows negative stock silently (also seen in Milestone-0 spike 1).
* **Decision:** `settle()` locks the quant rows (`FOR UPDATE`, ordered), re-reads, auto-transfers from the Godown when
  enabled, else raises. Offline-flushed sales use `allow_oversell` and are flagged instead.
* **Proof:** `scripts/concurrency_test.sh` (real connections, REPEATABLE READ, Odoo's retry on serialization failure).

### D4 — One location per opened bottle ⚠ spec change
* **Why:** "remaining ml per bottle must be derived from the authoritative quant" is impossible if two open bottles of one
  product share a single quant (it would force a per-bottle ml field — the parallel ledger the spec forbids). Lots would
  force lot tracking on every receipt and sale of the product.
* **Decision:** each bottle gets a child location `WH/Stock/Opened/<label>`; archived when closed. Topology still reads
  `Opened = OP Stock`; stock position sums children.
* **Cost:** many archived locations over time (cheap; no effect on valuation).

### D5 — Price precision 6, discount precision 4
Deriving a rate from a total (`15,000.33 / 100`) needs more than 2 decimals or the line total drifts. Verified: the 5-bottle
conservation suite still passes unchanged.

### D6 — Purchase costing delegated to `stock.landed.cost`; TCS is always an asset
* Capitalised charges **and discounts** go through Odoo's landed cost (negative cost lines are native), allocated by value.
  No ORSquare costing engine. Non-capitalised ones post to expense/income.
* **TCS is never stock cost** ⚠: the spec's "Factor Taxes in Cost" lists GST/VAT/TCS, but TCS under Sec. 206C is an
  advance-tax credit even for composition shops. The toggle therefore capitalises GST/VAT only. *Owner/CA to confirm.*
* Verified against the real Anand Wines invoice (D6a in `tests/test_purchases.py`).

### D7 — Sealed-day policy ⚠ spec change
A strict "reject everything on a sealed day" would stop a shop that seals at 22:00 but trades until the 02:00 cutoff.
**Live** documents roll forward to the next business day (`rolled_forward: true`); **dated** documents (offline, back-dated
purchase) are rejected — which is what the spec's wording ("dated in a sealed day") says.

### D8 — Event feed: commit-ordered sequence, money split
* `seq` = row id; writers take a transaction-scoped advisory lock before inserting, so rows become visible in id order and a
  device that saw N never later receives < N.
* Amounts live in `money`, delivered only to `can_see_money` users and to a separate `shop:<id>:money` channel. Found in
  the security review: totals in the stream would have let a cashier read revenue.

### D9 — Wipe uses ordered `DELETE`, never `TRUNCATE … CASCADE` ⚠ spec change
The spec's ORM-unlink sketch cannot delete posted entries; a `TRUNCATE CASCADE` is fast but follows foreign keys regardless
of `ON DELETE`, and `res_company.account_opening_move_id` references `account_move` — it **would have truncated the company
record** (the master-data test caught it). `DELETE` honours each FK's own rule. Backup (`pg_dump` zip, SHA-256, recorded
immutably) is verified before anything is touched.

### D10 — Cash/UPI payments post straight to the journal account
Odoo parks every payment in an "Outstanding" account until a bank statement is reconciled; a shop has none. So payment-method
lines point at the journal's own account: cash in hand is one number and payments are `paid`. (`bootstrap.simplify_liquidity`.)

### D11 — Provisioning = clone a template; India chart first
* The Indian chart must exist **before** POS/stock install (swapping later deletes accounts POS references — found by
  building from zero). `scripts/build_template.sh`: base → company India/INR → `l10n_in` → `orsquare`.
* Clone uses Odoo's own `duplicate_database` (SQL **and filestore**). Measured **≈1.8 s** per shop, ≈4 s with configuration.
* Schema upgrades are a loop (`scripts/upgrade_shops.sh`); the template is upgraded with them.

### D12 — Native report services instead of OCA ⚠ spec change
OCA `account_financial_report` / `account_fiscal_year` are not in the Odoo image and cannot be assumed available offline.
Trial balance, P&L, balance sheet, GST report and registers are implemented as read projections over `account.move.line`
(and checked to balance in tests). OCA modules can still be added later without changing this API.

### D13 — Business Studio lives on `res.company`
One shop = one company, so toggles, tabs, cost policy and branding are company fields with a whitelisted update API and four
presets (wine shop, bar, restaurant, grocery). The owner can still change every toggle.

### D14 — Roles are native groups; the API is a whitelist
`api_registry.py` is the only way in. A new model method is *not* reachable until someone lists it; the dispatcher refuses
unknown services/methods; every method re-checks the role (found in review: several read endpoints only masked fields).

### D15 — Auth routes are database-independent
On a shared host a guest has no database. All routes are `auth='none'`; unauthenticated → 401 JSON, no redirect. Guards:
`/api/session/gate` (302 for signed-in, 204 for guests) drives Caddy `forward_auth`. Two defects were found only by running a
real proxy: ORSquare must be a **server-wide module**, and Odoo does not persist sessions created in a database-less request,
so login persists and rotates the session itself. Proof: `scripts/e2e_gateway.sh` (14 assertions).

### D16 — Brute-force and CSRF
DB-backed throttle (5 failures / 5 min per login+IP → 429, no oracle while blocked); mutating calls need
`application/json` and a trusted `Origin`; session cookie is Odoo's HttpOnly cookie, scoped to the root domain by the proxy.

### D17 — Invoicing needs the shop address ⚠
`l10n_in` refuses to post a tax invoice without the company address and state. The raw `RedirectWarning` (an HTTP 500) is
converted into an actionable 422: "complete Settings → Business details".

### D18 — Idempotency store doubles as the ordering cursor
`orsquare.sync_log` (unique `mutation_id`, unique `(device_id, device_seq)`) answers replays and enforces `last+1`.

### D19 — Reads are cached nowhere; performance fixed at the source
Profiling showed 55 % of bootstrap time was one SQL search *per product* (margin rule). Batched; stock position now one
grouped query. Bootstrap at 2,000 products: 716 → 203 ms. See `benchmarks.md`.

---

## 2. Findings from verification (things that would have shipped broken)

| Found by | Defect | Fix |
|---|---|---|
| master-data test | `TRUNCATE CASCADE` reaches `res_company` | ordered `DELETE` (D9) |
| from-scratch template build | chart swap after POS install deletes referenced accounts | install order (D11) |
| clone-and-test | cloned DB missing filestore | Odoo `duplicate_database` (D11) |
| real Caddy E2E | guests got 404 (module not server-wide) | `server_wide_modules` (D15) |
| real Caddy E2E | login did not persist the session | explicit rotate+save (D15) |
| daybook test | stale `cash_register_difference` booked a phantom loss | invalidate around closing |
| security review | totals in event stream / unguarded reads / no throttle | D8, D14, D16 |
| returns test | replaying an exchange re-priced already-returned lines | idempotency check first |
| reports test | GST report mis-bucketed split taxes (type `none`) | classify by ledger account |

## 3. Spec changes to confirm with the product owner

1. Sales = POS orders (D1). Dashboard "sum of invoices" → sum of bills (still the same numbers for the owner).
2. `detailed_type` → `type + is_storable` (D2).
3. Opened bottles: per-bottle sub-location under `Opened` (D4).
4. TCS excluded from the "Factor Taxes in Cost" toggle (D6) — **needs your/your accountant's confirmation**.
5. Live bills after an early seal roll to the next business day instead of being rejected (D7).
6. Wipe uses SQL deletes (D9). OCA reports replaced by native projections (D12).
7. Liquor State-VAT rate ships as 0 % (configuration, not code) — set the real statutory rate before go-live.
