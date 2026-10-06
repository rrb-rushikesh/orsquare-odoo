# Tab Specification: Daybook

**Route:** `/daybook`  
**Purpose:** Manages the daily cash drawer session, physical cash reconciliation, physical closing stock counting, discrepancy reconciliation, and end-of-day sealing.  
**Underlying Engine:** Custom `orsquare.business_day` model tracking expected cash against Odoo Cash Journal, physical stock count audits via `stock.inventory.adjustment`, and frozen immutable daily snapshots.

---

## 1. Daily Operational Ritual

### A. Morning Opening
1. Cashier enters counted physical cash in the drawer (e.g. ₹5,000 opening float).
2. Session transitions to `Open`.

### B. During the Day (Authoritative Expected Cash)
Expected drawer cash is calculated dynamically from authoritative ledger moves:

$$\begin{aligned}
\text{Expected Cash} = &\text{ Opening Float} \\
&+ \text{Net Cash Sales (Cash Bills} - \text{Cash Refunds)} \\
&+ \text{Customer Cash Receipts (Khata settlements)} \\
&- \text{Supplier Cash Payments} \\
&- \text{Cash Flow Expenses (Petty cash, payouts)}
\end{aligned}$$

### C. End-of-Day Closing Ritual
1. **Physical Stock Count:** Staff enters physical bottle counts using thumb steppers (`+1`, `-1`, `-3`, or *Matches*).
2. **Count Drawer Cash:** Cashier counts physical cash in the till and enters the total.
3. **Variance Identification:** System computes difference ($\text{Counted} - \text{Expected}$).
4. **Close & Seal:** User confirms closing. The session transitions to `Sealed`, and an immutable Z-report snapshot is frozen in `orsquare.business_day`.

---

## 2. Closing Settings & Audit Rigor

Day closing behavior is controlled by two shop-level governance settings:

1. **Cash Materiality Threshold (₹ Tolerance):**
   * Configurable allowed cash difference at close (e.g. ₹5.00).
   * Allows closing when tiny coin shortages occur without forcing tedious penny investigations. Setting to ₹0 requires exact match to the paisa.
2. **Closing Count Strictness:**
   * **Simple Mode:** Counts only products that had movements during the day.
   * **Rigorous Mode (Blind Physical Inventory Count):** Counts the entire active catalog and **hides the expected system quantity** until staff commits to a physical number. Prevents staff from guessing or faking shelf counts.

---

## 3. Closing Stock Audit & Discrepancy Reconciliation Engine

Available after the day is closed, the **Closing Stock Audit** correlates physical stock variances against cash drawer discrepancies to diagnose root causes:

### A. Separation of Facts vs. Findings
* **Facts (Mathematical Demonstration):** Demonstrates what the records prove (exact drawer cash difference, exact SKU piece shortages/overages, value at cost and selling rate).
* **Findings (Actionable Hypotheses):** Correlates patterns into diagnostic findings with confidence levels:
  * `proven` / `Explains it`: Mathematical match (e.g., 2 missing bottles worth ₹500 matching ₹500 excess cash $\rightarrow$ Unrecorded sale).
  * `likely`: High probability correlation.
  * `check_next`: Discrepancy requiring physical shelf re-inspection.

### B. 1-Click Corrective Actions (Auditable Business Documents)
The audit never quietly tampers with ledger balances. Every resolution posts an auditable business document:
1. `record_sale`: Missing stock + matching excess cash $\rightarrow$ Generates an unrecorded sales invoice, bringing stock and cash into perfect balance.
2. `record_expense`: Cash shortage without stock loss $\rightarrow$ Generates an unrecorded petty expense voucher (e.g. unrecorded shop cleaning or vendor tip).
3. `record_correction`: Stock shortage with matching cash $\rightarrow$ Generates a stock adjustment/scrap voucher (`stock.scrap`) booked to Spillage/Shrinkage expense.

---

## 4. Business Rules
* **No Direct Edits to Past Days:** Once closed and sealed, figures are immutable. Any adjustments must be made via auditable vouchers or adjustment moves.
* **Closed Day Rejection:** New sales, purchases, or vouchers dated in a sealed business day are rejected by backend guardrails.
