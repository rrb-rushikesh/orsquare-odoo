---
title: Tenancy and Database-per-Shop
type: note
permalink: orsquare/decisions/tenancy-and-database-per-shop
---

# Tenancy: Database-per-Shop

## Context
Multi-tenant architecture evaluation for retail operations (liquor/beverage shops, counters, restaurants).

## Decision
Strict model: One Account = One Shop = One PostgreSQL Database (orsquare_shop1, orsquare_shop2). Multi-shop management by a single owner is canceled. Fleet management is handled by orsquare_platform.

## Why
1. Absolute isolation: Zero cross-tenant data leaks or table lock contention.
2. Safe operational data wipe: Resetting a test or live shop cannot affect other tenants.
3. Independent point-in-time backups and fast DB cloning (≈1.8s per shop from template).
4. No cross-shop schema contamination or sequence collision during high-traffic billing.

## How to Apply
All shop services operate strictly in tenant db context. Platform routes and fleet operations belong exclusively to orsquare_platform.