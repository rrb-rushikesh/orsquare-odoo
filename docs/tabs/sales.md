# Tab Specification: Sales (Counter POS)

**Route:** `/sales`  
**Purpose:** High-traffic retail checkout billing counter. Highest performance requirement in the platform.  
**Underlying Engine:** Atomic `orsquare` retail sale service orchestrating Odoo `account.move`, `account.payment`, and `stock.picking` from `WH/Stock/Counter`.

---

## 1. Checkout Workflow

1. **Scan or Search:** Salesperson scans barcode (USB/Bluetooth) or searches product name / short code.
2. **Stock Validation vs. Infinite Kitchen Stock:**
   * **Retail Products (`detailed_type = 'product'`):** Instant visual feedback showing availability in **Counter** stock (`WH/Stock/Counter`). Quantity cannot exceed physical stock without manager override.
   * **Kitchen Dishes & Consumables (`detailed_type = 'consu'`):** Bypasses physical stock check; displays an infinite availability badge (`∞`). Quantities can be incremented freely without inventory restrictions.
3. **Quantity, Rate & Portion Selection:**
   * Adjust quantity; optional discount or price override (if authorized).
   * **Portion Selection (Full / Half):** For dishes with portion pricing, cashier selects the desired portion chip (`[Full: ₹200]` or `[Half: ₹120]`) directly from the search dropdown or bill line without cluttering catalog searches.
4. **Open Bottle Peg Flow (Optional):**
   * If customer wants a portion (e.g. 60ml peg), salesperson opens the **Open Bottle Drawer**.
   * Selects portion pack size (30ml, 60ml, 90ml, etc.).
   * Selects existing open bottle from the **Open Bottles Tray** (or opens a new bottle).
   * Adds portion to bill.
5. **Select Payment Method:**
   * **Cash:** Exact change or tendered amount calculator.
   * **UPI / Online:** Generates dynamic QR or manual transaction reference.
   * **Khata (Credit):** Customer picker with live outstanding balance; adds to customer's receivable.
   * **Multiple Tender:** Combine Cash + UPI.
6. **Confirm & Settle:** Commits the transaction atomically.
7. **Silent Thermal Printing:** ESC/POS silent print to 80mm or 58mm thermal receipt printer via QZ Tray or browser print fallback.

---

## 2. Universal Features & Modules

### A. Open Bottles Tray & Open Bottle Drawer
* Persistent carousel at the bottom of the Sales screen displaying active opened bottles with live remaining ml and visual liquid fill level (Green >50%, Amber 25-50%, Red <25%). See [`docs/opened-bottles-spec.md`](../opened-bottles-spec.md).

### B. Kitchen Quick Billing (Universal Extension)
* When Kitchen is enabled in Business Studio, a dedicated Kitchen category filter appears in POS.
* Cashiers can quickly tap popular food dishes and snacks without leaving the checkout flow.
* Kitchen sales roll into daily sales totals and tax accounts, but never affect stock valuations or warehouse quants.

### C. Offline Mode & Queue
* When internet disconnects, the React app continues billing using locally cached catalog data in IndexedDB.
* Generates bills with client-side UUIDs and prints receipts locally.
* When connection returns, batches and pushes pending orders to Odoo.

### D. Restaurant Tables Mode (Optional)
* When enabled in Settings, provides an interactive table map allowing staff to hold and manage open bills per table.

---

## 3. Responsive Layout
* **Desktop:** High-density, keyboard-driven layout with instant shortcuts (F1-F12 for scanning, holding, and settling).
* **Tablet:** Dual mode: desktop grid or touch-friendly POS with large numpad.
* **Mobile:** Dedicated single-column POS with bottom action drawer and full-screen camera barcode scanner.

---

## 4. Business Rules
* **Counter Stock Only for Retails:** Sales strictly consume stock from `WH/Stock/Counter`. Goods cannot be sold directly from the Godown without an internal transfer.
* **Infinite Stock for Kitchen:** Kitchen items and untracked consumables never generate Odoo `stock.picking` delivery records, posting only the `account.move` invoice and payment lines.
* **Sealed Day Guard:** The checkout service rejects sales dated in a closed business day.
* **Atomic Settle:** Inventory deduction, invoice posting, and payment reconciliation succeed together or fail together.

