---
title: AI tooling setup
type: note
permalink: orsquare/decisions/ai-tooling-setup
---

# AI tooling setup
Decision 2026-10-07: use codebase-memory-mcp (code graph) plus Basic Memory (decisions) as the shared AI knowledge layer.
## Why
Different AI workers kept misunderstanding the codebase; hand-written function docs go stale and cost tokens.
## Rules
See docs/ai-knowledge-tools.md. Graph = what exists. Memory = why and rules.