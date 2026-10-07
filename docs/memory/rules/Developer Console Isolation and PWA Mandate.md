---
title: Developer Console Isolation and PWA Mandate
type: note
permalink: orsquare/rules/developer-console-isolation-and-pwa-mandate
---

# Rule: Developer Console Isolation and In-Browser PWA Mandate

- **Date:** 2026-10-07
- **Area:** Security / Architecture / Routing / Tenancy
- **Related Files:** `AGENTS.md`, `CLAUDE.md`, `frontend/src/App.tsx`, `frontend/src/features/dev/DevApp.tsx`

## Context
A critical security and tenancy invariant: retail shop owners and counter staff run their individual businesses and must never see, access, or know about the central Platform Developer Console (`/dev`). Furthermore, to protect against intellectual property theft, tampering, and software cracking, ORSquare is strictly in-browser only (Chrome/Edge PWA) and is prohibited from being packaged as a native desktop binary (`.exe`, `.msi`, Electron, Tauri).

## Mandatory Rules
1. **Zero Retailer Exposure to `/dev`:**
   - Any authenticated retail user (owner, cashier, stockkeeper, or anyone with a shop company) who visits `/dev` must be **immediately and unconditionally redirected to `/` (their shop workspace)** in 0 milliseconds.
   - They must never see the Developer Console UI, header, fleet tables, or platform error messages.
2. **Unauthenticated Access to `/dev`:**
   - Any guest or unauthenticated user visiting `/dev` must be redirected immediately to `/login`.
3. **Platform Developer Gating:**
   - Developer Console access is strictly restricted to verified platform developers (`surface: 'dev'`) authenticated against the central `orsquare_platform` database.
4. **PWA Standalone Standard:**
   - The application is distributed exclusively as an in-browser web application installed via Chrome / Edge's native "Install as app" feature.
   - No native desktop executable wrappers (`.exe`, `.msi`, Electron, Tauri) are permitted.