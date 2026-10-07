---
title: PWA Routing and Dev Console 2026-10-07
type: note
permalink: orsquare/checkpoints/pwa-routing-and-dev-console-2026-10-07
---

# Checkpoint: PWA Routing, Session Desync Fix & Developer Console

- **Date:** 2026-10-07
- **Scope:** Frontend Auth Guards, Service Worker dev bypass, Developer Console (`/dev`)

## Context
The owner demonstrated a critical routing defect (Video `2026-10-07 20-12-03.mp4`): opening a new browser tab to `/login` presented the login form even though an active session existed, and `/dev` was inaccessible. The owner mandated a 100% free, in-browser PWA architecture (Chrome "Install as app") without native desktop wrappers (`.exe`/Electron/Tauri) to eliminate piracy risks.

## Completed Work
1. **Synchronous Frame-0 Auth Hydration:**
   - Initialized `me`, `shopCode`, and `ready` synchronously in `AuthContext.tsx` from `readCached()`.
   - Fast-started `startStore` from cached credentials on boot so IndexedDB connects with zero latency.
2. **Double-Layer Route Guarding:**
   - Added `<RedirectIfAuth />` wrapper around `/login` in `App.tsx`.
   - Added defensive `<Navigate to="/" replace />` in `LoginPage.tsx`.
   - Navigating to `/login` with an active session redirects to `/` in 0ms with zero form flicker.
3. **Service Worker Compatibility:**
   - Updated `public/sw.js` with live network bypass for Vite dev and HMR paths (`/@`, `/src/`, `/node_modules/`).
   - Updated `main.tsx` with `?sw=1` opt-in for dev testing, maintaining automatic production activation.
4. **Platform Developer Console (`/dev`):**
   - Built `frontend/src/features/dev/` suite (`DevApp.tsx`, `NewShopModal.tsx`, `ShopDrawer.tsx`, `api.ts`, `types.ts`).
   - Wired `<Route path="/dev/*" element={<DevGuard><DevApp /></DevGuard>} />` in `App.tsx`.
   - Communicates with native Odoo `orsquare.platform.service` (`fleet`, `shop_detail`, `create_shop`, `suspend`, `reactivate`, `extend`, `audit`, `system`).
   - Bundled in an isolated, lazy-loaded chunk (23 kB) preventing any overhead on counter POS bundles.

## Verification
- `npm run typecheck`: Passed (0 errors).
- `npm test`: 107 tests passed (1 physical printer test skipped).
- `npm run build`: Production build succeeded (`✓ built in 1.86s`).
- `npm run check` (Landing): 11 pages passed.
- Dev servers operational on ports 5173 and 4321.