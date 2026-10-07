---
title: Accounts Tab Receivable Payable Refactoring 2026-10-07
type: note
permalink: orsquare/checkpoints/accounts-tab-receivable-payable-refactoring-2026-10-07
---

# Accounts Tab Receivable/Payable Refactoring Checkpoint (2026-10-07)

## What Was Done
1. **Replaced Confusing Accounting Jargon in Accounts Tab:**
   - Replaced all user-facing instances of "Debit" and "Credit" (`Dr` / `Cr`) with **"Receivable"** and **"Payable"** across `AccountsPage.tsx` and `AccountLedgerView.tsx`.
   - **Receivable** represents money owed to the shop and is styled in **Green** (`var(--ok, #198038)` / `var(--rec-fg, #235c35)` / `var(--rec-bg, #edf6f0)`).
   - **Payable** represents money the shop owes to suppliers and is styled in **Red** (`var(--err, #da1e28)` / `var(--pay-fg, #8a2e2e)` / `var(--pay-bg, #faebeb)`).

2. **Refactored `AccountLedgerView.tsx`:**
   - Financial Metrics bar:
     - `Period Debit (+)` $\rightarrow$ `Period Receivable (+)` in Green (`var(--fin-rec)`).
     - `Period Credit (-)` $\rightarrow$ `Period Payable (-)` in Red (`var(--fin-pay)`).
     - Removed raw `Dr` and `Cr` text from Current Balance and Opening Balance tiles; replaced with semantic position badge (`· Receivable` / `· Payable`).
   - Ledger table headers:
     - Column 5: `Debit (You Gave)` $\rightarrow$ `Receivable (+)` (Green).
     - Column 6: `Credit (You Got)` $\rightarrow$ `Payable (-)` (Red).
   - Closing Balance summary row:
     - Total Receivable amount in Green (`var(--ok, #198038)`).
     - Total Payable amount in Red (`var(--err, #da1e28)`).
     - Removed raw `Dr` / `Cr` text next to the closing balance figure.
   - Entry Detail Drawer:
     - Renamed `Debit (Dr)` $\rightarrow$ `Receivable` (Green).
     - Renamed `Credit (Cr)` $\rightarrow$ `Payable` (Red).
     - Resulting balance badge renders clean `· Receivable` or `· Payable` without `Dr`/`Cr`.

3. **Refactored `AccountsPage.tsx`:**
   - Summary tiles:
     - Replaced `Debtor accounts` note with `Receivable accounts`.
     - Replaced `Creditor accounts` note with `Payable accounts`.
   - Table columns:
     - Cleaned up Balance column to display pure formatted currency amount with clean colored status pills (`Receivable` in Green, `Payable` in Red) instead of appending raw `Dr` / `Cr`.
   - New / Edit Account Drawer:
     - Replaced `Balance type` with `Opening position`.
     - Dropdown options display `"Receivable (Owed to Shop)"` and `"Payable (Owed to Supplier)"` while maintaining internal wire values (`'Debit' | 'Credit'`).
   - Restored icon on `+ Add` button (`IconPlus` from `@/components/icons`).

4. **Synchronized Global Tokens (`tokens.css`):**
   - Inverted legacy `--dr-fg` and `--cr-fg` definitions so `--dr-fg` is Green (`#235c35`) and `--cr-fg` is Red (`#8a2e2e`), ensuring complete consistency across all ledger surfaces.

5. **Verification:**
   - `npm run typecheck`: 0 errors.
   - `npm test`: 107 passed, 1 skipped.