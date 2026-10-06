# Master Specification: Retail Capabilities & Operational Features

This document provides the authoritative baseline for all specialized retail features, operational toggles, and hardware integrations across ORSquare, formalizing which capabilities are **Retained (Keep Now)**, **Redesigned**, **Postponed (Future Scope)**, or **Skipped**.

---

## 1. Feature Status & Roadmap Matrix

| # | Feature / Workflow | Phase Status | Settings Location | Architectural Foundation |
|---|---|---|---|---|
| **1** | **Auto-Godown Transfer on Checkout** | **Keep Now** | Settings $\rightarrow$ Sales Register | Owner-only toggle. Chained Odoo internal picking (`Godown` $\rightarrow$ `Counter`) preserving audit trail and cashier context. |
| **2** | **Continuous Scanning Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Rapid POS scanning workflow with UI cart lock/unlock safety guard and persistent local IndexedDB draft cart. |
| **3** | **Default Payment Mode** | **Keep Now** | Settings $\rightarrow$ Sales Register | Independent setting (`Cash`, `UPI`, `All / Prompt`). Works standalone or combined with Continuous Scanning. |
| **4** | **Granular Cashier Permissions** | **Keep Now & Improve** | Settings $\rightarrow$ Staff Access | Built 100% on native Odoo `res.groups`. Owner toggle matrix for tab grants, sensitive data masking (`can_see_money`, `can_see_valuation`), and return controls. |
| **5** | **Purchase & Sales Returns / Exchanges** | **Keep Now & Redesign** | Purchases & Sales | True bi-directional double-entry accounting and stock movements. Multi-line return/exchange tickets with automatic ledger netting. |
| **6** | **Restaurant Floor & Table Management** | **Keep Now & Redesign** | Settings $\rightarrow$ Tables | Redesigned setup UX: Dining Sections (AC, Garden, Bar) + Table cards + 1-click bulk table generator. Maps to standard Odoo `pos_restaurant`. |
| **7** | **Multi-Station Hardware & Thermal Printing** | **Keep Now (Decided)** | Settings $\rightarrow$ Bill & Receipt | Three-tier architecture: QZ Tray WebSocket bridge for silent ESC/POS printing (cut & drawer pulse) + local IndexedDB queue + browser print fallback. |
| **8** | **Unified 3-in-1 Discount System** | **Keep Now & Merge** | Sales $\rightarrow$ Discount Popover | Unified engine: (1) Smart 1-Tap Rounding (e.g. ₹124 $\rightarrow$ round to ₹100, suggest −₹24), (2) Saved Promo Presets (`FLAT50`, `10%`), and (3) Manual %/₹ entry. |
| **9** | **Bill Finder ("Recognition Over Recall")** | **Keep Now (Decided)** | Sales & Purchases Drawer | Two-tier search: Tier 1: Instant zero-latency lookup from local Dexie.js for recent bills (works offline); Tier 2: Asynchronous server search on Odoo `account.move`. |
| **10** | **Rate Cards & Retail Margins by Bottle Volume** | **Redesign (Keep Simple)** | Products $\rightarrow$ Units & Pricing | Attach lightweight size margins to Units of Measure (`uom.uom`). Cashiers sell at native `list_price`. 1-tap price helper during product creation. |
| **11** | **Closing Stock Audit & Reconciliation Engine** | **Postpone (Future Scope)** | Daybook (Future) | Postponed to future phase. Core Daybook cash opening, live expected cash, drawer count, and sealed Z-report snapshots satisfy current requirements. |
| **12** | **Wine Shop Sheet Register & WineStock Matrix** | **Postpone (Future Scope)** | Stock & Sheet (Future) | Postponed to future phase. Retained in documentation for specialized Indian statutory excise requirements. |
| **13** | **Product Master Library & Smart Importer** | **Skip Completely** | — | Excluded completely from the current phase. Not implemented or modified. |

---

## 2. Active Specifications (Keep Now & Redesigned)

### 1. Automatic Godown $\rightarrow$ Counter Transfer on Checkout
* **Owner Governance:** Configured in **Settings $\rightarrow$ Sales Register Controls** by Shop Owner only. Employees cannot view or edit this setting.
* **Operational Behavior:**
  * When a cashier rings up 5 bottles, but Counter has only 2 while Godown has $\ge 3$:
  * Upon settlement, Odoo atomically executes:
    1. **Internal Picking (`stock.picking` type `internal`):** Transfers 3 units from `WH/Stock/Godown` to `WH/Stock/Counter`. Sets `origin = f"Auto-Godown Transfer for Sale {sale_ref}"` and logs the cashier's user session.
    2. **Sale Delivery Picking:** Delivers 5 units from `WH/Stock/Counter` to `Customers` and posts the customer invoice.
  * If Godown also lacks stock, checkout halts with an explicit stockout warning.
* **Audit Trail:** Preserves full ledger integrity; the transfer is never invisible or unrecorded.

### 2. Continuous Scanning Mode & Independent Default Payment Mode
* **Continuous Scanning Mode (`prefs.continuousScanning`):**
  * POS screen hides quick category tiles, locks the cart table, and keeps barcode scanner focus permanent.
  * Scans append or increment items directly in an active **IndexedDB draft cart**.
  * **Crash Resilience:** If power cuts or browser closes, reopening `/sales` instantly rehydrates the draft cart with zero data loss.
  * **Safety Lock/Unlock:** A visual banner `[🔒 Cart Locked for Rapid Scanning]` prevents accidental line deletions. Cashier must click `[Unlock to Edit]` before modifying quantities or deleting lines manually.
* **Independent Default Payment Mode:**
  * Configured in Settings: `Default POS Payment Method = [ Cash | UPI | All / Prompt ]`.
  * Independent of Continuous Scanning. When set to `Cash`, tapping Settle or pressing `F8`/`Enter` completes the sale immediately as Cash without opening payment popups.

### 3. Granular Cashier Permissions & Sensitive Data Masking
* **Architecture:** Built strictly on native Odoo Security Groups (`res.groups`) and field-level access rules:
  * **Owner Dashboard:** Simple toggle matrix in **Settings $\rightarrow$ Staff Access**.
  * **Tab Grants:** Per-user checkboxes controlling accessible tabs (`sales`, `stock`, `products`, `accounts`, `cashflow`, `daybook`, `reports`).
  * `can_see_money`: When OFF, masks drawer cash, total daily gross revenue, and profit summaries from cashiers.
  * `can_see_valuation`: When OFF, masks supplier purchase rates, inventory asset valuations, and profit margins.
  * `can_manage_returns`: When OFF, cashiers cannot issue refunds, credit notes, or purchase exchanges without manager authorization.

### 4. Purchase & Sales Returns + Direct Replacement Exchanges
* **A. Purchase Return with Direct Replacement Exchange:**
  * Scenario: Damaged stock returned to vendor upon delivery and replaced immediately by the driver.
  * **Stock Movements:**
    - Return picking for damaged items: `WH/Stock/Godown` $\rightarrow$ `Vendors`.
    - Inward receipt for replacement items: `Vendors` $\rightarrow$ `WH/Stock/Godown`.
  * **Accounting:**
    - If values match: Wash transaction; supplier payable balance remains untouched.
    - If price difference exists: Credit Note and Vendor Bill net automatically, leaving the exact net adjustment on the supplier ledger.
* **B. Sales Return with Direct Exchange at POS:**
  * Single POS ticket supporting negative and positive items (e.g. Return Beer A ₹150, Take Beer B ₹180 $\rightarrow$ Net payable ₹30).
  * Automatically returns Beer A to `WH/Stock/Counter`, delivers Beer B to `Customers`, adjusts tax accounts, and collects ₹30 from the customer.

### 5. Restaurant Floor Layout & Table Management (Redesigned)
* **Redesigned Settings UX (Settings $\rightarrow$ Tables):**
  1. **Dining Sections (Floors):** Clean chip list to manage sections (`AC Hall`, `Non-AC`, `Garden`, `Rooftop Terrace`, `Bar Counter`).
  2. **Table Cards:** Simple cards showing Table #, Cover Capacity, and assigned Section.
  3. **1-Click Bulk Creator:** Simple modal: Section dropdown + Table Number Range (e.g. `1 to 10`) + Covers per Table (`4`) $\rightarrow$ generates all 10 tables in one click.
* **Odoo Engine:** Maps 1:1 to native Odoo `pos_restaurant` (`restaurant.floor` & `restaurant.table`).

### 6. Multi-Station Hardware & Thermal Printing Engine
* **Three-Tier Architecture:**
  1. **Tier 1 (QZ Tray WebSocket Bridge):** Connects to local QZ Tray (`ws://localhost:8182`) to send raw ESC/POS commands to USB, Network/LAN, or Bluetooth printers.
     - **Silent:** Prints in <100ms with **zero browser print dialogs**.
     - **Hardware Pulses:** Auto paper-cut (`\x1d\x56\x41\x03`) and cash drawer kick pulse (`\x1b\x70\x00\x19\xfa`).
  2. **Tier 2 (Durable Local Queue):** Buffers print jobs in IndexedDB. Retries automatically on paper-out or reconnect without freezing checkout.
  3. **Tier 3 (Browser Print Fallback):** If QZ Tray is not installed, falls back seamlessly to standard `@media print` browser printing.
  4. **Presets:** Standard character layouts for **80mm** (48 cols) and **58mm** (32 cols).

### 7. Unified 3-in-1 Discount System
* Consolidates manual discounts, saved promo schemes, and smart rounding into a single POS popover:
  1. **Smart 1-Tap Rounding Pill:** If bill total is ₹124, displays `[Round to ₹100: −₹24]` and `[Round to ₹120: −₹4]`. One click applies it.
  2. **Saved Promo Presets:** 1-tap chips for shop promo schemes (`[Regular 5%]`, `[Happy Hour 10%]`, `[FLAT ₹50]`).
  3. **Manual Entry:** Single input with `%` vs. `₹` switch.
* **Tax Compliance:** Prorated across bill lines by gross value to preserve exact GST slab taxation.

### 8. Bill Finder ("Recognition Over Recall")
* **Two-Tier Search Engine:**
  1. **Tier 1 (Instant Local Search - Dexie.js):** Bills from active daybook and recent days are cached locally. Opening the drawer shows recent bills immediately with 0ms network latency. Debounced search filters by Bill #, customer name, phone, or amount.
  2. **Tier 2 (Deep Server Archive - Odoo API):** If searching for older bills (>7 days), an asynchronous query searches Odoo `account.move` records.
* Provides 1-tap actions: *Reprint Receipt*, *Issue Return / Exchange*, *View Details*.

### 9. Rate Cards & Retail Margins by Bottle Volume (Simplified)
* **Architecture:**
  * Selling prices remain authoritative on `product.template.list_price` (simplest, zero overhead).
  * Bottle size margins are stored as lightweight attributes on the Unit of Measure (`uom.uom`).
  * **Product Setup UX:** In Product form, entering purchase cost ₹180 on a 750ml bottle displays a 1-tap helper: `[Auto-Set Selling Price: ₹180 + ₹25 = ₹205]`.
  * **Reporting:** Daybook turnover reports multiply pieces sold by the size margin to compute estimated volume gross margins.

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
