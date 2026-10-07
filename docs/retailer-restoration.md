# Original retailer frontend restoration — 2026-10-07

## Scope and source

The owner explicitly authorized replacing the rejected retailer frontend, importing the original source, and continuing without questions. The source is `C:\Users\rushi\Music\production-hot-fix\src`, not the Tryton retailer frontend. Original page/component markup and styles were imported. Changes in active screens are limited to Odoo contracts, native price/report fields, auth, print routing, and honest unavailable states. The source repository was not edited.

`frontend/DESIGN.md` is an unchanged copy of the source `DESIGN-ibm.md`. Preserve its Carbon/Plex/square-corner/hairline visual system. No new visual direction was introduced. Source code reuse does not prove complete pixel or interaction parity: a live side-by-side comparison is still pending.

Kept: Odoo services and platform module, Astro landing, API cookie client, Dexie snapshot/outbox, delta and Centrifugo transport, native receipt rendering, Vite configuration. No new dependencies installed. No deployment or production writes.

## Active connections

| Original surface | Odoo connection | Status |
| --- | --- | --- |
| Sales counter | `sales.quote`, `sales.settle`, existing durable outbox | Native online pricing, tax, payments, totals; local cash sale verified |
| Products | catalog snapshot, `catalog.save_product`, categories/brands | Basic native create/edit mapping; full form parity pending |
| Purchases | `purchases.preview_bill`, `record_bill`, `list_bills`, `bill_detail`, `summary` | Native supplier bill and stock receipt verified; supplier context passed to preview |
| Stock | native stock snapshot/valuation, queued stock-transfer flush | Godown/Counter transfer verified; refresh no longer clears the entry draft |
| Accounts | native directory, party creation, statement, customer/supplier payments | Native balances and statement render; bill-specific allocation unavailable |
| Cash Flow | `cashflow.register`, `new_entry`, native supplier payments | Rows and running balances come from Odoo; expense and payment types distinguished |
| Ledger | native trial balance, P&L, balance sheet, cash register | Read adapters connected; unsupported control-account cards show a dash |
| Dashboard | native dashboard projection | Trading and cash/party cards connected; category insights unavailable |
| Settings | original device preferences and existing offline tools | Appearance and receipt/device choices retained; unconnected shop controls disabled |
| Login/shell | Odoo session cookie and `staff.me` | Original UI retained with required shop-code field; deep-link hydration splash preserved |

`lib/contracts.ts` contains original UI types. `lib/repo.ts` is a thin Odoo adapter. `lib/unavailable.ts` explicitly rejects unmapped operations; it does not implement legacy backend services or return invented success/data. The older `_pending` source remains for comparison; it is not routed.

Backend changes are small read projections: directory/statement side fields, vendor totals/line identifiers and uncapped summary, bill lookup date filters, native cash-flow classification and metrics, dashboard summary, stock-value total. Sale quote presentation now uses native untaxed subtotal/discount so `subtotal - discount + tax = payable` for tax-inclusive products. Settlement arithmetic is unchanged. These have native tests.

## Verified evidence

Local environment: existing Docker Odoo at `127.0.0.1:8088`, Vite at `127.0.0.1:5173`, existing demo shop `orsquare_shop1`. These are local proof, not production proof.

- Full Odoo module regression: **210 tests, 0 failures, 0 errors**, 2026-10-07 10:21:31 UTC. Command: `docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d orsquare_dev -u orsquare --test-enable --test-tags=/orsquare --stop-after-init --http-port=8099 --workers=0`. Log: `scratch/retailer-backend-tests.log` (ignored local evidence).
- Final opening-side addition: **16 accounts/report tests, 0 failures, 0 errors**, 10:23:12 UTC; tags `/orsquare:TestAccounts,/orsquare:TestReports`. Log: `scratch/retailer-statements-tests.log`. The earlier mistyped class selection ran zero tests and is not proof.
- Frontend `npm run build`: passed, including TypeScript. `npm test`: **103 passed, 1 skipped**; the skipped case requires a physical printer. Existing tests cover printing infrastructure, not complete restored-screen behavior.
- Browser: original login/shell/dashboard/counter/register/drawer layouts render at 1440×900. One Mineral Water 1L cash sale posted for **₹20**, native bill **ORSquare Counter/0011**; today's net sales updated **₹2,820 → ₹2,840**, cart cleared, original print choice appeared. Chose Skip; no printer was exercised.
- Browser: bought **2 Mineral Water 1L at ₹12**, native vendor bill **BILL/26-27/10/0002**, total **₹24**, unpaid. Supplier reference `RESTORE-UI-20261007` is preserved in the native ledger. Purchase register showed 2 bills; native supplier payable **₹4,074**. Water Godown stock became **2**, Counter **46**.
- Browser: moved **1** water unit Godown → Counter; native stock became **1 / 47**, total **48** and valuation **₹576** unchanged. Combined stock **₹1,03,760** unchanged. First attempt was interrupted by a polling-driven draft reset; fixed the original drawer reset dependency, then verified actual successful movement.
- Browser: Cash Flow displayed **14 native rows**, including the ₹20 sale, existing ₹150 expense and ₹1,000 supplier payment; latest running balance **₹1,690**.
- Browser: a fresh `/sales` deep-link and refresh stayed on Sales through the hydration splash; a fresh tab had no error/warning logs. An unknown app URL recovered to the retailer dashboard.
- Browser: supplier statement showed native bill/payment rows and ₹4,074 Cr. The original supplier-sign convention was corrected to display server-provided debit/credit sides.

## Explicitly unfinished

This is a restored working core baseline, not a complete parity or production release.

- Returns/exchanges, purchase editing and histories, stock movement history, product opening stock in this form, box packing, flavor/variants, product import/deletion, account edits, purchase notes, tips, selected-bill payment allocation are unavailable in these adapters. Key controls are disabled with an explanation; remaining unmapped operations throw `not_available` before writing.
- Native Odoo already supports several of those capabilities. Connect the existing service to the original control next; do not replace the UI or recreate ledger logic.
- Settings Features, Tables, Team & Access and cutoff save are disabled until correctly connected. Wipe/restore are unavailable. Device preference choices remain device-local; account synchronization is not claimed.
- Table/KOT and open-bottle/peg frontend workflows are not fully mapped or manually verified. They must not be advertised as complete. Category insights/top sellers, some search/detail fields and cash-account cards need native read adapters.
- Daybook and Calendar remain deferred placeholders by the owner's earlier instruction. Sheet/WineStock, AI, master importer, distribution/multi-shop remain outside this restoration. Multi-shop is canceled. Developer Console restoration and platform HTTP checks remain separate open work; its visual source remains the Tryton Developer Console, not the legacy retailer console widgets.
- The original frontend still contains unreachable/unmapped historical math in deferred workflows. Supported online financial totals use native Odoo results; finish removing old math as each remaining workflow is mapped.
- Offline estimates/outbox/realtime foundation retained, but browser offline/reconnect, multi-tab concurrency, ambiguous network responses, multi-user isolation, queue rejection/recovery and physical-stock conflicts have not been proven through the restored UI. Existing device sequence allocation uses a global local-storage counter and is not atomic with IndexedDB enqueue. This needs a focused review before release; do not claim offline production readiness.
- Purchase form retries currently generate a new client reference; preserve the same intent across ambiguous retries before release. Online sales use the existing idempotent service/outbox, but UI-level ambiguous response tests remain pending.
- Full role-by-role browser proof, custom cutoff display/period filters, complete register pagination/search, physical printing, mobile visual parity and original live side-by-side comparison remain pending.
- Caddy/public-domain routing, `/dev`, production TLS, backups/restore drill and deployment were not changed or verified here.

Continue with one original workflow at a time: map the existing Odoo service, expose honest loading/errors, verify against native documents and original visuals. Do not redesign the restored screens.
