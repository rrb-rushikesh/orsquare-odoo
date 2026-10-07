# Master Specification: Retail Capabilities & Operational Features

> **Status review — 2026-10-07:** This is a scope/requirements document, not an implemented-feature list. Preserve the restored original UI; “redesign” labels below do not authorize a new visual direction. See [current status](../STATUS.md).

This document provides the authoritative, locked baseline for all specialized retail features, operational toggles, tax regimes, and hardware integrations across ORSquare, formalizing which capabilities are **Retained (Keep Now)**, **Redesigned**, **Postponed (Future Scope)**, or **Skipped**.

---

## 1. Feature Status & Roadmap Matrix

| # | Feature / Workflow | Phase Status | Settings Location | Architectural Foundation |
|---|---|---|---|---|
| **1** | **Auto-Godown Transfer on Checkout** | **Keep Now** | Settings $\rightarrow$ Sales Register | Owner-only toggle. Executed inside the same atomic Odoo transaction with native reservation and PostgreSQL row locks. Invariant of zero overselling and zero negative stock is verified and proven via concurrent integration tests, with Odoo's reservation machinery as the authority. |
| **2** | **Continuous Scanning Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Rapid POS scanning workflow with UI cart lock/unlock safety guard and durable IndexedDB draft cart that persists across browser crashes and power loss until settlement. |
| **3** | **Default Payment Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Independent setting (`Cash`, `UPI`, `All / Prompt`). Works standalone or combined with Continuous Scanning. |
| **4** | **Granular Cashier Permissions** | **Keep Now & Improve** | Settings $\rightarrow$ Staff Access | Built 100% on native Odoo `res.groups` and field security. Owner toggle matrix for tab grants, sensitive data masking (`can_see_money`, `can_see_valuation`), and return controls. |
| **5** | **Transaction-Type-Aware Returns & Exchanges** | **Keep Now & Redesign** | Purchases & Sales | Backend generates appropriate stock reversal and accounting document based on whether original transaction was a POS sale, customer invoice, or vendor bill. |
| **6** | **Multi-Tax Regimes & Configurable Tax Mappings** | **Keep Now & Locked** | Products & Billing | Configurable statutory tax regime and tax mapping configuration. Separates alcoholic liquor (outside GST under CGST Sec 9 & Art 366(12A), subject to state levies/VAT & Sec 206C TCS) from GST retail merchandise, with Maharashtra as initial reference but fully configurable for any state without hard-coded rates. |
| **7** | **Restaurant Floor & Table Management** | **Keep Now & Redesign** | Settings $\rightarrow$ Tables | Redesigned setup UX: Dining Sections (AC, Garden, Bar) + Table cards + 1-click bulk table generator. Maps to standard Odoo `pos_restaurant`. |
| **8** | **Multi-Station Hardware & Thermal Printing** | **Keep Now (Decided)** | Settings $\rightarrow$ Bill & Receipt | Three-tier architecture: QZ Tray WebSocket bridge for silent ESC/POS printing (cut & drawer pulse) + local IndexedDB queue + browser print fallback. Latency (<100ms) treated as a benchmark target. |
| **9** | **Discounts vs. Rounding vs. Settlement Concession** | **Keep Now & Redesign** | Sales $\rightarrow$ Discount & Settlement | Explicit user classification between: (1) Trade Discounts (pre-tax, affects taxable base), (2) Statutory Round-off (Sec 170 CGST Act), and (3) Collection/Settlement Differences (post-tax accounting adjustment). |
| **10** | **Bill Finder ("Recognition Over Recall")** | **Keep Now (Decided)** | Sales & Purchases Drawer | Two-tier search: Tier 1: Instant local lookup from Dexie.js for recent bills (works offline, benchmark responsiveness target); Tier 2: Asynchronous server search on Odoo `account.move`. |
| **11** | **Rate Cards as Optional Price-Setting Assistance** | **Redesign (Keep Simple)** | Products $\rightarrow$ Pricing Rules | Margin rules attached to Category & Pricing configuration (`orsquare.margin_rule`). Provides optional 1-tap selling price suggestion during product setup without silently overwriting prices. |
| **12** | **Native Odoo Landed Costs** | **Keep Now & Standard** | Purchases $\rightarrow$ Landed Costs | The ORSquare checkbox is purely a UX control; actual valuation is performed 100% by Odoo's native landed-cost mechanism into AVCO/FIFO layers. No parallel costing engine is built. |
| **13** | **Closing Stock Audit & Reconciliation Engine** | **Postpone (Future Scope)** | Daybook (Future) | Postponed to future phase. Core Daybook cash opening, live expected cash, drawer count, and sealed Z-report snapshots satisfy current requirements. |
| **14** | **Wine Shop Sheet Register & WineStock Matrix** | **Postpone (Future Scope)** | Stock & Sheet (Future) | Postponed to future phase. Retained in documentation for specialized Indian statutory excise requirements. |
| **15** | **Product Master Library & Smart Importer** | **Skip Completely** | — | Excluded completely from current phase. Not implemented or modified. |

---

## 2. Active Technical Specifications

### 1. Multi-Tax Regimes: Configurable Statutory Tax Regimes & Tax Mappings
* **Statutory Baseline:** Under Article 366(12A) of the Constitution of India and Section 9(1) of the CGST Act, alcoholic liquor for human consumption is constitutionally excluded from GST and subject to state taxation. Section 206C(1) of the Income Tax Act also mandates Tax Collected at Source (TCS) on wholesale alcoholic liquor transactions (currently listed at 1% for alcoholic liquor).
* **Configurable Architecture (No Hard-Coded State or Rates):**
  * Rather than relying on a rigid, static boolean product flag or hard-coding a specific state tax (like "MVAT") or specific rates into the codebase, ORSquare implements a flexible **tax regime and tax mapping configuration** powered by Odoo's native tax and fiscal position framework (`account.tax`, `account.fiscal.position`):
  1. **Configurable Statutory Regimes:** State liquor levies, VAT, and excise structures vary across Indian states and change over time. The platform supports Maharashtra as the initial reference configuration (State VAT + statutory TCS), while keeping state taxes, cess, surcharge, and levy rates fully configurable for any Indian state without code changes.
  2. **Context-Aware Tax Mappings:** A product's tax treatment is resolved dynamically via tax mapping configurations based on transaction context, counter type, customer/vendor state, date, and fiscal position, rather than a single restrictive static product flag.
  3. **GST Retail Merchandise:** Packaged snacks, water, soda, bar accessories, and kitchen dishes are mapped through standard Indian GST tax structures (`l10n_in`).
  4. **Strict Reporting Segregation:** Output VAT/state excise schedules, Section 206C TCS registers, and GSTR-1/3B filings are partitioned cleanly into their respective statutory journals and ledgers.
* **Universal Billing Engine:** Purchase bills, POS checkouts, and B2B invoices evaluate each line item against its configured tax regime and mapping, computing State VAT, TCS, or GST independently on the same commercial voucher without cross-contamination.

---

### 2. Automatic Godown $\rightarrow$ Counter Transfer on Checkout (Concurrency Protected)
* **Owner Governance:** Configured in **Settings $\rightarrow$ Sales Register Controls** by Shop Owner only.
* **Operational Behavior:**
  * When a cashier rings up 5 bottles, Counter has 2, and Godown has $\ge 3$:
* **Transaction Atomicity & Concurrency Protection:**
  * The stock reservation, internal transfer, sale delivery, and associated invoice/payment records are executed inside the **same appropriate Odoo database transaction and either all succeed or the entire operation is rolled back**.
  * Utilizes PostgreSQL row-level locks on `stock.quant` through Odoo's native stock reservation system (`stock_move._action_assign()`).
  * If multiple terminals attempt to sell the last remaining Godown units simultaneously, competing database transactions safely queue on row locks and re-evaluate available stock.
  * **Test-Proven Invariant:** Maintaining zero overselling, zero phantom sales, and zero negative inventory is treated as a critical design invariant that is rigorously proven and verified through concurrent automated integration and load tests (simulating concurrent cashiers across terminals), relying on Odoo's core reservation and valuation machinery as the sole authority.
* **Audit Trail:** Sets `origin = f"Auto-Godown Transfer for Sale {sale_ref}"` and logs the cashier's user session.

---

### 3. Continuous Scanning Mode & Independent Default Payment Mode
* **Continuous Scanning Mode (`prefs.continuousScanning`):**
  * POS screen hides category tiles, locks the cart table, and keeps barcode scanner focus permanent.
  * Scans stream directly into an active draft bill in **IndexedDB**.
  * **Durable Draft Guarantee:** The draft cart is durable and append-only. If the browser crashes, computer loses power, or network drops, reopening `/sales` synchronously restores the active draft cart with zero data loss until explicit settlement or explicit cancellation.
  * **Safety Lock/Unlock:** A visual banner `[🔒 Cart Locked for Rapid Scanning]` prevents accidental line deletions or price tampering. Cashier must click `[Unlock to Edit]` before modifying quantities or deleting lines manually.
* **Independent Default Payment Mode:**
  * Configured in Settings: `Default POS Payment Method = [ Cash | UPI | All / Prompt ]`.
  * Completely independent of Continuous Scanning. When set to `Cash`, tapping Settle or pressing `F8`/`Enter` completes the sale immediately as Cash without opening payment popups.

---

### 4. Granular Cashier Permissions & Sensitive Data Masking
* **Architecture:** Built strictly on native Odoo Security Groups (`res.groups`) and field-level access rules:
  * **Owner Dashboard:** Simple toggle matrix in **Settings $\rightarrow$ Staff Access**.
  * **Tab Grants:** Per-user checkboxes controlling accessible tabs (`sales`, `stock`, `products`, `accounts`, `cashflow`, `daybook`, `reports`).
  * `can_see_money`: When OFF, masks drawer cash, total daily gross revenue, and profit summaries from cashiers.
  * `can_see_valuation`: When OFF, masks supplier purchase rates, inventory asset valuations, and profit margins.
  * `can_manage_returns`: When OFF, cashiers cannot issue refunds, credit notes, or purchase exchanges without manager authorization.

---

### 5. Transaction-Type-Aware Returns & Exchanges
* **Core Rule:** The backend must create the **appropriate stock reversal and accounting document according to whether the original transaction was a POS sale, customer invoice, vendor bill, etc.**
  1. **Retail POS Counter Return / Exchange:**
     - Creates a POS return order / session refund movement tied to the POS journal and Counter location.
     - Does NOT force an unnecessary B2B invoice credit note workflow for simple counter slips.
     - For exchanges, positive and negative lines settle on the same POS receipt, netting cash/UPI automatically.
  2. **B2B Customer Invoice Return / Exchange:**
     - Generates a formal statutory Credit Note (`out_refund` referencing the original invoice `reversed_entry_id` for GSTR-1 credit adjustments) paired with a new Tax Invoice (`out_invoice`).
  3. **Vendor Purchase Bill Return / Exchange:**
     - Generates a formal Vendor Credit Note (`in_refund` referencing original vendor bill) paired with a new Vendor Bill (`in_invoice`), linking incoming replacement receipts and outgoing return pickings.
* **Frontend UX:** The user interacts with a unified, clean Return/Exchange experience across all surfaces, while the backend generates the legally compliant document structure.

---

### 6. Native Odoo Landed Costs (`stock.landed.cost`)
* **Standard Framework & Architectural Boundary:**
  * **ORSquare's checkbox (`[✓] Capitalize into Inventory Cost`) is strictly a UX control; the actual valuation and cost allocation must be performed entirely by Odoo's native landed-cost mechanism (`stock.landed.cost`).**
  * **Strict Prohibition:** Do NOT build a parallel or custom ORSquare costing or inventory valuation engine.
* **Workflow:**
  * In Advanced Purchase Bills, selecting the capitalization control marks the expense line as a landed cost linked to the incoming purchase picking (`stock.picking`).
  * Odoo's native automated inventory valuation adjusts the product's Moving Weighted Average Cost (AVCO) directly in `stock.valuation.layer` with complete accounting and audit compliance.

---

### 7. Rate Cards as Optional Price-Setting Assistance
* **Decoupled Architecture:** Margin rules are **never stored on `uom.uom`**. Units of measure remain pure physical dimensions (`ml`, `L`, `Piece`).
* **Optional Helper Rule:**
  * Margin rules are attached to Category & Pricing configuration (`orsquare.margin_rule`: Category + Size $\rightarrow$ Margin Amount).
  * In the Product Form, entering a purchase cost of ₹180 on a 750ml Whisky bottle looks up the Whisky 750ml margin rule (₹25) and displays:  
    `Suggested Selling Price: ₹205 (₹180 cost + ₹25 suggested margin) [Apply Suggestion]`
  * **Non-Intrusive:** The suggestion is strictly optional assistance. It **never automatically overwrites or changes the actual selling price** without explicit user confirmation.
  * Cashiers continue to sell at native `product.template.list_price` with zero runtime pricing overhead.

---

### 8. Commercial Discounts vs. Round-off vs. Settlement Differences
To prevent legal and tax distortion, the system provides explicit user classification:
1. **Trade / Commercial Discount (Pre-Tax):**
   * Documented discount (coupons, percentage, or flat ₹) applied before tax.
   * Reduces the taxable base and proportionally lowers output tax liabilities where legally applicable.
2. **Statutory Round-off:**
   * Minor rounding of final invoice amount to the nearest ₹1.00 under Section 170 CGST Act, booked to standard Round-off ledger (`account.account`).
3. **Collection / Settlement Difference (Post-Tax Cash Concession):**
   * When a customer short-pays due to lack of change (e.g. bill total is ₹124 and customer pays ₹100 cash), the user explicitly chooses whether it is:
     - (a) A **Trade Discount** (which recalculates taxable value and tax), or
     - (b) A **Settlement Shortfall / Concession** (which preserves the full legal tax invoice value and books the ₹24 difference to a dedicated "Cash Settlement Difference / Cash Loss" expense ledger without rewriting the tax record).

---

### 9. Multi-Station Hardware & Thermal Printing Engine
* **Three-Tier Architecture:**
  1. **Tier 1 (QZ Tray WebSocket Bridge):** Connects to local QZ Tray (`ws://localhost:8182`) to send raw ESC/POS commands to USB, Network/LAN, or Bluetooth printers.
     - **Silent:** Prints with zero browser print dialogs.
     - **Hardware Pulses:** Auto paper-cut (`\x1d\x56\x41\x03`) and cash drawer kick pulse (`\x1b\x70\x00\x19\xfa`).
     - **Performance Target:** `<100ms` dispatch latency is treated as a **benchmark target to measure and validate**, not an assumed guarantee.
  2. **Tier 2 (Durable Local Queue):** Buffers print jobs in IndexedDB. Retries automatically on paper-out or reconnect without freezing checkout.
  3. **Tier 3 (Browser Print Fallback):** If QZ Tray is not installed, falls back cleanly to browser `@media print` printing.
  4. **Presets:** Standard character layouts for **80mm** (48 cols) and **58mm** (32 cols).

---

### 10. Bill Finder ("Recognition Over Recall")
* **Two-Tier Search Engine:**
  1. **Tier 1 (Instant Local Search - Dexie.js):** Bills from active daybook and recent days are cached locally. Opening the drawer renders recent bills with instantaneous local responsiveness (benchmark target: <10ms local query). Debounced search filters by Bill #, customer name, phone, or amount.
  2. **Tier 2 (Deep Server Archive - Odoo API):** If searching for older bills (>7 days), an asynchronous query searches Odoo `account.move` records.
* Provides 1-tap actions: *Reprint Receipt*, *Issue Return / Exchange*, *View Details*.

---

### 11. Restaurant Floor Layout & Table Management (Redesigned)
* **Redesigned Settings UX (Settings $\rightarrow$ Tables):**
  1. **Dining Sections (Floors):** Clean chip list to manage sections (`AC Hall`, `Non-AC`, `Garden`, `Rooftop Terrace`, `Bar Counter`).
  2. **Table Cards:** Simple cards showing Table #, Cover Capacity, and assigned Section.
  3. **1-Click Bulk Creator:** Simple modal: Section dropdown + Table Number Range (e.g. `1 to 10`) + Covers per Table (`4`) $\rightarrow$ generates all 10 tables in one click.
* **Odoo Engine:** Maps 1:1 to native Odoo `pos_restaurant` (`restaurant.floor` & `restaurant.table`).

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

---

## 5. Architectural Invariant & Operational Principle

> [!IMPORTANT]
> **Core System Division of Responsibility:**
> **ORSquare simplifies the user's actions; Odoo remains responsible for the accounting, inventory valuation, tax calculation, and ledger truth.**
>
> 1. **UX Control vs. Engine Authority:** Frontend and custom ORSquare settings switches (e.g. `[✓] Capitalize into Inventory Cost`, simple bill entry) are purely UX controls. No parallel costing, tax calculation, or inventory valuation engines are built inside ORSquare.
> 2. **Odoo as Ledger Truth:** Native Odoo 18 Community models (`account.move`, `stock.valuation.layer`, `stock.quant`, `account.tax`, `account.fiscal.position`, `stock.landed.cost`) execute all financial entries, cost allocations, and inventory state transitions.
> 3. **Verification via Concurrent Testing:** Concurrency invariants (zero overselling, zero phantom sales, zero negative stock) are verified through automated multi-user integration and load tests rather than taken as unmeasured assumptions.

