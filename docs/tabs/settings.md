# Tab Specification: Settings

> **Status review — 2026-10-08:** Device preferences exist. **Business Studio** (presets, tabs, features, stock/accounts views, sales-register switches, day cutoff hour), **Team & Access** (roles, data switches, tab grants, password and authenticator reset, plan staff limit) and **Security & activity** (own two-step sign-in, who-changed-what log) are connected and shared with the Developer Console ([governance](../governance.md)). Tables setup and the old Data Control page (cutoff view, wipe, restore) are still disconnected. The rest of this document describes requirements; see [current status](../../STATUS.md).

**Route:** `/settings`  
**Purpose:** Master shop configuration, hardware integration, billing templates, staff permissions, and operational data controls.  
**Underlying Engine:** Shop preferences model + native Odoo `res.users`, `res.groups`, and `pos_restaurant` table models.

---

## 1. Master Configuration Areas

| Setting Area | Scope & Operational Capabilities |
|---|---|
| **Appearance** | Theme selection (Light / Dark mode), interface density (Standard / Compact). |
| **Bill & Invoice** | **Dual Bill-Template System:** Dedicated template engines for **Compact Thermal (58mm / 80mm)** and **Large Format (A4 Tax Invoice)** with live side-by-side previews. Controls store branding, GSTIN, FSSAI, Liquor License No, Statutory Excise bottle matrix footer (IMFL/Wine/Beer), Bank details, dynamic UPI QR code, and sequential invoice numbering prefix (e.g. `INV-`). See [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md). |
| **Hardware & Printing** | **Three-Tier Thermal Printing Engine:**<br>• **Tier 1 (QZ Tray Bridge):** Self-healing WebSocket to Windows QZ Tray for background silent raw ESC/POS printing (dispatch latency target: <100ms benchmark) with auto paper cut (`\x1d\x56\x41\x03`) and cash drawer kick pulse (`\x1b\x70\x00\x19\xfa`). Zero browser print dialogs.<br>• **Tier 2 (Durable Local Queue):** Buffers print jobs in IndexedDB, auto-retrying on paper-out or disconnect.<br>• **Tier 3 (Browser Fallback):** Clean `@media print` browser printing if QZ Tray is not installed. |
| **Sales Register Controls** | **Checkout Optimization:**<br>• **Continuous Scanning Mode:** Rapid POS scanning workflow with visual cart lock/unlock guardrail to prevent accidental edits during rush hours.<br>• **Independent Default Payment Mode:** Locks checkout tender to `Cash`, `UPI`, or `All / Prompt`, routing keyboard shortcuts (F8/Enter) directly to the chosen tender without dialog popups.<br>• **Auto-Godown Transfer:** Owner switch enabling automated internal picking (`Godown` $\rightarrow$ `Counter`) on checkout with atomic PostgreSQL row-level locks preventing concurrent double-allocation. |
| **Costing & Purchases** | **Configurable Cost Composition Policy:** Independent switches for factoring discounts, freight/handling, and taxes into product piece rates and AVCO valuations. |
| **Day Closing Rules** | **Audit Governance:**<br>• **Cash Materiality Threshold (₹):** Allowed cash difference tolerance at close (e.g. ₹5.00) permitting day closing without blocking for trivial change shortages. |
| **Business Studio** | **Master Experience Customizer:** Toggle tabs (Sales, Stock, Purchases, Accounts) and enable feature extensions (*Open Bottle* peg mode, restaurant *Tables* mode, *Kitchen* mode). |
| **Tables & Seating** | **Redesigned Restaurant Floor Setup:**<br>• **Dining Sections (Floors):** Clean chip list to manage sections (`AC Hall`, `Non-AC`, `Garden`, `Rooftop Terrace`, `Bar Counter`).<br>• **Table Cards:** Simple cards showing Table #, Cover Capacity, and assigned Section.<br>• **1-Click Bulk Table Generator:** Modal with Section + Number Range (`1 to 10`) + Covers (`4`) $\rightarrow$ generates tables in 1 tap.<br>• Maps directly to native Odoo `pos_restaurant` (`restaurant.floor` & `restaurant.table`). |
| **Staff Access** | **Granular Role Governance:** Per-employee tab grants, plus sensitive data masking switches (`can_see_money`, `can_see_valuation`, `can_manage_returns`). |
| **Data Control & Safe Wipe** | **Lifecycle Management:** Business-day cutoff hour (e.g. 02:00 AM) and 2-step safe shop data wiping with automated pre-wipe backup. See [`docs/data-control-and-wipe.md`](../data-control-and-wipe.md). |

---

## 2. Staff Access Control & Sensitive Data Masking

Staff governance leverages native Odoo Security Groups (`res.groups`) and Record Rules:
* **Shop Owner:** Full system access, ledger review, cost valuations, re-audit, settings, and data wipe.
* **Per-Employee Tab Grants:** Owner selects exact accessible tabs (`dashboard`, `sales`, `stock`, `products`, `accounts`, `cashflow`, `daybook`, `reports`).
* **`can_see_money`:** When disabled, hides drawer cash balances, daily gross sales revenue, and profit summaries from cashiers.
* **`can_see_valuation`:** When disabled, hides supplier purchase rates, inventory asset valuations, and gross margins from staff.
* **`can_manage_returns`:** Restricts creating credit notes or processing distributor purchase returns.

---

## 3. Data Control & Safe Wipe
* Allows wiping transactional data (clearing practice bills, moves, and daybooks) while preserving products, partners, chart of accounts, and system configuration.
* Requires 2-step verification (typing shop name and password).
* Automatically triggers a pre-wipe database backup before clearing data.
