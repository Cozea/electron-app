# Substrate spine complete (Phases 1–7)

Branch: `cursor/substrate-phases-complete-a002`

This branch completes the substrate spine end-to-end while **all flags remain default OFF**.

## Flag matrix (full stack)

| Flag | Env | Default | Role |
| --- | --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER` | off | Spawn shadow HTTP/WS on `:4783` |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT` | off | `/rpc` chat WS on the shadow server |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS` | off | Route `chat.send` through ProviderDriver registry |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS` | off | VcsDriver facade + checkpoint stubs |
| `cozea.substrate.primary` | `COZEA_SUBSTRATE_PRIMARY` | off | Skip in-process assistant; shadow is primary |
| `cozea.obs.ndjson` | `COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON` | off | NDJSON span writer |
| Codex deep probe | `COZEA_SUBSTRATE_CODEX_DEEP_PROBE` | off | App-server skills discovery on Codex driver |

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
| 2 RPC chat | `attachRpcChat` on `/rpc`; real assistant WS bridge when primary or provider fallback |
| 3 Providers | When `PROVIDERS=1`, `chat.send` materializes drivers via `bootstrapSubstrateProviderRegistry`; Codex deep probe optional |
| 4 VCS | `bootstrapSubstrateVcs()` + `registerSubstrateVcsIpcHandlers`; renderer `src/substrate/vcsClient.ts`; collab paths call `invalidateVcsStatus` |
| 5 Primary | Shadow child starts assistant runtime on `:3773`; main skips in-process runtime; workbench uses shadow RPC |
| 6 Obs | `electron/substrate/obs` NDJSON writer; spans for shadow, rpc, provider materialize |
| 7 Monorepo | `@cozea/substrate-contracts` / `@cozea/substrate-client-runtime` re-export canonical packages; `apps/desktop/README.md` |

## Package re-exports (Phase 7)

| Public name | Implementation |
| --- | --- |
| `@cozea/substrate-contracts` | Re-exports `@cozea/contracts` (`packages/substrate-contracts`) |
| `@cozea/substrate-client-runtime` | Re-exports `@cozea/client-runtime` (`packages/substrate-client-runtime`) |

Prefer the `substrate-*` import path in new code; existing `@cozea/contracts` /
`@cozea/client-runtime` imports remain valid.

Root `package.json` workspaces include `packages/substrate-*` alongside `packages/*`.

## VCS cutover surface

When `COZEA_SUBSTRATE_VCS=1`:

- IPC: `substrate:vcs:invalidate`, alias `substrate:vcs:invalidateStatus`, `substrate:vcs:capabilities`
- Preload: `desktopBridge.substrateVcs.invalidate` / `getCapabilities`
- Collab overlay (`registerWorkspaceSyncHandlers`) already calls `invalidateVcsStatus` on cwd mutations

GitCore is retained until agent paths fully migrate to `vcs.*`.

## Remaining follow-ons

- Default-on product flip (all env flags still off)
- Full GitCore deletion after agent `vcs.*` cutover
- Track E OTLP export (`COZEA_OTLP_ENDPOINT` with NDJSON)
- Bun vs pnpm/`vp` monorepo tooling decision

See also: `docs/substrate-spine-status.md`, per-phase docs under `docs/substrate-*.md`.
