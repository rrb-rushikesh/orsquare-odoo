# Tab Specification: Sheet (Daily Counter Register)

**Route:** `/sheet`  
**Purpose:** The daily operational Counter stock register fixture for liquor and beverage retail stores in India. Answers for every brand: *What should be on the shelf right now, and does the physical count agree?*  
**Underlying Engine:** Projection of Odoo `stock.move` lines associated with the Counter location during the business day.

---

## 1. Matrix Layout & Conservation Formula

The Sheet organizes inventory into a compact high-density matrix:
* **Rows:** Grouped by **Brand** (e.g. *Royal Challenge*, *McDowell's No. 1*, *Tuborg*). Distinct flavors expand as child rows under the parent brand.
* **Columns:** Defined by standard **Bottle Sizes** configured for the register:
  * E.g. *750 ml*, *375 ml*, *180 ml*, *90 ml*.
* **Pinned Sorting:** Allows retailers to pin top-selling, high-velocity brands permanently to the top of the matrix for fast physical auditing.

### The Conservation Equation
Every cell asserts the mathematical identity for the Counter shelf during that business day:

$$\text{Opening (OPN)} + \text{Inward (INW)} - \text{Outward (OUT)} - \text{Sold (SLD)} = \text{Closing (CLS)}$$

* **OPN (Opening):** Counter quantity at the beginning of the business day.
* **INW (Inward):** Stock transferred from Godown to Counter during the day.
* **OUT (Outward):** Stock returned to Godown or written off as breakage.
* **SLD (Sold):** Total pieces billed at the POS counter during the day.
* **CLS (Closing):** Expected physical count remaining on the shelf right now.

---

## 2. Rate Cards & Retail Margins by Bottle Size (`rate_card`)

* Beverage retailers operate under fixed statutory or customary trade margins in paise per bottle size (e.g., 90ml = ₹5 margin, 180ml = ₹10, 375ml = ₹15, 750ml = ₹25).
* **Operational Uses:**
  1. **Sheet Profitability Verification:** Automatically derives total expected gross margin from pieces sold across each size category.
  2. **Product Price Calculation:** Automatically derives recommended selling prices from purchase cost + statutory size margin.

---

## 3. Register Tabs & Cell Rules
* **Registers:** Tabbed groups: *Liquor*, *Beer*, *Others*, *Kitchen*.
* **Status Badges:**
  * 🟢 **Reconciled:** Formula balances, movements classified.
  * 🟡 **Discrepancy:** Differences detected against transaction summaries.
  * 🔴 **Blocked:** Conservation equation breached; figures withheld until corrected.
* **Print & Export:**
  * Printable physical stock-taking sheet (A4 or thermal roll) formatted in shelf-walk order.
  * Official CSV/PDF export for statutory state excise reporting.

---

## 4. Business Rules
* **Sizes are Columns, Flavors are Children:** A bottle size (ml) is always a column; distinct flavors expand as child rows under the parent brand.
* **Derived from Ledger:** Sheet figures are derived directly from movements; no component can overwrite a cell value.
