---
title: Toolbar Select Stretch and Search Squeeze
type: note
permalink: orsquare/bugs/toolbar-select-stretch-and-search-squeeze
---

# Bug: Toolbar Select Stretch & Search Squeeze

- **Date:** 2026-10-07
- **Relevant Files:** `frontend/src/styles/components.css`, `frontend/src/components/ui/Toolbar.tsx`, `frontend/src/pages/AccountsPage.tsx`, `frontend/src/pages/PurchasesPage.tsx`

## Symptom
Across multiple application tabs (Accounts, Purchases, Products, etc.), the search input was severely squished down to minimum width (~140px), truncating placeholder text ("Search by n...", "Search bill r..."), while adjacent `<select>` dropdown filters ("All types", "All statuses", "All positions") expanded horizontally to consume ~60% of the screen width with empty grey space.

## Root Cause
1. In `frontend/src/styles/components.css`, `.field-control` at line 1857 declared `width: 100%`.
2. The specific toolbar select width helper classes (`.tb-select-sm { width: 140px; }`) were defined earlier in the stylesheet (line 1241) with equal class specificity (0-1-0).
3. Under standard CSS cascade rules, the later rule (`.field-control { width: 100% }`) won, setting `width: 100%` on `<select className="field-control tb-select tb-select-sm">`.
4. Inside the `.panel-actions` flexbox container, items with `width: 100%` and `flex-shrink: 0` consumed all remaining width in the toolbar.
5. Consequently, the flexible search input (`.search-box`, defined with `flex: 1 1 240px; min-width: 140px`) was crushed down to its absolute minimum width (140px).

## Fix
1. **CSS Specificity and Strict Bounds:**
   - Updated `.panel-actions select`, `.tb-select`, and `select.field-control.tb-select` to have `flex: 0 0 auto !important; width: auto;`.
   - Updated `.tb-select-sm` (140px), `.tb-select-md` (160px), `.tb-select-lg` (170px) with `!important` and `max-width` bounds.
   - Added an explicit override right after `.field-control` preventing it from forcing `width: 100%` on `.tb-select`.
2. **Search Field Flexibility:**
   - Configured `.panel-actions .search-box` to `flex: 1 1 240px; min-width: 200px; max-width: 480px`.
3. **Defense-in-Depth in React Primitives:**
   - In `frontend/src/components/ui/Toolbar.tsx`, added inline `SELECT_WIDTH_STYLE` to `ToolbarSelect` and explicit flex bounds to `SearchField`, providing an absolute architectural guarantee against CSS specificity leaks.