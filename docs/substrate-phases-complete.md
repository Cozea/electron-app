# Substrate spine complete (Phases 1–7)

Branch: `cursor/substrate-phases-complete-a002`

End-to-end substrate spine with **all flags default ON** and Phase 4 consolidation (4a–4e).

## Flag matrix

| Flag | Env | Default |
| --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER` | **on** |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT` | **on** |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS` | **on** |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS` | **on** |
| `cozea.substrate.primary` | `COZEA_SUBSTRATE_PRIMARY` | **on** |
| `cozea.obs.ndjson` | `COZEA_OBS_NDJSON` | **on** |
| Codex deep probe | `COZEA_SUBSTRATE_CODEX_DEEP_PROBE` | **on** |

Opt out with `COZEA_SUBSTRATE_*=0`.

## Phase 4 consolidation (4a–4e)

| Sub-phase | Status |
| --- | --- |
| **4a** Agent `vcs.*` | WS + `NativeApi.vcs`; agent git ops route through `GitVcsDriver` when VCS on |
| **4b** One checkpoint owner | Forked `checkpoint-worker` **removed**; in-process ops via `inProcessCheckpointOps.ts` |
| **4c** One status stream | `VcsStatusBroadcaster` replaces 10s poll; event-driven invalidation |
| **4d** Collab overlay | All cwd-mutating `workspaceSync:git*` handlers invalidate status; collab push uses push-safety |
| **4e** Worktree orphan | IPC `substrate:vcs:detectOrphanWorktree` + `pruneOrphanWorktree` wired on boot |

Checkpoint refs are unified under `refs/cozea/checkpoints` (legacy `refs/t3/checkpoints` migrated lazily). Changes capture lives in `electron/substrate/vcs/checkpointOps.ts` (replaces `gitCheckpoints.ts`). Codex substrate driver exposes live app-server turns for RPC chat.

GitCore remains the git execution layer behind `GitVcsDriver`.

## Observability

NDJSON + OTLP export (default `http://127.0.0.1:4318/v1/logs`). Disable collector with `COZEA_OTLP_ENDPOINT=0`.

## Remaining follow-ons

- Remote environment stubs (SSH) — placeholders only
- Bun vs pnpm/`vp` monorepo tooling
