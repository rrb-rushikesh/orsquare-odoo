# Architectural & Accounting Specification: Advanced Purchase & Sales Billing System

**Document Version:** 1.0  
**Target Platform:** Odoo 18.0 Community Edition + Custom React Frontend  
**Accounting Standard:** Indian Accounting Standards (Ind AS 2 / AS 2 - Inventories), CGST/SGST Act, TCS Sec 206C  
**Reference Artifacts:** 
- Wholesale Liquor Tax Invoice (`Anand Wines` Invoice # `BEER--7845`, [`03b0f225-1f4a-4096-9b73-670341f01dbd.jpg`](file:///C:/Users/rushi/Desktop/03b0f225-1f4a-4096-9b73-670341f01dbd.jpg))
- System Walkthrough Video ([`2026-10-07 01-50-01.mp4`](file:///C:/Users/rushi/Videos/OBS/2026-10-07%2001-50-01.mp4))  
**Audience:** Product Designer, Technical Architects & Chartered Accountants  

---

## 1. Executive Summary & Design Vision

ORSquare serves retail shops, beverage stores, and hybrid restaurants where two starkly different billing realities co-exist:
1. **Everyday Operations (Simple Billing):** Cashiers need to record quick stock receipts or counter checkouts in 10–15 seconds without being bogged down by corporate accounting forms.
2. **Wholesale & Statutory Accounting (Advanced Billing):** Retailers purchase from institutional distributors who issue complex wholesale tax invoices containing trade discounts, freight charges, handling fees, TCS, excise permit numbers, and penny round-offs. Additionally, retailers occasionally execute wholesale B2B sales to hotels, clubs, or institutions requiring full GST tax invoices.

### The Non-Negotiable Principle: Two-Tier Progressive Disclosure
* **The Normal Workflow NEVER Becomes Complicated:** By default, the Purchases drawer and Sales POS render their ultra-clean, minimalist interface.
* **The Advanced Workflow is an Explicit Switch:** Enabling `[✓] Advanced Bill` reveals supplier invoice numbers, item/bill discounts, tax overrides, additional expenses, and landed cost allocations.
* **Standard Odoo 18 Engine Underneath:** 100% of double-entry ledger postings, inventory valuation layers (`stock.valuation.layer`), tax accounts (`account.tax`), and vendor payables (`res.partner`) reuse standard Odoo Community models. Custom code is strictly confined to the high-speed React UX and bi-directional calculation engine.

---

## 2. Real-World Invoice Deconstruction (`Anand Wines` Case Study)

The reference invoice ([`03b0f225-1f4a-4096-9b73-670341f01dbd.jpg`](file:///C:/Users/rushi/Desktop/03b0f225-1f4a-4096-9b73-670341f01dbd.jpg)) provides an authentic blueprint of Indian wholesale distribution billing:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TAX INVOICE: ANAND WINES (Udgir / Nanded)                       Invoice No: BEER--7845 │
│ Buyer: POOJA HOTEL SHIRUR TAJBAND (Lic: FL-III-851)             Date: 21/07/2026       │
│ Transport Permit (TP No): 10651                                 TP Date: 22/07/2026    │
├──────┬────────────────────────────────┬─────────┬─────────┬─────┬──────────┬───────────┤
│ Btls │ Particulars                    │ MRP     │ Size    │ Qty │ Rate     │ Amount    │
├──────┼────────────────────────────────┼─────────┼─────────┼─────┼──────────┼───────────┤
│  120 │ TUBORG STR. BEER 330ML CAN-125 │  125.00 │ 330 CAN │   5 │ 2,770.41 │ 13,852.00 │
│  300 │ TUBORG STR. BEER 650ML-200     │  200.00 │ 650 ML  │  25 │ 2,216.33 │ 55,408.00 │
├──────┴────────────────────────────────┴─────────┴─────────┴─────┴──────────┼───────────┤
│ GROSS AMOUNT                                                               │ 69,260.00 │
│ TRADE D- ON CARLSBERG (Brand Trade Discount)                               │ -1,050.00 │
│ TRADE DIS.ON CIPL PRODUCT (Product Group Discount)                         │ -1,100.00 │
│ ADD STAMP & HANDLING (Additional Charge)                                   │    +15.00 │
│ TCS A/c. 2% (Tax Collected at Source on Net: 67,125 × 2%)                  │ +1,342.00 │
├────────────────────────────────────────────────────────────────────────────┼───────────┤
│ NET TOTAL BILL AMOUNT                                                      │ 68,467.00 │
│ PREVIOUS PARTY OUTSTANDING                                                 │135,137.00 │
├────────────────────────────────────────────────────────────────────────────┴───────────┤
│ Statutory Excise Matrix: S.BEER = 300 Bottles | CANS = 120 Cans                        │
│ Bank Details: ICICI BANK (Udgir), A/C: 110705015474, IFSC: ICIC0001107, Dynamic QR    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Critical Observations from the Ground Reality:
1. **Packaging Hierarchy:** The invoice bills in **Cases/Boxes** (`Qty: 5`, `Qty: 25`), but inventory must be tracked in **Bottles/Cans** (`120 cans`, `300 bottles`). Unit conversions must be continuous and automatic.
2. **Bill-Level Trade Discounts:** Wholesale distributors apply deductions after subtotaling (`-1,050.00`, `-1,100.00`).
3. **Ancillary Charges:** Handling, stamps, or transport fees (`+15.00`) are included on the face of the bill.
4. **Statutory Tax Layers:** TCS (Tax Collected at Source) under Section 206C(1) or 206C(1H) is added *after* trade discounts and handling charges.
5. **Exact Stated Amount vs Penny Discrepancy:** $(69,260 - 1,050 - 1,100 + 15) \times 2\% = 67,125 \times 0.02 = 1,342.50$. The distributor rounded this to `1,342.00` (50 paise difference). The software **must allow exact matching of the supplier's stated total** (₹68,467.00), routing the 50 paise to a Round-off ledger.

---

## 3. Accounting Architecture: Treatment of Commercial Components

### A. Discounts: Item-Level vs. Bill-Level

| Type | How It Appears on Invoice | GST & Tax Law Treatment | Accounting Double-Entry | Impact on Inventory Unit Cost |
|---|---|---|---|---|
| **Item Discount (%)** | E.g., `5%` on line item | Excluded from taxable value under CGST Sec 15(3)(a). | Net amount debited to Stock Interim. | Reduces unit cost directly. |
| **Item Discount (Fixed ₹)**| E.g., `₹50/case` on line | Excluded from taxable value. | Net amount debited to Stock Interim. | Reduces unit cost directly. |
| **Bill-Level Trade Discount** | E.g., `-₹1,050` after Gross | Excluded from taxable value if shown on invoice. | Prorated across item lines to reduce Stock Interim debit. | Prorated reduction of inventory cost across lines. |
| **Post-Supply Cash Discount** | Given later if paid in 7 days | Not deducted on invoice. Requires supplier Credit Note under Sec 15(3)(b). | Credit to `Discount Received (Income)` upon payment settlement. | Does NOT alter historical inventory cost. |

#### Proration Formula for Bill-Level Discounts
When a bill contains multiple products (potentially across different GST tax rates), bill-level discounts are apportioned across lines by gross value:
$$\text{Line Discount Share} = \text{Bill Discount} \times \frac{\text{Line Gross Amount}}{\text{Total Gross Amount}}$$
$$\text{Line Taxable Base} = \text{Line Gross Amount} - \text{Line Item Discount} - \text{Line Discount Share}$$

---

### B. Additional Expenses: Landed Costs (Capitalization) vs. Period Expenses

Retailers encounter ancillary charges on purchase invoices: Freight Inward, Unloading Labour, Breakage/Insurance, Packaging/Crates, and Handling.

#### Accounting Rule (Ind AS 2 / AS 2):
* **Capitalized to Inventory (Landed Cost):** All direct costs incurred to bring the goods to their present location and condition (Godown).
* **Period Expense:** Financing charges, cash discount interest, post-arrival storage, or demurrage.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ADDITIONAL EXPENSE ROW                               │
│  Charge Name: [ Freight Inward ]       Amount: [ ₹ 500.00 ]                      │
│  [✓] Capitalize into Inventory Cost (Landed Cost)                                │
└────────────────────────┬─────────────────────────────────┬───────────────────────┘
                         │                                 │
              IF CAPITALIZED [ON]                 IF EXPENSED [OFF]
                         │                                 │
                         ▼                                 ▼
         Debit: Stock Interim / Inventory           Debit: Freight Expense (P&L)
         Credit: Supplier Payable                   Credit: Supplier Payable
         Unit Cost of products increases            Unit Cost of products unchanged
```

#### Proration of Capitalized Landed Costs
Landed costs can be allocated across products using two standard methods:
1. **By Value (Default):** Apportions freight proportionally to each product's value:
   $$\text{Allocated Freight}_i = \text{Total Freight} \times \frac{\text{Value}_i}{\sum \text{Value}}$$
2. **By Quantity / Volume (Optional):** Apportions freight based on physical bottle weight or liter volume (ideal when heavy low-cost beer incurs higher transport than high-cost whisky).

---

### C. Stock Costing & Price Fluctuation: FIFO vs. AVCO (Weighted Moving Average)

The user raised a critical scenario:
* **Day 1:** 50 pcs @ ₹150 = ₹7,500
* **Day 2:** 50 pcs @ ₹200 = ₹10,000
* **Total Stock:** 100 pcs. How should valuation work?

#### 1. Comparison of Costing Models

| Criteria | Moving Weighted Average (AVCO) — **Recommended** | First-In, First-Out (FIFO) | Standard Costing |
|---|---|---|---|
| **Mechanism** | Re-computes blended unit cost upon each receipt: $\frac{7,500 + 10,000}{50 + 50} = \mathbf{₹175.00}$ | Maintains discrete layers: Layer 1 (50 @ ₹150), Layer 2 (50 @ ₹200). | Fixed pre-set cost; difference goes to Price Variance account. |
| **COGS on Sale of 60 pcs**| $60 \times 175 = \mathbf{₹10,500}$ | $(50 \times 150) + (10 \times 200) = \mathbf{₹9,500}$ | $60 \times \text{StdCost}$ |
| **Ending Stock (40 pcs)** | $40 \times 175 = \mathbf{₹7,000}$ | $40 \times 200 = \mathbf{₹8,000}$ | $40 \times \text{StdCost}$ |
| **Physical Reality in Retail** | **Matches reality:** Identical bottles sit on the same shelf and cannot be physically distinguished by batch. | Creates artificial layer tracking for physically identical units. | Unrealistic for fluctuating wholesale prices. |
| **TallyPrime Compatibility** | Exactly matches TallyPrime's default retail costing method. | Supported but rarely used in small/medium retail. | Rarely used. |
| **Odoo 18 Community** | 100% native: `property_cost_method = 'average'`. | 100% native: `property_cost_method = 'fifo'`. | Native: `property_cost_method = 'standard'`. |

#### 2. Supplier Payable vs. Inventory Valuation Boundary
* **Supplier Payable:** Represents legal contractual debt. It is **never averaged**.
  * Bill 1 establishes Payable of ₹7,500 to Supplier.
  * Bill 2 establishes Payable of ₹10,000 to Supplier.
* **Inventory Asset:** Represents internal asset valuation on the Balance Sheet. AVCO updates the asset ledger without distorting what is owed to the vendor.

---

### D. Complete Double-Entry Accounting Matrix

For a complete Advanced Purchase Bill matching the Anand Wines case study:
- Line Items: ₹69,260.00
- Trade Discounts: -₹2,150.00
- Handling Charge (Capitalized): +₹15.00
- TCS (2%): +₹1,342.00
- Net Bill Total: ₹68,467.00

```
┌──────────────────────────────────────────┬──────────────┬──────────────┐
│ Ledger Account                           │ Debit (₹)    │ Credit (₹)   │
├──────────────────────────────────────────┼──────────────┼──────────────┤
│ 100500 Stock Interim (Received Goods)    │    67,125.00 │              │
│   (Goods: 69,260 − Discounts: 2,150 + Handling: 15)     │              │
│ 100700 TCS Receivable (Tax Asset Sec 206C)│     1,342.00 │              │
│ 200100 Accounts Payable (Anand Wines)    │              │    68,467.00 │
├──────────────────────────────────────────┼──────────────┼──────────────┤
│ TOTALS                                   │    68,467.00 │    68,467.00 │
└──────────────────────────────────────────┴──────────────┴──────────────┘
```
*(When goods land in Godown, Odoo's automated valuation moves ₹67,125.00 from Stock Interim to Stock Asset: `Debit WH/Stock/Godown Asset`, `Credit Stock Interim`).*

---

## 4. UI/UX Workflow Specifications

### A. Advanced Purchase Bill Drawer (Progressive Disclosure)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ New Purchase Bill                                               [✓] Advanced    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Supplier: [ Anand Wines                     ▼ ]  Bill Date: [ 21/07/2026 ]     │
│ Supplier Inv No: [ BEER--7845               ]  Due Date:  [ 28/07/2026 ]     │
│ Transport Permit (TP No): [ 10651           ]  TP Date:   [ 22/07/2026 ]     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ LINE ITEMS                                                                      │
│ # | Product         | Boxes | Pcs | Unit Rate | Disc %/₹ | Taxable  | Total (₹) │
│ 1 | Tuborg 330ml Can|   5   | 120 | 2,770.41  |    —     | 13,852.00| 13,852.00 │
│ 2 | Tuborg 650ml Btl|  25   | 300 | 2,216.33  |    —     | 55,408.00| 55,408.00 │
│ [+ Add Product Line]                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│ BILL ADJUSTMENTS & CHARGES                                                      │
│ Type                 | Description              | Capitalize? | Amount (₹)     │
│ [Discount (-)    ▼]  | Trade D- on Carlsberg    |     N/A     | [ -1,050.00 ]  │
│ [Discount (-)    ▼]  | Trade Dis on CIPL Product|     N/A     | [ -1,100.00 ]  │
│ [Expense (+)     ▼]  | Add Stamp & Handling     |   [✓] Yes   | [    +15.00 ]  │
│ [Tax (+)         ▼]  | TCS A/c (2.0%)           |   [ ] No    | [  1,342.00 ]* │
│   *Override active: Calculated was ₹1,342.50. Routed 50p to Round-off.          │
│ [+ Add Charge / Discount Line]                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ SUMMARY                                                                         │
│ Gross Items:     ₹ 69,260.00   |   Previous Outstanding: ₹ 135,137.00           │
│ Net Discounts:   −₹ 2,150.00   |   Total Cases: 30 Cases (420 Units)            │
│ Taxes & Charges:  +₹ 1,357.00   |                                                │
│ Round-off Adj:       −₹ 0.50   |   NET PAYABLE:          ₹ 68,467.00            │
├─────────────────────────────────────────────────────────────────────────────────┤
│ [Cancel]                                            [ Save Bill & Update Stock ]│
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Bi-Directional Rate & Total Calculation Engine
To eliminate calculation friction (as demonstrated in the user's video):
1. **Forward Entry:** User enters `Boxes = 5` (or `Pieces = 120`) and `Rate = 2,770.41` $\rightarrow$ `Total Amount` automatically calculates to `₹13,852.00`.
2. **Reverse Entry:** User enters `Pieces = 100` and `Total Amount = ₹15,000.00` $\rightarrow$ `Unit Rate` instantly calculates to `₹150.00`.
3. **Ambiguity Prevention Guard:**
   * The line total in the table is explicitly labeled **"Basic Amount (Excl. Tax & Discount)"**.
   * If a user has a tax-inclusive rate from an invoice, clicking an inline **[₹ Incl]** toggle allows typing the inclusive total; the system reverse-calculates the taxable base using standard GST formulas ($Rate = \frac{Total}{1 + TaxRate}$).

#### Direct Tax Override & Penny Round-off Matching
* **Default:** System auto-computes tax using the registered percentage.
* **Invoice Matching Override:** The user can edit the calculated tax box directly to match the printed supplier paper.
* **Penny Variance Threshold:** Differences up to $\pm ₹5.00$ are automatically routed to the `Round-off / Penny Difference Ledger`. If variance exceeds ₹5.00, the system displays a warning banner preventing improper accounting entry.

---

### B. Advanced Sales Invoice (B2B / Large Invoice)

* **Separation of Concerns:**
  * **Retail POS (`/sales`):** Remains 100% focused on speed (1-click cash, thermal slip, $<1$ sec checkout).
  * **Advanced Sales Invoice:** Accessible via **"+ New Tax Invoice / B2B Sale"** button.
* **Fields Supported:**
  * Customer selection with live GSTIN validation, State Code, and Khata balance.
  * Billing & Shipping Addresses (for interstate supply).
  * HSN/SAC codes, Tax slabs (CGST+SGST or IGST).
  * Item discounts and Bill-level discounts.
  * Payment terms (Immediate, 7 Days, 15 Days Credit).
  * Transport details: Vehicle No., LR/RR No., e-Way bill # (statutory requirement for Indian consignments $> ₹50,000$).
  * Generates an official statutory A4 Tax Invoice PDF and updates customer receivable ledger.

---

## 5. Dual Bill-Template System Architecture

In [`SettingsPage.tsx`](file:///C:/Users/rushi/Music/production-hot-fix/src/pages/SettingsPage.tsx), the user demonstrated print preferences currently tailored solely for thermal slips.  
ORSquare establishes two distinct, professional presentation engines:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      ORSQUARE BILL TEMPLATE SYSTEM                              │
├───────────────────────────────────────┬─────────────────────────────────────────┤
│   CATEGORY 1: LARGE FORMAT (A4)       │   CATEGORY 2: COMPACT THERMAL (POS)     │
│   • B2B Tax Invoices                  │   • Counter Sales & Retail Slips        │
│   • Wholesale Purchase Receipts       │   • Bar & Peg Dispense Slips            │
│   • Supplier Debit / Credit Notes     │   • Kitchen KOT Slips                   │
├───────────────────────────────────────┼─────────────────────────────────────────┤
│ Layout: 210mm × 297mm (A4 Grid)       │ Layout: 58mm (32 col) / 80mm (48 col)   │
│ Density: High detail, full borders    │ Density: Compact, monospaced/condensed  │
│ Tables: S.No, HSN, MRP, Qty, Rate,    │ Format: 2-line wrapped item list        │
│         Disc, Taxable, CGST, SGST     │ Totals: Subtotal, Disc, Tax, Settle     │
│ Features:                             │ Features:                               │
│ • Statutory Excise Matrix (IMFL/Beer) │ • Silent print via QZ Tray / Raw ESC/POS│
│ • Bank NEFT/RTGS details              │ • Cash drawer kick code                 │
│ • Dynamic UPI QR code                 │ • Top/Bottom cutter feeds               │
│ • Authorized Signatory box            │ • Compact return lookup barcode         │
└───────────────────────────────────────┴─────────────────────────────────────────┘
```

### Settings Tab Layout Evolution
Under `Settings` $\rightarrow$ `Bill & Invoice`:
1. **Template Switcher:** `[ Compact Thermal (58/80mm) ]` vs `[ Large Format Tax Invoice (A4) ]`.
2. **Side-by-Side Live Preview:**
   - Selecting *Compact Thermal* renders the live receipt roll preview with paper width presets (58mm, 80mm, 76mm impact).
   - Selecting *Large Format A4* renders a live A4 tax invoice preview with company header, buyer details, item table, excise matrix, and bank details.
3. **Template Customization Controls:**
   - Toggle HSN code column display.
   - Toggle MRP column display.
   - Toggle Statutory Excise Matrix footer (IMFL/Wine/Beer bottle summary).
   - Bank details and dynamic UPI QR code generator configuration.

---

## 6. Purchase Returns & Corrections Workflow

* **Debit Notes for Purchase Returns (`in_refund`):**
  - When damaged cases or leaked bottles are returned to the distributor:
    1. System posts reverse stock movement (`WH/Stock/Godown` $\rightarrow$ `Supplier`).
    2. Generates an Odoo Vendor Credit Note (`account.move` with `move_type = 'in_refund'`).
    3. Reverses original tax/TCS and credits the supplier's accounts payable ledger.
* **Audited Bill Corrections:**
  - If a cashier mistyped a quantity or rate on a saved bill:
    - Never executes silent database overwrites.
    - Generates an auditable adjustment record logging the restated stock count and adjusting the supplier payable variance.

---

## 7. Action Plan & Next Checkpoint

1. **Review & Approval:** Present this architectural and accounting framework to the product owner for confirmation.
2. **Phase 1 (Backend Foundation):**
   - Verify Odoo 18 `property_cost_method = 'average'` (AVCO) configuration on product categories.
   - Structure `account.move` vendor bill extensions in `orsquare` module for supplier invoice reference, TP number, capitalized landed cost lines, and penny round-off routing.
3. **Phase 2 (Frontend Purchases & Sales UI):**
   - Implement the `[✓] Advanced Bill` progressive disclosure drawer in Purchases.
   - Embed the bi-directional Rate $\leftrightarrow$ Total Amount calculation engine.
   - Add the B2B Tax Invoice modal to Sales.
4. **Phase 3 (Template Engine):**
   - Build the dual A4 Tax Invoice and 58/80mm Thermal receipt print engines with live preview in Settings.
