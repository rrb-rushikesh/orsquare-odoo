# Tab Specification: Purchases

> **Status review — 2026-10-07:** One native supplier-bill flow has local browser proof. Editing/history and ambiguous-response retry handling remain incomplete. The rest of this document describes requirements; see [current status](../../STATUS.md).

**Route:** `/purchases`  
**Purpose:** Manages procurement from suppliers: recording bills, receiving stock into Godown, purchase returns, and supplier payables.  
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
* **Invoice Metadata:** Supplier Invoice No. (for GSTR-2B matching), Payment Due Date, Transport Permit No. (TP No) & Date (statutory liquor transport compliance).
* **Multi-Tax Regimes & Configurable Tax Mappings:** Line items are calculated according to configurable tax regime and mapping configurations:
  - *Alcoholic Liquor:* State levies/VAT and Section 206C(1) Income Tax TCS (outside GST under Art. 366(12A) & Sec. 9(1) CGST Act). Shipped with Maharashtra reference config, fully configurable for any Indian state without hardcoding.
  - *General Retail Goods & Kitchen:* Standard Indian GST (`l10n_in`: 0%, 5%, 12%, 18%, 28%).
* **Discounts:** Item-level discounts (% or ₹) and prorated bill-level Trade Discounts.
* **Additional Expenses & Native Landed Costs:** Freight, Handling, Insurance with `[✓] Capitalize into Inventory Cost` switch. The switch is strictly a UX control; actual valuation is performed 100% by Odoo's native Landed Costs engine (`stock.landed.cost`) into AVCO inventory valuation layers (`stock.valuation.layer`) without building a parallel ORSquare costing engine.
* **Configurable Cost Composition Policy:** Independent Settings toggles for factoring discounts, freight, and taxes into product piece rates.
* **Tax Override & Penny Round-off:** Direct override of calculated tax to match printed supplier invoice ($\pm ₹5.00$ auto-booked to Round-off ledger).

---

## 2. Stock Costing (AVCO Moving Average)
* **Moving Weighted Average Cost (AVCO):** Standardized across all products (`property_cost_method = 'average'`).
  $$\text{New Unit Cost} = \frac{\text{Current Asset Value} + \text{New Receipt Landed Value}}{\text{Current Qty} + \text{New Qty}}$$
* **Supplier Payable Separation:** Vendor payables reflect the exact contractual invoice total and are never averaged.

---

## 3. Purchase Returns & Direct Replacement Exchange (Multi-Tax & Value Rigor)

Purchases handles damaged goods or distributor discrepancies with two flows:

### A. Standard Purchase Return (Debit Note)
* Posts reverse stock movement (`WH/Stock/Godown` $\rightarrow$ `Supplier`) and generates an Odoo Vendor Credit Note (`in_refund`), reversing taxes/ITC and reducing supplier payables.

### B. Direct Replacement Exchange (`[✓] Exchange items instead`)
* **The Complexity:** Damaged items returned to a distributor and replaced immediately upon delivery frequently have different prices, different HSNs, or different tax slabs (e.g. returning 18% GST items for 5% GST or TCS items). A single naive netted line corrupts GSTR-2B statutory records.
* **Paired Statutory Documents Architecture:**
  1. **Vendor Credit Note (`in_refund`):** Reverses returned damaged goods with their original purchase rates, HSN codes, and tax rates (`reversed_entry_id`). Generates return picking (`WH/Stock/Godown` $\rightarrow$ `Vendors`).
  2. **New Vendor Bill (`in_invoice`):** Bills incoming replacement goods with their own rates and tax slabs. Generates incoming receipt picking (`Vendors` $\rightarrow$ `WH/Stock/Godown`).
  3. **Automatic Ledger Netting:** Odoo reconciles the Credit Note and Bill on the supplier ledger:
     - Equal values: Net payable adjustment is ₹0, but both documents post to statutory tax journals.
     - Unequal values: Books the exact net difference to the supplier payable balance.
* **Frontend UX:** The user interacts with a single unified Return/Exchange drawer, while Odoo produces compliant dual documents in the backend.

---

## 4. Bill Finder & Business Rules
* **Bill Finder Drawer:** Two-tier lookup drawer allowing quick search of past purchase bills by Bill #, Supplier, date, or amount for audits or returns.
* **Godown Arrival:** All incoming goods land strictly in `WH/Stock/Godown`.
* **Sealed Day Guard:** System rejects recording purchases dated in a sealed business day.
* **See Full Specification:** [`docs/advanced-billing-spec.md`](../advanced-billing-spec.md).
