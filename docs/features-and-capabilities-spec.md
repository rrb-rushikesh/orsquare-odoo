# Master Specification: Retail Capabilities & Operational Features

This document provides the authoritative baseline for all specialized retail features, operational toggles, and hardware integrations across ORSquare, formalizing which capabilities are **Retained (Keep Now)**, **Redesigned**, **Postponed (Future Scope)**, or **Skipped**.

---

## 1. Feature Status & Roadmap Matrix

| # | Feature / Workflow | Phase Status | Settings Location | Architectural Foundation |
|---|---|---|---|---|
| **1** | **Auto-Godown Transfer on Checkout** | **Keep Now** | Settings $\rightarrow$ Sales Register | Owner-only toggle. Atomic chained internal picking with PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) and Odoo stock reservation to prevent concurrent double-allocation. |
| **2** | **Continuous Scanning Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Rapid POS scanning workflow with UI cart lock/unlock safety guard and durable IndexedDB draft cart that survives browser crashes and power loss until settlement. |
| **3** | **Default Payment Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Independent setting (`Cash`, `UPI`, `All / Prompt`). Works standalone or combined with Continuous Scanning. |
| **4** | **Granular Cashier Permissions** | **Keep Now & Improve** | Settings $\rightarrow$ Staff Access | Built 100% on native Odoo `res.groups` and field security. Owner toggle matrix for tab grants, sensitive data masking (`can_see_money`, `can_see_valuation`), and return controls. |
| **5** | **Purchase & Sales Returns / Exchanges** | **Keep Now & Redesign** | Purchases & Sales | True bi-directional double-entry accounting. Paired Credit/Debit Note + New Invoice/Bill handling unequal values, different tax slabs, and automatic ledger netting. |
| **6** | **Restaurant Floor & Table Management** | **Keep Now & Redesign** | Settings $\rightarrow$ Tables | Redesigned setup UX: Dining Sections (AC, Garden, Bar) + Table cards + 1-click bulk table generator. Maps to standard Odoo `pos_restaurant`. |
| **7** | **Multi-Station Hardware & Thermal Printing** | **Keep Now (Decided)** | Settings $\rightarrow$ Bill & Receipt | Three-tier architecture: QZ Tray WebSocket bridge for silent ESC/POS printing (cut & drawer pulse) + local IndexedDB queue + browser print fallback. Latency (<100ms) treated as a benchmark target. |
| **8** | **Discounts & Settlement Rounding** | **Keep Now & Redesign** | Sales $\rightarrow$ Discount & Settlement | Strict separation between: (1) Pre-tax Commercial Discounts (coupons, manual %/₹ affecting taxable value), and (2) Post-tax Settlement Rounding / Cashier Concessions (preserving statutory tax liabilities). |
| **9** | **Bill Finder ("Recognition Over Recall")** | **Keep Now (Decided)** | Sales & Purchases Drawer | Two-tier search: Tier 1: Instant local lookup from Dexie.js for recent bills (works offline, instant responsiveness benchmark); Tier 2: Asynchronous server search on Odoo `account.move`. |
| **10** | **Rate Cards & Retail Margins by Bottle Volume** | **Redesign (Keep Simple)** | Products $\rightarrow$ Pricing Rules | Margin rules decoupled from `uom.uom` and attached to Category/Pricing configuration (`orsquare.margin_rule`). Cashiers sell at native `list_price`. 1-tap price helper during product setup. |
| **11** | **Closing Stock Audit & Reconciliation Engine** | **Postpone (Future Scope)** | Daybook (Future) | Postponed to future phase. Core Daybook cash opening, live expected cash, drawer count, and sealed Z-report snapshots satisfy current requirements. |
| **12** | **Wine Shop Sheet Register & WineStock Matrix** | **Postpone (Future Scope)** | Stock & Sheet (Future) | Postponed to future phase. Retained in documentation for specialized Indian statutory excise requirements. |
| **13** | **Product Master Library & Smart Importer** | **Skip Completely** | — | Excluded completely from the current phase. Not implemented or modified. |

---

## 2. Active Technical Specifications

### 1. Automatic Godown $\rightarrow$ Counter Transfer on Checkout (Concurrency Protected)
* **Owner Governance:** Configured in **Settings $\rightarrow$ Sales Register Controls** by Shop Owner only. Employees cannot view or edit this setting.
* **Operational Behavior:**
  * When a cashier rings up 5 bottles, but Counter has only 2 while Godown has $\ge 3$:
  * Upon checkout confirmation, the backend executes an **atomic database transaction** (`with env.cr.savepoint():`).
* **Concurrency & Race Condition Protection:**
  * **The Risk:** Two cashiers on separate terminals could simultaneously ring up the last 5 bottles in Godown. Naive sequential API calls would cause phantom sales or negative stock.
  * **Odoo 18 Concurrency Architecture:**
    1. The auto-transfer service initiates an internal picking (`WH/Stock/Godown` $\rightarrow$ `WH/Stock/Counter`, Qty: 3) and executes Odoo's native reservation lock (`stock_move._action_assign()`), triggering row-level PostgreSQL locks (`SELECT ... FOR UPDATE` on `stock.quant`).
    2. Terminal 1 acquires the reservation lock; Terminal 2's reservation attempt fails immediately with `Insufficient Stock in Godown`.
    3. If reservation fails, Terminal 2's transaction safely rolls back, and the UI immediately halts with: *"Stock already allocated by another terminal. Available in Godown: 0."*
    4. Upon successful reservation on Terminal 1, the picking validates, transfers the stock to Counter, delivers to the customer, and posts the invoice atomically.
* **Audit Trail:** Sets `origin = f"Auto-Godown Transfer for Sale {sale_ref}"` and logs the cashier's user session.

---

### 2. Continuous Scanning Mode & Independent Default Payment Mode
* **Continuous Scanning Mode (`prefs.continuousScanning`):**
  * POS screen hides category tiles, locks the cart table, and keeps barcode scanner focus permanent.
  * Scans stream directly into an active draft bill in **IndexedDB**.
  * **Durable Draft Guarantee:** The draft cart is durable and append-only. If the browser crashes, computer loses power, or network drops, reopening `/sales` synchronously restores the active draft cart with zero data loss until explicit settlement or explicit cancellation.
  * **Safety Lock/Unlock:** A visual banner `[🔒 Cart Locked for Rapid Scanning]` prevents accidental line deletions or price tampering. Cashier must click `[Unlock to Edit]` before modifying quantities or deleting lines manually.
* **Independent Default Payment Mode:**
  * Configured in Settings: `Default POS Payment Method = [ Cash | UPI | All / Prompt ]`.
  * Completely independent of Continuous Scanning. When set to `Cash`, tapping Settle or pressing `F8`/`Enter` completes the sale immediately as Cash without opening payment popups.

---

### 3. Granular Cashier Permissions & Sensitive Data Masking
* **Architecture:** Built strictly on native Odoo Security Groups (`res.groups`) and field-level access rules:
  * **Owner Dashboard:** Simple toggle matrix in **Settings $\rightarrow$ Staff Access**.
  * **Tab Grants:** Per-user checkboxes controlling accessible tabs (`sales`, `stock`, `products`, `accounts`, `cashflow`, `daybook`, `reports`).
  * `can_see_money`: When OFF, masks drawer cash, total daily gross revenue, and profit summaries from cashiers.
  * `can_see_valuation`: When OFF, masks supplier purchase rates, inventory asset valuations, and profit margins.
  * `can_manage_returns`: When OFF, cashiers cannot issue refunds, credit notes, or purchase exchanges without manager authorization.

---

### 4. Purchase & Sales Returns + Direct Replacement Exchanges (Multi-Tax & Value Rigor)
* **The Complexity:** Returns and exchanges cannot be represented as naive single netted vouchers because products often have different prices, different HSNs, and different GST tax slabs (e.g. returning a 28% GST item for a 12% GST item).
* **Architecture: Paired Statutory Accounting Documents:**
  * Every Return & Exchange transaction generates **two linked legal accounting documents** reconciled on the partner ledger:
  1. **Document 1: Reversal (Credit Note / Debit Note):**
     - Reverses the returned items with their *exact original prices, HSN codes, and tax slabs*.
     - Explicitly references the original invoice/bill number (`reversed_entry_id`).
     - Triggers an incoming or outgoing return picking (`stock.picking`).
  2. **Document 2: Outward Sale / Inward Purchase (New Invoice / Bill):**
     - Charges the replacement items with their *own proper rates and tax slabs*.
     - Triggers the corresponding delivery or receipt picking.
  3. **Financial Netting & Settlement:**
     - Odoo reconciles Document 1 against Document 2 on the partner ledger (`account.move.line` reconciliation).
     - **Case A (Replacement Value > Return Value):** Net difference collected from customer (or added to supplier payable).
     - **Case B (Replacement Value < Return Value):** Net difference refunded to customer (or deducted from supplier payable).
     - **Case C (Equal Value, Different Taxes):** Net cash difference is ₹0, but both Credit Note and Invoice post correctly to their respective tax ledgers, fully satisfying statutory GST audit requirements.
* **Frontend UX:** The cashier or stockkeeper interacts with a single unified "Exchange" ticket, while Odoo produces compliant dual documents in the backend.

---

### 5. Restaurant Floor Layout & Table Management (Redesigned)
* **Redesigned Settings UX (Settings $\rightarrow$ Tables):**
  1. **Dining Sections (Floors):** Clean chip list to manage sections (`AC Hall`, `Non-AC`, `Garden`, `Rooftop Terrace`, `Bar Counter`).
  2. **Table Cards:** Simple cards showing Table #, Cover Capacity, and assigned Section.
  3. **1-Click Bulk Creator:** Simple modal: Section dropdown + Table Number Range (e.g. `1 to 10`) + Covers per Table (`4`) $\rightarrow$ generates all 10 tables in one click.
* **Odoo Engine:** Maps 1:1 to native Odoo `pos_restaurant` (`restaurant.floor` & `restaurant.table`).

---

### 6. Multi-Station Hardware & Thermal Printing Engine
* **Three-Tier Architecture:**
  1. **Tier 1 (QZ Tray WebSocket Bridge):** Connects to local QZ Tray (`ws://localhost:8182`) to send raw ESC/POS commands to USB, Network/LAN, or Bluetooth printers.
     - **Silent:** Prints with zero browser print dialogs.
     - **Hardware Pulses:** Auto paper-cut (`\x1d\x56\x41\x03`) and cash drawer kick pulse (`\x1b\x70\x00\x19\xfa`).
     - **Performance Target:** `<100ms` dispatch latency is treated as a **benchmark target to measure and validate**, not an assumed guarantee.
  2. **Tier 2 (Durable Local Queue):** Buffers print jobs in IndexedDB. Retries automatically on paper-out or reconnect without freezing checkout.
  3. **Tier 3 (Browser Print Fallback):** If QZ Tray is not installed, falls back cleanly to browser `@media print` printing.
  4. **Presets:** Standard character layouts for **80mm** (48 cols) and **58mm** (32 cols).

---

### 7. Commercial Discounts vs. Settlement Rounding Adjustments
To protect statutory tax compliance, the platform cleanly distinguishes between commercial discounts and settlement roundings:

1. **Commercial / Trade Discounts (Pre-Tax):**
   * Includes Promo Coupons (`PROMO10`, `FLAT50`), manual percentage discounts, or fixed ₹ discounts.
   * Applied *before tax* directly to line items, reducing the taxable base and proportionally lowering output GST liabilities.
2. **Settlement Rounding & Cashier Concessions (Post-Tax):**
   * **Statutory Penny Round-off:** Automatic rounding to the nearest ₹1.00 (under Section 170 CGST Act), auto-booked to the standard Round-off Account (`account.account` Expense/Income).
   * **Cashier Settlement Concession:** When cash payment is rounded down (e.g. bill total is ₹124 and customer pays ₹100 due to lack of change), the system explicitly distinguishes whether it is:
     - (a) A **Trade Discount** (which recalculates tax liability), or
     - (b) A **Post-Tax Cash Concession** (which preserves the full tax invoice value and books the ₹24 variance to a dedicated "Cash Settlement Discount / Cash Loss" expense account without distorting statutory tax ledgers).

---

### 8. Bill Finder ("Recognition Over Recall")
* **Two-Tier Search Engine:**
  1. **Tier 1 (Instant Local Search - Dexie.js):** Bills from active daybook and recent days are cached locally. Opening the drawer renders recent bills with instantaneous local responsiveness (benchmark target: <10ms local query). Debounced search filters by Bill #, customer name, phone, or amount.
  2. **Tier 2 (Deep Server Archive - Odoo API):** If searching for older bills (>7 days), an asynchronous query searches Odoo `account.move` records.
* Provides 1-tap actions: *Reprint Receipt*, *Issue Return / Exchange*, *View Details*.

---

### 9. Rate Cards & Retail Margins by Bottle Volume (Decoupled Architecture)
* **Validation & Design Rule:**
  * Margins are **never stored on `uom.uom`**. A Unit of Measure is a pure physical dimension (e.g. 180 ml) and must not be polluted with commercial pricing rules. Furthermore, different beverage categories (e.g. 750ml Premium Scotch vs. 750ml Country Liquor) have completely different margins for the identical physical bottle size.
* **Architecture:**
  * Selling prices remain authoritative on `product.template.list_price`. Cashiers always ring up items at `list_price`.
  * Margin rules are attached to **Category & Pricing Configuration** via a dedicated `orsquare.margin_rule` table (`product_category_id` optional + `size_uom_id` $\rightarrow$ `margin_amount`).
  * **Product Setup UX:** In the Product form, entering purchase cost ₹180 on a 750ml Whisky bottle looks up the Whisky 750ml margin rule (₹25) and displays a 1-tap helper: `[Auto-Set Selling Price: ₹180 + ₹25 = ₹205]`.
  * **Reporting:** Daybook turnover reports multiply pieces sold by the category size margin to compute estimated volume gross margins.

---

## 3. Postponed Features (Marked as Future Scope)

1. **Closing Stock Audit & Discrepancy Reconciliation Engine:**
   * **Reason:** Core Daybook cash opening float, live expected cash calculation, physical drawer count, and sealed Z-report snapshots fully satisfy current base website requirements.
   * **Status:** Marked as Future Scope. Re-evaluated in future audit milestone.
2. **Indian Wine Shop Sheet Register & WineStock Matrix:**
   * **Reason:** Specialized statutory liquor excise fixture. Excluded from base retail launch.
   * **Status:** Marked as Future Scope. Requirements preserved in documentation for dedicated excise phase.

---

## 4. Skipped Features

1. **Product Master Library & Smart Importer:**
   * **Reason:** Canonical liquor barcode library and fuzzy Levenshtein spreadsheet importer are excluded from current scope.
   * **Status:** Skipped completely for current phase. Not touched or implemented.
