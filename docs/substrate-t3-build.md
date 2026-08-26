# T3 vendor build boundary

Date: 2026-08-26  
Pin: `docs/substrate-t3-pin.md` (`a3a8cbd6`)

This document describes how Cozea runs upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) during the T3 server import epic (Phase T0–T8).

## Layout

| Path | Role |
| --- | --- |
| `vendor/t3code` | Git submodule @ pinned SHA |
| `scripts/vendor/sync-t3code-pin.mjs` | Detach-checkout vendor at pin |
| `scripts/vendor/sync-t3-contracts.mjs` | Sync T3 contract groups → `packages/contracts/src/t3/` |
| `scripts/spike-t3-server-boot.mjs` | Phase T0 boot spike (no Electron) |
| `scripts/spike-t3-rpc-get-config.ts` | Effect RPC probe (copied into vendor during spike) |
| `apps/server/` | Cozea wrapper (shadow child bootstrap today; T3 body in T1+) |

## Package managers

| Area | Tool | Notes |
| --- | --- | --- |
| Cozea repo root | **Bun** | `bun install`, `bun run typecheck`, Electron/Vite |
| `vendor/t3code` | **pnpm** (+ `vp` / vite-plus) | Upstream monorepo; do not convert to Bun in T0 |

T3 `apps/server` requires **Node.js >= 22.16** (or >= 23.11 or >= 24) for `node:sqlite` APIs used by persistence.

## Boot spike (Phase T0)

```shell
# One-time / CI: vendor install + server bundle
cd vendor/t3code
pnpm install --frozen-lockfile
pnpm --filter t3 build:bundle

# From Cozea root (reuse bundle with COZEA_T3_SPIKE_SKIP_BUILD=1)
node scripts/spike-t3-server-boot.mjs
```

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `COZEA_T3_SPIKE_SKIP_BUILD=1` | Skip pnpm install/build when `apps/server/dist/bin.mjs` exists |
| `COZEA_T3_SPIKE_PORT` | Fixed port (default `13773`) |
| `COZEA_T3_SPIKE_HOST` | Bind host (default `127.0.0.1`) |

Spike checks:

1. Submodule SHA matches pin
2. `GET /.well-known/t3/environment`
3. OAuth bootstrap + websocket ticket
4. `server.getConfig` over Effect RPC → provider count

## CI

CircleCI job `t3_vendor_spike` runs the spike on Linux after submodule checkout. It installs pnpm via corepack and uses Node 22.x (see `.circleci/config.yml`).

## Updating the pin

1. Choose upstream SHA on `pingdotgg/t3code`
2. Update `docs/substrate-t3-pin.md` and `electron/substrate/constants.ts` (`SUBSTRATE_T3_PIN_SHA`)
3. Run `node scripts/vendor/sync-t3code-pin.mjs`
4. Run `node scripts/vendor/sync-t3-contracts.mjs`
5. Re-run `node scripts/spike-t3-server-boot.mjs` and `bun scripts/smoke-t3-server.mjs`
6. Commit `.gitmodules`, submodule gitlink, pin docs, synced contracts, and any wrapper changes
