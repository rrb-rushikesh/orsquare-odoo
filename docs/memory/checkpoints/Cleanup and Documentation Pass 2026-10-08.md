---
title: Cleanup and Documentation Pass 2026-10-08
type: note
permalink: orsquare/checkpoints/cleanup-and-documentation-pass-2026-10-08
---

# Checkpoint: Cleanup and Documentation Pass (2026-10-08)

## Removed (dead, verified by import graph + compiler)
- 53 never-referenced stub operations from `frontend/src/lib/unavailable.ts` (employee, product-library, session/impersonation, closing/day stubs) and 28 unused type imports.
- 47 unused declarations from `frontend/src/lib/contracts.ts` (1105 -> 552 lines).
- Unreachable files: `components/ui/Field.tsx`, `components/ui/index.ts`, `features/dev/useLoad.ts`. Legacy `FeaturesPanel`, `TeamPanel`, `MemberDrawer` from `SettingsPage.tsx` (replaced by the shared governance screens).
- Unused Python imports in the governance modules. Reachability script result afterwards: zero unreachable frontend files; `tsc` clean.

## Documentation
- `STATUS.md` rewritten as a short current-state file; the dated session log moved to `docs/status-history.md`.
- New hand-written pick-up guide `docs/HANDOFF.md`; new `docs/governance.md` and `docs/tabs/dev-console.md`.
- Updated README, context, architecture, decisions (D20-D26), runbook, benchmarks, retailer-restoration, tab specs (settings, stock, accounts), feature spec banner, AGENTS.md/CLAUDE.md (kept identical).
- Code graph re-indexed (`index_repository`, project `C-Repo-orsquare-odoo`); notes updated here.

See [[Project Handoff 2026-10-08]].
