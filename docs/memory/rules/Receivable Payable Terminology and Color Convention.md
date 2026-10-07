# Receivable & Payable Terminology and Color Convention

## Core Business Rule
In all retail-facing UI surfaces (specifically the **Accounts** tab, ledger views, statements, and transaction modals), double-entry jargon (**Debit**, **Credit**, `Dr`, `Cr`) must never confuse shop owners or cashiers.
Instead, the UI strictly uses **Receivable** and **Payable**:

1. **Receivable:**
   - Meaning: Money owed to the shop by customers.
   - User Label: `Receivable` or `Receivable (+)`
   - Semantic Color: **Green** (`var(--ok, #198038)`, `var(--rec-fg, #235c35)`)
   - Background Tint: `var(--rec-bg, #edf6f0)` or `rgba(35, 92, 53, 0.06)`

2. **Payable:**
   - Meaning: Money owed by the shop to suppliers/vendors.
   - User Label: `Payable` or `Payable (-)`
   - Semantic Color: **Red** (`var(--err, #da1e28)`, `var(--pay-fg, #8a2e2e)`)
   - Background Tint: `var(--pay-bg, #faebeb)` or `rgba(218, 30, 40, 0.06)`

3. **Settled / Flat:**
   - Meaning: Zero balance.
   - User Label: `Settled`
   - Color: Muted (`var(--muted)`)

4. **Advance:**
   - Meaning: Prepayment or advance funds held on the reverse side of an account.
   - Color: `var(--adv-fg, #0f62fe)` (Blue)

## Implementation Guardrails
- **Backend wire contracts are preserved:** Internal API payloads still transmit `'Debit' | 'Credit'` where expected by Odoo/Python endpoints, but the UI dropdown labels present `"Receivable (Owed to Shop)"` and `"Payable (Owed to Supplier)"`.
- **Global CSS Tokens aligned:** In `frontend/src/styles/tokens.css`, `--dr-fg` maps to Green (`#235c35`) and `--cr-fg` maps to Red (`#8a2e2e`).
- **Zero raw Dr/Cr suffixes in retail cards:** Amounts render cleanly as formatted currency (e.g. `₹5,400.00`) followed by clear status badges (`· Receivable` or `· Payable`), eliminating confusing `Dr`/`Cr` abbreviations.
