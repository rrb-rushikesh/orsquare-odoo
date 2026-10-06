# Tab Specification: Stock

**Route:** `/stock`  
**Purpose:** Physical inventory register showing quantities, location split, valuations, and internal movements.  
**Underlying Engine:** Standard Odoo `stock.quant`, `stock.location` (`Godown` & `Counter`), and `stock.picking` internal transfers.

---

## 1. Two-Location Inventory Topology

To maintain tight physical control and prevent theft in bottle/retail shops, inventory is strictly segregated:

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

* **Godown (`WH/Stock/Godown`):** Bulk reserve where new purchases land. Not directly sellable.
* **Counter (`WH/Stock/Counter`):** Sale-ready front inventory consumed by POS sales.
* **OP Stock (`WH/Stock/Opened`):** Active bottles being dispensed in portions/pegs.

---

## 2. Workflows & Features

### A. Stock Transfer Drawer
* Quick slide-out drawer to transfer stock from Godown to Counter.
* Selects items, quantities, and confirms. Posts an Odoo internal transfer (`stock.picking` of type `internal`), immediately updating Counter stock.

### B. OP Stock (Open Bottles) Section
* Dedicated table listing all active opened bottles:
  - Bottle identifier (e.g. `RC #01`, `Old Monk #02`).
  - Original size vs. remaining milliliters.
  - Percentage full with fill status badge.
  - Action button: *Write-off Remaining (Spillage/Wastage)*.

### C. Low Stock Alerts & Valuation
* Filters items below reorder thresholds.
* Total inventory valuation (Godown value + Counter value). Masked for non-authorized roles.

---

## 3. Variants: Standard vs. WineStock Matrix

### Standard Stock Variant (`StockPage`)
Flat list table of products with category filters, search, Godown pieces, and Counter pieces.

### WineStock Variant (`WineStockPage`)
Specialized matrix layout for beverage retailers:
* Rows represent **Brands** (e.g. *Royal Challenge*, *Kingfisher*).
* Columns represent **Sizes** (e.g. *750ml*, *375ml*, *180ml*, *90ml*).
* Cells show live pieces in Godown and Counter for that specific brand and size.

---

## 4. Business Rules
* **Strict Conservation:** Total stock always equals Godown quantity + Counter quantity + Opened bottle volume.
* **Derived Truth:** Stock quantities are read directly from Odoo `stock.quant`; the UI never stores or overrides balances.
