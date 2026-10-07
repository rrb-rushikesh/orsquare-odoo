# Current repository status — 2026-10-07

## Start here

The product is incomplete. The owner reports multiple nonworking features and will provide the details in another session. This cleanup does not resolve those bugs or prove product readiness. Investigate each reported flow before changing it; preserve the original retailer screens and [design philosophy](frontend/DESIGN.md).

Odoo remains the only accounting/stock/tax authority. One account = one shop = one database. Legacy repositories are visual and requirements sources only. Read [context](context.md), [agent rules](AGENTS.md), [backend decisions](docs/backend-decisions.md) and the relevant tab specification before work.

## What exists

- Original retailer UI imported from `C:\Users\rushi\Music\production-hot-fix`; partial Odoo adapters connect Sales, Products, Purchases, Stock, Accounts, Cash Flow, Ledger and Dashboard. See [restoration evidence and limitations](docs/retailer-restoration.md).
- Odoo shop backend, platform backend, native projections, session guards, sync and realtime infrastructure exist. API availability does not mean a screen is connected. See the [generated API reference](docs/backend-api-reference.md).
- The separate Astro public site exists. Developer Console UI, full production deployment and public-domain proof remain open.

## Known gaps to investigate

- Returns/exchanges, purchase editing/history, stock movement history, product opening stock/import/deletion, variants/packing, account edits and selected-bill allocation are unavailable or incompletely mapped in the restored UI.
- Settings shop controls, Team & Access, tables/cutoff configuration and wipe/restore are disconnected. Native services for some operations already exist; reuse them.
- Daybook and Calendar are deferred placeholders. Sheet/WineStock, master importer and AI remain deferred; multi-shop is canceled.
- Table/KOT and opened-bottle/peg flows need original-screen mapping and manual proof. Some search/detail/report fields and pagination remain incomplete.
- Offline/reconnect, rejection recovery, multi-tab sequencing, role isolation and physical-stock conflicts are not proven through the restored screens. The current local-storage device sequence counter is not atomic with IndexedDB enqueue.
- Purchase retries currently create a new client reference. Ambiguous-response retries need investigation before release.
- Physical printers, mobile parity, full original-app comparison, production TLS/routing and a restore drill on another host remain unverified.

## Evidence and its limits

The latest recorded full Odoo regression before cleanup was **210 tests passed** on the development database; a later focused accounts/report run passed **16 tests**. Earlier pristine-install proof covered **206 tests**, not the latest 210-test revision. These were not rerun for this documentation/dead-code cleanup.

Prior browser proof covered one cash sale, one supplier bill, one transfer, native statements/cash register and Sales deep-link refresh. It did not cover every workflow or the owner's newly reported failures. Printer tests do not establish restored-screen correctness.

Cleanup validation on 2026-10-07:

- Frontend `npm run build`: passed (TypeScript and production build). Existing Vite warning about mixed static/dynamic sync imports remains; no runtime behavior was changed to silence it.
- Frontend `npm test`: **103 passed, 1 physical-printer test skipped**.
- Landing `npm run check` with the production app sign-in URL: passed; 11 pages checked.
- Regenerated shop API reference: **90 methods across 16 installed services**. Optional platform service is absent from the shop database and is explicitly omitted. The documentation generator now handles this and stops copying output after a failed generation.
- Import graph after removal: no unreachable source files from the audited entry points. Dependency tree and repository-local Markdown file links checked. Design philosophy left unchanged.

No new browser acceptance, hardware proof, backend regression or production deployment was performed for this cleanup. Production readiness and offline correctness are not inferred from compilation or tests.

## Cleanup scope

Removed 42 source files unreachable from application, test and configuration entry points, including the duplicate `_pending` tree and disconnected Sheet/PDF helpers. Removed the unused maskable SVG and the dependencies `@react-pdf/renderer`, `axe-core` and `playwright`; retained live printing, spreadsheet, sync and realtime dependencies. Old source remains recoverable in Git history and the external visual source repository.

Consolidated the two stale root handover documents here. Historical architecture/proof documents remain useful and are labeled by scope; the design philosophy remains unchanged. No application workflow or financial logic was changed in this cleanup. Continue with the owner's specific bug list in the next session.

## Git publication status

Cleanup is committed locally in three groups: unused frontend code/dependencies, API documentation generation, and Markdown/status consolidation. All completed work has been fast-forward merged into `main` at the owner's request. The fully merged `codex/restore-original-retailer` branch has been deleted; only local `main` remains. Remote branch inventory also shows only `main`. Prior backend and original-UI restoration commits are preserved.

**Push was not executed.** Automatic approval review again rejected pushing `main` to the existing `origin`, `https://github.com/rrb-rushikesh/orsquare-odoo.git`: it requires user approval explicitly naming that destination and publication of all committed repository code/documentation on `main`. The owner's request to merge and "push online" did not satisfy the review's specificity requirement. Fetch succeeded and the remote shares this project's history. GitHub CLI authentication is unavailable. Do not bypass the rejection or claim the current work is online; obtain the exact publication approval before retrying.
