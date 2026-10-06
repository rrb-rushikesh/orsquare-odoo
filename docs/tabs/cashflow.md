# Tab Specification: Cash Flow

**Route:** `/cashflow`  
**Purpose:** The shop's chronological cash diary: tracking every liquid rupee entering or leaving the business outside standard counter sales.  
**Underlying Engine:** Projection of standard Odoo `account.move.line` entries posted against Cash and Bank journals (`account.journal`).

---

## 1. Core Workflow & Operations

* **Summary Metrics:**
  * **Cash In:** Total cash receipts, customer Khata collections, and other operating income.
  * **Cash Out:** Total supplier cash payments, owner withdrawals, staff advances, and petty expenses.
  * **Net Movement:** Difference between inflows and outflows for the chosen period.
* **Chronological Register:**
  * Line items displaying voucher date/time, description, voucher type, mode (Cash/Bank), amount in, amount out, and running cash balance.
* **1-Click "New Entry" Drawer:**
  * **Expense Voucher:** Petty expenses (tea, cleaning, electricity, municipal fees, transport). Debits Expense Account, credits Cash/Bank.
  * **Income Voucher:** Miscellaneous receipts (scrap sale, rebate).
  * **Owner Drawing / Capital Injection:** Cash taken or added by the shop owner.

---

## 2. Business Rules & Distinction from Sales
* **Sale $\neq$ Cash Collection:** A cash sale increases Cash Flow immediately; a credit (Khata) sale increases Accounts Receivable and does **not** move cash until the customer settles their balance later.
* **Source of Truth for Daybook:** Cash Flow vouchers entered under "Cash" mode directly feed into the Daybook's live expected cash calculation.
* **Single Ledger Backend:** Cash Flow is an operational view over Odoo's Cash and Bank journals; it does not maintain separate duplicate database tables.
