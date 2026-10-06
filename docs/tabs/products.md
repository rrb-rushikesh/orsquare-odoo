# Tab Specification: Products

**Route:** `/products`  
**Purpose:** Master catalog defining sellable products, purchase costs, retail prices, barcodes, units of measure, and portion pricing.  
**Underlying Engine:** Standard Odoo `product.template`, `product.product`, and `uom.uom`.

---

## 1. Domain Terminology Hierarchy

ORSquare enforces standard product nomenclature to prevent retail inventory errors:

| Term | Technical Mapping | Example | Meaning |
|---|---|---|---|
| **Brand (Family)** | `product.template` | *Royal Challenge* | The umbrella product brand. |
| **Variant / Flavor** | Product Attribute | *Green Apple*, *Barrel Select* | Meaningful formula or flavor differentiation. |
| **Size / Volume** | `uom.uom` (ml) | *750 ml*, *375 ml*, *180 ml* | Physical bottle volume. |
| **SKU** | `product.product` | *RC Whisky 180ml* | The exact scannable, sellable item with barcode. |

---

## 2. Key Features & Workflows

### A. Product Form & Catalog Fields
* **Classification:**
  * **Retail Product:** Physical storable inventory (`detailed_type = 'product'`). Tracked in Godown and Counter.
  * **Kitchen Dish (Universal Extension):** Infinite stock consumable (`detailed_type = 'consu'`, `is_kitchen = True`). Sold directly at POS without inventory deductions or delivery pickings.
  * **Shop Consumables (Packaged snacks, peanuts):** Configurable as tracked storables or untracked counter consumables.
* **Pricing & Portions:**
  * Maximum Retail Price (MRP), Selling Rate (`list_price`), and Cost Rate (`standard_price`).
  * **Portion Pricing (Half & Full Portions):** Replaces legacy duplicate products (`Name (Half)`). Managed as native Odoo Product Variants (`product.template` + `Portion` attribute) under a clean toggle: `[✓] Offer Half & Full portions`.
* **Bottle Size Margins & Rate Helpers (Pricing Configuration):**
  * Margins are **never placed on `uom.uom`** (units represent pure physical dimensions, not commercial pricing, and different categories like Country Liquor vs Premium IMFL have different margins for the same 750ml bottle).
  * Margin rules are attached to **Category & Pricing configuration** (`orsquare.margin_rule`: Category + Size UoM $\rightarrow$ Margin Amount).
  * Cashiers sell at native `product.template.list_price` (zero runtime overhead).
  * In the product form, entering a purchase cost of ₹180 on a 750ml Whisky bottle looks up the Whisky 750ml margin rule (₹25) and displays a 1-tap helper: `[Auto-Set Selling Price: ₹180 + ₹25 = ₹205]`.
* **Open Bottle Peg Settings:** Configures allowed peg pack sizes (30ml, 60ml, 90ml) and selling rates per peg for that bottle.

---

## 3. Two-Tier Unit Standardization System

To guarantee exact liquid volume calculations for reporting and eliminate fragile regex parsing bugs, units follow a strict two-tier hierarchy:

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

* **Tier 1 (Base Units):** `ml`, `L`, `Piece`, `Pack`, `Plate`, `Bowl`, `Kg`, `gm`. Immutable. Visibility controlled by shop owners via an eye toggle.
  * **Non-Destructive Guardrail:** Hiding a Base Unit removes it strictly from new selection dropdowns and creation UIs. Existing derived Shop Units and products continue to work and compute volume normally.
* **Tier 2 (Shop Units):** Derived by shops with strict numeric conversion ratios (e.g. `180 ml` with ratio `180` to `ml`), guaranteeing exact liquid volume calculation in Liters:
  $$\text{Total Liters} = \sum \frac{\text{Qty Sold} \times \text{Shop Unit Ratio in ml}}{1000}$$

---

## 4. Catalog Masters Drawer
Accessed via the gear icon in Products:
* **Tab 1: Categories:** Manage retail and kitchen categories.
* **Tab 2: Units:** Structured into Base Units (with eye toggles) and Shop Units (derived with ratios).
* **Tab 3: Brands:** Brand families for grouping in registers and reports.

---

## 5. Excluded Scope (Skipped)
* **Product Master Library & Smart Fuzzy Importer:**
  * **Status:** **Skipped Completely for Current Phase.**
  * The canonical barcode library and fuzzy Levenshtein spreadsheet importer are excluded from the current phase to keep master catalog operations lean and straightforward. Initial products are created directly or through standard Odoo CSV import.

---

## 6. Business Rules
* **No Direct Balance Overwrites:** Stock quantities exist only as physical moves in the inventory ledger.
* **Initial Onboarding Stock:** Accepted once upon creation via an append-only opening inventory move.
