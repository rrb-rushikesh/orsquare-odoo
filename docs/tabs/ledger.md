# Tab Specification: Ledger

> **Status review — 2026-10-07:** Native report projections are connected. OCA report modules are not installed; some control-account cards remain unavailable. The rest of this document describes requirements; see [current status](../../STATUS.md).

**Route:** `/ledger`  
**Purpose:** Business-wide accounting review across all financial accounts.  
**Underlying Engine:** Standard Odoo `account.move.line` with native report projections. OCA `account_financial_report` remains an optional future module (decision D12), not an installed dependency.

---

## 1. Core Financial Views

| View | Purpose & Technical Source |
|---|---|
| **Trial Balance** | Verifies total debits equal total credits across all accounts (`account.account`). |
| **Profit & Loss (P&L)** | Net operational profit: Sales revenue minus COGS minus operating expenses. |
| **Balance Sheet** | Statement of assets (cash, bank, stock, receivables) vs. liabilities (supplier payables, loans). |
| **Cash and Bank Book** | Chronological ledger of all movements in liquidity journals. |
| **Sales & Purchase Registers** | Detailed itemized records of all customer invoices and vendor bills. |
| **Tax Reports (GST)** | Output GST (CGST/SGST/IGST collected) vs. Input Tax Credit (ITC on purchases). |

---

## 2. Business Rules & Access Control
* **Statutory Authority:** The general ledger resides in Odoo; reports are dynamic projections directly from Odoo journal entries.
* **Valuation Masking:** Staff without `can_see_valuation` cannot see cost-based gross margins or inventory valuation.
* **Historical Read Speed:** Closed periods load instantly from sealed `orsquare.business_day` snapshots.
* **Read-Only Surface:** Ledger reads and audits; corrections must be posted through the originating business transaction (e.g. Sales return or Purchase credit note).
