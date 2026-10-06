# Tab Specification: Products

**Route:** `/products`  
**Purpose:** Master catalog defining what the shop sells, purchase costs, retail prices, barcodes, and measurement units.  
**Underlying Engine:** Standard Odoo `product.template`, `product.product`, and `uom.uom`.

---

## 1. Domain Terminology Hierarchy

Mixing up brands, flavors, and sizes is a common source of retail bugs. ORSquare enforces standard nomenclature:

| Term | Technical Mapping | Example | Meaning |
|---|---|---|---|
| **Brand (Family)** | `product.template` | *Royal Challenge* | The umbrella product brand. |
| **Variant / Flavor** | Product Attribute | *Green Apple*, *Barrel Select* | Meaningful formula or flavor differentiation. |
| **Size / Volume** | `uom.uom` (ml) | *750 ml*, *375 ml*, *180 ml* | Physical bottle volume. Used as columns in the Sheet register. |
| **SKU** | `product.product` | *RC Whisky 180ml* | The exact scannable, sellable item with barcode. |

---

## 2. Key Features & Workflows

### A. Product Form & Catalog Fields
* **Product Classification:**
  * **Retail Product:** Physical storable inventory (`detailed_type = 'product'`). Tracked in Godown and Counter with quants, low-stock alerts, and internal transfers.
  * **Kitchen Dish (Universal Extension):** Infinite stock consumable (`detailed_type = 'consu'`, `is_kitchen = True`). Sold directly at POS without inventory deductions or delivery pickings. No recipes, BOMs, or kitchen costing at this stage.
  * **Shop Consumables (Packaged snacks, peanuts, cashews):** Can be configured as tracked storables (`detailed_type = 'product'`) or untracked counter items (`detailed_type = 'consu'`) with standard units (`Piece`, `Pack`, `Plate`).
* **Name, Short Code, Barcode:** For high-speed barcode scanner or keyboard search.
* **Category (`product.category`):** E.g., *Whisky*, *Beer*, *Wine*, *Beverages*, *Kitchen / Food*.
* **Pricing & Portions:**
  * Maximum Retail Price (MRP), Selling Rate (`list_price`), and Cost Rate (`standard_price`).
  * **Portion Pricing (Half & Full Portions):** Replaces legacy duplicate products (`Name (Half)`). Managed as native Odoo Product Variants (`product.template` + `Portion` attribute). In the UI, presented as a clean toggle:
    * `[✓] Offer Half & Full portions`
    * Full Portion Rate (₹) and Half Portion Rate (₹).
    * Single parent product template guarantees synchronized names, categories, and unified sales reporting.
* **Open Bottle Peg Settings:** Configures allowed peg pack sizes (e.g. 30ml, 60ml, 90ml) and selling rates per peg for that bottle.

---

## 3. Two-Tier Unit Standardization System

To guarantee exact liquid volume calculations for excise/statutory reporting and eliminate legacy regex parsing bugs, units follow a strict two-tier hierarchy:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   TIER 1: STANDARD BASE UNITS (Platform-Level)              │
│       • Shipped & maintained by ORSquare. Immutable. Non-deletable.          │
│       • Controlled by Shop Owner via [Show / Hide] Visibility Eye Icon.     │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│   ml (Vol)   │   L (Vol)    │ Piece (Unit) │  Pack (Unit) │  Plate (Kitchen)│
│  [Eye: ON]   │  [Eye: ON]   │  [Eye: ON]   │  [Eye: ON]   │    [Eye: OFF]   │
└──────┬───────┴──────────────┴──────┬───────┴──────────────┴─────────────────┘
       │                             │
       ▼                             ▼
┌──────────────────────────────┐ ┌───────────────────────────────────────────┐
│ TIER 2: SHOP UNITS (Derived) │ │ TIER 2: SHOP UNITS (Derived)              │
│ • Base Unit: ml              │ │ • Base Unit: Piece                        │
│ • 180 ml  → Ratio: 180       │ │ • 1 Piece    → Ratio: 1                   │
│ • 375 ml  → Ratio: 375       │ │ • Pack of 10 → Ratio: 10                  │
│ • 750 ml  → Ratio: 750       │ │ • Box of 24  → Ratio: 24                  │
└──────────────────────────────┘ └───────────────────────────────────────────┘
```

### A. Tier 1: Standard Base Units (Platform Managed)
* Built-in platform units shipped by ORSquare: `ml`, `L`, `Piece`, `Pack`, `Plate`, `Bowl`, `Kg`, `gm`.
* Immutable: Users cannot delete them and cannot create new base units.
* **Shop Visibility Control & Non-Destructive Hiding:** Shop owners can toggle visibility (eye icon) to hide base units not relevant to their retail type (e.g., wine shops hide `Plate` and `Bowl`).
* **Non-Destructive Guardrail:** Hiding a Base Unit removes it strictly from new selection dropdowns and creation UIs. It **never breaks or invalidates existing Shop Units or products** that rely on it; they continue operating and calculating volume normally. Re-enabling the base unit restores it to the creation dropdowns.


### B. Tier 2: Shop Units / Product Units (Shop Managed)
* Created by the shop owner from an active, visible Base Unit.
* Fields: Unit Name (e.g. `180 ml`, `Pack of 10`), Base Unit (`ml`, `Piece`), and a strict Numeric Ratio (`180`, `10`).
* **Mathematical Integrity:** Liquid volume aggregation in Liters is 100% mathematically exact:
  $$\text{Total Liters} = \sum \frac{\text{Qty Sold} \times \text{Shop Unit Ratio in ml}}{1000}$$

---

## 4. Catalog Masters (Formerly "Catalog Options")

The drawer accessed via the gear icon is renamed from *"Catalog Options"* to **"Catalog Masters"** to reflect authoritative enterprise master data:
* **Tab 1: Categories:** Manage retail and kitchen categories.
* **Tab 2: Units:** Structured into two visual sections:
  1. **Standard Base Units:** Shipped defaults with dimension badges and visibility toggles.
  2. **Shop Units:** Shop-created derived units with base unit picker, numeric ratio, and edit/delete actions.
* **Tab 3: Brands:** Brand families for grouping in registers and sheets.

---

## 5. Opening Stock & Business Rules
* **No Direct Balance Edits:** Stock quantities exist only as physical moves in the inventory ledger.
* **Opening Stock Policy:** Accepted once upon creation for initial onboarding via an append-only inventory move.
* **Kitchen Classification:** Dishes marked `is_kitchen` are consumables (`detailed_type = 'consu'`) and bypass counter stock deductions.

