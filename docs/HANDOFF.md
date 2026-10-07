# Hand-off: how to pick this project up

Written 2026-10-08 by hand at the end of the governance / Developer Console build. If you are a person or an AI agent starting fresh, read this top to bottom once; it is meant to be enough. Current numbers are in [STATUS.md](../STATUS.md); the reasoning behind decisions is in [backend-decisions.md](backend-decisions.md), [governance.md](governance.md) and the notes under `docs/memory/`.

## 1. What this project is, in five lines

ORSquare sells software to bottle/beverage counters (and bars/restaurants). **Odoo 18 Community** does all accounting, stock and tax. A thin custom Odoo module (`orsquare`) adds the retail rules. A **React** app (`frontend/`) is what shop staff use; a separate **Astro** site (`landing/`) is the public website. **One shop = one PostgreSQL database**; a **platform database** (`orsquare_platform`) keeps the fleet registry and the operators' Developer Console (`/dev`). The product owner is a designer, not a developer: explain simply, and ask before architectural changes (see AGENTS.md section 1).

## 2. Start the stack (Windows, Docker Desktop)

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"   # wait until it is ready
Set-Location scratch/odoo18-spike ; docker compose up -d                       # Odoo on :8088, PostgreSQL on :5433
Set-Location ../../frontend ; npm ci ; npm run dev                             # app on http://localhost:5173
```

* Databases: `orsquare_platform` (console), `orsquare_template` (every new shop is a clone of it), `orsquare_shop1` (sample shop), `orsquare_dev` (test database), `orsquare_shop_bench` (leftover, not a shop).
* Sample users and test passwords are in [status-history.md](status-history.md) (local test values only). Sign in at `/login` with email or mobile and a password: **no shop code**. Operators sign in at `/dev`.
* **The local developer account must enrol an authenticator** at its next sign-in (the console refuses everything else until then). On a throw-away machine you may set the system parameter `orsquare.platform.require_mfa` to `0` in the platform database. If you are locked out: `UPDATE res_users SET totp_secret = NULL WHERE login = '<operator>'` in `orsquare_platform`, then enrol again.
* **Odoo does not reload Python.** After changing any `.py`: `docker restart odoo18-spike-web`. After changing models, data or a migration: bump the module version, add `migrations/<version>/post-migration.py` if data must move, then `bash scripts/upgrade_shops.sh` (template and every shop) and, for the platform module, run `bash scripts/run_platform_tests.sh` (it upgrades the platform database first).

## 3. Verify (run these before and after any change)

```bash
bash scripts/run_tests.sh /orsquare orsquare_dev     # shop suite, 250 tests, ~1 min
bash scripts/run_platform_tests.sh                   # platform suite, 24 tests (provisions and deletes a real shop)
cd frontend && npx tsc --noEmit && npm test && npm run build
docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d orsquare_platform --no-http < scripts/bench_platform.py   # 10,000-shop timings, rolls back
```

Noise you can ignore in the logs: `duplicate key ... orsquare_brand_name_unique` (a test that expects it) and `could not serialize access` (handled on purpose in `_claim`).

## 4. Map of the code

| Need | Go to |
| --- | --- |
| Who may call which API | `addons/orsquare/api_registry.py` (`API_REGISTRY`, `API_GATES`, `MUTATION_TABS`), enforced in `controllers/main.py` and `models/security_utils.py` |
| Staff, roles, tab groups, Business Studio, presets, plan limits | `addons/orsquare/models/staff_service.py`, `presets.py`, `res_company.py`, `security/orsquare_security.xml` |
| Change history, directory, throttle | `models/governance.py`, `models/directory.py`, `models/login_throttle.py` |
| Sign-in, two-step code, enrolment | `controllers/main.py` (`_resolve_db`, `login`, `mfa*`) |
| Console backend (fleet, plans, operators, provisioning) | `addons/orsquare_platform/models/{platform,service}.py` |
| Console UI (Tryton parity: FleetPage, BusinessPanel drawer, NewBusinessDialog, StudioPanel workbench) | `frontend/src/features/dev/`, `frontend/src/components/ui/`, `frontend/src/styles/dev-theme.css` |
| Route guards (`/dev` vs `/`) | `frontend/src/auth/surface.ts`, `frontend/src/App.tsx` |
| Settings page | `frontend/src/pages/SettingsPage.tsx` |
| Offline outbox and sync | `frontend/src/lib/sync.ts`, `addons/orsquare/models/sync_service.py` |
| Operations | [operations-runbook.md](operations-runbook.md) ; scripts in `scripts/` |

## 5. What is left, in priority order

**A. Needs the owner (do not start without an answer)**
1. **10,000 shop databases.** One PostgreSQL cluster with 10,000 full Odoo databases and one worker pool is unproven (memory per loaded registry, backups, upgrades). Likely answer: several pools plus a `shop -> pool` column in the registry and routing in the proxy. Needs a capacity test and a decision; then register it in the console's Fleet.
2. **Plan contents.** Built-in plans (trial, basic, pro) include everything with no staff limit. Decide what each plan allows, then set it in Console -> Plans and press "Apply to shops".
3. **Production.** Domain, TLS, Caddy routing (`deploy/`), a restore drill on another host, Centrifugo/Redis in production (realtime answers "not configured" without it).
4. **Publishing.** `main` is committed locally and never pushed. A push needs the owner's explicit instruction naming `https://github.com/rrb-rushikesh/orsquare-odoo.git`.

**B. Retailer features that are still disabled in the UI** (each button says why; the owner will give the exact bug list)
5. Returns and exchanges (sales and purchases), purchase editing and edit history, stock movement history, product opening stock / import / deletion, product variants and box packing, account edits, payment against a chosen bill. `frontend/src/lib/unavailable.ts` lists every unmapped operation; map one at a time to the existing Odoo service, delete its stub, add a test.
6. **Settings -> Data Control** (shift-cutoff view, wipe, restore) and **Settings -> Tables** (floors/table generator). Backend exists: `wipe.preview/wipe_shop`, `catalog.floors/create_floor/bulk_create_tables`, [data-control-and-wipe.md](data-control-and-wipe.md). The old panels still call stubs.
7. Daybook and Calendar screens (placeholders), table/KOT and open-bottle (peg) screens need mapping to the original UI and manual proof.

**C. Correctness work before real shops** (a core audit on 2026-10-08 fixed four small issues and logged five open ones: see [audit-2026-10-08.md](audit-2026-10-08.md); items A-D there, notably the purchase double-post and the cashier price override, belong here)
8. Offline: the device sequence counter is in `localStorage` and not atomic with the IndexedDB enqueue; purchase retries create a new client reference (double-post risk on an ambiguous response); prove reconnect, rejection recovery, multi-tab sequencing and the physical-stock conflict flow through the restored screens.
9. Role isolation end to end in the browser for cashier and stock keeper (the API gate is tested; the screens are not all exercised).
10. A browser test for `/dev` (sign-in, enrolment, provision, studio, staff) so the console cannot regress silently. Playwright was removed from dependencies in the earlier cleanup; add it back deliberately.
11. Physical printers, mobile parity, a full side-by-side comparison with the original app.

**D. Deferred on purpose (do not build without being asked)**
12. Sheet register and AI surfaces (live repo `SheetPage.tsx`, `AIPage.tsx`), Closing Stock Audit, Product Master Library (excluded by the owner), multi-shop (cancelled). Passkeys (Odoo 18 `auth_passkey`) and a central identity provider (Keycloak/Zitadel) are future options only; see [governance.md](governance.md) section 4.

## 6. Traps already hit (read before you lose an hour)

* **Git Bash quoting.** Long heredocs containing quotes break the shell. Write the script to a file and run it. File paths to `docker exec` need `MSYS_NO_PATHCONV=1`.
* **`odoo.registry()` is deprecated** (use `Registry(db)`); an `Environment` has no `.sudo()` (use `env(su=True)`); `_check_credentials` checks the environment's user, not the record you call it on.
* **PostgreSQL REPEATABLE READ.** A transaction cannot see rows another connection committed after it started. `_claim` and `_unregistered` read on a fresh connection for that reason.
* **"Guarded, so silently off."** A check written `if model in env` disappears when the module is absent from that database. The platform database has no `orsquare` module; operator sign-in was unprotected until the throttle was shared. Test both database types.
* **Never decide shop vs developer from `me.company`;** both have one. Use `auth/surface.ts`. Hooks must not sit below an early return.
* **Do not scan shop databases** to find a user; the directory (`orsquare_platform_login`) is authoritative. Rebuild it in Console -> System after importing shops.
* **Test runs touch several databases** (`-d orsquare_dev` also upgrades the others listed in `odoo.conf`); "0 tests" lines for them are normal.
* **The browser pane cannot take screenshots while the Claude window is hidden.** Drive and read the page through scripts instead (set React inputs with the native value setter, then dispatch `input`).
* `Settings` tab can never be switched off (it holds Business Studio). Plans only cap what is effective; they never delete data.
* The two-step code is not single-use (Odoo core). Operators need passwords of 12+ characters; shop staff 8+.

## 7. How the team's tools are used here

* **Memory:** decisions, bugs and checkpoints are notes under `docs/memory/` managed by the `basic-memory` MCP (project `orsquare`); the code graph is the `codebase-memory` MCP (project `C-Repo-orsquare-odoo`). Re-index after large changes (`index_repository` with the repo root). Details: [ai-knowledge-tools.md](ai-knowledge-tools.md).
* **Rules:** AGENTS.md == CLAUDE.md (run `scripts/sync-agent-files.ps1`; a pre-commit hook blocks drift). Ask before architectural change; write a checkpoint note when something is verified, a root cause is found, or work is paused.
* **Commits:** small logical groups, imperative subject, body explains why. Never push without the exact approval described above.
