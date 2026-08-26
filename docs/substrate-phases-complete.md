# Substrate spine complete (Phases 1–7)

Branch: `cursor/substrate-phases-complete-a002`

This branch completes the substrate spine end-to-end with **all flags default ON**.

## Flag matrix (full stack)

| Flag | Env | Default | Role |
| --- | --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER` | **on** | Spawn shadow HTTP/WS on `:4783` |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT` | **on** | `/rpc` chat WS on the shadow server |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS` | **on** | Route `chat.send` through ProviderDriver registry |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS` | **on** | VcsDriver on agent `vcs.*` WS paths |
| `cozea.substrate.primary` | `COZEA_SUBSTRATE_PRIMARY` | **on** | Skip in-process assistant; shadow is primary |
| `cozea.obs.ndjson` | `COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON` | **on** | NDJSON span writer + OTLP export |
| Codex deep probe | `COZEA_SUBSTRATE_CODEX_DEEP_PROBE` | off | App-server skills discovery on Codex driver |

Set any flag to `0` to opt out. Example legacy in-process boot:

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=0 \
COZEA_SUBSTRATE_RPC_CHAT=0 \
COZEA_SUBSTRATE_PROVIDERS=0 \
COZEA_SUBSTRATE_VCS=0 \
COZEA_SUBSTRATE_PRIMARY=0 \
COZEA_OBS_NDJSON=0 \
  bun run dev
```

Optional: `COZEA_OBS_NDJSON_PATH=/tmp/cozea-substrate-obs.ndjson` to pin the
span file (otherwise a temp default is used).

## Observability / OTLP

When `cozea.obs.ndjson` is on (default), spans are written locally **and** exported
to OTLP HTTP logs at `COZEA_OTLP_ENDPOINT` (default `http://127.0.0.1:4318/v1/logs`).
Set `COZEA_OTLP_ENDPOINT=0` to disable collector export while keeping NDJSON.

## How phases are wired

| Phase | Wiring |
| --- | --- |
| 1 Shadow | `ShadowServerManager` forks `electron/substrate-shadow-server/child.ts` |
| 2 RPC chat | `attachRpcChat` on `/rpc`; real assistant WS bridge when primary or provider fallback |
| 3 Providers | `chat.send` materializes drivers via `bootstrapSubstrateProviderRegistry`; Codex deep probe optional |
| 4 VCS | Agent WS `vcs.*` (git.* deprecated aliases); `GitVcsDriver` adapter; collab `invalidateVcsStatus` |
| 5 Primary | Shadow child starts assistant runtime on `:3773`; main skips in-process runtime; workbench uses shadow RPC |
| 6 Obs | NDJSON writer + OTLP export in `electron/substrate/obs` |
| 7 Monorepo | `@cozea/substrate-contracts` / `@cozea/substrate-client-runtime` re-export canonical packages |

## VCS cutover surface

Agent WS methods prefer `vcs.*` (`vcs.status`, `vcs.pull`, …). Legacy `git.*`
methods remain as aliases. Renderer `NativeApi.vcs` is canonical; `NativeApi.git`
delegates to the same implementation.

- IPC: `substrate:vcs:invalidate`, `substrate:vcs:invalidateStatus`, `substrate:vcs:capabilities`
- Collab overlay calls `invalidateVcsStatus` on cwd mutations
- GitCore remains the implementation layer behind `GitVcsDriver` until checkpoint consolidation (4b)

## Remaining follow-ons

- `VcsStatusBroadcaster.streamStatus` to replace GitChangesBroadcaster poll (4c)
- Checkpoint stack consolidation / delete `gitCheckpoints` worker (4b)
- Bun vs pnpm/`vp` monorepo tooling decision

See also: `docs/substrate-spine-status.md`, per-phase docs under `docs/substrate-*.md`.
