---
title: Layout Fix and Component Standardization 2026-10-07
type: note
permalink: orsquare/checkpoints/layout-fix-and-component-standardization-2026-10-07
---

# Checkpoint: Layout Fix and Component Standardization (2026-10-07)

## Completed Work
1. **Layout & Scrollbar Bug Fixed**:
   - Diagnosed root cause in `frontend/src/styles/components.css`: `.shell-topnav > .page` was included in lines 5557–5585 which forced `scrollbar-width: thin`. Because `.page` has `max-width: 1600px; margin: 0 auto;`, on widescreen displays (1920px+), this caused a visible vertical scrollbar at pixel 1600 with an empty dead gutter to the right.
   - Removed `.shell-topnav > .page` from all 7 scrollbar rules in `components.css`. Page scrolling now adheres to `scrollbar-width: none` ("installed software" standard) with full-width continuity.
   - Added Rule 11 (Zero-Scrollbar & Full-Width Layout Architecture) to `AGENTS.md` and synced with `CLAUDE.md`.
   - Recorded `docs/memory/rules/Layout and Scrollbar Guardrails.md`.

2. **In-Depth Research of `C:\Repo\orsquare-tryton` UI Standards**:
   - Studied `C:\Repo\orsquare-tryton\frontend\docs\UI_STANDARDS.md` and component patterns:
     - Control sizing system (`--ctl-h: 40px`, `--ctl-h-sm: 32px`).
     - Standardized button hierarchy (`Button`, `IconButton` with square geometry).
     - Standardized toolbar search (`SearchField` with 15px search glyph, 36px left padding, clear button).
     - Standardized toolbar selects (`ToolbarSelect` with sm/md/lg width tiers).
     - Standardized segmented controls (`Segmented` with toolbar/inline appearances).
     - Standardized date filtering (`DateRangeFilter`, `MiniCalendar`, `useDateRange` with day-key format).

3. **Standardized Reusable Components Implemented**:
   - `frontend/src/components/ui/Button.tsx`: `Button`, `IconButton`, `Btn` (backward compatible).
   - `frontend/src/components/ui/Toolbar.tsx`: `SearchField`, `ToolbarSelect`.
   - `frontend/src/components/ui/Segmented.tsx`: `Segmented`.
   - `frontend/src/components/ui/tokens.ts`: `ICON` and `CONTROL` tokens.
   - `frontend/src/components/ui/index.ts`: Barrel export.
   - `frontend/src/components/ui.tsx`: Re-exports all components for full backward compatibility.
   - Modernized toolbar controls across `ProductsPage.tsx`, `PurchasesPage.tsx`, `StockPage.tsx`, `CashFlowPage.tsx`, and `AccountsPage.tsx`.

4. **Verification**:
   - `npm run typecheck` passed with 0 errors.
   - `npm test` passed: all 103 tests green.
   - `codebase-memory-mcp` re-indexed: 3,920 nodes, 14,015 edges.