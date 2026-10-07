---
title: Financial and Stock Immutability
type: note
permalink: orsquare/rules/financial-and-stock-immutability
---

# Financial and Stock Immutability

## Context
Core invariants governing ledger and inventory operations.

## Invariant Rules
1. Double-Entry Rigor: Never write code that overwrites an account balance or stock quantity. All balances are derived from posted journal entries and stock movements.
2. Auditable Corrections: Historical adjustments must post reversal documents or formal credit/debit notes. Never mutate sealed records.
3. Business-Day Attribution: Every transaction has an immutable orsquare_business_date derived from the shop's operational cutoff time (e.g. 02:00 AM IST), completely separate from statutory accounting lock dates.
4. Negative Stock Blocked: Online counter checkout takes ordered FOR UPDATE locks on stock.quant and auto-transfers from Godown. Overselling is rejected online.