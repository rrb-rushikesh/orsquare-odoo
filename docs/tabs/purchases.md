# Tab Specification: Purchases

**Route:** `/purchases`  
**Purpose:** Manages procurement from suppliers: recording bills, receiving stock into Godown, and updating supplier payables.  
**Underlying Engine:** Odoo `purchase.order`, incoming `stock.picking` (`Supplier` $\rightarrow$ `WH/Stock/Godown`), and vendor bills (`account.move` with `move_type='in_invoice'`).

---

## 1. Procurement Workflow: Two-Tier Billing Architecture

Purchases supports two operational modes via a progressive disclosure toggle:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PURCHASE BILL DRAWER                                 │
│  [ Default: Simple Purchase Bill ]      <──Toggle──>     [✓ Advanced Bill ] │
└───────────────────────┬───────────────────────────────────────┬─────────────┘
                        │                                       │
                        ▼                                       ▼
        [ Simple Purchase Bill ]                [ Advanced Purchase Bill ]
        • Fast 10-second stock-in               • Full Supplier Invoice reproduction
        • Supplier, Date, Notes                 • Supplier Inv #, Due Date, TP No
        • Item search & Boxes/Pieces            • Item discounts (% or fixed ₹)
        • Forward/Reverse Rate entry            • Bill-level Trade Discounts
        • Instant Godown landing                • Additional Expenses & Landed Costs
                                                • Tax override & Penny Round-off
```

### A. Simple Purchase Bill (Everyday Default)
1. **Select Supplier:** Choose from registered suppliers in Accounts.
2. **Add Products & Quantities:** Search item or scan barcode. Enter quantities in supplier units (boxes/cases) or individual pieces with automatic unit conversion (e.g. 1 Box = 24 Cans).
3. **Bi-Directional Rate Entry:**
   * *Forward:* Enter `Pieces = 100` and `Rate = ₹150` $\rightarrow$ Total auto-calculates to `₹15,000`.
   * *Reverse:* Enter `Pieces = 100` and `Total = ₹15,000` $\rightarrow$ Rate auto-calculates to `₹150`.
   * *Boxes:* Enter `5 Boxes` and `Total = ₹13,852` $\rightarrow$ Rate per Box auto-calculates to `₹2,770.41`.
4. **Confirm & Receive:** Automatically confirms `purchase.order`, validates `stock.picking` into `WH/Stock/Godown`, posts the vendor bill (`account.move`), and updates supplier payable.

### B. Advanced Purchase Bill (Wholesale Invoice Reproduction)
When `[✓] Advanced Bill` is toggled:
* **Invoice Metadata:** Supplier Invoice No. (for GSTR-2B ITC matching), Payment Due Date, Transport Permit No. (TP No) & Date (statutory liquor transport compliance).
* **Discounts:**
  * Item-level discounts (% or ₹ per unit).
  * Bill-level Trade Discounts (prorated across line items by gross value for exact GST tax slab compliance).
* **Additional Expenses & Landed Costs:**
  * Rows for Freight Inward, Handling & Labour, Packaging, Transit Insurance.
  * `[✓] Capitalize into Inventory Cost` toggle: Capitalized charges are absorbed into moving average inventory valuation (AVCO); uncapitalized charges route to operational P&L expense accounts.
* **Tax Override & Penny Round-off:**
  * System calculates tax (GST / TCS / VAT).
  * User can override the tax amount directly to match the printed supplier invoice.
  * Discrepancies up to $\pm ₹5.00$ are booked to the standard **Round-off Account**.

---

## 2. Stock Costing & Price Fluctuation (AVCO Moving Average)
* **Moving Weighted Average Cost (AVCO):** Standardized across all products (`property_cost_method = 'average'`). When new stock arrives at a fluctuating rate:
  $$\text{New Unit Cost} = \frac{\text{Current Asset Value} + \text{New Receipt Landed Value}}{\text{Current Qty} + \text{New Qty}}$$
* **Supplier Payable Separation:** Vendor payables reflect the exact contractual invoice total and are never averaged.

---

## 3. Purchase Returns & Corrections
* **Purchase Returns:** System posts reverse stock movement (`WH/Stock/Godown` $\rightarrow$ `Supplier`) and generates an Odoo Vendor Credit Note (`in_refund`), reversing taxes/TCS and reducing supplier payables.
* **Audited Edits:** Correcting historical bills generates auditable adjustment entries rather than silent database overwrites.

---

## 4. Business Rules
* **Godown Arrival:** All incoming goods land in the Godown. Stock must be transferred to the Counter before it is sale-ready.
* **Sealed Day Guard:** The system rejects recording purchases dated in a closed/sealed business day.
* **See Full Specification:** [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md).

