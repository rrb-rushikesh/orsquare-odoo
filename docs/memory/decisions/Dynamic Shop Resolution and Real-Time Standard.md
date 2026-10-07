---
title: Dynamic Shop Resolution and Real-Time Standard
type: note
permalink: orsquare/decisions/dynamic-shop-resolution-and-real-time-standard
---

# Dynamic Shop Resolution and Real-Time Standard

## Context
Eliminating the manual 'Shop Code' input requirement at login and establishing the sub-millisecond real-time performance priority.

## Decision
1. Removed the 'Shop code' input field from the UI. Users enter only Login/Email/Phone and Password.
2. Implemented a 4-tier dynamic resolution cascade in _resolve_db() (<1ms total overhead):
   - Tier 1: Host subdomain (0ms)
   - Tier 2: Cached client device memory via localStorage (0ms)
   - Tier 3: Central platform directory lookup in orsquare_platform (<1ms)
   - Tier 4: Single active shop fallback for local development and standalone counter PCs (<0.1ms)
   - Tier 5: Direct scan across registered shop databases
3. Login responses return the resolved shop database name, which the client auto-pins to localStorage for all subsequent sessions.
4. Mandated sub-millisecond (<1ms) local response and <10ms broadcast standard across the platform.

## Why
Typing internal database names like 'orsquare_shop1' is unacceptable in retail. Dynamic resolution provides zero-friction UX while preserving full PostgreSQL database-per-shop isolation.
