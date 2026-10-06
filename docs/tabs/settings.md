# Tab Specification: Settings

**Route:** `/settings`  
**Purpose:** Master shop configuration, hardware integration, billing templates, staff permissions, and operational data controls.  
**Underlying Engine:** Shop preferences model + native Odoo `res.users`, `res.groups`, and `pos_restaurant` table models.

---

## 1. Master Configuration Areas

| Setting Area | Scope & Operational Capabilities |
|---|---|
| **Appearance** | Theme selection (Light / Dark mode), interface density (Standard / Compact). |
| **Bill & Invoice** | **Dual Bill-Template System:** Dedicated template engines for **Compact Thermal (58mm / 80mm)** and **Large Format (A4 Tax Invoice)** with live side-by-side previews. Controls store branding, GSTIN, FSSAI, Liquor License No, Statutory Excise bottle matrix footer (IMFL/Wine/Beer), Bank details, dynamic UPI QR code, and sequential invoice numbering prefix (e.g. `INV-`). See [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md). |
| **Hardware & Printing** | **Thermal Printing Engine:**<br>• **QZ Tray Bridge:** Self-healing WebSocket to Windows QZ Tray for background silent printing without browser dialogs.<br>• **ESC/POS Generator:** Auto paper cutting (`\x1d\x56\x41\x03`) and cash drawer kick pulse (`\x1b\x70\x00\x19\xfa`).<br>• **Print Modes:** *Prompt Cashier* (ask every bill), *Always Print* (speed POS queue), *Paperless* (silent digital checkout).<br>• **Fallback:** Browser HTML printing when QZ Tray is not running. |
| **Sales Register Controls** | **Checkout Optimization:**<br>• **Continuous Scanning Mode:** Locks cart and accumulates high-speed USB scanner input directly into draft bills.<br>• **Enforce Payment Method:** Locks checkout to a single tender (`Cash only`, `UPI only`, or `All`), routing keyboard shortcuts directly to the selected method. |
| **Costing & Purchases** | **Configurable Cost Composition Policy:** Independent switches for factoring discounts, freight/handling, and taxes into product piece rates and AVCO valuations. |
| **Day Closing Rules** | **Audit Governance:**<br>• **Cash Difference Allowed (₹):** Materiality threshold for drawer closing tolerance.<br>• **Closing Count Strictness:** *Simple* (moved items only) vs. *Rigorous* (Blind Physical Inventory Count - hides expected system quantities). |
| **Business Studio** | **Master Experience Customizer:** Toggle tabs (Sales, Stock, Purchases, Accounts), choose variants (*WineStock Matrix* vs. *Standard Stock*), and enable feature extensions (*Open Bottle* peg mode, restaurant *Tables* mode, *Kitchen* mode). |
| **Tables & Seating** | **Restaurant Floor Grid Editor:** Interactive grid editor (rows 1-8, cols 1-12) to configure table numbers, covers, and dining sections (AC, Non-AC, Garden, Terrace, Bar). |
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
