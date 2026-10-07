---
title: Governance Review 2026-10-08 (Staff Access and Business Studio)
type: note
permalink: orsquare/decisions/governance-review-2026-10-08-staff-access-and-business-studio
---

# Governance Review 2026-10-08 (Staff Access and Business Studio)

Status: **approved by the owner and implemented 2026-10-08** (see [[Governance and Developer Console Build 2026-10-08]]). Deviation from the proposal: an own append-only audit table was built instead of OCA `auditlog`.

## Context
Owner asked whether the current user/permission/Business Studio plan is reliable and whether a mature free framework should replace it.

## Verified findings (code: `addons/orsquare/models/staff_service.py`, `security/*`, `api_registry.py`)
- Roles (owner/cashier/stockkeeper) and the 3 data flags are native `res.groups`; ACL csv per model; API whitelist re-checks roles. This part is sound.
- Per-user tab grants (`res.users.orsquare_tabs`) and shop-enabled tabs (`res.company.orsquare_enabled_tabs`) are comma-separated strings. `orsquare_effective_tabs()` is read only by `me()` and `list_staff()`: **no service enforces it**, so a revoked tab or a switched-off tab is cosmetic. No server check found for `open_bottle`/`kitchen` toggles either; only `tables` is enforced (`tabs_service._need`).
- No change history for Staff Access or Business Studio settings (`update_settings` only publishes the changed key names).
- Staff API has no password reset, no MFA, no password policy; owner sets staff password at creation only (min 8).
- Login resolves the shop by scanning shop databases (`controllers/main.py` tiers 4-5); a login is unique only inside one DB, so the same email in two shops is ambiguous.
- Platform has one coarse developer tier; `plan` (trial/basic/pro) maps to no features.
- Presets are Python dicts; changing a preset does not reach existing shops.

## Researched options (see report in chat for sources)
- Odoo Community core already ships `auth_totp`, `auth_passkey`, `auth_password_policy`, `auth_oauth`, `auth_ldap` (checked in the container). OCA 18.0: `auth_oidc`, `password_security`, `auth_session_timeout`, `auth_totp_enforce`, `base_user_role`, `auditlog` (Beta), `base_tier_validation`.
- Central IdP (Keycloak Apache-2.0; Zitadel AGPL-3.0 with native orgs; Ory Apache but multi-tenancy partly commercial): defer. Adds a critical online service against the offline-first mandate.
- External authorization engines (OpenFGA, SpiceDB, Cerbos, OPA, Casbin): reject. Second source of truth next to Odoo ACLs, extra hop per call, solves relationship/attribute problems we do not have.
- Feature-flag servers (Unleash, Flagsmith, GrowthBook, Flipt): not for Business Studio (tenant config belongs in the shop DB). Optional later for developer rollout flags.
- Odoo Studio is a paid Odoo product, not usable on Community.

## Proposed direction
Harden the Odoo-native model (enforce tabs/toggles in the API registry, tabs as native groups, audit log, staff password reset, TOTP step in the custom login, global login directory, versioned presets, platform roles). Re-evaluate a central IdP when SSO or ~50+ shops is required.

## How to apply
Do not start without the owner's go-ahead (AGENTS.md section 1/6). Link: [[Developer Console Redirect Loop and Hooks Crash]].
