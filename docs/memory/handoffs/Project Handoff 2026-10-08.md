---
title: Project Handoff 2026-10-08
type: note
permalink: orsquare/handoffs/project-handoff-2026-10-08
---

# Project Handoff (2026-10-08)

The full hand-written guide is `docs/HANDOFF.md`; current numbers are in `STATUS.md`. This note is the short version for memory search.

## State
Backend, governance and the Developer Console are built and tested (shop suite 250, platform suite 24, frontend 125). Retailer screens are partly connected. Everything is committed locally on `main`; **nothing is pushed** (a push needs the owner to name `https://github.com/rrb-rushikesh/orsquare-odoo.git` explicitly).

## Next steps, in order
1. **Owner decisions:** capacity/sharding for 10,000 shop databases; plan contents (built-in plans have no limits); production domain/TLS/edge; permission to push.
2. **Disabled retailer features** (see `frontend/src/lib/unavailable.ts`): returns/exchanges, purchase edit + history, stock movement history, product opening stock/import/deletion, variants/box packing, account edits, bill-specific payments.
3. **Settings:** reconnect Data Control (cutoff view, wipe, restore) and Tables (floors/table generator); backends exist (`wipe.*`, `catalog.floors/create_floor/bulk_create_tables`).
4. **Correctness:** offline sequence counter atomicity; purchase retry idempotency; prove reconnect/rejection/multi-tab through the restored screens; role isolation in the browser; browser test for `/dev`.
5. **Deferred:** Sheet register, AI, Closing Stock Audit, Daybook/Calendar screens; excluded: Product Master Library; cancelled: multi-shop.

## How to start
Docker Desktop -> `scratch/odoo18-spike` `docker compose up -d` -> `frontend` `npm run dev`. Python is not hot-reloaded (`docker restart odoo18-spike-web`); schema/data changes need `scripts/upgrade_shops.sh`. The local developer account must enrol an authenticator (or set `orsquare.platform.require_mfa=0` locally). Verification commands are in `docs/HANDOFF.md` section 3.

Related: [[Governance and Developer Console Build 2026-10-08]], [[Operator Sign-in Had No Throttle and Guarded Code Fails Silent]], [[Known Traps and Findings]].
