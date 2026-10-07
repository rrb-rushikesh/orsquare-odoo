# Milestone 0 Empirical Spikes: Scratch Environment

> **Repository status — 2026-10-07:** Retained local Docker environment and historical proof harnesses, not dead production assets. Spike scripts live under `spikes/`; the main implementation now lives in `addons/orsquare/`. See [current status](../../STATUS.md).

This directory contains temporary sandbox configurations and automated test harnesses to empirically prove core architectural behaviors on a live Odoo 18 Community instance before Milestone 1 implementation.

## The 4 Spikes:
1. **Spike 1: `spike1_pos_concurrency.py`** — Headless POS order ingestion via `sync_from_ui`, session lifecycle, and concurrent checkout stress test.
2. **Spike 2: `spike2_open_bottle_valuation.py`** — Real accounting comparison of opened bottle alternatives (fractional moves vs liquid conversion vs immediate consumption), inspecting SVLs and journal entries.
3. **Spike 3: `spike3_anand_wines_orm.py`** — Complete wholesale bill lifecycle matching Anand Wines (discounts + 1% TCS + native `stock.landed.cost`).
4. **Spike 4: `spike4_tenant_provisioning.py`** — Benchmark PostgreSQL template database cloning and multi-tenant routing.
