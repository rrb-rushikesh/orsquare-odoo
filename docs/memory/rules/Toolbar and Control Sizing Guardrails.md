---
title: Toolbar and Control Sizing Guardrails
type: note
permalink: orsquare/rules/toolbar-and-control-sizing-guardrails
---

# Rule: Toolbar and Control Sizing Guardrails

- **Date:** 2026-10-07
- **Relevant Files:** `frontend/src/components/ui/`, `frontend/src/styles/components.css`, `frontend/DESIGN.md`

## Context
Panel header toolbars (`.panel-actions`) house discovery and operational controls (Search, Filters, Sort, Date range, Action buttons). Poor flexbox constraints caused dropdown selects to balloon across the page while squishing search inputs.

## The Rules
1. **Search Field is the Sole Flexible Element:**
   - `<SearchField />` (`.search-box`, `.toolbar-grow`) must be the only element in `.panel-actions` with `flex-grow: 1`.
   - Dimensions: `flex: 1 1 240px; min-width: 200px; max-width: 480px;`.
   - Reserves 36px on the left for the 15px search icon; features an accessible clear button (✕) when a query is present.
2. **Selects are Strictly Fixed Geometry:**
   - `<ToolbarSelect />` (`.tb-select`) must be `flex: 0 0 auto; flex-shrink: 0; flex-grow: 0;`.
   - Standard width tiers:
     - `sm`: 140px (e.g. status, type filters).
     - `md`: 160px (e.g. categories, accounts).
     - `lg`: 170px (e.g. complex sort criteria).
   - Must never inherit `width: 100%` from general form `.field-control` styles.
3. **Buttons & Date Range Pickers:**
   - `<Btn />`, `<IconButton />`, `<DateRangeFilter />` must be `flex: 0 0 auto;`.
   - Height is strictly `--ctl-h` (40px comfortable / 38px toolbar / 32px dense).
   - Icon-only buttons must be exact squares (`38x38px` or `32x32px`).
4. **IBM Carbon Visual Rigor:**
   - 0px border-radius across all controls.
   - Hairline borders: `1px solid var(--line)`.
   - Surfaces: `--layer` for inputs/selects, `--canvas` for toolbars.
   - Font: IBM Plex Sans.