---
title: Governance and Developer Console Build 2026-10-08
type: note
permalink: orsquare/checkpoints/governance-and-developer-console-build-2026-10-08
---

# Checkpoint: Governance and Developer Console Build (2026-10-08)

Owner approved the plan in [[Governance Review 2026-10-08 (Staff Access and Business Studio)]] ("develop it with utmost maturity").

## Done and verified
- Server-side gate (`api_registry.API_GATES`, `MUTATION_TABS`), tab grants as native groups, plan entitlements, version-locked Business Studio, versioned presets, append-only `orsquare.config_audit`.
- TOTP two-step sign-in (shops optional, operators mandatory), staff password/authenticator reset, global sign-in directory (no more scanning shop DBs), operator levels admin/support.
- Console: Fleet (server paging), shop drawer (overview/health, Studio, Team, Activity, lifecycle incl. archive + permanent delete), Plans, Operators, Audit (filters), System (template, directory, adopt).
- Retailer Settings: Business Studio, Team & Access, Security & activity. Stock WineStock matrix + Advanced accounts variants ported from the live repo.
- Evidence: shop suite 250, platform suite 24, frontend 125, build clean, browser-verified. Scale: fleet page 3 ms at 10,000 shops (`scripts/bench_platform.py`).

## Decisions
- Own audit table, not OCA `auditlog` (Beta, ORM patching, extra download, logs noise). Records intent at the service layer.
- Built-in plans ship with no limits (commercial decision stays with the owner).
- Shop DB scan removed from sign-in; the directory is authoritative.

## Open (owner decision or later work)
- 10,000 databases on one cluster: capacity/sharding plan (registry would need a `shop -> pool` mapping). Not started.
- Settings -> Data Control and Tables still old disconnected pages; Sheet register and AI not imported.

Files: `docs/governance.md`, `addons/orsquare/models/{staff_service,governance,directory,presets}.py`, `addons/orsquare_platform/models/{platform,service}.py`, `frontend/src/features/{governance,dev}/`.
