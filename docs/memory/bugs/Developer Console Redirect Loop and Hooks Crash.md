---
title: Developer Console Redirect Loop and Hooks Crash
type: note
permalink: orsquare/bugs/developer-console-redirect-loop-and-hooks-crash
---

# Developer Console Redirect Loop and Hooks Crash

- **Date:** 2026-10-08
- **Files:** `frontend/src/auth/surface.ts`, `frontend/src/App.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/auth/AuthContext.tsx`, `frontend/src/features/dev/`
- Supersedes the diagnosis in [[Developer Auth Session Leak and Hydration Crashes]] (that note fixed symptoms; these are the root causes of "the /dev links are broken").

## Context
After the 2026-10-07 hardening, `/dev` still failed: refresh looped or showed an Application Error, and sign-in could crash.

## Findings (root causes)
1. **Redirect loop /dev <-> /.** `DevGuard` and `DevApp` treated anyone with `me.company` as retail staff. The platform `me()` was changed to return a `company` (and `AuthContext` also fills a default one), so every developer counted as retail staff. `/dev` sent them to `/`, `RequireAuth` sent them straight back to `/dev`. Never decide the surface from `me.company`.
2. **Hooks after an early return.** `DevApp` and `LoginPage` returned (`<DevLogin/>`, `<Navigate/>`) before their `useState` calls. When `me` flipped on sign-in or sign-out the hook count changed and React threw, which the root ErrorBoundary showed as "Application Error".
3. **Stale shop code poisoned the next sign-in.** `drop()` cleared only `or2_me`. After a developer session `or2_shop = orsquare_platform` stayed in localStorage and was sent with the next retail sign-in, so the server pinned the platform DB: "Wrong shop, login or password". The same happens when a different shop's code is left on a shared device.
4. **ErrorBoundary Reload could not recover** from a bad cached session; it now clears `or2_me` before reloading.

## Fix
- One pure rule in `auth/surface.ts`: `isPlatformDev` (server `surface === 'dev'` or role `developer`), `homeFor`, `devGate`. App, LoginPage and AuthContext all use it. Unit tests: `auth/__tests__/surface.test.ts` (includes the loop regression).
- `DevApp` is hook-free (chooses DevLogin / DevConsole); `LoginPage` hooks run before its redirect.
- `drop()` clears both cached keys; retail sign-in ignores a cached `orsquare_platform`.
- Console rebuilt on the shared Drawer/Modal/Tag/Tile/.tbl components (`features/dev/*Tab.tsx`, `dev.css`).

## How to apply
- Never branch /dev vs / on `me.company`, shop code or any field both surfaces share.
- Never put hooks below an early `return` in a component whose gate depends on auth state; split into a gate component and a screen component.
- Anything that ends a session must clear every cached identity key (`or2_me`, `or2_shop`).

## Verified (2026-10-08, local stack)
Dev sign-in, refresh on /dev, fleet, shop drawer, suspend/reactivate (audit rows written), system diagnostics, provisioning a throwaway shop then owner sign-in with the stale shop code, owner visiting /dev redirected to /. Throwaway shop dropped afterwards.
