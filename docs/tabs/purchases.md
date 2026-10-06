# Tab Specification: Purchases

**Route:** `/purchases`  
**Purpose:** Manages procurement from suppliers: recording bills, receiving stock into Godown, and updating supplier payables.  
**Underlying Engine:** Odoo `purchase.order`, incoming `stock.picking` (`Supplier` $\rightarrow$ `WH/Stock/Godown`), and vendor bills (`account.move` with `move_type='in_invoice'`).

---

## 1. Procurement Workflow

1. **Select Supplier:** Choose from registered suppliers in Accounts.
2. **Add Products & Quantities:** Scan barcode or select SKU. Enter quantities in supplier units (cases/boxes) or individual pieces.
3. **Enter Purchase Rate:** Enter unit purchase cost (strictly cost; not MRP or selling rate).
4. **Confirm & Receive:** In an atomic transaction:
   * Confirms `purchase.order`.
   * Automatically validates `stock.picking`, landing physical stock into **Godown (`WH/Stock/Godown`)**.
   * Creates and posts the vendor bill, recording Accounts Payable for unpaid amounts.
5. **Print & Settle:** Print purchase invoice; settle via Accounts payment modal when paid.

---

## 2. Purchase Returns & Corrections
* **Purchase Returns:** If stock is damaged or returned to the distributor, system posts a reverse stock move (`WH/Stock/Godown` $\rightarrow$ `Supplier`) and creates an Odoo vendor credit note (`in_refund`), reducing the supplier payable.
* **Audited Edits:** Correcting rate or quantity errors after confirmation generates an auditable adjustment move rather than a silent database overwrite.

---

## 3. Business Rules
* **Godown Arrival:** All incoming goods land in the Godown. Stock must be transferred to the Counter before it is sale-ready.
* **Sealed Day Guard:** The system rejects recording purchases dated in a closed/sealed business day.
* **Unit Conversions:** Supports automated conversion between supplier packaging (e.g. 1 Case = 12 Bottles of 750ml) and single inventory pieces.
