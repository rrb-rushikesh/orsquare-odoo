# ORSquare Backend API Reference

> **Generated** from the live API registry (`addons/orsquare/api_registry.py`) by `scripts/gen_api_docs.sh`. Do not edit by hand: change the code (signatures/docstrings) and regenerate.

Every call is `POST /api/call` with a JSON body `{"service": <name>, "method": <name>, "params": {...}}` (see *HTTP endpoints* in `docs/backend-architecture.md`). `params` are the keyword arguments below. Only the methods listed here are reachable; each re-checks the caller's role, and money/valuation figures are masked for users without `can_see_money` / `can_see_valuation`.

## `accounts`

Model: `orsquare.accounts.service`

### `accounts.create_party(name, kind, mobile=None, opening_balance=0.0, gstin=None)`

### `accounts.directory(kind='all', search=None, limit=80, offset=0)`

### `accounts.employee_advance_balance(employee_partner_id)`

### `accounts.employee_voucher(employee_partner_id, kind, amount, method='cash', note=None)`

advance (asset), recovery (reduces the asset) or wage (expense) through the cash/bank journal.

### `accounts.lookup_gstin(gstin)`

Validate an Indian GSTIN offline: format, state code, embedded PAN and the mod-36 check character.

### `accounts.pay_supplier(partner_id, amount, method='cash', note=None)`

### `accounts.receive_payment(partner_id, amount, method='cash', note=None)`

Customer receipt against Khata (cash or UPI); feeds the Daybook drawer when cash.

### `accounts.statement(partner_id, date_from=None, date_to=None)`

Chronological dossier with running balance (receivable positive; payable shown negative).

## `bills`

Model: `orsquare.bill.service`

### `bills.bill_document(order_id)`

### `bills.escpos(order_id, cols=None, open_drawer=True)`

Raw ESC/POS job (base64): init, the receipt, paper cut and optional cash-drawer pulse.

### `bills.thermal_text(order_id, cols=None)`

Fixed-width receipt (58 mm = 32 cols, 80 mm = 48 cols).

## `bottles`

Model: `orsquare.opened_bottle`

### `bottles.tray(company=None)`

Open Bottles Tray: active bottles, oldest first (rotation), with live ml.

## `cashflow`

Model: `orsquare.cashflow.service`

### `cashflow.new_entry(kind, amount, mode='cash', description=None, account_id=None)`

Expense/Income voucher, owner drawing, capital injection: a real payment against the chosen ledger account.
Cash vouchers feed the Daybook's live expected cash.

### `cashflow.register(date_from=None, date_to=None, mode=None)`

Chronological register with in/out and running balance (by operational business date).

## `catalog`

Model: `orsquare.catalog.service`

### `catalog.brands()`

### `catalog.bulk_create_tables(floor_id, start, end, seats=4)`

1-click generator: tables ``start..end`` on a floor, laid out on a tidy grid.

### `catalog.categories()`

### `catalog.create_brand(name)`

### `catalog.create_category(name, parent_id=None, regime_id=None)`

### `catalog.create_floor(name)`

### `catalog.create_shop_unit(name, base_unit_id, ratio)`

Tier 2 unit derived from a visible Tier 1 unit (e.g. '180 ml' = 180 x ml).

### `catalog.floors()`

### `catalog.list_products(search=None, kind=None, limit=200, offset=0, changed_since=None)`

Catalog listing; purchase cost only for staff with valuation rights.

### `catalog.save_product(values, product_tmpl_id=None)`

Create/update a catalog product.

### `catalog.set_base_unit_visibility(uom_id, visible)`

The Eye toggle. Non-destructive: hiding never touches shop units or products.

### `catalog.set_margin_rule(categ_id, uom_id, margin_amount)`

### `catalog.set_regime_tax_rate(tax_id, amount)`

Configure a statutory rate (State VAT etc.) without code changes.

### `catalog.set_regime_tcs_rate(regime_id, rate)`

### `catalog.suggest_price(product_tmpl_id)`

### `catalog.tax_regimes()`

### `catalog.units()`

Catalog Masters -> Units: Tier 1 base units (with the eye toggle) and Tier 2 shop units.

## `day`

Model: `orsquare.api.facade`

### `day.bill_detail(order_id)`

Everything a return/reprint needs: lines with what can still be returned.

### `day.bill_lookup(search=None, limit=30)`

Search counter bills, invoices and returns by number, customer or amount.

### `day.day_current()`

### `day.day_open(opening_float=0.0, note=None)`

### `day.day_reaudit(date, reason)`

### `day.day_seal(counted_cash, note=None)`

### `day.discrepancies(state='open')`

### `day.finish_bottle(bottle_id, reason=None)`

### `day.open_bottle(product_id, note=None)`

### `day.transfer(direction, quantities, origin=None)`

## `promos`

Model: `orsquare.promo`

### `promos.check_promo(code, bill_total)`

Preview for the cashier: what would this code take off a bill of ``bill_total``?

### `promos.create_promo(code, kind, value, name=None, min_bill=0.0, max_discount=0.0, date_from=None, date_to=None, max_uses=0)`

### `promos.list_promos()`

### `promos.set_promo_active(promo_id, active)`

## `purchases`

Model: `orsquare.purchase.service`

### `purchases.preview_bill(payload)`

Bi-directional rate engine + TCS suggestion for the Advanced Bill drawer (read-only).

### `purchases.record_bill(payload)`

### `purchases.return_to_supplier(payload)`

Vendor Credit Note + Godown->Vendor return picking; optional paired replacement bill.

## `realtime`

Model: `orsquare.realtime.service`

### `realtime.token()`

## `reports`

Model: `orsquare.reports.service`

### `reports.balance_sheet(as_of=None)`

### `reports.calendar(date_from, date_to)`

Period summary from frozen snapshots (max 92 days).

### `reports.dashboard()`

### `reports.day_detail(date)`

### `reports.gst_report(date_from=None, date_to=None)`

Output tax vs input tax credit by tax; liquor State VAT stays in its own bucket.

### `reports.profit_and_loss(date_from=None, date_to=None)`

### `reports.registers(kind, date_from=None, date_to=None, limit=500)`

Sales register (customer invoices + counter bills) or purchase register (vendor bills).

### `reports.trial_balance(date_from=None, date_to=None)`

## `sales`

Model: `orsquare.sale.service`

### `sales.settle(payload)`

Bill a sale, a return, or an exchange (return + sale on one request).

## `staff`

Model: `orsquare.staff.service`

### `staff.apply_preset(name)`

Apply a shop preset (tabs + feature toggles). Everything stays adjustable afterwards.

### `staff.create_staff(name, login, password, roles, flags=None, tabs=None)`

### `staff.get_settings()`

### `staff.list_presets()`

### `staff.list_staff()`

### `staff.me()`

### `staff.update_settings(values)`

### `staff.update_staff(user_id, roles=None, flags=None, tabs=None, active=None)`

## `stock`

Model: `orsquare.stock.reports`

### `stock.adjust_stock(product_id, location_key, counted_qty, reason)`

Set a location to the physically counted quantity through a real, reasoned inventory move.

### `stock.movement_history(product_id, limit=100)`

Per-SKU ledger: intake, transfers, peg openings, POS deductions, scraps, adjustments.

### `stock.needs_attention_stock()`

### `stock.opened_shelf()`

### `stock.resolve_discrepancy(discrepancy_id, note=None, counted_qty=None)`

### `stock.set_opening_stock(lines, location='godown')`

Accept onboarding stock ONCE per product as a real inventory-adjustment move.

### `stock.stock_position(product_ids=None)`

Per product: Godown, Counter and opened (ml) quantities; value only with valuation rights.

### `stock.stock_value_by_location()`

Dashboard widget: valuation split Godown vs Counter vs Opened (None when masked).

## `sync`

Model: `orsquare.sync.service`

### `sync.bootstrap()`

### `sync.delta(since_seq, since_ts=None, limit=500)`

### `sync.flush(mutations)`

Apply the offline outbox. Returns one result per mutation, in order.

## `tabs`

Model: `orsquare.tab.service`

### `tabs.tab_cancel(table_id, reason=None)`

Discard an unpaid tab. Needs a reason once anything has gone to the kitchen/bar.

### `tabs.tab_get(table_id)`

### `tabs.tab_kot(table_id, station=None)`

Print what is NEW (and what was cancelled) since the last ticket for a station.

### `tabs.tab_open(table_id, covers=None)`

### `tabs.tab_save(table_id, lines, covers=None)`

Replace the tab's items with ``lines`` (each with a stable ``key``), priced by the server.

### `tabs.tab_transfer(from_table_id, to_table_id)`

Move a tab to another table; if the target already has one, the two are merged.

### `tabs.table_status()`

Spatial grid data: every table with free/occupied state, running total and age.

## `wipe`

Model: `orsquare.wipe.service`

### `wipe.preview()`

Step 1: what will be cleared and what is preserved (counts from the live database).

### `wipe.wipe_shop(confirm_name, password)`

---
*86 methods across 16 services.*
