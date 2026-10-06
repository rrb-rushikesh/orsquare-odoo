# Tab Specification: Stock

**Route:** `/stock`  
**Purpose:** Physical inventory register showing quantities, location split, valuations, and internal movements.  
**Underlying Engine:** Standard Odoo `stock.quant`, `stock.location` (`Godown` & `Counter`), and `stock.picking` internal transfers.

---

## 1. Two-Location Inventory Topology

To maintain tight physical control and prevent theft in bottle/retail counters, inventory is strictly segregated:

```
[ Supplier ] ──Purchases──▶ [ Godown (Reserve Storage) ]
                                      │
                               Internal Transfer
                                      ▼
[ Customer ] ◀──Sales────── [ Counter (Sale-Ready) ]
                                      │
                                 Open Bottle
                                      ▼
                            [ OP Stock (Opened Shelf) ]
```

* **Godown (`WH/Stock/Godown`):** Bulk reserve where new purchases land. Not directly sellable at POS.
* **Counter (`WH/Stock/Counter`):** Sale-ready front inventory consumed by POS checkout.
* **OP Stock (`WH/Stock/Opened`):** Active bottles being dispensed in portions/pegs.

---

## 2. Key Workflows & Operational Capabilities

### A. Auto-Godown Stock Transfer on Checkout (`auto_godown_transfer`)
* **Problem:** In high-speed retail counters, cashiers cannot stop to manually transfer cases when a customer buys 5 bottles and Counter only has 2 on the shelf.
* **Behavior:**
  * When `auto_godown_transfer` is **OFF**: POS warns or blocks sale if Counter stock is insufficient.
  * When `auto_godown_transfer` is **ON**: If Counter stock is insufficient but Godown has adequate stock, the system automatically posts an internal stock transfer (`WH/Stock/Godown` $\rightarrow$ `WH/Stock/Counter`) upon bill settlement without blocking checkout.
* **Odoo 18 Mapping:** Automated chained internal picking or 2-step replenishment route executed atomically with invoice validation.

### B. Stock Transfer Drawer (Manual Stock Movement)
* Slide-out drawer to transfer stock from Godown to Counter or return excess from Counter to Godown.
* Selects items, quantities, and notes. Posts an Odoo internal transfer (`stock.picking` of type `internal`), immediately updating location balances.

### C. OP Stock (Open Bottles) Shelf
* Dedicated table listing all active opened bottles:
  - Bottle identifier (e.g. `RC #01`, `Old Monk #02`).
  - Original size vs. remaining milliliters.
  - Percentage full with dynamic visual fill badge (Green >50%, Amber 25-50%, Red <25%).
  - Action button: *Write-off Remaining (Spillage/Wastage)* via `stock.scrap`.

### D. Stock Movement History Drawer
* Real-time ledger view per SKU showing historical movements: Intake (Purchases), Transfers (Godown $\leftrightarrow$ Counter), Peg Openings, POS Deductions, and Breakage Scraps.

---

## 3. Surface Variants: Standard vs. WineStock Matrix

### Variant A: Standard Stock (`StockPage`)
* Flat list table of products with category filters, search, Godown pieces, and Counter pieces.
* Best for general retail, grocery, and packaged consumables.

### Variant B: WineStock Matrix (`WineStockPage`)
* High-density matrix designed specifically for beverage retailers:
  * **Rows:** Grouped by **Brand** (e.g. *Royal Challenge*, *Kingfisher*). Child flavours expand underneath.
  * **Columns:** Defined by standard **Bottle Sizes** (`90ml`, `180ml`, `375ml`, `750ml`, `1000ml`, `PCS`).
  * **Cells:** Live breakdown of `Godown / Counter / Total` pieces for each brand-size intersection.
  * **Pinned Sorting:** Allows retailers to pin high-velocity brands permanently to the top of the matrix for fast scanning and counting.

---

## 4. Business Rules
* **Strict Conservation:** Total physical stock always equals Godown quantity + Counter quantity + Opened bottle volume.
* **Derived Truth:** Stock quantities are read directly from Odoo `stock.quant`; the UI never stores or overrides balances.
* **Sensitive Valuation Masking:** Inventory valuations (asset worth at cost) are masked for employees without `can_see_valuation` permission.
