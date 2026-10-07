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