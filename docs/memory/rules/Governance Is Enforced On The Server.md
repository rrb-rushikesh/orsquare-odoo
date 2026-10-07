---
title: Governance Is Enforced On The Server
type: note
permalink: orsquare/rules/governance-is-enforced-on-the-server
---

# Rule: Governance Is Enforced On The Server (AGENTS.md section 15)

- **Date:** 2026-10-08
- **Files:** `addons/orsquare/api_registry.py`, `addons/orsquare/models/security_utils.py`, `addons/orsquare/models/staff_service.py`, `addons/orsquare/tests/test_governance.py`

## Rule
1. A hidden tab or button is never a permission. Every API method is gated by tab (any-of) and optionally feature in `API_GATES`; offline mutations use `MUTATION_TABS`. Adding a method without a gate decision fails `TestRegistryCoverage`.
2. Tab grants are native `res.groups` (one per tab); effective tabs = granted AND on for the shop AND in the plan.
3. Settings change only through `staff.update_settings` (whitelist, `expected_version`, change log). The Settings tab can never be switched off.
4. Platform operators need an authenticator and one level (admin or support); at least one active admin always remains.
5. A sign-in key belongs to exactly one shop (platform directory). Never scan shop databases to find a user; never decide the surface from `me.company`.
6. Console lists must stay server-paged on indexed columns; re-run `scripts/bench_platform.py` after changing a query.

## Why
The first design stored tabs as text that only the UI read, so revoking a tab did not revoke access; sign-in scanned every shop database; the platform database had no brute-force throttle. See [[Operator Sign-in Had No Throttle and Guarded Code Fails Silent]] and `docs/governance.md`.
