# Master Specification: Retail Capabilities & Operational Features

This document provides a single consolidated reference for all specialized capabilities, operational toggles, and hardware integrations across the ORSquare platform, mapping each to **Odoo 18 Community** and the **custom React frontend**.

---

## 1. Feature Catalog & Architectural Mappings

| # | Capability / Feature | Settings / Studio Location | Default | Underlying Engine & Technical Behavior |
|---|---|---|---|---|
| **1** | **Auto-Godown Transfer on Checkout** | Settings $\rightarrow$ Sales Register | OFF | When enabled, if Counter stock is insufficient for a sale, an automated internal transfer (`WH/Stock/Godown` $\rightarrow$ `WH/Stock/Counter`) is chained to the POS settlement so the cashier is never blocked. |
| **2** | **Closing Stock Audit & Reconciliation Engine** | Daybook $\rightarrow$ Sealed Day | Built-in | Analyzes physical closing stock variances against cash drawer differences. Separates **Facts** (mathematical proof) from **Findings** (probabilistic causes) with 1-click remediation actions (`record_sale`, `record_expense`, `record_correction` via `stock.scrap`). |
| **3** | **Blind Physical Inventory Count** | Settings $\rightarrow$ Day Closing Rules | Simple | When set to *Rigorous*, the system hides expected book stock on the closing screen until the cashier commits to a physical shelf count, preventing guessing or fudging. |
| **4** | **Cash Materiality Threshold** | Settings $\rightarrow$ Day Closing Rules | ₹0.00 | Allowed drawer difference tolerance in ₹ (e.g. ₹5.00) permitting day closing without blocking for trivial change shortages. |
| **5** | **Continuous Scanning Mode** | Settings $\rightarrow$ Sales Register | OFF | High-traffic rush hour mode. Locks the cart, hides category tiles, and pipes USB barcode scans straight into active draft bills without dialog interruptions. |
| **6** | **Enforce Payment Method** | Settings $\rightarrow$ Sales Register | All | Restricts POS checkout to a single tender (`Cash only` or `UPI only`). Hides unused tender buttons and locks keyboard shortcuts (F8/F9) directly to the chosen method. |
| **7** | **Bill Finder ("Recognition Over Recall")** | Sales & Purchases $\rightarrow$ Top Action | Built-in | Fast search modal listing recent bills with real-time fuzzy filtering by Bill #, customer/supplier name, date, or amount for rapid returns, reprints, or audits. |
| **8** | **Purchase Return with Direct Exchange** | Purchases $\rightarrow$ Return Bill | Built-in | Allows returning damaged stock to a distributor while simultaneously recording replacement intake items (`stock down + intake up`) on the same voucher, eliminating floating debit notes. |
| **9** | **Rate Cards & Volume Margins** | Business Studio $\rightarrow$ Sheet Settings | Configured | Configures statutory retailer margins in paise per bottle size (90ml, 180ml, 375ml, 750ml). Used to verify Sheet register gross margins and auto-derive selling rates. |
| **10** | **WineStock Matrix & Pinned Sorting** | Business Studio $\rightarrow$ Stock Surface | Wine Variant | Matrix view grouping brands as rows and bottle sizes as columns (`90ml` to `1000ml`), displaying live Godown, Counter, and Total stock. Supports pinning high-velocity brands to the top. |
| **11** | **Excise Sheet Register** | Business Studio $\rightarrow$ Active Surfaces | Wine Variant | Statutory daily Indian retail register displaying Opening (`OPN`), Inward (`INW`), Sold (`SLD`), and Closing (`CLS`) counts per brand and bottle size, with official CSV/PDF export. |
| **12** | **Discounts & Promo Coupon Schemes** | Business Studio $\rightarrow$ Sales Features | Built-in | Coupon code engine (`PROMO10`, `FLAT50`) supporting percentage and flat ₹ discounts with minimum bill spend rules, mapping natively to Odoo `loyalty.program`. |
| **13** | **Hardware Thermal Printing Engine** | Settings $\rightarrow$ Bill & Receipt | Built-in | QZ Tray WebSocket bridge for Windows silent thermal printing without browser dialogs, direct ESC/POS generation (paper cut, cash drawer kick pulse), and clean browser print fallback. |
| **14** | **Restaurant Seating Grid Editor** | Settings $\rightarrow$ Tables | Optional | Visual grid editor (rows 1-8, cols 1-12) defining table numbers, covers, and dining sections (AC, Non-AC, Garden, Terrace), mapping to Odoo `pos_restaurant` floor models. |
| **15** | **Granular Cashier Data Masking** | Settings $\rightarrow$ Staff Access | Owner Only | Granular permission switches: `can_see_money` (masks drawer cash and sales totals), `can_see_valuation` (masks supplier cost rates and asset margins), and `can_manage_returns`. |
| **16** | **Master Product Library & Smart Importer** | Products / DevConsole | Built-in | Pre-seeded database of common beverage barcodes for 1-click catalog onboarding, paired with an intelligent Excel/CSV importer with Levenshtein fuzzy column matching. |

---

## 2. Server Enforcement & Immutability Principles

1. **Server-Enforced Validation:**
   * All feature gates and permissions are enforced at the server API level.
   * If a cashier terminal attempts to submit an unauthorized rate edit or apply a disabled discount via a forged payload or an offline mutation, Odoo server validation rejects the mutation upon synchronization.
2. **Non-Destructive Feature Toggling:**
   * Toggling a feature OFF hides its screens, filters, and selectors across the application, but **never deletes historical data**.
   * Turning the feature back ON immediately restores access to past records, sales, and analytics.
3. **Double-Entry Financial & Stock Rigor:**
   * No operational feature or reconciliation action ever performs a direct balance overwrite (`UPDATE stock_quant SET quantity = ...`).
   * Every correction posts an auditable business document (`stock.picking`, `stock.scrap`, or `account.move`).
