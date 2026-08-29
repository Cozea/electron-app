# Desktop shell (`@cozea/desktop`)

The Cozea Electron desktop application lives in this workspace package.

| Concern | Location |
| --- | --- |
| Electron main / preload | `electron/` |
| Renderer (React workbench) | `src/` |
| Static assets | `public/` |
| Substrate server package | `../server/` (`@cozea/server`) |
| Shadow child entry | `electron/substrate-shadow-server/child.ts` → `@cozea/server` |
| Build | `electron.vite.config.ts`, `"main": "out/main/index.js"` |

## Package manager

Cozea uses **Bun** for the monorepo (`bun install`, `bun run dev`). The vendored upstream tree under `vendor/t3code/` keeps its own **pnpm** / `vp` toolchain and is not merged into the Bun workspace.

For a fresh checkout, use `bun run bootstrap`. It initializes the direct T3
submodule and builds the assistant server without installing pnpm globally.
Normal `bun run dev` calls the same idempotent preparation step and does no
vendor work when the pinned bundle is already ready. Never initialize the T3
submodule recursively.

## Running locally

From the repository root:

```bash
bun run bootstrap
bun run dev
```

Or from this package:

```bash
bun run dev
```

## Substrate flags (all default **on**)

See `docs/substrate-cutover-checklist.md`. Opt out with `COZEA_SUBSTRATE_*=0`.

When primary mode is on, the shadow child hosts vendored T3 `@cozea/server` on loopback; main probes readiness and exposes orchestration over shadow RPC at `ws://127.0.0.1:4783/rpc`.

## Related packages

- `@cozea/server` — substrate server bootstrap (shadow HTTP + RPC)
- `@cozea/substrate-contracts` → `@cozea/contracts`
- `@cozea/substrate-client-runtime` → `@cozea/client-runtime`
