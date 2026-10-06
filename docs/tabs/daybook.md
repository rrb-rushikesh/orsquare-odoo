# Tab Specification: Daybook

**Route:** `/daybook`  
**Purpose:** Manages the daily cash drawer session, opening float, physical cash reconciliation, and end-of-day sealing.  
**Underlying Engine:** Custom `orsquare.business_day` model tracking expected cash against Odoo Cash Journal, and freezing immutable daily snapshots.

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
1. **Count Drawer Cash:** Cashier counts physical cash in the till and enters the total.
2. **Variance Calculation:** System computes difference ($\text{Counted} - \text{Expected}$).
3. **Cash Materiality Threshold (₹):** Controlled by Settings (e.g. ₹5.00 tolerance) to allow closing when minor change shortages occur without blocking operations.
4. **Close & Seal:** User confirms closing. The session transitions to `Sealed`, and an immutable Z-report snapshot is frozen in `orsquare.business_day`.

---

## 2. Business Rules & Immutability
* **No Direct Edits to Past Days:** Once closed and sealed, figures are immutable. Any adjustments must be made via auditable vouchers or adjustment moves.
* **Closed Day Rejection:** New sales, purchases, or vouchers dated in a sealed business day are rejected by backend guardrails.

---

## 3. Future Scope: Closing Stock Audit & Reconciliation Engine
* **Status:** **Postponed to Future Phase.**
* **Description:** The advanced diagnostic panel correlating physical shelf count shortages with cash drawer variances (identifying unrecorded sales vs. wastage vs. petty expenses) is documented for future implementation once base retail operations are established.
