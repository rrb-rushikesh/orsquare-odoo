# Tab Specification: Developer Console (`/dev`)

> **Status review — 2026-10-08:** Built and browser-verified against the local stack. Backend: `addons/orsquare_platform/`. UI: `frontend/src/features/dev/` (shared governance screens in `frontend/src/features/governance/`). Model, scale numbers and open decisions: [governance.md](../governance.md). What is still missing is listed at the end.

**Route:** `/dev` (platform operators only; a shop user is redirected to `/` and never sees it). A visitor who is not signed in gets the operator sign-in; there is no link from the retailer app.
**Purpose:** The people who run ORSquare manage the whole fleet of shops from here.

## Access

* Sign in with email and password, then the 6-digit authenticator code. An operator with no authenticator sees only the enrolment screen until it is set up (server enforced).
* Two levels: **Admin** (everything) and **Support** (look, never change). The Operators tab and every change control are hidden from Support, and the server refuses them anyway. There is always one active admin.
* Every action is written to the append-only audit trail with the operator's name; changes made inside a shop also appear in that shop's own log as `platform:<operator>`.

## Tabs

| Tab | What it does |
| --- | --- |
| **Fleet** | Every shop, paged on the server (25/50/100/200), search by shop/code/owner/mobile, filter by lifecycle (active, trial, expiring, expired, suspended, archived) and plan, sortable columns. Admin: *Provision shop* (clones the template; owner login and mobile are reserved in the sign-in directory first). |
| **Shop drawer: Overview** | Owner, plan, expiry, preset; health (software version vs template with "needs upgrade", database size, staff count against the plan, last business day, studio version and preset drift, directory on/off). Admin: change plan and expiry (+7 / +30 / +365 days), reset owner password, suspend (reason required), reactivate, archive, and, for an archived shop only, delete permanently (type the shop code). |
| **Shop drawer: Business Studio** | The same editor the owner has: presets, tabs, features, stock and accounts views, sales-register switches, day cutoff. Greyed-out items are outside the plan. Saves are version-locked. |
| **Shop drawer: Team & access** | The shop's staff: add, change role/data switches/tab grants, disable, set password, remove two-step. Respects the plan's staff limit. |
| **Shop drawer: Activity** | The shop's own change log and the operator actions taken on that shop. |
| **Plans** | List and edit plans (features and tabs included, staff limit); *Apply to shops* pushes a plan in slices with progress; create custom plans; built-ins cannot be deleted; a plan with shops on it cannot be deleted. |
| **Operators** (admin) | Add operators (password 12+), change level, disable/enable, set password, reset authenticator. |
| **Audit trail** | Filter by action, operator, text and dates; paged. |
| **System** | Engine and module versions, database counts, sign-in key count, the new-shop template and its version, *Rebuild directory* with progress and conflict list, and databases that exist but are not in the fleet (*Add to fleet*). |

## Rules (do not break)

* Developer-only: AGENTS.md section 13. Server-side enforcement: section 15.
* Nothing in the console reads shop business data (sales, stock, money). It manages the shop, not the business.
* Lists must stay server-paged and indexed (benchmark: `scripts/bench_platform.py`).

## Not built

Backups and restore from the console (use the runbook), billing and invoicing, per-shop health history over time, bulk actions on many shops, an automated browser test for this page, and routing shops across several database pools (capacity decision pending).
