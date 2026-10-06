# Tab Specification: Sales (Counter POS)

**Route:** `/sales`  
**Purpose:** High-traffic retail checkout billing counter. Highest performance requirement in the platform.  
**Underlying Engine:** Atomic `orsquare` retail sale service orchestrating Odoo `account.move`, `account.payment`, and `stock.picking` from `WH/Stock/Counter`.

---

## 1. Checkout Workflow

1. **Scan or Search:** Salesperson scans barcode (USB/Bluetooth) or searches product name / short code.
2. **Stock Validation & Auto-Godown Replenishment:**
   * **Counter Stock Validation:** Retail items consume `WH/Stock/Counter`.
   * **Auto-Godown Transfer:** If `auto_godown_transfer` is ON and counter quantity is insufficient, an internal transfer from Godown to Counter is chained automatically during settlement.
   * **Kitchen & Consumables (`detailed_type = 'consu'`):** Displays an infinite availability badge (`∞`). Incrementable freely without inventory restrictions.
3. **Quantity, Rate & Portion Selection:**
   * Adjust quantity; optional discount or price override (if authorized).
   * **Portion Selection (Full / Half):** For dishes with portion variants, cashier selects `[Full]` or `[Half]` directly from search or line item.
4. **Open Bottle Peg Flow (Optional):**
   * Salesperson opens the **Open Bottle Drawer**, selects peg size (30ml, 60ml, 90ml, etc.), chooses an open bottle from the **Open Bottles Tray**, and adds portion to bill.
5. **Coupons & Discount Schemes:**
   * 1-tap coupon input applying configured promo schemes (e.g. `PROMO10` for 10% off, `FLAT50` for ₹50 off) subject to minimum invoice spend rules.
6. **Payment & Settlement:**
   * **Tender Options:** Cash (with change calculator), UPI (dynamic QR code), Khata (Customer ledger credit), or Split Tender.
   * **Enforced Payment Method:** If enabled in Settings (e.g. `Cash only` or `UPI only`), alternative buttons are hidden and keyboard shortcuts route directly to the enforced method.
7. **Silent Thermal Printing:** ESC/POS silent print to 80mm or 58mm thermal receipt printer via QZ Tray bridge or clean browser print fallback.

---

## 2. Specialized Operational Modes

### A. Continuous Scanning Mode (`prefs.continuousScanning`)
* **Target:** High-traffic supermarket queues and festival rush hours.
* **Behavior:** Locks the cart list and hides visual category tiles. Every barcode scan immediately accumulates into the active open draft bill without requiring enter keys or confirmation modals.

### B. Bill Finder Drawer ("Recognition Over Recall")
* Dedicated drawer to locate past bills for returns, reprints, or customer disputes.
* Lists the most recent bills immediately upon opening; real-time search filters by Bill # (e.g. `INV-1042`), Customer name, date/time, or bill amount.

### C. Open Bottles Tray & Peg Drawer
* Persistent carousel at the bottom of the Sales screen displaying active opened bottles with live remaining ml and visual liquid fill badges (Green >50%, Amber 25-50%, Red <25%). See [`docs/opened-bottles-spec.md`](../opened-bottles-spec.md).

### D. Offline POS & Resilient Outbox
* Local IndexedDB (Dexie.js) cache allows continuous billing when offline. Orders queue safely with client-side UUIDs (`client_order_ref`) and flush idempotently to Odoo upon reconnect.

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
* **Atomic Settlement:** Inventory deduction, invoice posting, and payment reconciliation succeed together or fail together.
* **Data Masking:** Cashiers without `can_see_money` permission cannot view cumulative daily sales revenue or drawer cash balances.
