# Desktop shell (`apps/desktop`)

The Cozea Electron desktop application is the **`apps/desktop` monorepo target** for
Phase 7 substrate work. Source for the shell lives at the repository root today:

| Concern | Location |
| --- | --- |
| Electron main / preload | `electron/` |
| Renderer (React workbench) | `src/` |
| Substrate server package | `apps/server/` (`@cozea/server`) |
| Shadow child entry | `electron/substrate-shadow-server/child.ts` → `@cozea/server` |
| Build entry | `electron.vite.config.ts`, `package.json` `"main": "out/main/index.js"` |

## Running locally

```bash
bun install
bun run dev
```

## Substrate flags (all default **on**)

See `docs/substrate-cutover-checklist.md`. Opt out with `COZEA_SUBSTRATE_*=0`.

When primary mode is on, `@cozea/server` starts the assistant runtime on
`ws://127.0.0.1:3773` inside the shadow child; main probes readiness and exposes
orchestration over shadow RPC at `ws://127.0.0.1:4783/rpc`.

## Packages

- `@cozea/server` — substrate server bootstrap (shadow HTTP + RPC + runtime)
- `@cozea/substrate-contracts` → `@cozea/contracts`
- `@cozea/substrate-client-runtime` → `@cozea/client-runtime` (+ orchestration client)
