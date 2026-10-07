$notes = @(
    @{
        Folder = "decisions"
        Title = "Sale Engine is Native POS Order"
        Content = @"
# Sale Engine: Native pos.order

## Context
Deciding the authoritative transaction model for retail counter sales.

## Decision
All sales, returns, and exchanges use Odoo's native `pos.order` engine (`sales.settle`, `sales.quote`), backed by `pos.session` (the Daybook). Custom standalone `account.move + stock.picking` pipelines were rejected.

## Why
1. Native `pos.order` already manages cash drawer sessions, opening floats, closing counts, Khata customer credit, journal entries, and automated AVCO valuation layers.
2. Reimplementing this manually causes accounting drift and loss of audit trail.
3. Proven by tests: sales post exact AVCO COGS and balance double-entry ledgers automatically.

## How to Apply
Counter bills are POS orders. Invoices are generated on request. Dashboards and registers project from `pos.order`.
"@
    },
    @{
        Folder = "decisions"
        Title = "Open Bottle Precision and Location Topology"
        Content = @"
# Open Bottle Peg Tracking: 6-Decimal UoM and Sub-Locations

## Context
Dispensing fractional liquor portions (30ml, 60ml, 90ml pegs) from standard bottles (750ml, 700ml, etc.).

## Decision
1. Odoo bottle UoM precision is configured to 6 decimals (0.000001).
2. Each opened bottle is provisioned with its own child location `WH/Stock/Opened/<bottle_label>`.
3. `orsquare.opened_bottle` is strictly an operational tracking and UI view record, NEVER a parallel inventory ledger.
4. Wastage/breakage scrap zeroes the remaining quant exactly (`scrap_qty = remaining_quant`).

## Why
Multiple opened bottles of the same SKU sharing one location would make deriving exact physical ml impossible without a parallel ledger. Child locations keep stock quants as the single source of truth.

## How to Apply
Frontend displays only physical ml. Fractional bottle math is backend-only. Permanent regression suite passes 5-bottle conservation tests.
"@
    },
    @{
        Folder = "decisions"
        Title = "Frontend Restoration and Adapter Boundary"
        Content = @"
# Frontend Restoration and Adapter Boundary

## Context
The custom handwritten React UI was rejected by the owner in favor of the original live retailer UI from `C:\Users\rushi\Music\production-hot-fix\src`.

## Decision
The original retailer screens, components, and CSS were imported directly into `frontend/src`. A thin adapter layer (`lib/repo.ts`, `lib/contracts.ts`) bridges the original screens to Odoo's API (`lib/api.ts`). Unimplemented operations explicitly throw via `lib/unavailable.ts`.

## Why
Preserves the tested IBM Plex/Carbon design, layout density, and cashier keyboard muscle memory without altering the Odoo backend authority.

## How to Apply
Never redesign the restored retailer screens. Connect missing operations by mapping existing Odoo services into `lib/repo.ts`. Do not write new business math in React.
"@
    },
    @{
        Folder = "rules"
        Title = "Financial and Stock Immutability"
        Content = @"
# Financial and Stock Immutability

## Context
Core invariants governing ledger and inventory operations.

## Invariant Rules
1. Double-Entry Rigor: Never write code that overwrites an account balance or stock quantity. All balances are derived from posted journal entries and stock movements.
2. Auditable Corrections: Historical adjustments must post reversal documents or formal credit/debit notes. Never mutate sealed records.
3. Business-Day Attribution: Every transaction has an immutable `orsquare_business_date` derived from the shop's operational cutoff time (e.g. 02:00 AM IST), completely separate from statutory accounting lock dates.
4. Negative Stock Blocked: Online counter checkout takes ordered `FOR UPDATE` locks on `stock.quant` and auto-transfers from Godown. Overselling is rejected online.
"@
    },
    @{
        Folder = "rules"
        Title = "Offline Sync Outbox and Idempotency"
        Content = @"
# Offline Sync Outbox and Idempotency

## Context
High-reliability counter billing during internet outages.

## Invariant Rules
1. Mutations write to browser Dexie.js `outbox_mutations` with client UUIDs (`client_order_ref`) and monotonic sequence numbers per device.
2. Flushes (`POST /api/sync/flush`) are strictly idempotent: replays return previous results without double-booking.
3. Offline oversell handling: If two offline registers sell the last physical bottle, both sales are accepted into Odoo upon reconnection; stock shortage is flagged for Daybook physical audit.
4. Single bootstrap bundle (`/api/sync/bootstrap`) loads full shop catalog, stock, and settings in one compressed request.
"@
    },
    @{
        Folder = "bugs"
        Title = "Known Traps and Findings"
        Content = @"
# Known Traps and Verified Bugs

## Context
Defects discovered during architecture spikes, testing, and gateway integration.

## Key Findings & Gotchas
1. POS Oversell: Odoo's default POS silently ignores stockouts. ORSquare's `settle()` enforces `FOR UPDATE` locking to prevent negative stock.
2. Data Wipe: `TRUNCATE CASCADE` deletes `res_company` because of opening move foreign keys. Wipe must use ordered SQL `DELETE`.
3. Caddy Session Loss: Database-independent requests in Odoo drop unsaved sessions. Login must explicitly rotate and save sessions.
4. Server-Wide Module: `orsquare` must be in `server_wide_modules` or gateway guests get 404 on unauthenticated routes.
5. GST Address Dependency: Odoo `l10n_in` crashes with 500 if company address/state is missing. ORSquare wraps this into 422 error.
6. Local Sequence Race: Browser `localStorage` device sequence is not atomic with Dexie enqueue; needs careful handling.
"@
    },
    @{
        Folder = "checkpoints"
        Title = "Audit Checkpoint 2026-10-07"
        Content = @"
# Audit Checkpoint: Repository Status 2026-10-07

## What is Complete & Verified
- Backend: 90 API methods across 16 services. 210 Odoo tests passed, 3 platform tests passed.
- Platform: Shop provisioning, DB clone (~1.8s), suspension, password reset.
- Sync & Realtime: Outbox replay, Centrifugo+Redis live event push (<10ms).
- Astro Landing: Imported, verified with `npm run check`.
- Frontend Shell: Original retailer UI imported (+24k LOC), basic sales/purchases/stock/accounts happy-paths connected.

## What is Broken or Incomplete in Frontend
- Many controls trigger `lib/unavailable.ts` (Product import, opening stock, returns/exchanges, purchase edit, stock history, table tabs).
- Settings shop controls (cutoff, team access, wipe) are disconnected.
- Daybook and Calendar are placeholder tabs.
- Docker environment must be running for React to connect to Odoo backend.
"@
    }
)

foreach ($note in $notes) {
    Write-Host "Writing note: $($note.Title) in folder $($note.Folder)"
    basic-memory tool write-note --project orsquare --folder $note.Folder --title $note.Title --content $note.Content --overwrite
}
Write-Host "All notes written successfully."
