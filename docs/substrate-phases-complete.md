# Substrate spine complete (Phases 1–7)

Branch: `cursor/substrate-phases-complete-a002`

This branch deepens the merged Phase 1–7 scaffolding so the spine is wired
end-to-end while **all flags remain default OFF**.

## Flag matrix (full stack)

| Flag | Env | Default | Role |
| --- | --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER` | off | Spawn shadow HTTP/WS on `:4783` |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT` | off | `/rpc` chat WS on the shadow server |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS` | off | Route `chat.send` through ProviderDriver registry |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS` | off | VcsDriver facade + checkpoint stubs |
| `cozea.substrate.primary` | `COZEA_SUBSTRATE_PRIMARY` | off | Skip in-process assistant; shadow is primary |
| `cozea.obs.ndjson` | `COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON` | off | NDJSON span writer |

### Enable the full stack

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=1 \
COZEA_SUBSTRATE_RPC_CHAT=1 \
COZEA_SUBSTRATE_PROVIDERS=1 \
COZEA_SUBSTRATE_VCS=1 \
COZEA_SUBSTRATE_PRIMARY=1 \
COZEA_OBS_NDJSON=1 \
  bun run dev
```

Optional: `COZEA_OBS_NDJSON_PATH=/tmp/cozea-substrate-obs.ndjson` to pin the
span file (otherwise a temp default is used).

## How phases are wired

| Phase | Wiring |
| --- | --- |
| 1 Shadow | `ShadowServerManager` forks `electron/substrate-shadow-server/child.ts` |
| 2 RPC chat | `attachRpcChat` on `/rpc`; echo/bridge when providers off |
| 3 Providers | When `PROVIDERS=1`, `chat.send` materializes OpenCode (or legacy adapters) via `bootstrapSubstrateProviderRegistry`; falls back to echo/bridge on failure |
| 4 VCS | `bootstrapSubstrateVcs()` from Electron main boot **and** `registerWorkspaceSyncHandlers` (idempotent) |
| 5 Primary | `shouldStartInProcessAssistantRuntime` → false when primary+shadow; status IPC `features.inProcessAssistant: false`; shadow still starts |
| 6 Obs | `electron/substrate/obs` NDJSON writer; spans for shadow start/ready, rpc send accepted, provider materialize; `features.obsNdjson` on status |
| 7 Packages | `@cozea/substrate-contracts` / `@cozea/substrate-client-runtime` re-export `@cozea/contracts` / `@cozea/client-runtime` (canonical names; implementations stay in the older packages) |

## Remaining follow-ons

- Codex **full** substrate driver + session-runtime deep parity (still legacy adapter)
- Full GitCore deletion / `vcs.*` agent cutover (Phase 4a later)
- Product chat UI cutover off in-process assistant (primary path still flagged)
- Track E OTLP export (optional)
- Bun vs pnpm/`vp` monorepo tooling decision

See also: `docs/substrate-spine-status.md`, per-phase docs under `docs/substrate-*.md`.
