---
title: Sale Engine is Native POS Order
type: note
permalink: orsquare/decisions/sale-engine-is-native-pos-order
---

# Sale Engine: Native pos.order

## Context
Deciding the authoritative transaction model for retail counter sales.

## Decision
All sales, returns, and exchanges use Odoo's native pos.order engine (sales.settle, sales.quote), backed by pos.session (the Daybook). Custom standalone ccount.move + stock.picking pipelines were rejected.

## Why
1. Native pos.order already manages cash drawer sessions, opening floats, closing counts, Khata customer credit, journal entries, and automated AVCO valuation layers.
2. Reimplementing this manually causes accounting drift and loss of audit trail.
3. Proven by tests: sales post exact AVCO COGS and balance double-entry ledgers automatically.

## How to Apply
Counter bills are POS orders. Invoices are generated on request. Dashboards and registers project from pos.order.