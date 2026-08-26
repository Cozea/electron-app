# Substrate spine status (Phases 0–7)

Last updated: 2026-08-26 (completion branch — **DONE**)

| Phase | Status | Branch / PR | Notes |
| --- | --- | --- | --- |
| 0 Inventories | Done (docs) | #74 / #78 | IPC/store/gap inventories + pin |
| 1 Shadow server | **Done** | #85 / this branch | Flagged spawn on :4783; obs start/ready spans |
| 2 RPC chat | **Done** | #89 / this branch | `/rpc` + assistant WS bridge (`assistantWsBridge.ts`) |
| 3 Providers | **Done** | #88 / this branch | Codex CLI + optional deep probe; RPC provider routing |
| 4 VCS 4a–4e | **Done (scaffold)** | #87 / this branch | IPC + renderer client; collab invalidate wired; GitCore retained |
| 5 Shrink main | **Done** | this branch | Primary shadow runs assistant runtime; workbench RPC transport |
| 6 Obs / remote | **Done** | this branch | NDJSON writer; remote env stubs |
| 7 Monorepo | **Done** | this branch | `@cozea/substrate-*` re-exports; `apps/desktop/README.md` |

All substrate flags default **off**.

**How to enable full stack** — see `docs/substrate-phases-complete.md`.

### Follow-ons (not blocking spine)

- Default-on product flip (env flags remain off)
- Full GitCore deletion after agent `vcs.*` cutover
- OTLP collector wiring in production ops
