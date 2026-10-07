---
title: Offline Sync Outbox and Idempotency
type: note
permalink: orsquare/rules/offline-sync-outbox-and-idempotency
---

# Offline Sync Outbox and Idempotency

## Context
High-reliability counter billing during internet outages.

## Invariant Rules
1. Mutations write to browser Dexie.js outbox_mutations with client UUIDs (client_order_ref) and monotonic sequence numbers per device.
2. Flushes (POST /api/sync/flush) are strictly idempotent: replays return previous results without double-booking.
3. Offline oversell handling: If two offline registers sell the last physical bottle, both sales are accepted into Odoo upon reconnection; stock shortage is flagged for Daybook physical audit.
4. Single bootstrap bundle (/api/sync/bootstrap) loads full shop catalog, stock, and settings in one compressed request.