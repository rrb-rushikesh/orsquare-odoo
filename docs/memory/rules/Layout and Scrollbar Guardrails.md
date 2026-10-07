---
title: Layout and Scrollbar Guardrails
type: note
permalink: orsquare/rules/layout-and-scrollbar-guardrails
---

# Layout and Scrollbar Guardrails (Zero Detached Scrollbars & Zero Dead Space)

## Context
A visual layout bug was identified on widescreen monitors (>1600px, e.g. 1920x1080) where a vertical scrollbar was rendered at pixel 1600 (centered container edge) rather than the viewport edge, leaving an artificial empty gutter to the right.

## Finding & Root Cause
In `frontend/src/styles/components.css`, `.shell-topnav > .page` is the internal scrolling container (`overflow-y: auto`) constrained by `max-width: var(--page-max-width, 1600px); margin: 0 auto;`. However, lines 5557–5585 had forced `.shell-topnav > .page` to have `scrollbar-width: thin;` and `scrollbar-color: ...`. This overrode the intended `scrollbar-width: none;` rule on lines 24–34.

Because `.page` was constrained to 1600px width and centered, the thin scrollbar sat 160px away from the browser window edge, creating an unacceptable floating scrollbar and dead space.

## Decision & Rule
1. **Rule 11 Added to AGENTS.md / CLAUDE.md**:
   - Primary page scrolling in `.shell-topnav > .page` MUST remain completely invisible (`scrollbar-width: none; -ms-overflow-style: none; &::-webkit-scrollbar { display: none; }`).
   - The desktop/tablet interface follows the "installed software" standard: smooth scrolling via mouse wheel, trackpad, touch swipe, or keyboard, with zero visible vertical scrollbar on the page body.
   - Never place a visible scrollbar on a centered or constrained-width container.
   - Internal table or sheet horizontal/vertical scrolling (e.g. `.tbl-scroll`, `.sheet-page`) must be strictly contained within the component's own hairline border boundaries.
   - Surfaces and backgrounds (`--canvas`, `--layer`) must extend edge-to-edge across 100% of the display with zero artificial gutters or dead whitespace.

## How to Apply
- Maintain `scrollbar-width: none` on `.shell-topnav > .page`.
- Ensure `.page` has `width: 100%; box-sizing: border-box;` and seamless background continuity.
- Verify on widescreen displays (>1600px) that no vertical scrollbars appear on `.page`.