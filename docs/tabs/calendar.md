# Tab Specification: Calendar

**Route:** `/calendar`  
**Purpose:** Historical review of finalized business days, weeks, and months. Read-only by design.  
**Underlying Engine:** Projection of frozen `orsquare.business_day` snapshots + audited `action_reaudit()` service.

---

## 1. Features & Workflows

* **Period Selector:** Day view, week view, month view, or custom date range (up to 92 days).
* **Period Summaries:** Total sales, bill count, cash/UPI collections, Khata balance changes, petty cash expenses, and drawer reconciliation results.
* **Day Drill-Down:** Inspect top-selling SKUs, hourly sales curve, and retail vs. kitchen breakdown for any past day.
* **Fast Snapshot Loading:** Past closed days load in <20ms from frozen `orsquare.business_day` records instead of recalculating thousands of historical lines.

---

## 2. Business-Day Cutoff & Re-Audit

### A. Business-Day Cutoff Time (e.g., 02:00 AM IST)
* Shops frequently trade past midnight. A sale at `01:30 AM` belongs to the previous business date.
* All date boundaries in the Calendar strictly respect the shop's configured cutoff hour.

### B. Controlled Re-Audit Mechanism
* **The Scenario:** A sale occurred two days ago, and a customer returns the product today (or an accountant adjusts an expense).
* **The Workflow:**
  1. The return is posted as an auditable Odoo credit note linked to the original transaction.
  2. In the Calendar, an authorized owner opens that past date and clicks **"Re-audit"**.
  3. The system executes `orsquare.business_day.action_reaudit()`:
     * Recalculates metrics incorporating the linked adjustments.
     * Appends an immutable log in `orsquare.day_audit_log` (recording actor, timestamp, previous numbers, updated numbers, and reason).
     * Updates the snapshot with status `re_audited`.
  4. Preserves accounting auditability without dirty database overwrites.
