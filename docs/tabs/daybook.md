# Tab Specification: Daybook

**Route:** `/daybook`  
**Purpose:** Manages the daily cash drawer session, physical cash reconciliation, closing stock count, and the end-of-day sealing ritual.  
**Underlying Engine:** Custom `orsquare.business_day` model tracking expected cash against Odoo Cash Journal and freezing daily snapshots.

---

## 1. Daily Operational Ritual

### A. Morning Opening
1. Cashier enters the counted cash in the drawer (e.g. ₹5,000 opening float).
2. The session transitions to `Open`.

### B. During the Day (Live Expected Cash)
Expected drawer cash is calculated dynamically from live transactions:

$$\begin{aligned}
\text{Expected Cash} = &\text{ Opening Float} \\
&+ \text{Net Cash Sales (Cash Bills} - \text{Cash Refunds)} \\
&+ \text{Customer Cash Receipts (Khata settlements)} \\
&- \text{Supplier Cash Payments} \\
&- \text{Cash Flow Expenses (Petty cash, payouts)}
\end{aligned}$$

### C. End-of-Day Closing Ritual
1. **Closing Stock Count:** Staff enters physical bottle counts using thumb-accessible steppers (`+1`, `-1`, `-3`, or *Matches*).
2. **Count Drawer Cash:** Cashier counts physical cash in the till and enters the total.
3. **Variance Identification:** System computes difference ($\text{Counted} - \text{Expected}$).
4. **Close & Seal:** User confirms closing. The session transitions to `Sealed`, and an immutable Z-report snapshot is frozen in `orsquare.business_day`.

---

## 2. Closing Stock Audit Panel
Available after the day is closed, the audit panel compares physical stock variances against cash drawer variances to identify explanations:
* **Stock Short, Drawer Over by exact value:** Unscanned sale (goods left, cash taken). Offers 1-click action to post the missing POS bill.
* **Offline Concurrent Sale Discrepancy:** If two offline registers legitimately sold the same last physical unit while disconnected, both completed bills remain valid, and the discrepancy surfaces here for owner review and stock reconciliation.
* **Stock Short, Drawer Balances:** Unrecorded breakage or theft. Offers action to write off stock adjustment (`audit_correction`).
* **Drawer Short, Stock Balances:** Unrecorded cash payout. Offers action to record missing petty cash voucher.

---

## 3. Business Rules
* **No Direct Edits to Past Days:** Once closed, figures are immutable. Any post-close discrepancy must be settled via an auditable business document (bill, voucher, or stock adjustment).
* **Closed Day Rejection:** New sales, purchases, or vouchers dated in a sealed business day are rejected by the backend.
