# AI Knowledge Tools (code graph + decision memory)

Two MCP tools give every AI agent (Claude Code, Codex, Cursor, others) precise project knowledge without reading whole files. Set up 2026-10-07.

| Tool | Answers | Store | License |
|---|---|---|---|
| **codebase-memory-mcp** v0.11.0 | What exists, who calls what, data flow, impact of a change | Local graph DB in `~/.cache/codebase-memory-mcp` (rebuildable, not committed) | MIT |
| **Basic Memory** v0.23.2 | Why decisions were made, business rules, gotchas | Plain markdown in [`docs/memory/`](memory/) (committed to git) | AGPL-3.0 (used as a local tool only) |

Project name in the graph: `C-Repo-orsquare-odoo`. Basic Memory project: `orsquare`.

## Rules for any AI agent

1. **Code questions → graph first, files last.** Use `search_graph`, `trace_path` / call tracing, `get_architecture`, `get_code_snippet`; read a whole file only when you must edit it.
2. **Before changing a function or model → run impact analysis** (callers, tests that cover it).
3. **Before starting work → search memory** (`search_notes`) for the area you touch.
4. **After a decision, a bug root cause, or a business rule is learned → write a note** (`write_note`) in `docs/memory/`. One topic per note, plain language, include the *why*.
5. Never record what code already states (signatures, field lists). Record intent, rules, and traps.
6. Memory notes are shared in git: never put secrets or customer data in them.

## Setup on a new machine

Config files already in the repo: [`.mcp.json`](../.mcp.json) (Claude Code and compatible), [`.cursor/mcp.json`](../.cursor/mcp.json) (Cursor).

1. Install `uv` (https://docs.astral.sh/uv/).
2. Basic Memory:
   ```
   uv tool install basic-memory --prerelease=allow
   basic-memory project add orsquare <repo>\docs\memory --default
   ```
3. Graph tool: download `codebase-memory-mcp-windows-amd64.zip` from the official GitHub releases (https://github.com/DeusData/codebase-memory-mcp/releases), verify it against `checksums.txt`, extract into `%LOCALAPPDATA%\Programs\codebase-memory-mcp\`.
4. Index once: `codebase-memory-mcp cli index_repository --repo-path <repo>`. After that the background watcher (`auto_watch`, on by default) re-indexes on file changes.
5. **Codex** reads only user-level config. Add to `~/.codex/config.toml`:
   ```toml
   [mcp_servers.codebase-memory]
   command = "C:\\Users\\<you>\\AppData\\Local\\Programs\\codebase-memory-mcp\\codebase-memory-mcp.exe"

   [mcp_servers.basic-memory]
   command = "uvx"
   args = ["--prerelease=allow", "basic-memory", "mcp"]
   ```
6. Restart the agent. Claude Code asks once to approve the project's MCP servers.

## Known limits (verified 2026-10-07)

- Odoo **XML** (views, security, data files) is **not** indexed. Python and TypeScript are. For XML, search with grep or read the file.
- Five large TSX files parse partially (`ProductForm`, `ProductImport`, `AccountLedgerView`, `LedgerPage`, `PurchasesPage`); a few constructs may be missing from the graph.
- Binary is unsigned third-party software; upgrade deliberately (re-verify checksum), do not auto-update.
- Token-saving figures published by the tools are their own claims, not measured here.

## Maintenance

- Graph is disposable: delete the cache and re-run the index command to rebuild.
- Memory notes are reviewed like code (they are in git). Prune notes that become wrong.
