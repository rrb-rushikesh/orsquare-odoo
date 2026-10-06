# Tab Specification: Settings

**Route:** `/settings`  
**Purpose:** Shop configuration, billing preferences, hardware settings, permissions, and operational data controls.  
**Underlying Engine:** Shop preferences model + native Odoo `res.users`, `res.groups`, and `pos_restaurant` table models.

---

## 1. Settings Areas & Capabilities

| Area | Controls & Capabilities |
|---|---|
| **Appearance** | Theme selection (Light / Dark mode), interface density (Standard / Compact). |
| **Bill & Invoice** | **Dual Bill-Template System:** Dedicated template engines for **Compact Thermal (58mm / 80mm)** and **Large Format (A4 Tax Invoice)** with live side-by-side previews. Controls store branding, GSTIN, FSSAI, Liquor License No, Statutory Excise bottle matrix footer (IMFL/Wine/Beer), Bank details, dynamic UPI QR code, and thermal printer hardware triggers (QZ Tray / ESC/POS / cash drawer kick). See [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md). |
| **Costing & Purchases** | **Configurable Cost Composition Policy:** Granular controls for how product cost rates and stock valuations are calculated: *Factor Discounts in Cost* [ON/OFF], *Factor Expenses/Freight in Cost* [ON/OFF], and *Factor Taxes in Cost* [ON/OFF] (for Composition Scheme vs Regular GST). |


| **Business Studio** | **Master Shop Experience Customizer:** Toggle tabs (Sales, Stock, Purchases, Accounts), choose variants (*WineStock Matrix* vs. *Standard Stock*), and enable features (*Open Bottle* peg mode, restaurant *Tables* mode, *Kitchen* mode). |
| **Staff Access** | **Simple Role Assignment:** Assign shop staff (Cashiers, Stockkeepers) to standard Odoo security groups (`res.groups`) with sensitive data masking (`can_see_money`, `can_see_valuation`). |
| **Tables** | Setup dining areas/floors and restaurant tables for hospitality billing (leverages `pos_restaurant`). |
| **Data Control** | Business-day cutoff hour (e.g. 02:00 AM) and the **Wipe Shop Data** function (two confirmations + automated pre-wipe backup). |

---

## 2. Staff Access Control (Native Odoo Security Groups)
* **Shop Owner / Administrator:** Full system access, ledger review, cost valuations, re-audit, settings, and data control.
* **Cashier:** Restricted to Sales (POS billing), Daybook cash session, and basic Accounts lookup. Cost price and profit margins are masked via Odoo security rules.
* **Stockkeeper:** Restricted to Stock, Purchases, and Product catalog. Financial reports and drawer cash are masked via Odoo security rules.

---

## 3. Data Control & Safe Wipe
* Allows resetting transactional data (clearing practice sales/bills) while preserving products, partners, chart of accounts, and system configuration.
* Requires 2-step verification (typing shop name and password).
* Automatically triggers a pre-wipe database backup before clearing data. See [`docs/data-control-and-wipe.md`](../data-control-and-wipe.md).
