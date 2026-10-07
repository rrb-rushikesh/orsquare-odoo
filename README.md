# ORSquare (OR²)

Retail software for bottle and beverage counters, using Odoo 18 Community as the accounting, tax and stock authority. React serves the retailer app; Astro serves the separate public site.

**The product is incomplete.** The Odoo backend, the governance layer (roles, server-side permissions, two-step sign-in, plans) and the Developer Console are built and tested. The original retailer screens have been restored and only partially connected to Odoo. A few successful local flows do not establish full product readiness.

Read [STATUS.md](STATUS.md) first, then the pick-up guide [docs/HANDOFF.md](docs/HANDOFF.md) (what exists, what is left, traps), then [context.md](context.md), [AGENTS.md](AGENTS.md), [frontend/DESIGN.md](frontend/DESIGN.md), and the relevant [architecture](docs/backend-architecture.md), [decisions](docs/backend-decisions.md) and [runbook](docs/operations-runbook.md). Preserve the original UI and design system.

## Local development

PowerShell, with Docker Desktop running:

```powershell
Set-Location scratch/odoo18-spike
docker compose up -d
Set-Location ../../frontend
npm ci
npm run dev
```

The development frontend is at `http://127.0.0.1:5173`; Vite proxies the API to local Odoo at port 8088. Use an existing provisioned test shop. Backend proof/provisioning scripts require Git Bash; see the runbook before running them. Do not run wipe/drop commands on a working shop.

```powershell
# From frontend/
npm run build
npm test
# Backend (Git Bash, Docker running): shop suite and platform suite
bash scripts/run_tests.sh /orsquare orsquare_dev
bash scripts/run_platform_tests.sh
# From landing/
$env:PUBLIC_APP_URL = 'https://app.orsquare.com/login'
npm run check
```

## Layout

| Path | Purpose |
| --- | --- |
| `addons/orsquare/` | Native Odoo shop services, governance (API gate, change log, two-step sign-in), controllers, security and tests |
| `addons/orsquare_platform/` | Platform backend: fleet registry, plans, operators, provisioning, audit (Developer Console backend) |
| `frontend/` | Original retailer UI with Odoo adapters, offline/realtime foundation, and the Developer Console (`/dev`) |
| `landing/` | Separate static Astro public site |
| `deploy/` | Deployment templates; full production environment is not verified |
| `docs/` | Requirements, architecture, decisions, API reference and recorded evidence |
| `scripts/` | Test, provisioning, benchmark and gateway/realtime proof tools |
| `scratch/odoo18-spike/` | Local Docker environment and retained architecture proof harnesses |
