# Tab Specification: Developer Console (`/dev`)

> **Status review — 2026-10-08:** Redesigned to exact visual and architectural parity with Tryton console (`C:\Repo\orsquare-tryton`). Built with Tailwind CSS v4, scoped token layers (`dev-theme.css`, `theme.css`, `controls.css`, `primitives.css`), and UI primitives (`Drawer`, `Modal`, `ChoiceCards`, `PasswordField`, `PhoneField`, `Stepper`, `Switch`, `Tag`). Backend: `addons/orsquare_platform/`. UI: `frontend/src/features/dev/` (adapter bridge in `frontend/src/features/dev/api.ts`).

**Route:** `/dev` (platform operators only; a shop user is redirected to `/` and never sees it). Deep links to business property drawers use `/dev/b/:slug`. A visitor who is not signed in gets the operator sign-in; there is no link from the retailer app.
**Purpose:** The central platform console for operators managing fleet registration, subscriptions, cashier staffing, Business Studio configurations, audit trails, and system diagnostics.

## Visual Design & Architecture

The Developer Console mirrors the Tryton implementation:
- **Top Shell (`DevApp.tsx`)**: Header with BrandLogo, Console tag, navigation segments (Businesses, Audit, System), sign-out button, and compact density toggle.
- **Styling Architecture**: Tailwind CSS v4 (`@tailwindcss/vite`) with custom CSS variable tokens for controls, surfaces, typography, and primitives. Configured without preflight resets to guarantee zero interference with the POS retailer counter screens.

## Views & Forms

| Screen / Component | What it does |
| --- | --- |
| **Fleet Page (`FleetPage.tsx`)** | Fleet table with stage filter segments (`All`, `Active`, `Expiring`, `Grace`, `Suspended`), search filter input, selection banner with batch shift, CSV export, and `+ New business` button. Row click opens the business property drawer at `/dev/b/:slug`. |
| **Onboarding Form (`NewBusinessDialog.tsx`)** | 4-section modal wizard with live summary aside: (1) Identity & auto-slug generation, (2) Plan tier selection cards, (3) Owner credentials with password generator dice roll, (4) Phone number with country calling code picker. Provisions shop directly via Odoo RPC. |
| **Profile Property Form (`BusinessPanel.tsx`)** | Slide-over drawer on `/dev/b/:slug` with six key management blocks:<br>• **IdentityBlock**: Shop code, slug, created date, stage badge, tier badge.<br>• **OwnerBlock**: Owner email, phone, reset password modal.<br>• **SubscriptionBlock**: Plan details, validity date, progress bar, quick shift chips (`-30d`, `-7d`, `+7d`, `+30d`, `+365d`), suspend/reactivate toggles.<br>• **CashiersBlock**: Active count vs plan limit, toggle active, reset PIN/password, and **Add Cashier** dialog (`AddCashierDialog`).<br>• **StudioBlock**: Live preview and launcher for Business Studio.<br>• **ActivityBlock**: Historical shop audit logs. |
| **Business Studio Form (`studio/StudioPanel.tsx`)** | 3-column configuration workbench: left navigation sidebar (POS, Billing, Hardware, Payments, Inventory, Integrations), center feature toggles and preset selector, right inspection pane with live JSON preview and apply button. |
| **Audit Page (`AuditPage.tsx`)** | Audit event log filtering by operator, action type, target shop, and JSON metadata. |
| **System Page (`SystemPage.tsx`)** | Diagnostic panel showing database status, Odoo server engine version, platform registry health, and directory rebuild utilities. |

## Rules (do not break)

* Developer-only: AGENTS.md section 13. Server-side enforcement: section 15.
* Nothing in the console reads shop business data (sales, stock, money). It manages the shop, not the business.
* Lists stay server-paged and indexed (benchmark: `scripts/bench_platform.py`).
* Retain zero preflight reset isolation in `dev-theme.css` so counter POS screens remain unaffected.
