---
title: Known Traps and Findings
type: note
permalink: orsquare/bugs/known-traps-and-findings
---

# Known Traps and Verified Bugs

## Context
Defects discovered during architecture spikes, testing, and gateway integration.

## Key Findings & Gotchas
1. POS Oversell: Odoo's default POS silently ignores stockouts. ORSquare's settle() enforces FOR UPDATE locking to prevent negative stock.
2. Data Wipe: TRUNCATE CASCADE deletes es_company because of opening move foreign keys. Wipe must use ordered SQL DELETE.
3. Caddy Session Loss: Database-independent requests in Odoo drop unsaved sessions. Login must explicitly rotate and save sessions.
4. Server-Wide Module: orsquare must be in server_wide_modules or gateway guests get 404 on unauthenticated routes.
5. GST Address Dependency: Odoo l10n_in crashes with 500 if company address/state is missing. ORSquare wraps this into 422 error.
6. Local Sequence Race: Browser localStorage device sequence is not atomic with Dexie enqueue; needs careful handling.


## Added 2026-10-08 (governance build)
10. **Git Bash heredocs with quotes break**; write a script file and run it. `docker exec` paths need `MSYS_NO_PATHCONV=1`.
11. **Odoo does not hot-reload Python**: `docker restart odoo18-spike-web`. Module changes need `scripts/upgrade_shops.sh`; platform changes `scripts/run_platform_tests.sh`.
12. **REPEATABLE READ**: a transaction cannot see another connection's later commits (new databases, directory keys). Read those on a fresh connection.
13. **`if model in env` guards fail silent** when the module is absent from that database (the platform DB had no throttle). See [[Operator Sign-in Had No Throttle and Guarded Code Fails Silent]].
14. `odoo.registry()` is deprecated (use `Registry`); `Environment` has no `.sudo()` (use `env(su=True)`); `_check_credentials` checks the environment's user.
15. Never scan shop databases to find a user; use the platform directory. Rebuild it after importing shops.
16. The browser pane cannot screenshot while the Claude window is hidden; drive and read the DOM by script (native value setter + `input` event for React inputs).
17. The local developer account needs an authenticator (or `orsquare.platform.require_mfa=0` locally).
