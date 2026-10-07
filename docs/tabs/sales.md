# Tab Specification: Sales (Counter POS)

**Route:** `/sales`  
**Purpose:** High-traffic retail checkout billing counter. Highest performance requirement in the platform.  
**Underlying Engine:** Atomic `orsquare.sale.service.settle()` orchestrating a native Odoo `pos.order` (taxes, payments, `stock.picking` from `WH/Stock/Counter`, session accounting, optional GST invoice). See `docs/backend-decisions.md` D1.

---

## 1. Checkout Workflow

1. **Scan or Search:** Salesperson scans barcode (USB/Bluetooth) or searches product name / short code.
2. **Multi-Tax Regimes & Stock Validation:**
   * **Multi-Tax Regime & Tax Mapping Evaluation:** Line items are automatically taxed according to configurable tax regime and mapping configurations:
     - *Alcoholic Liquor:* State levies/VAT and Section 206C(1) Income Tax TCS (constitutionally excluded from GST under Art. 366(12A) & Sec. 9(1) CGST Act). Shipped with Maharashtra reference config, fully configurable for any Indian state without hardcoding.
     - *Retail Consumables & Kitchen:* Standard Indian GST (`l10n_in`: 0%, 5%, 12%, 18%, 28%).
   * **Counter Stock Validation:** Retail items consume `WH/Stock/Counter`.
   * **Auto-Godown Transfer (Transaction Atomic & Concurrency Protected):** If `auto_godown_transfer` is ON and counter quantity is insufficient, an internal stock transfer is executed inside the **same atomic Odoo database transaction** as the sale using PostgreSQL row-level locks on `stock.quant` and native stock reservation (`_action_assign()`). Competing cashier transactions queue safely; maintaining zero overselling and zero negative stock is a core invariant proven through concurrent integration tests, with Odoo's reservation machinery acting as the sole authority.
   * **Kitchen Dishes (`type = 'consu'` + `is_storable = False`):** Displays infinite availability badge (`∞`).
3. **Quantity, Rate & Portion Selection:**
   * Adjust quantity; optional authorized price override.
   * **Portion Selection (Full / Half):** For dishes with portion variants, cashier selects `[Full]` or `[Half]` directly from search or line item.
4. **Open Bottle Peg Flow (Optional):**
   * Salesperson opens **Open Bottle Drawer**, selects peg size (30ml, 60ml, 90ml), chooses an open bottle from the **Open Bottles Tray**, and adds portion to bill.
5. **Commercial Discounts vs. Round-off vs. Settlement Concessions:**
   * **Trade / Commercial Discounts (Pre-Tax):** Promo coupons (`PROMO10`, `FLAT50`), percentage off, or manual trade discounts applied to line items before tax, reducing taxable turnover and output taxes.
   * **Statutory Round-off:** Standard minor rounding to nearest ₹1.00 (under Section 170 CGST Act) booked to the standard Round-off account.
   * **Collection / Settlement Concession:** When cash payment is rounded down (e.g. ₹124 rounded to ₹100 cash), the user explicitly chooses whether it is a pre-tax trade discount or a post-tax settlement difference booked to Cash Settlement Loss expense without rewriting the tax record.
6. **Payment & Settlement:**
   * **Tender Options:** Cash (with change calculator), UPI (dynamic QR code), Khata (Customer ledger credit), or Split Tender.
   * **Default Payment Mode:** If configured in Settings (e.g. `Cash only` or `UPI only`), pressing Settle or `F8`/`Enter` completes the sale immediately using the default tender without opening payment selection modals.
7. **Silent Thermal Printing:** Direct ESC/POS silent print via QZ Tray bridge (dispatch latency target: <100ms benchmark) or browser print fallback.

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

### C. Counter Sales Returns & Direct Exchanges (Transaction-Type-Aware)
* Allows handling customer returns or product exchanges directly at the POS counter:
  - **POS Counter Sales:** Generates a POS return order / session refund receipt and Counter stock return movement. Avoids creating unnecessary B2B e-invoice credit notes for simple retail counter slips.
  - **B2B Invoiced Sales:** Generates a formal statutory Credit Note (`out_refund` referencing original invoice `reversed_entry_id`) and a new Tax Invoice (`out_invoice`).
  - **Direct Exchanges:** Net cash difference is collected or refunded seamlessly, while underlying stock movements return original items to `WH/Stock/Counter` and deliver replacement goods to `Customers`. Handles unequal values and different tax regimes cleanly.

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
