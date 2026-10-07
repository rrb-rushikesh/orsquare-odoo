# Tab Specification: Sheet (Daily Counter Register)

> **Status review — 2026-10-07:** Sheet/WineStock remains deferred; disconnected source helpers were removed. This is a retained requirement, not an active screen. The rest of this document describes requirements; see [current status](../../STATUS.md).

**Route:** `/sheet`  
**Purpose:** Daily operational Counter stock register fixture for liquor and beverage retail stores in India, tracking brand-level shelf movements.  
**Phase Status:** **Postponed to Future Phase (Future Scope).**

---

## 1. Scope & Roadmap Status

The Sheet Register is a specialized Indian liquor excise compliance surface (commonly required for FL-9 / Daily Brand Registers in states like Maharashtra, Karnataka, and Goa). 

To ensure the base ORSquare retail platform remains clean and focused on core counter POS, inventory, and accounting, the Sheet Register is **postponed to a future phase**. The requirements and mathematical formulation are preserved below for that future milestone.

---

## 2. Matrix Layout & Conservation Formula (Future Scope Reference)

When enabled in the excise phase, the Sheet organizes inventory into a compact high-density matrix:
* **Rows:** Grouped by **Brand** (e.g. *Royal Challenge*, *McDowell's No. 1*). Distinct flavors expand as child rows under the parent brand.
* **Columns:** Defined by standard **Bottle Sizes** (`750 ml`, `375 ml`, `180 ml`, `90 ml`).

### The Conservation Equation
Every cell asserts the mathematical identity for the Counter shelf during that business day:

$$\text{Opening (OPN)} + \text{Inward (INW)} - \text{Outward (OUT)} - \text{Sold (SLD)} = \text{Closing (CLS)}$$

* **OPN (Opening):** Counter quantity at the beginning of the business day.
* **INW (Inward):** Stock transferred from Godown to Counter during the day.
* **OUT (Outward):** Stock returned to Godown or written off as breakage.
* **SLD (Sold):** Total pieces billed at the POS counter during the day.
* **CLS (Closing):** Expected physical count remaining on the shelf.

---

## 3. Statutory Reporting & Export
* Printable physical stock-taking sheet formatted in shelf-walk order.
* Statutory CSV/PDF export for state excise compliance.
