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

## UI Layout Fix & Component Standardization (2026-10-07)

- **Layout & Scrollbar Bug Resolved:** Removed `.shell-topnav > .page` from forced thin scrollbar rules in `frontend/src/styles/components.css`. Eliminated detached vertical scrollbar at 1600px and dead-space gutters on wide screens (1920px+). Primary page scroll restored to invisible desktop standard (`scrollbar-width: none`).
- **Layout Guardrail Rule 11:** Enshrined in `AGENTS.md` and `CLAUDE.md`: zero floating scrollbars, invisible page scrolling ("installed software" feel), and edge-to-edge surface continuity.
- **Component Standardization from `orsquare-tryton`:** Researched `UI_STANDARDS.md` in `orsquare-tryton`. Built reusable primitives in `frontend/src/components/ui/` (`Button`, `IconButton`, `SearchField`, `ToolbarSelect`, `Segmented`, `DateRangeFilter`, `Field`, `tokens.ts`) with unified `--ctl-h: 38px/40px` toolbar geometry using `@base-ui/react`, `clsx`, and `class-variance-authority`. Applied across Products, Purchases, Stock, Cash Flow, Accounts, Settings, and SalesHistoryRegister without altering the Carbon visual identity.
- **Toolbar Stretch & Squish Bug Fixed (Screenshots 1.png & 2.png):** Overrode general `.field-control { width: 100% }` for toolbar selects (`select.tb-select`, `.tb-select-sm: 140px`, `.tb-select-md: 160px`, `.tb-select-lg: 170px`) with `flex: 0 0 auto !important`. Standardized SearchField to `flex: 1 1 240px; min-width: 200px; max-width: 480px`. Dropdowns never balloon and search inputs never cut off placeholders.
- **Guardrail Rule 12 Enshrined:** Added Rule 12 (Standardized Toolbar & Control Sizing) to `AGENTS.md` and `CLAUDE.md`.
- **Validation:** `npm run typecheck` passed (0 errors); all 107 vitest tests passed; production build passed (`✓ built in 1.92s`).

## In-Browser PWA Architecture, Session Routing & Developer Console (2026-10-07)

- **Login Screen Flicker & Desync Resolved (Video 2026-10-07 20-12-03.mp4):**
  - **Synchronous Session Hydration:** In `frontend/src/auth/AuthContext.tsx`, `me`, `shopCode`, and `ready` are now initialized synchronously from `localStorage` (`readCached()`) on frame 0. If cached credentials exist, the store connects to IndexedDB immediately without waiting for network roundtrips.
  - **Synchronous Route Guard:** In `frontend/src/App.tsx`, wrapped `/login` in `<RedirectIfAuth />`. Authenticated users navigating to `/login` (or opening new browser tabs) are immediately redirected to `/` with 0ms visual delay. The login form is never painted or flashed.
  - **LoginPage Guard:** Added immediate `<Navigate to="/" replace />` in `frontend/src/pages/LoginPage.tsx` if `me` is authenticated.
- **Service Worker Dev Server Compatibility:**
  - In `frontend/public/sw.js`, added bypass for Vite dev and HMR paths (`/@`, `/src/`, `/node_modules/`).
  - In `frontend/src/main.tsx`, enabled Service Worker registration with `?sw=1` opt-in during development, running automatically in production.
- **Platform Developer Console (`/dev`) Connected:**
  - Ported and modernized Developer Console suite into `frontend/src/features/dev/` (`DevApp.tsx`, `NewShopModal.tsx`, `ShopDrawer.tsx`, `api.ts`, `types.ts`).
  - Wired into `frontend/src/App.tsx` with `<DevGuard />` at route `/dev/*`, gated to platform operators, system admins, and shop owners.
  - Connects to native Odoo backend `orsquare.platform.service` for fleet inspection, shop provisioning (`create_shop`), lifecycle management (suspend, reactivate, extend expiry, reset password), audit logs, and system diagnostics.
  - Lazy-loaded into its own isolated 23 kB chunk (`DevApp-*.js`), ensuring zero bloat on cashier and counter bundle sizes.
- **Validation:**
  - `npm run typecheck`: Passed (0 errors).
  - `npm test`: **107 passed, 1 physical-printer test skipped**.
  - `npm run build`: Production build passed (`✓ built in 1.86s`).
  - Landing `npm run check`: Passed (11 pages checked).

## Accounts Tab Modernization & Receivable/Payable Convention (2026-10-07)

- **Eliminated Confusing Double-Entry Jargon:**
  - Replaced all user-facing instances of "Debit" and "Credit" (`Dr` / `Cr`) across the Accounts tab (`AccountsPage.tsx`) and Khata ledger statements (`AccountLedgerView.tsx`).
  - Strict semantic retail terminology: **Receivable** (money owed to shop) and **Payable** (money owed to suppliers).
- **Clear Semantic Financial Coloring:**
  - **Receivable:** **Green** (`var(--ok, #198038)` / `var(--rec-fg, #235c35)` / `var(--rec-bg, #edf6f0)`).
  - **Payable:** **Red** (`var(--err, #da1e28)` / `var(--pay-fg, #8a2e2e)` / `var(--pay-bg, #faebeb)`).
  - **Settled:** Neutral / Muted (`var(--muted)`).
  - **Advance:** Blue (`var(--adv-fg, #0f62fe)`).
- **Component & View Updates:**
  - `AccountLedgerView.tsx`: Metrics bar updated to `Period Receivable (+)` (Green) and `Period Payable (-)` (Red). Table columns updated to `Receivable (+)` and `Payable (-)`. Closing balance row updated with green receivable and red payable amounts. Entry detail drawer updated to `Receivable` and `Payable`.
  - `AccountsPage.tsx`: Summary tiles updated from "Debtor accounts" / "Creditor accounts" to "Receivable accounts" / "Payable accounts". Table balance column displays clean formatted amounts with semantic status pills, omitting raw `Dr` / `Cr` text. Account drawer balance type renamed to "Opening position" with "Receivable (Owed to Shop)" and "Payable (Owed to Supplier)". Restored `IconPlus` on the Add Account button.
  - `tokens.css`: Aligned `--dr-fg` to green (`#235c35`) and `--cr-fg` to red (`#8a2e2e`).
- **Guardrail Rule 14 Enshrined:** Added Rule 14 (Receivable & Payable Retail Terminology) to `AGENTS.md` and `CLAUDE.md`.
- **Validation:** `npm run typecheck` passed (0 errors); `npm test` passed (107 passed, 1 skipped).

## Developer Console Hardening, Auth Standardization & Session Fix (2026-10-07)

- **Session Database Isolation Fixed (Screenshot 2026-10-07 230811.png):**
  - Resolved session database leakage where a browser previously accessing the retail counter (`orsquare_shop1`) carried `request.db = 'orsquare_shop1'` into the developer console, causing `AccessDenied` on `orsquare_platform`.
  - In `addons/orsquare/controllers/main.py`, `_resolve_db` now prioritizes developer logins, explicit `surface='dev'`, and developer email addresses over stale session cookies.
- **Application Error Crash Fixed (Screenshot 2026-10-07 231554.png):**
  - Resolved `Cannot read properties of undefined (reading 'name')` crash in `frontend/src/auth/AuthContext.tsx`.
  - Updated `me()` in `addons/orsquare_platform/models/platform.py` to return the complete standardized user envelope (`company`, `flags`, `roles: ['developer']`, `tabs: []`, `shop: 'orsquare_platform'`).
  - Added safe optional chaining in `AuthContext.tsx` (`me.company?.name ?? 'ORSquare Platform'`, `me.features`) and guarded IndexedDB synchronization (`startStore`) to run only for retail shop accounts, preventing developer accounts from executing shop sync loops.
- **Login Standardization for All Users:**
  - **Developer:** Standardized strictly to **Email** (`dev@orsquare.com` or `admin@orsquare.com`) and **Password** (`Dev#Admin2026`).
  - **Shop Owner:** Standardized to **Email** (`owner@krishnawines.com`) or **Phone** (`9876543210`) and **Password** (`Krishna#Owner2026`).
  - **Cashier:** Standardized to **Email** (`cashier@krishnawines.com`) or **Phone** (`9876543211`) and **Password** (`Krishna#Owner2026`).
- **Canonical Partner Resolution in Backend Odoo:**
  - In `addons/orsquare/controllers/main.py`, SQL authentication queries now join `res_users` with `res_partner` (`p.email`, `p.phone`, `p.mobile`), allowing users across all roles to authenticate seamlessly with their email, phone number, or internal username.
- **Dedicated Developer Login Screen:**
  - Visiting `http://localhost:5173/dev` unauthenticated presents the dedicated Developer Console sign-in screen with fields for Developer Email and Password.
  - Retail shop staff visiting `/dev` are unconditionally redirected to `/` in 0ms.
- **Cached Session Self-Healing & Optional Chaining Fix (Screenshot 232334):**
  - Resolved `Cannot read properties of undefined (reading 'can_see_money')` caused by reading stale cached session envelopes from `localStorage` lacking `flags`.
  - Added optional chaining `me?.flags?.can_see_money` in `AuthContext.tsx`.
  - Added self-healing normalization in `readCached()` and `adopt()` ensuring default flags, company, roles, and tabs are always populated even from legacy cached browser state.
- **Validation:**
  - `npm run typecheck`: Passed (0 errors).
  - `npm test`: **107 passed, 1 physical-printer test skipped**.
  - Verified authentication across all roles via automated API tests (Developer email/username, Owner email/phone, Cashier email/phone, Stale shop cookie override).

## Active Blockers & Server Shutdown Notice (2026-10-07 23:31 IST)

> **CRITICAL NOTICE:** All dev servers (Vite on port 5173, Astro on port 4321) and all Docker containers/background tasks were explicitly stopped by the product owner. Before restarting services in the next session, review the diagnosis below.

### Detailed Problem Diagnosis: Developer Console Hydration & ErrorBoundary Loop
1. **The Visible Symptom:**
   - The browser displays full-screen: `System Notice / Application Error / Cannot read properties of undefined (reading 'can_see_money')`.
   - Clicking `[ Reload View ]` fails to clear the error and immediately shows the same screen.
2. **The Underlying Mechanism:**
   - **Step 1:** In early revisions of `orsquare.platform.service.me()`, developer accounts returned an incomplete JSON envelope lacking `flags` and `company` (`{'id': 6, 'name': 'dev_ops', 'surface': 'dev', 'roles': ['developer']}`).
   - **Step 2:** The client stored this object in the browser's persistent `localStorage['or2_me']`.
   - **Step 3:** On page load, `frontend/src/auth/AuthContext.tsx` synchronously hydrates `initial = readCached()`.
   - **Step 4:** During the first synchronous render pass, `AuthApi`'s `useMemo` evaluated `seesMoney: !!me?.flags.can_see_money`. Because `me.flags` was `undefined`, accessing `.can_see_money` threw a fatal `TypeError` before `useEffect` or network re-hydration could run.
   - **Step 5:** `frontend/src/main.tsx` wraps the whole application in `<ErrorBoundary fallbackTitle="Application Error">`. The error boundary caught the fatal exception and painted the fallback screen.
   - **Step 6:** The `[ Reload View ]` button in `ErrorBoundary.tsx` only resets React local error state (`this.setState({ hasError: false })`). Because the malformed `me` object was still in React state / `localStorage`, the re-render instantly threw the exact same error, creating an unbreakable loop.
3. **Applied Code Fixes in Repository:**
   - Commit `78153e5`: Backend `platform.py` updated to return complete `Me` envelope with standard `company`, `flags`, and `roles`.
   - Commit `6c291df`: Frontend `DevApp.tsx` updated with dedicated `DevLogin` and `me.company?.name` fallback.
   - Commit `06ccc75`: Frontend `AuthContext.tsx` updated with `me?.flags?.can_see_money` optional chaining, and `readCached()` / `adopt()` self-healing normalization to populate missing properties automatically.
4. **Action Required on Next Service Start:**
   - Run `node_modules/.bin/vite --force` (or clear `.vite` cache) to ensure Vite serves the un-cached bundle.
   - If a browser window was left open during the error, a hard browser refresh (`Ctrl + Shift + R`) or clearing `localStorage` may be required to flush the old bundle currently executing in the browser tab.




