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
* **Scope:** Controlled strictly by Shop Owner in Settings $\rightarrow$ Sales Register Controls.
* **Behavior & Concurrency Protection:**
  * When `auto_godown_transfer` is **ON**: If Counter stock is insufficient but Godown has adequate stock, the checkout service automatically executes an internal stock transfer (`WH/Stock/Godown` $\rightarrow$ `WH/Stock/Counter`) upon bill settlement.
  * **Concurrency & Atomic Transaction Guard:** The stock reservation, internal transfer, delivery, and invoice execute inside the exact same Odoo database transaction (`with env.cr.savepoint():`) and either all succeed or all roll back atomically.
  * **Row-Level Lock Queueing & Test-Proven Invariant:** Concurrency is protected via PostgreSQL row-level locks on `stock.quant` through native reservation (`_action_assign()`). Competing concurrent checkouts queue cleanly on the row lock rather than throwing immediate unhandled failures. When the queued transaction acquires the lock, it re-verifies available quant quantities: if the preceding transaction depleted the stock, it aborts cleanly with an `Insufficient Stock in Godown` validation message. Zero overselling, zero phantom sales, and zero negative inventory is maintained as a core system invariant that must be proven and validated through concurrent multi-threaded integration and load tests, relying on Odoo's native reservation and valuation machinery as the sole authority.
  * Preserves full Odoo audit trail: creates a real Odoo `stock.picking` with `origin = f"Auto-Godown Transfer for Sale {sale_ref}"` and logs the cashier's user session.
  * If Godown lacks stock, checkout halts with an explicit stockout warning.

### B. Stock Transfer Drawer (Manual Movements)
* Slide-out drawer to transfer stock between Godown and Counter.
* Selects items, quantities, and notes. Posts an Odoo internal transfer (`stock.picking`), updating location balances immediately.

### C. OP Stock (Open Bottles) Shelf
* Dedicated table listing all active opened bottles:
  - Bottle identifier (e.g. `RC #01`, `Old Monk #02`).
  - Original size vs. remaining milliliters.
  - Percentage full with dynamic visual fill badge (Green >50%, Amber 25-50%, Red <25%).
  - Action button: *Write-off Remaining (Spillage/Wastage)* via `stock.scrap`.

### D. Stock Movement History Drawer
* Real-time ledger view per SKU showing historical movements: Intake (Purchases), Transfers (Godown $\leftrightarrow$ Counter), Peg Openings, POS Deductions, and Breakage Scraps.

---

## 3. Business Rules
* **Strict Conservation:** Total physical stock always equals Godown quantity + Counter quantity + Opened bottle volume.
* **Derived Truth:** Stock quantities are read directly from Odoo `stock.quant`; the UI never stores or overrides balances.
* **Sensitive Valuation Masking:** Inventory valuations (asset worth at cost) are masked for employees without `can_see_valuation` permission.

---

## 4. Future Scope: WineStock Matrix Surface
* **Status:** **Postponed to Future Phase.**
* **Description:** The specialized matrix layout grouping brands as rows and bottle sizes as columns (`90ml`, `180ml`, `375ml`, `750ml`) with pinned sorting is preserved in documentation for the future Indian statutory excise milestone. Base platform operates on the high-performance Standard Stock view.
