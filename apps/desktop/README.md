# Desktop shell (`apps/desktop`)

The Cozea Electron desktop application is the **`apps/desktop` monorepo target** for
Phase 7 substrate work. Source for the shell lives at the repository root today:

| Concern | Location |
| --- | --- |
| Electron main / preload | `electron/` |
| Renderer (React workbench) | `src/` |
| Shadow substrate child | `electron/substrate-shadow-server/` |
| Build entry | `electron.vite.config.ts`, `package.json` `"main": "out/main/index.js"` |

## Running locally

```bash
bun install
bun run dev
```

## Substrate flags (all default **off**)

See `docs/substrate-phases-complete.md` for the full flag matrix. Typical dev stack:

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=1 \
COZEA_SUBSTRATE_RPC_CHAT=1 \
COZEA_SUBSTRATE_PRIMARY=1 \
  bun run dev
```

When `COZEA_SUBSTRATE_PRIMARY=1`, the shadow child process starts the assistant
runtime on `ws://127.0.0.1:3773` and the main process skips the in-process copy.

## Packages

Renderer and shadow code consume substrate contracts via:

- `@cozea/substrate-contracts` → re-exports `@cozea/contracts`
- `@cozea/substrate-client-runtime` → re-exports `@cozea/client-runtime`

Implementations remain in `packages/contracts` and `packages/client-runtime`; the
`substrate-*` packages are the canonical import path for new desktop code.
