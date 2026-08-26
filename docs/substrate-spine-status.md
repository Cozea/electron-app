# Substrate spine status (Phases 0–7)

Last updated: 2026-08-26

| Phase | Status | Branch / PR | Notes |
| --- | --- | --- | --- |
| 0 Inventories | Done (docs) | #74 / #78 | IPC/store/gap inventories + pin |
| 1 Shadow server | Done | #85 | Flagged spawn on :4783 |
| 2 RPC chat | Done (PR) | #89 / `cursor/substrate-phase2-rpc-chat-a002` | Contracts + client-runtime + flagged `/rpc` chat |
| 3 Providers | Done (PR) | #88 / `cursor/substrate-phase3-providers-02bb` | Driver registry; OpenCode full + legacy adapters |
| 4 VCS 4a–4e | Done (PR) | #87 / `cursor/substrate-phase4-vcs-a002` | VcsDriver + push-safety + invalidate |
| 5 Shrink main | Scaffolded | #86 / this branch | `primary` skips in-process runtime; IPC allowlist |
| 6 Obs / remote | Scaffolded | #86 / this branch | Remote env stubs; NDJSON flag (Track E) |
| 7 Monorepo | Scaffolded | #86 / this branch | `@cozea/substrate-contracts` + `client-runtime` packages |

All substrate flags default **off**. See `docs/substrate-phases-5-7.md` and `docs/substrate-shadow-server.md`.
