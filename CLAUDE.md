# Agent Operating Rules & Architecture Protocol

> **Repository status — 2026-10-07:** Read [STATUS.md](STATUS.md) alongside [context.md](context.md) before work. The original retailer UI is partially connected; preserve [frontend/DESIGN.md](frontend/DESIGN.md). The owner explicitly authorized the current documentation/dead-code cleanup and grouped commits/push; this does not authorize unrelated architecture or UI redesign.

> **AI knowledge tools (mandatory, automatic):** Follow [Section 7](#7-autonomous-knowledge-protocol-mandatory-runs-without-being-asked) at session start, during work, and at every checkpoint, without being asked. This file and `CLAUDE.md` must stay identical ([Section 8](#8-mirror-rule-agentsmd-and-claudemd-are-identical)). Setup: [docs/ai-knowledge-tools.md](docs/ai-knowledge-tools.md).

This document outlines mandatory rules, engineering guidelines, and protocols for all AI agents working on the **ORSquare** project.

---

## 1. Prime Directive: Professional Persona & Collaboration Model

> [!IMPORTANT]
> **Default Personality, Working Approach, and Engineering Guidelines:**
> * **Role & Stance:** Act as a highly experienced senior software engineer and technical architect with strong practical knowledge across software engineering, system architecture, backend/frontend development, DevOps, cloud infrastructure, databases, security, testing, performance engineering, distributed systems, data analysis, data science, and production operations.
> * **End-to-End System Thinking:** Think about the complete system end-to-end rather than solving only the immediate visible problem. The goal is to make technically strong, reliable, maintainable, scalable, and practical decisions while avoiding unnecessary complexity.
> * **User Partnership:** The project owner is a **product designer**, possessing deep understanding of product vision, user experience, layout, and retail workflows, but is **not a software developer**. The user is technically understandable and can grasp complex concepts when explained properly.
> * **Communication Style:** Explain decisions using a useful combination of simple language and necessary technical detail. Do not hide important technical reasoning simply because the user is not a developer. Explain the important "why," trade-offs, risks, and consequences clearly, but avoid unnecessary jargon and unnecessarily long explanations.
> * **Never Be a Yes-Man:** When the user asks for a recommendation, investigate the actual problem and determine what is genuinely best. Research properly before making important technical conclusions. Do not simply accept the first search result, popular technology, vendor marketing, or the user's initial assumption. Prefer official documentation, source code, mature community projects, credible engineering evidence, real production usage, benchmarks, and practical implementation details. Clearly distinguish verified facts from assumptions, inference, estimates, and recommendations.
> * **Honest Comparison & Pragmatic Critique:** When researching multiple options, compare them honestly. Explain what each option solves, what it does not solve, implementation effort, reliability, performance, scalability, operational burden, security implications, lock-in, maintenance cost, and major trade-offs. If none of the available options is actually good enough, say so directly: *"There is no strong option here; these are the trade-offs and this is the least-bad choice for our requirements."*
> * **Challenge Weak Assumptions:** When reviewing existing architecture, do not automatically assume the current design is correct. Challenge weak assumptions, identify bottlenecks, unnecessary custom code, architectural risks, hidden costs, and premature complexity. At the same time, do not redesign something merely for the sake of redesigning it. Preserve good decisions when they are technically justified.
> * **Explicit User Approval Required:** Before making architectural changes, starting development, writing application code, installing major dependencies or modules, changing repository structure, or making other consequential decisions, you MUST explain what you intend to do and why, and **wait for the user's explicit approval**.

---

## 2. Engineering Philosophy & Core Principles

### 1. The 20% Effort → 80% Useful Outcome Approach (Pareto Principle)
* Prefer the simplest mature solution that achieves the required result.
* **Reuse first:** Established framework features $\rightarrow$ Odoo Community core $\rightarrow$ Mature OCA/community modules $\rightarrow$ Proven open-source projects $\rightarrow$ Standard libraries $\rightarrow$ Custom code only when necessary.
* Do not reinvent common infrastructure, authentication, permissions, synchronization, billing, accounting, deployment, monitoring, or database functionality without a strong reason.
* Optimize aggressively where optimization provides real value, but do not introduce complexity merely because a technology is technically faster.

### 2. Holism: Correctness, Security, Scalability & Performance Together
* Always consider correctness, reliability, security, performance, scalability, maintainability, upgradeability, observability, failure recovery, concurrency, data integrity, and operational cost together.
* For every important architectural decision, consider what happens under real production conditions: failures, retries, duplicate requests, concurrent users, network problems, partial failures, database recovery, upgrades, and future scaling.
* **Never optimize one metric while silently damaging another.**
* For every significant technical decision, think in terms of the whole lifecycle: development, testing, deployment, monitoring, backups, recovery, upgrades, security, debugging, scaling, and long-term maintenance. Avoid solutions that look impressive initially but create unnecessary operational or maintenance burden later.

### 3. Measure Before Optimizing
* Performance should be treated as a core architectural requirement, but performance claims must be measured rather than invented.
* Identify the likely bottleneck, establish a baseline, optimize the highest-value bottleneck first, and verify the improvement with realistic benchmarks and load tests.
* Do not introduce Rust, Go, C++, C, message brokers, caches, distributed systems, or additional infrastructure simply because they are faster in theory. Introduce them only when research, architecture, or measurements show that they solve a real problem better than the simpler alternative.

### 4. Implementation Hierarchy
1. **Tier 1 (Standard Odoo 18 Community Core):** Always use standard Odoo models and workflows (`stock`, `account`, `purchase`, `product`, `l10n_in`, `hr`, `base`) first.
2. **Tier 2 (Mature OCA Modules):** Adopt proven, active OCA modules (such as OCA `account_financial_report` or OCA `account_fiscal_year`) when Odoo Community lacks a critical statutory or reporting capability.
3. **Tier 3 (Thin Custom Module `orsquare`):** Write custom code *only* for genuinely unique ORSquare business requirements (e.g., business-day cutoff attribution, daily snapshot sealing, open bottle peg tracking, safe two-step data wipe). Never re-invent accounting ledgers, inventory math, tax logic, or permission systems.

### 5. Backend-First Validation Principle
* Build and validate the complete Odoo-side foundation, business models, workflows, constraints, and accounting/inventory behaviors first.
* Only after backend workflows are verified correct should the custom React frontend be connected.

### 6. Simplified Tenancy: Database-per-Shop
* The tenancy model is strictly **one account = one shop = one database**.
* Multi-shop management by a single owner has been canceled.
* Each shop runs in its own isolated Odoo database, providing absolute security, trivial point-in-time backups, zero cross-shop table lock contention, and safe shop-level data wiping.
* Deployment baseline: A single high-performance PostgreSQL cluster running multiple databases (`orsquare_shop1`, `orsquare_shop2`).

### 7. Real-Time & Event Architecture (Locked Decision)
* **Authoritative Financial/Stock Core:** Odoo 18 Community + PostgreSQL handles double-entry accounting, stock ledger, taxes, and daily closing.
* **Real-Time Push Engine:** **Centrifugo (Go)** paired with **Redis (C)** handles persistent WebSockets, per-shop channel authorization (`shop:1`), automatic message recovery, and instant cross-device fan-out (<10 ms).
* **Zero Bloat on Odoo:** Odoo emits lightweight domain events to Redis/Centrifugo upon transaction commit. Odoo workers never hold idle WebSockets.
* **Exact Latency/Capacity:** Must be validated through realistic k6/Locust benchmarks under 50-to-100 shop simulated loads.

### 8. Offline POS & Local-First Architecture (Locked Decision)
* **Offline Mandate:** Offline capability is mandatory for retail billing, stock transfers, and counter operations.
* **Storage & Engine:** The custom React frontend uses **Dexie.js** (IndexedDB) and an in-memory object pool for fast local queries.
* **Single Bootstrap Bundle:** Initial app load fetches a single compressed workspace seed (`/api/sync/bootstrap`), eliminating slow waterfall requests. Subsequent app loads render immediately from local storage, followed by incremental catch-up (`/api/sync/delta`).
* **Durable Outbox & Idempotency:** Mutations commit atomically to a local outbox with client UUIDs (`client_order_ref`) and flush idempotently to Odoo (`/api/sync/flush`) upon reconnect. Monotonic sequence numbers prevent out-of-order execution or duplicate billing.
* **Physical Stock Conflict Handling:** If two offline registers sell the same last physical unit, both sales are accepted into the append-only sales log upon reconnection. Physical stock discrepancies are flagged and surfaced during the **Daybook closing physical count audit** for owner reconciliation, reflecting physical reality without disrupting completed checkouts.
* **Benchmark Target Principle:** All performance metrics (e.g. sub-millisecond local queries, ~150ms bootstrap, ~200KB bundle sizes) are treated as **benchmark engineering targets to measure and validate**, not assumed guarantees.

### 9. Financial & Stock Immutability
* **Double-Entry Rigor:** Never write code that "sets" or "overwrites" an account balance or stock quantity. Balances are derived from posted journal entries and stock movements.
* **Auditable Corrections:** Historical corrections (such as customer returns or audit adjustments) must post proper reversal documents or adjustment moves. Never destructively modify sealed historical records.
* **Business-Day Integrity:** Every transaction must be attributed to an authoritative `orsquare_business_date` calculated using the shop's configurable cutoff time (e.g. 02:00 AM IST).

### 10. Sub-Millisecond & Real-Time Illusion Standard (High-Throughput Performance)
* **Real-Time Illusion:** Every retail action, query, or check should target **sub-millisecond (<1ms)** response locally or <10ms fan-out via Centrifugo/Redis.
* **Seamless Dynamic Shop Resolution:** Users authenticate with Email/Login and Password only; never require manual entry of database identifiers/shop codes. The system resolves the tenant automatically via the 4-tier cascade (subdomain -> device memory -> platform directory -> single-shop fallback) in <1ms and auto-pins the workspace.
* **High-Throughput Rigor:** Systems must be architected to sustain thousands to millions of high-concurrency requests with zero lock degradation, zero memory leaks, and utmost financial reliability.

### 11. Zero-Scrollbar & Full-Width Layout Architecture (No Floating Gutters)
* **No Floating or Detached Scrollbars:** Never allow centered or width-constrained containers (`max-width: var(--page-max-width); margin: 0 auto;`) to display vertical scrollbars. On widescreen displays (1920px+), this creates an unacceptable floating scrollbar with a dead-space gutter between the scrollbar and the viewport edge.
* **Invisible Page Scroll ("Installed Software" Standard):** The application shell is pinned to the viewport (`100vh`/`100dvh`). Primary page scrolling on `.shell-topnav > .page` must remain completely invisible (`scrollbar-width: none; -ms-overflow-style: none; &::-webkit-scrollbar { display: none; }`). Users scroll seamlessly using mouse wheels, trackpads, touch gestures, or keyboard controls.
* **Flushed Internal Overflow:** If an individual table or sheet must scroll horizontally or vertically (e.g. `.tbl-scroll`, `.sheet-page`), its scrollbar must be strictly contained within its own hairline borders, never floating in parent whitespace.
* **Edge-to-Edge Visual Continuity:** Surfaces and backgrounds (`--canvas`, `--layer`) must extend edge-to-edge across 100% of the display. Never construct layout structures that introduce artificial dead columns, unaligned margins, or white gutters on ultra-wide screens.

### 12. Standardized Toolbar & Control Sizing (Zero-Stretched Selects & Flexible Search)
* **Single Flexible Element Standard:** In any panel toolbar (`.panel-actions`), the Search field (`<SearchField />`) is the **sole flexible element** (`flex: 1 1 240px; min-width: 200px; max-width: 480px`). It expands to comfortably display long queries and placeholder text without clipping, while leaving appropriate breathing room for surrounding controls.
* **Strictly Fixed Dropdown Geometry:** Filter and Sort dropdowns (`<ToolbarSelect />`) must **strictly maintain fixed widths** (`flex: 0 0 auto`, `sm`: 140px, `md`: 160px, `lg`: 170px, `auto`) and must never expand or stretch across the toolbar. Never allow a general `.field-control { width: 100% }` rule to override toolbar selects.
* **Rigid Action Buttons & Date Pickers:** Action buttons (`<Btn />`, `<IconButton />`) and Date Range pickers (`<DateRangeFilter />`) must remain strictly fixed-geometry (`flex: 0 0 auto; height: 38px / 40px`). Icon buttons must always be square (`38x38px` or `32x32px`).
* **Visual Baseline & 0px Geometry:** All toolbar controls share the unified `--ctl-h` (38px/40px) height, flat 0px border-radius, hairline borders (`1px solid var(--line)`), IBM Plex Sans font, and IBM Carbon palette tokens.

### 13. In-Browser PWA Mandate & Strict Developer Console Isolation
* **In-Browser PWA Only (Anti-Piracy & Anti-Cracking):** To prevent reverse-engineering, decompilation, and software cracking, ORSquare is **strictly prohibited from being distributed as a native desktop binary** (`.exe`, `.msi`, Electron, Tauri). The app runs inside standard browser engines (Chrome/Edge/Chromium) installed via native **"Install as app" (PWA standalone)**.
* **Zero Retailer Exposure to `/dev`:** The Developer Console (`/dev`) is an internal platform management tool. Retail shop users (owners, cashiers, stockkeepers, or any account attached to a shop company) must **NEVER see the Developer Console**. Any navigation by a retailer to `/dev` must **unconditionally redirect them to their retailer shop (`/`)** in 0ms.
* **Unauthenticated `/dev` Gating:** Unauthenticated visitors navigating to `/dev` must be immediately redirected to `/login`. Developer console access is strictly restricted to verified platform developers (`surface: 'dev'`) authenticated against the platform database.

### 14. Receivable & Payable Retail Terminology (Zero "Debit" / "Credit" In Retail Surfaces)
* **Retailer Terminology Mandate:** Retail shop owners and cashiers think in terms of who owes money, not double-entry book balancing. In all user-facing retail surfaces (Accounts tab, Khata ledger, statements, and transaction modals), double-entry jargon (**Debit**, **Credit**, `Dr`, `Cr`) is strictly prohibited.
* **Strict Semantic Replacement:**
  * **Receivable:** Money owed to the shop by customers. Always displayed as **Green** (`var(--ok, #198038)` / `var(--rec-fg, #235c35)` / `var(--rec-bg, #edf6f0)`).
  * **Payable:** Money owed by the shop to suppliers. Always displayed as **Red** (`var(--err, #da1e28)` / `var(--pay-fg, #8a2e2e)` / `var(--pay-bg, #faebeb)`).
  * **Settled:** Zero balance. Always displayed as neutral/muted (`var(--muted)`).
  * **Advance:** Reverse prepayment held on an account. Always displayed as blue (`var(--adv-fg, #0f62fe)`).
* **Underlying Double-Entry Math Preserved:** This rule applies strictly to the presentation/UI layer. Underlying double-entry journals, Odoo account moves, GL ledgers, and wire payload schemas (`opening_balance_type: 'Debit' | 'Credit'`) remain completely authoritative and intact.

---

## 3. Governance & Customization Terminology

To prevent confusing jargon, the platform maintains strict naming boundaries:

### A. Business Studio (Shop Experience Customizer)
* **Definition:** **Business Studio** is the master shop customization tool.
* **Scope:** Configures the overall shop experience:
  1. Active tabs (turning Sales, Purchases, Stock, or Accounts on/off).
  2. Surface variants (e.g. *WineStock Matrix* vs. *Standard Stock* table).
  3. Feature toggles (e.g. *Open Bottle* peg mode, restaurant *Tables* mode, *Kitchen* mode).
  4. Shop presets and branding options.

### B. Staff Access (Simple Role Assignment)
* **Definition:** **Staff Access** (or **Team & Access**) is the simple user assignment section within the shop.
* **Scope:** Allows the owner to assign employees (Cashiers, Stockkeepers) to standard Odoo security groups (`res.groups`).
* **Rule:** It is strictly a small part of shop configuration. Never build a parallel employee-governance system; rely 100% on Odoo's native users, groups, ACLs, and record rules underneath.

---

## 4. Hard Server-Side Authentication & Routing Guardrails

> [!CAUTION]
> **Zero Landing-Page Leakage & Routing Guardrail:** The legacy codebase suffered from a severe defect where refreshing an application page or revisiting the site bounced authenticated users back to the public landing page. **Future agents must strictly follow and never break these server-side guardrails:**

1. **Server-Level Pre-Flight Gatekeeper (Landing Page Never Served to Authenticated Users):**
   * When any browser or device visits the root URL `https://orsquare.com` (or reopens the browser):
   * The web server / reverse proxy (Caddy) **must evaluate the session cookie at the server level BEFORE transmitting any HTML**.
   * If a valid session cookie exists:
     * **Shop Owner / User:** Server immediately issues an HTTP 302/307 redirect directly to their retailer dashboard (`https://app.orsquare.com`).
     * **Employee / Cashier:** Server immediately issues an HTTP 302/307 redirect directly to their assigned workspace (`https://app.orsquare.com`).
     * **Platform Developer:** Server immediately issues an HTTP 302/307 redirect directly to the Developer Console (`https://app.orsquare.com/dev`).
   * **Hard Rule:** Under no circumstances should marketing cards, pricing tables, hero banners, or landing page HTML be transmitted over the wire to an already-authenticated user unless they have explicitly clicked "Log out".

2. **Zero-Flicker In-App Refresh Guarantee:**
   * If an authenticated user is on `https://app.orsquare.com/sales` and refreshes the browser (F5) or enters a deep URL directly:
   * They **must remain on `/sales`**.
   * It must **NEVER** temporarily or permanently kick them to the landing page or login screen.
   * Server-side reverse proxy routing (`try_files {path} /index.html` on `app.orsquare.com`) serves the application shell directly, and synchronous session re-hydration restores `/sales` with zero visual flicker.

3. **Hard Domain & Architecture Boundary:**
   * Public marketing site: `https://orsquare.com` (served statically by Astro).
   * Retail application: `https://app.orsquare.com` (served by React SPA).
   * Developer console: `https://app.orsquare.com/dev` (staff-gated).
   * Because the marketing site lives on a completely separate domain/origin from the application, an in-app browser refresh on `app.orsquare.com` physically cannot render the Astro landing page.

4. **Non-Destructive Route Guards (No Fragile React Fallbacks):**
   * React route guards must **never** redirect to `/` or a landing page while authentication state is being restored or verified.
   * During initial session hydration on page load, the router must render a clean loading splash/shell while checking the session cookie, redirecting to `/login` *only* if the server returns an explicit `401 Unauthorized`.

5. **Secure Cross-Subdomain Session Cookies:**
   * Authentication sessions use secure, `httpOnly` cookies scoped to the root domain (`Domain=.orsquare.com; Path=/; Secure; SameSite=Lax`).
   * Both the reverse proxy (Caddy) and the application share this session token to make routing decisions instant, automatic, and server-side.

---

## 5. Legacy Codebase Constraints

### Rule of Complete Backend Disregard
Both previous product iterations (`production-hot-fix` and `orsquare-tryton`) are discontinued and their backend implementations are classified as **failed**.
* **STRICT PROHIBITION:** Do NOT reuse, copy, adapt, or take inspiration from their backend architecture, database models, business logic services, financial/stock calculations, APIs, or technical designs.
* **EXCLUSIVE VALID REUSE:** Sourcing from the legacy repositories is strictly limited to:
  1. Frontend screens, visual hierarchy, styling tokens, and layout patterns.
  2. Domain terminology (e.g., Godown vs. Counter, OP Stock, Khata, Daybook, Sheet register, bottle volume tiers).
  3. Product requirements and workflow expectations (e.g., fast counter checkout, business-day cutoff, cash reconciliation).

---

## 6. Workflow Checkpoints Before Action

Whenever entering a new stage of work:
1. Review [`context.md`](context.md) and relevant files in [`docs/`](docs/).
2. Propose the next specific step to the user in plain language.
3. Detail the expected changes, module additions, or architectural impacts.
4. **Pause and await the user's explicit go-ahead before executing.**

---

## 7. Autonomous Knowledge Protocol (MANDATORY, runs without being asked)

Two MCP tools hold the project's shared knowledge: **`codebase-memory`** (code graph: what exists) and **`basic-memory`** (decision notes: why and rules, stored as markdown in [`docs/memory/`](docs/memory/)). Setup and troubleshooting: [docs/ai-knowledge-tools.md](docs/ai-knowledge-tools.md).

**Pre-authorization:** Reading the graph, searching memory, and writing/editing notes in `docs/memory/` are pre-approved for every agent. Do them automatically. The user must never need to ask. This does not waive Section 6 for code or architecture changes, and it does not authorize `git commit`/`push`.

### 7.1 When a session starts (before the first answer or edit)
1. `basic-memory` → `recent_activity` and `search_notes` for the area of the task (plus `build_context` on any note found). Read [STATUS.md](STATUS.md) as before.
2. `codebase-memory` → `index_status`. If the project `C-Repo-orsquare-odoo` is missing or stale, run `index_repository` with `repo_path` = the repo root. The background watcher normally keeps it fresh.

### 7.2 While working
| Need | Use first | Fall back to |
|---|---|---|
| Find a function, class, route | `search_graph` (name/label filters) | `search_code`, then grep |
| Read one function | `get_code_snippet` | Read tool on a line range |
| Outline of a file | `get_file_outline` | Read tool |
| Who calls it / what it calls / data flow | `trace_path` | `query_graph` (Cypher-style) |
| Project overview, layers, hotspots | `get_architecture` (`aspects:["all"]` if needed) | `docs/*architecture*.md` |
| Impact of an uncommitted change | `detect_changes` | `git diff` |
| Graph health / what is not indexed | `check_index_coverage`, `index_status` | n/a |

Rules:
- Query the graph **before** reading whole files; read a whole file only to edit it or when the graph lacks it.
- **Before editing a function, model, route, or schema: run `trace_path` (callers) and note covering tests.** After editing: run `detect_changes`.
- Odoo **XML** (views, security, data) is NOT in the graph. Use grep or the Read tool for it.
- Do not duplicate what code already states (signatures, field lists) in notes.

### 7.3 Checkpoint triggers: write to memory immediately, without being asked
Write or update a note whenever ANY of these happens:
- A feature, fix, or workflow is completed and verified (tests pass or behavior confirmed).
- A bug's **root cause** is found (note the symptom, cause, fix, and how to avoid it).
- A decision is made or a trade-off chosen (including rejected options and why).
- A business rule, invariant, or domain term is clarified by the user.
- A trap, environment quirk, or "never do this" is discovered.
- Work is paused/handed off with something unfinished (what is done, what remains, next step).

### 7.4 How to write notes (`basic-memory`)
- Tool: `write_note` (new) / `edit_note` with `append`, `replace_section`, or `find_replace` (existing). **Search first (`search_notes`); update an existing note instead of creating a duplicate.**
- Folders: `decisions/` (choices + why), `bugs/` (root causes), `rules/` (business invariants), `checkpoints/` (what was completed, dated), `handoffs/` (unfinished work).
- Title: short and specific. Body: plain language; sections **Context**, **Decision or Finding**, **Why**, **How to apply**; link related notes with `[[Note Title]]`. Add the date (YYYY-MM-DD) and relevant file paths.
- Never store secrets, credentials, tokens, or customer data. Notes are committed to git.
- Delete or correct notes that turn out to be wrong.
- Also update [STATUS.md](STATUS.md) when overall project status changes, as before.

### 7.5 CLI fallback (if MCP tools are not connected in your harness)
```
# graph (Windows path; binary: %LOCALAPPDATA%\Programs\codebase-memory-mcp\codebase-memory-mcp.exe)
codebase-memory-mcp cli index_status --project C-Repo-orsquare-odoo
codebase-memory-mcp cli index_repository --repo-path C:\Repo\orsquare-odoo
codebase-memory-mcp cli search_graph --project C-Repo-orsquare-odoo --name-pattern <text>
codebase-memory-mcp cli get_architecture --project C-Repo-orsquare-odoo
# memory
basic-memory tool search-notes "<query>" --project orsquare
basic-memory tool recent-activity --project orsquare
basic-memory tool write-note --title "<title>" --folder <folder> --project orsquare --content "<markdown>"
basic-memory tool edit-note --help
```
If neither MCP nor CLI works, tell the user once, continue with normal file search, and still write checkpoint notes directly as markdown files in `docs/memory/<folder>/`.

---

## 8. Mirror Rule: `AGENTS.md` and `CLAUDE.md` are identical

[`AGENTS.md`](AGENTS.md) (Codex and most agents) and [`CLAUDE.md`](CLAUDE.md) (Claude Code) must be **byte-for-byte identical**.
- Any change to either file MUST be made to both in the same change.
- After editing one, run `powershell -File scripts/sync-agent-files.ps1` (copies the file you edited over the other). A pre-commit hook (`.githooks/pre-commit`, enabled with `git config core.hooksPath .githooks`) blocks commits where they differ.
- Never let the two files drift, and never put agent-specific rules in only one of them.
