# Tab Specification: Accounts

> **Status review — 2026-10-07:** Native statements and balances are connected; account edits and selected-bill allocation are unavailable. The rest of this document describes requirements; see [current status](../../STATUS.md).

**Route:** `/accounts`  
**Purpose:** The central party directory managing everyone the business interacts with: Customers, Suppliers, Employees, and Others.  
**Underlying Engine:** Odoo `res.partner` with standard double-entry `account.receivable` and `account.payable` ledgers; `hr.employee` for staff.

---

## 1. Account Types & Ledgers

| Account Type | Odoo Model | Ledger Mechanism | Meaning & Workflow |
|---|---|---|---|
| **Customer** | `res.partner` (`customer_rank > 0`) | `100100 Accounts Receivable` | Buys goods; can carry a **Khata** (credit) balance. Sales increase receivable; customer receipts reduce it. |
| **Supplier** | `res.partner` (`supplier_rank > 0`) | `200100 Accounts Payable` | Sells to shop. Unpaid purchases create payables; supplier payments reduce them. |
| **Employee** | `hr.employee` linked to `res.partner` | `100200 Employee Advances` / Expense | Tracks staff advances, salary loans, wage disbursements, and expense recoveries. |
| **Other** | `res.partner` | Custom general ledger account | Non-trade financial relationships (landlord rent, utilities). |

---

## 2. Workflows & Variants

### A. Accounts Directory List (Default View)
* Summary header: Total customer receivables, total supplier payables, active customer and supplier counts.
* Quick search by contact name or mobile number.
* Filter pills by type: *All*, *Customers*, *Suppliers*, *Employees*.
* Add Account modal: Name, mobile, type, opening balance.

### B. Advanced Accounts Dossier (`AdvancedAccountsPage` Variant)
* When clicking any account, opens the full party dossier (two-pane list/detail on desktop; dedicated view with back button on mobile).
* **Transaction Statement:** Chronological ledger of every invoice, bill, receipt, payment, and adjustment with reference numbers and running balance.
* **1-Click Settlement Drawer:**
  * **Customer Receipt:** Accepts cash or UPI against outstanding Khata, posting an inbound `account.payment` that reconciles the invoice and updates Daybook cash.
  * **Supplier Payment:** Records money paid to a vendor, reducing payables and recording cash/bank outflow.

---

## 3. Responsive Layout
* **Desktop:** Split-pane layout with party directory on the left and selected account statement on the right.
* **Tablet:** Toggleable full-width table or split-pane view.
* **Mobile:** Full-screen directory with bottom navigation; tapping an account pushes the transaction dossier view with a back button. Touch-friendly settlement sheet.

---

## 4. Business Rules & Financial Integrity
* **No Manual Balance Overwrites:** A balance is always the sum of posted ledger entries. Balances are never "edited" directly.
* **Append-Only Corrections:** Erroneous settlements are corrected via reversal entries, preserving full audit history.
* **Masking Rules:** Cashiers without `can_see_money` permission cannot view balances or payment amounts.
