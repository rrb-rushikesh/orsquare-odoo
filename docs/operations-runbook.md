# Operations Runbook

Everything here was run against the local Docker environment (`odoo18-spike-web` / `odoo18-spike-db`). Commands assume
the repository root and Git Bash. **Docker Desktop must be running** (it is not started automatically).

## 0. What is verified, and how

| Claim | Evidence (re-run any time) |
|---|---|
| Business logic, accounting, permissions (206 tests) | `scripts/run_tests.sh` (dev DB) — and on a **pristine from-scratch install**: `scripts/build_template.sh` → clone → `scripts/run_tests.sh /orsquare <clone>` |
| Zero overselling / exactly-once under real concurrency | `scripts/concurrency_test.sh` |
| Landing-page / refresh / cookie guardrails with a real proxy | `scripts/e2e_gateway.sh` (14 assertions) |
| Realtime delivery + channel authorisation over WebSocket | `scripts/e2e_realtime.sh` (8 assertions) |
| Performance baseline | `scripts/benchmark.sh` → `docs/benchmarks.md` |
| Production Caddyfile is valid | `caddy validate` (run in the `caddy:2` image) |
| **Not yet verified:** the full production compose stack on a real host/domain, TLS, Redis persistence under load, <10 ms fan-out, backups restored on another host, multi-worker Odoo under load | — treat `deploy/` as a vetted template |

## 1. Daily development

| Task | Command |
|---|---|
| Run all tests | `scripts/run_tests.sh` (log: `scratch/last_test.log`) |
| Run one class / test | `scripts/run_tests.sh /orsquare:TestSales` · `/orsquare:TestSales.test_01_cash_sale_posts_native_documents` |
| Odoo shell script | `scripts/shell.sh orsquare_dev < script.py` |
| Run a script on a throwaway DB clone | `scripts/run_on_clone.sh script.py orsquare_dev` |
| Regenerate API reference | `scripts/gen_api_docs.sh` |

Tests upgrade the module first (`-u orsquare`). **A schema/bootstrap change needs a manifest version bump plus
`migrations/<version>/post-migration.py`** (it calls the idempotent `post_init_hook`), otherwise existing databases will
not pick it up. The tests print an expected `duplicate key … orsquare_brand_name_unique` line: it is a negative test.

## 2. Shops (one database each)

```bash
scripts/build_template.sh                                   # template from zero (≈45 s): India chart → orsquare
scripts/provision_shop.sh orsquare_shop1 "Shri Krishna Wines" krishna_owner 'S3cure#Pass' "Krishna Patil" MH wine_shop
scripts/upgrade_shops.sh                                    # every shop + template (run on EVERY deploy, before routing traffic)
scripts/drop_shop.sh orsquare_shop1                         # destructive; shop/scratch DBs only
```
* Provisioning clones SQL **and filestore** (Odoo's `duplicate_database`), configures the company, creates the owner
  and **randomises the template's default `admin` password**. Database names must match `orsquare_[a-z0-9_]+`.
* After provisioning, set in the shop (Settings → Business details): address **and state** (GST invoices refuse to post
  without them), GSTIN, FSSAI, liquor licence, UPI id, and the **State VAT rate** (`catalog.set_regime_tax_rate`; ships
  at 0 %).
* `preset` ∈ `wine_shop | bar | restaurant | grocery` (starting toggles only).

## 3. Odoo configuration that matters (see `deploy/odoo.prod.conf`)

* `server_wide_modules = base,web,orsquare` — **required**: with many databases, Odoo only routes server-wide modules until
  a database is chosen, and sign-in/gate answer guests who have none. (Without it guests get 404.)
* `dbfilter = ^orsquare_shop[a-z0-9_]*$`, `list_db = False`, strong `admin_passwd`, `proxy_mode = True`.
* Parameters (`ir.config_parameter`, per shop DB): `orsquare.allowed_origins` (comma list), `orsquare.app_url`
  (default `https://app.orsquare.com`), `orsquare.centrifugo_url` / `_api_key` / `_secret` / `_ws_url`,
  `orsquare.backup_dir`.

## 4. Edge (Caddy) — `deploy/Caddyfile`

* **orsquare.com**: `forward_auth` → `/api/session/gate` *before* serving anything: signed-in → `302` to the app (the
  landing bytes are never sent); guest → `204` and the static site is served.
* **app.orsquare.com**: `/api/*` → Odoo (cookie re-scoped to `.orsquare.com; Secure`), Odoo UI paths → 404, everything else →
  `try_files {path} /index.html` so a refresh on `/sales` serves the SPA shell.
* Brute-force limiting exists in Odoo (5 failures / 5 min → 429); add proxy-level rate limiting as defence in depth.

## 5. Realtime (Centrifugo + Redis) — `deploy/centrifugo.json`

* The browser calls `realtime.token` and connects with the returned JWT; the **server subscribes it** to
  `shop:<db>` (no amounts) and, for `can_see_money` users, `shop:<db>:money`. `allow_subscribe_for_client` must stay
  **false** (proved: a client cannot subscribe itself).
* Odoo publishes *after commit* to Centrifugo's HTTP API; a failure is logged and never affects billing; devices recover
  from `sync.delta`. `history` + `force_recovery` let a device returning from sleep catch up.
* Channels are keyed by database name; **one gateway can serve many shops safely**.

## 6. Backups, wipes, restores

* Owner **Data Control → Wipe** (`wipe.preview` then `wipe.wipe_shop(confirm_name, password)`): requires the exact shop
  name and the owner's password, creates and verifies a `pg_dump` zip (`<data_dir>/orsquare_backups/pre-wipe-…zip`, SHA-256
  stored in the immutable `orsquare.console_audit`), then clears operational data only (masters, accounts, locations,
  users untouched). Return value includes the `BAK-YYYYMMDD-XXX-NNNN` reference.
* Restore a wipe by an operator: Odoo's own `restore_db` from the zip, or `pg_restore`/`psql` of its `dump.sql` + filestore.
  **Restoring has not been exercised on a second host yet** — do a restore drill before relying on it.
* Routine backups of every shop DB + filestore are the operator's job (`pg_dump` per database, nightly + WAL archiving
  recommended); the pre-wipe backup is a safety net, not a backup policy.

## 7. Troubleshooting (things already hit once)

| Symptom | Cause |
|---|---|
| Guests get **404** on `/api/*` | `orsquare` not in `server_wide_modules` |
| Login `200` but next request is 401 | session persistence; fixed in `login` (rotate + save) — do not move login to a database-bound route |
| `RedirectWarning … address (Don't forget the State field)` | shop address/state missing; API returns it as a 422 |
| `column … does not exist` on a shop | that shop DB was not upgraded: `scripts/upgrade_shops.sh --only <db>` |
| `FileNotFoundError … filestore` in a cloned DB | cloned with raw `CREATE DATABASE … TEMPLATE`; clone with `provision_shop.sh` |
| Tests fail on a new DB with chart/account errors | template built without the India chart first: use `build_template.sh` |
| "Opening a read/write test cursor from a readonly one" | a new HTTP route that writes needs `readonly=False` |
