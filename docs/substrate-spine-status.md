# Substrate spine status (Phases 0–7)

Last updated: 2026-08-26 — **consolidation complete**

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Inventories | Done | IPC/store/gap inventories + pin |
| 1 Shadow server | Done | Default-on on :4783 |
| 2 RPC chat | Done | `/rpc` + assistant WS bridge |
| 3 Providers | Done | OpenCode full + Codex deep probe default-on |
| 4 VCS 4a–4e | **Done** | In-process checkpoints, status stream, vcs.* agent path |
| 5 Shrink main | Done | Primary shadow runs assistant runtime |
| 6 Obs | Done | NDJSON + OTLP |
| 7 Monorepo | Done | `@cozea/substrate-*` re-exports |

PR: **#90** on `cursor/substrate-phases-complete-a002`.

### Remaining follow-ons

- Remote env stubs (SSH)
