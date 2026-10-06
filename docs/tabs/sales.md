# Tab Specification: Sales (Counter POS)

**Route:** `/sales`  
**Purpose:** High-traffic retail checkout billing counter. Highest performance requirement in the platform.  
**Underlying Engine:** Atomic `orsquare` retail sale service orchestrating Odoo `account.move`, `account.payment`, and `stock.picking` from `WH/Stock/Counter`.

---

## 1. Checkout Workflow

1. **Scan or Search:** Salesperson scans barcode (USB/Bluetooth) or searches product name / short code.
2. **Stock Validation & Auto-Godown Replenishment:**
   * **Counter Stock Validation:** Retail items consume `WH/Stock/Counter`.
   * **Auto-Godown Transfer (Concurrency Protected):** If `auto_godown_transfer` is ON and counter quantity is insufficient, an atomic internal transfer from Godown to Counter is executed using PostgreSQL row-level locks (`SELECT ... FOR UPDATE` on `stock.quant`) and Odoo stock reservation (`_action_assign()`), preventing race conditions between concurrent cashiers.
   * **Kitchen & Consumables (`detailed_type = 'consu'`):** Displays infinite availability badge (`∞`). Incrementable freely without inventory restrictions.
3. **Quantity, Rate & Portion Selection:**
   * Adjust quantity; optional authorized price override.
   * **Portion Selection (Full / Half):** For dishes with portion variants, cashier selects `[Full]` or `[Half]` directly from search or line item.
4. **Open Bottle Peg Flow (Optional):**
   * Salesperson opens **Open Bottle Drawer**, selects peg size (30ml, 60ml, 90ml), chooses an open bottle from the **Open Bottles Tray**, and adds portion to bill.
5. **Commercial Discounts vs. Settlement Rounding:**
   * **Commercial / Trade Discounts (Pre-Tax):** Promo coupons (`PROMO10`, `FLAT50`), percentage off, or manual trade discounts applied to line items before tax, reducing taxable turnover and GST proportionally.
   * **Settlement Rounding & Cashier Concessions (Post-Tax):**
     - Statutory penny round-off to nearest ₹1.00 (under Section 170 CGST Act) booked to standard Round-off ledger.
     - Cashier settlement concession (e.g. ₹124 rounded to ₹100 cash): explicitly classified as either a Pre-tax Trade Discount (recalculating tax) or a Post-tax Cash Concession (booked to Cash Settlement Loss expense without altering statutory tax liabilities).
6. **Payment & Settlement:**
   * **Tender Options:** Cash (with change calculator), UPI (dynamic QR code), Khata (Customer ledger credit), or Split Tender.
   * **Default Payment Mode:** If configured in Settings (e.g. `Cash only` or `UPI only`), pressing Settle or `F8`/`Enter` completes the sale immediately using the default tender without opening payment selection modals.
7. **Silent Thermal Printing:** Direct ESC/POS silent print via QZ Tray bridge (dispatch target: <100ms benchmark) or browser print fallback.

---

## 2. Specialized Operational Modes

### A. Continuous Scanning Mode (`prefs.continuousScanning`)
* **Target:** High-traffic supermarket queues and festival rush hours.
* **Behavior:** Locks the cart list, hides visual category tiles, and keeps scanner focus permanent. Scans stream directly into the active draft bill.
* **Safety Lock/Unlock:** A visual banner `[🔒 Cart Locked for Rapid Scanning]` prevents accidental deletions or price tampering. Cashier must click `[Unlock to Edit]` before modifying items.
* **Durable Draft Cart Guarantee:** The active draft bill persists synchronously in **IndexedDB**. If the computer loses power, the browser crashes, or network disconnects, reopening `/sales` synchronously restores the active draft cart with zero data loss until explicit settlement or explicit cancellation.

### B. Bill Finder Drawer ("Recognition Over Recall")
* Dedicated drawer to locate past bills for returns, reprints, or customer lookups.
* **Two-Tier Engine:**
  - **Tier 1 (Instant Local Search):** Recent bills (active daybook + last 7 days) are cached in Dexie.js and render with instantaneous local UI responsiveness (benchmark target: <10ms query). Debounced search filters by Bill #, customer name, date, or amount.
  - **Tier 2 (Deep Server Archive):** Searching older records queries Odoo `account.move` asynchronously.
* Provides 1-tap actions: *Reprint Receipt*, *Issue Return / Exchange*, *View Details*.

### C. Counter Sales Returns & Direct Exchanges (Multi-Tax Rigor)
* Allows handling customer returns or product exchanges directly at the POS counter:
  - Generates two linked statutory documents:
    1. **Customer Credit Note:** Reversing the returned item with its original price, HSN, and exact original GST tax rate.
    2. **New Tax Invoice:** Billing the replacement item with its own proper rate, HSN, and GST slab.
    3. **Ledger Netting:** Odoo reconciles the Credit Note against the Invoice, collecting or refunding only the net cash variance.
  - Handles unequal values (customer pays extra or receives refund) and different tax slabs without corrupting GSTR-1 filings.

### D. Open Bottles Tray & Peg Drawer
* Persistent carousel at the bottom of the Sales screen displaying active opened bottles with live remaining ml and visual liquid fill badges (Green >50%, Amber 25-50%, Red <25%). See [`docs/opened-bottles-spec.md`](../opened-bottles-spec.md).

### E. Advanced Sales Bill (B2B Tax Invoice)
* `+ New Tax Invoice` drawer for wholesale institutional sales (hotels, clubs).
* Captures Customer GSTIN, State Code, HSN breakdown, transport details, and generates statutory A4 Tax Invoices. See [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md).

---

## 3. Responsive Layout
* **Desktop:** High-density, keyboard-driven layout with instant shortcuts (F1-F12 for scanning, holding, and settling).
* **Tablet:** Dual mode: desktop grid or touch-friendly POS with large numpad.
* **Mobile:** Dedicated single-column POS with bottom action drawer and full-screen camera barcode scanner.

---

## 4. Business Rules
* **Counter Stock Only for Retails:** Sales strictly consume stock from `WH/Stock/Counter`.
* **Infinite Stock for Kitchen:** Kitchen consumables never generate stock delivery pickings, posting only revenue and tax journal lines.
* **Sealed Day Guard:** Checkout service rejects sales dated in a closed business day.
* **Data Masking:** Cashiers without `can_see_money` permission cannot view cumulative daily sales revenue or drawer cash balances.
