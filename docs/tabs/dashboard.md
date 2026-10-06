# Tab Specification: Dashboard

**Route:** `/`  
**Purpose:** Executive operational overview answering three questions in seconds: *How is today performing? What is our payment split? What is our stock worth?*  
**Underlying Engine:** Projections of Odoo `account.move`, `account.payment`, and `stock.quant`. Strictly read-only; mutates no transactions.

---

## 1. Key Metrics & Widgets

* **Today's Total Sales:** Total billed customer invoices on current business date (`orsquare_business_date`).
* **Payment Breakdown:**
  * **Cash:** Sum of payments reconciled against the Cash journal.
  * **UPI / Online:** Sum of payments reconciled against the Bank/UPI journal.
  * **Khata (Credit):** Uncollected receivables from credit sales made today.
* **Simple Gross Profit:** Billed revenue minus Cost of Goods Sold (COGS). Cleanly masked with a dash if the user lacks the `can_see_valuation` permission.
* **Weekly Trend:** 7-day visual graph plotting sales volume across recent finalized business days.
* **Stock Position:** Inventory valuation split by physical location: **Godown** (bulk reserve) and **Counter** (sale-ready).
* **Needs Attention:** High-priority alerts: low-stock SKUs, overdue customer Khata balances, and un-reconciled drawer cash.
* **Quick Actions:** One-tap shortcuts into daily workflows: *New Sale*, *Record Purchase*, *Transfer Stock*, *New Entry*, *Import Products*.

---

## 2. Real-Time Experience & Rolling Tickers

* **Live Streaming Updates:** Connected via Centrifugo/Redis WebSocket stream. When a cashier settles a bill, the dashboard cards (Total Sales, Cash, Today's Drawer) update automatically in <10 ms without requiring page refreshes.
* **Animated Tickers:** Digit increments roll smoothly (odometer effect) with a subtle green pulse highlight confirming new revenue.
* **Instant Bootstrap:** Renders immediately on open (<30 ms from local IndexedDB cache), with silent background delta reconciliation.

---

## 3. Responsive Layout
* **Desktop:** Multi-column grid with top metric tiles, side-by-side weekly trend chart, and stock valuation split.
* **Tablet:** Adapts between 2-column card grid and compact touch layout.
* **Mobile:** Single-column stacked cards, bottom navigation bar, thumb-friendly quick action buttons.

---

## 4. Business Rules & Constraints
* **Single Authoritative Source:** Figures are direct projections of Odoo accounting and inventory models; the dashboard never re-calculates or derives numbers with custom client logic.
* **Khata is Not Cash:** Credit sales appear as receivables, never as collected cash.
* **Live vs. Frozen:** The current day moves live; past days load instantly from frozen `orsquare.business_day` snapshots.
