---
title: Login Desync and Route Leakage
type: note
permalink: orsquare/bugs/login-desync-and-route-leakage
---

# Login Desync and Route Leakage

- **Date:** 2026-10-07
- **Area:** Frontend Routing / Session Management / Developer Console
- **Related Files:** `frontend/src/auth/AuthContext.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/LoginPage.tsx`

## Symptom
When an authenticated user opened a new browser tab or entered `http://localhost:5173/login`, the login form rendered immediately with empty email/password fields instead of routing the user into their workspace. Manually navigating to `/` loaded the workspace cleanly. Additionally, visiting `/dev` was caught by the catch-all router and redirected to `/`.

## Root Cause
1. **Asynchronous Session Hydration in SPA:** `AuthContext.tsx` initialized `me` to `null` and `ready` to `false`, only invoking `readCached()` inside an asynchronous `useEffect()`. On frame 0, the application had no user state.
2. **Missing Pre-flight Route Guard:** In `App.tsx`, `<Route path="/login" element={<LoginPage />} />` mounted without a guest guard. Because `LoginPage.tsx` had no check for `me`, it painted the login inputs immediately.
3. **Unregistered `/dev` Route:** The platform developer console was not wired into `App.tsx`.

## Fix
1. **Synchronous Frame-0 Hydration:** Updated `AuthContext.tsx` to initialize `me`, `shopCode`, and `ready` directly from `readCached()` using `useState(() => initial?.me ?? null)`. If a cached session exists in `localStorage`, `me` is populated on the very first render frame.
2. **`<RedirectIfAuth />` Guard:** Wrapped `/login` in `<RedirectIfAuth>` in `App.tsx` and added an immediate `<Navigate to="/" replace />` guard in `LoginPage.tsx`. Authenticated users are redirected to `/` with 0ms visual delay.
3. **Guarded `/dev` Route with Strict Retailer Isolation:** Registered `<Route path="/dev/*" element={<DevGuard><DevApp /></DevGuard>} />` in `App.tsx`. `DevGuard` and `DevApp` enforce that any retail shop user (shop owners, cashiers, stockkeepers, or anyone with `me.company`) is **immediately redirected to `/` (their retailer shop)** with zero developer console rendering. Unauthenticated guests are redirected to `/login`. Only verified platform developer identities (`surface: 'dev'` or role `developer`) can view `/dev`.

## How to Apply & Maintain
- Never render `<LoginPage />` without wrapping it in `<RedirectIfAuth />`.
- When adding new protected or public-only routes, verify that frame-0 hydration does not flash unauthenticated states.
- Retailers must never see `/dev`: any attempt to visit `/dev` must unconditionally bounce them to their shop (`/`).