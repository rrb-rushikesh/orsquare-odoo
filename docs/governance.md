# Governance: who may do what, and how the platform manages 10,000 shops

> Status 2026-10-08: implemented and tested (shop suite 250 tests, platform suite 24, frontend 125). Decision record:
> `docs/memory/decisions/Governance Review 2026-10-08 (Staff Access and Business Studio).md`.
> What is **not** done is listed at the end. Nothing here changes accounting, stock or tax: Odoo stays the only authority.

## 1. The model in one page

| Concern | Where it lives | Enforced by |
|---|---|---|
| Role (owner / cashier / stock keeper) | native `res.groups` | each service re-checks the group |
| Data switches (see money / valuation / manage returns) | native `res.groups` | each service masks the data |
| **Tab grants** (which tabs a person may open) | **one native group per tab** (`group_orsquare_tab_<tab>`), owner implies all | **the API gate** (below) |
| Shop settings, tabs on/off, features, views | fields on `res.company` (one shop = one company) | whitelisted `staff.update_settings`, version-locked |
| What the plan allows | `orsquare.entitlements` (a parameter the platform writes into the shop) | `res.company.orsquare_feature_on / entitled_tabs`, the gate, and `update_settings` |
| Who changed what | `orsquare.config_audit` in the shop (append-only) | written by the services, one place |
| Sign-in key -> shop | `orsquare_platform_login` in the platform DB (one row per login/e-mail/mobile) | claimed before a user is created; unique across all shops |
| Operators | users in the platform DB with `group_platform_admin` or `group_platform_support` | `orsquare.platform.service._require_dev` |

### The API gate (server side, never cosmetic)

`api_registry.API_GATES` maps every service/method to the tabs that may call it (any-of, because screens share calls: a
customer picker is used by Sales and Accounts) and, optionally, a shop feature that must be on. `controllers/main.py`
runs `enforce_gate` before every `/api/call`; the offline outbox (`sync.flush`) applies `MUTATION_TABS` per mutation, so
a revoked tab cannot be used by replaying an old queue. A switched-off tab closes its API for **everyone, owner included**.
`tests/test_governance.py::TestRegistryCoverage` fails if a service is added without a gate decision.

### Business Studio

* One screen (`frontend/src/features/governance/StudioEditor.tsx`) used by the owner (Settings) and by an operator
  (Developer Console, per shop). Presets, tabs, features, stock view (standard or brand x size matrix), accounts view
  (standard or advanced workspace), sales-register switches, day cutoff hour.
* **Optimistic lock**: every real change bumps `orsquare_settings_version`; a save made on an older version answers HTTP
  409 `version_conflict`. A no-op writes nothing.
* **Presets are versioned code** (`models/presets.py`, `PRESET_VERSION`). A shop remembers the version it applied; the
  console shows "preset is old". Applying a preset only sets switches, never deletes data, and never exceeds the plan.
* The Settings tab cannot be switched off (it is where Studio lives).

### Plans & entitlements

Plans are rows (`orsquare.platform.plan`): which features and tabs they include (empty = all) and a staff limit
(0 = unlimited). Built-ins ship with **no limits**: the commercial decision is yours. A plan is a ceiling: what is stored
stays stored; what is outside the plan is simply not effective. "Apply to shops" pushes a plan in slices of 25 and can be
repeated safely.

### Sign-in

* Email, username or mobile + password. No shop code. `_resolve_db`: operator? -> directory (one indexed lookup) ->
  sub-domain -> explicit code -> registry -> single-shop install. **Shop databases are never scanned.**
* **Two-step (TOTP)** with Odoo's own `auth_totp`: password first, then the 6-digit code (`/api/session/mfa`), with the same
  throttle as passwords (5 wrong in 5 min -> 429). Enrol/remove from Settings -> Security. Removing needs the password.
* **Operators must have an authenticator** (`orsquare.platform.require_mfa`, on unless set to `0`); until enrolled the
  console shows only the enrolment screen and the server refuses everything else. Operator passwords: 12+ characters.
* Operator sign-in has its own brute-force throttle (the platform DB does not run the shop module).

### Operator levels

`admin` changes anything; `support` can look (fleet, shop, audit, system) and never change. There is always one active
admin. Every action is in the append-only platform audit trail; changes made inside a shop also appear in that shop's own
log naming the operator (`platform:<login>`).

## 2. Scale (measured, not promised)

`scripts/bench_platform.py` seeds 10,000 shops + 300,000 audit rows + 30,000 sign-in keys in one transaction, times the
console's calls and rolls back. On the development machine (single PostgreSQL, warm):

| Call | Median |
|---|---|
| Fleet page (50 rows), page 100, any filter or sort | 2.6 - 3.9 ms |
| Fleet search by name / phone | ~21 ms |
| Audit first page / one shop / action + dates | 15 - 23 ms |
| Audit free-text search over 300,000 rows | ~155 ms |
| System diagnostics | ~19 ms |
| Sign-in directory lookup (1 of 30,000 keys) | 0.18 ms |

Every list is paged and filtered on the server; counts come from one grouped query; the number of queries does not grow
with page size (asserted in a test). Unregistered databases are found by one catalog query on a fresh connection.

**What this does not prove:** one PostgreSQL cluster holding 10,000 *databases* (each a full Odoo schema) and one Odoo
worker pool serving them. That is a capacity and sharding question (see "Open decisions").

## 3. Operations

```
scripts/upgrade_shops.sh               # module upgrade in the template and every shop (run before routing traffic)
scripts/run_tests.sh /orsquare         # shop suite (250)
scripts/run_platform_tests.sh          # platform suite (24): fleet at scale, operators, plans, directory, end-to-end shop
docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d orsquare_platform --no-http < scripts/bench_platform.py
```

* **First time after upgrading an existing platform:** Console -> System -> *Rebuild directory* (indexes every shop's
  sign-in keys and switches each shop's directory on). New shops are indexed automatically.
* **Local development:** the console demands an authenticator. To skip it on a developer machine only:
  `orsquare.platform.require_mfa = 0` (Settings -> Technical -> System Parameters in the platform DB).
  **Locked out?** `UPDATE res_users SET totp_secret = NULL WHERE login = '<operator>'` in the platform DB, then enrol again.
* Setting a shop's plan to a smaller one never deletes anything; widen it again and everything returns.

## 4. Not done / open decisions

1. **10,000 databases on one cluster.** Needs a capacity plan and likely several PostgreSQL/Odoo pools with a
   `shop -> pool` mapping in the registry and routing in the proxy. Not built; needs your decision (AGENTS.md section 1).
2. Settings -> **Data Control** (shift-cutoff view, wipe, restore) and **Tables** (floor/table generator) are still the
   old disconnected pages. The cutoff hour itself is editable in Business Studio. Their backends (`wipe`, `catalog.floors`,
   `bulk_create_tables`) exist.
3. **Sheet register** and **AI** surfaces from the live repo are not imported (the Sheet needs its own backend; the
   original spec postpones it). The product library / master importer is excluded as instructed.
4. Operators cannot be deleted (only disabled); the audit trail is append-only by design.
5. TOTP codes are not single-use (Odoo core behaviour); passkeys (`auth_passkey`, in Odoo 18 core) are a later option.
6. A central identity provider (Keycloak / Zitadel) is intentionally deferred: it adds a critical online service against
   the offline-first mandate. Revisit at SSO demand or when sign-in volume justifies it.
