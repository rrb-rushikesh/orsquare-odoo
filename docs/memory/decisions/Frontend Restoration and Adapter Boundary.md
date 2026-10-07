---
title: Frontend Restoration and Adapter Boundary
type: note
permalink: orsquare/decisions/frontend-restoration-and-adapter-boundary
---

# Frontend Restoration and Adapter Boundary

## Context
The custom handwritten React UI was rejected by the owner in favor of the original live retailer UI from C:\Users\rushi\Music\production-hot-fix\src.

## Decision
The original retailer screens, components, and CSS were imported directly into rontend/src. A thin adapter layer (lib/repo.ts, lib/contracts.ts) bridges the original screens to Odoo's API (lib/api.ts). Unimplemented operations explicitly throw via lib/unavailable.ts.

## Why
Preserves the tested IBM Plex/Carbon design, layout density, and cashier keyboard muscle memory without altering the Odoo backend authority.

## How to Apply
Never redesign the restored retailer screens. Connect missing operations by mapping existing Odoo services into lib/repo.ts. Do not write new business math in React.