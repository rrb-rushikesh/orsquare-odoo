---
title: Open Bottle Precision and Location Topology
type: note
permalink: orsquare/decisions/open-bottle-precision-and-location-topology
---

# Open Bottle Peg Tracking: 6-Decimal UoM and Sub-Locations

## Context
Dispensing fractional liquor portions (30ml, 60ml, 90ml pegs) from standard bottles (750ml, 700ml, etc.).

## Decision
1. Odoo bottle UoM precision is configured to 6 decimals (0.000001).
2. Each opened bottle is provisioned with its own child location WH/Stock/Opened/<bottle_label>.
3. orsquare.opened_bottle is strictly an operational tracking and UI view record, NEVER a parallel inventory ledger.
4. Wastage/breakage scrap zeroes the remaining quant exactly (scrap_qty = remaining_quant).

## Why
Multiple opened bottles of the same SKU sharing one location would make deriving exact physical ml impossible without a parallel ledger. Child locations keep stock quants as the single source of truth.

## How to Apply
Frontend displays only physical ml. Fractional bottle math is backend-only. Permanent regression suite passes 5-bottle conservation tests.