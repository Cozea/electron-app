# Substrate spine status (Phases 0–7)

Last updated: 2026-08-26 (completion branch — **DONE**)

| Phase | Status | Branch / PR | Notes |
| --- | --- | --- | --- |
| 0 Inventories | Done (docs) | #74 / #78 | IPC/store/gap inventories + pin |
| 1 Shadow server | **Done** | #85 / this branch | Default-on spawn on :4783; obs start/ready spans |
| 2 RPC chat | **Done** | #89 / this branch | `/rpc` + assistant WS bridge (`assistantWsBridge.ts`) |
| 3 Providers | **Done** | #88 / this branch | Codex CLI + optional deep probe; RPC provider routing |
| 4 VCS 4a–4e | **Done** | #87 / this branch | Agent `vcs.*` WS + GitVcsDriver; collab invalidate wired |
| 5 Shrink main | **Done** | this branch | Primary shadow runs assistant runtime; workbench RPC transport |
| 6 Obs / remote | **Done** | this branch | NDJSON + OTLP export (default collector URL) |
| 7 Monorepo | **Done** | this branch | `@cozea/substrate-*` re-exports; `apps/desktop/README.md` |

All substrate flags default **on**. Opt out with `COZEA_SUBSTRATE_*=0` — see `docs/substrate-phases-complete.md`.

PR: **#90** on `cursor/substrate-phases-complete-a002`.

### Remaining follow-ons (not blocking spine)

- `VcsStatusBroadcaster.streamStatus` (replace GitChangesBroadcaster poll)
- Checkpoint stack consolidation / delete `gitCheckpoints` worker (4b)
- Bun vs pnpm/`vp` monorepo tooling decision
