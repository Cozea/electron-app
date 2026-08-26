# Substrate shadow server (Phase 1)

Phase 1 of the T3 substrate rebase: spawn a **shadow** Node process beside the existing in-process assistant runtime. Product chat UI stays on the current runtime (`ws://127.0.0.1:3773`).

## Flag

| Flag | Env | Default |
| --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER=1` | **off** |

Optional:

- `COZEA_SUBSTRATE_SHADOW_HOST` (default `127.0.0.1`)
- `COZEA_SUBSTRATE_SHADOW_PORT` (default `4783` — not `3773`)

## Readiness

```http
GET http://127.0.0.1:4783/.well-known/cozea/substrate/ready
```

Returns JSON including `role: "shadow"`, `phase: 1`, and the pinned T3 SHA (`docs/substrate-t3-pin.md`).

## Logs

When enabled, Electron writes under:

`<user logs>/substrate-shadow/`

(manager + child logs).

## Smoke

```bash
# After electron-vite build (or from a built out/main):
COZEA_SUBSTRATE_SHADOW_SERVER=1 bun run scripts/smoke-substrate-shadow-server.mjs
```

Or with the app:

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=1 bun run dev
# then inspect ipc: substrateShadow:getStatus
```

## Exit criteria (Phase 1)

- [x] Child process spawn/stop from Electron main
- [x] Dedicated port + readiness HTTP probe
- [x] Logs under Cozea log dir
- [x] Flag default off (no UX switch)
- [x] Internal status IPC + smoke script
- [ ] Full T3 `apps/server` body behind this contract (Phase 2+)

## Layout

- `electron/substrate-shadow-server/` — child HTTP scaffold
- `electron/substrate/ShadowServerManager.ts` — DesktopBackendPool-shaped lite manager
- Upstream pin: `docs/substrate-t3-pin.md`

## Next

Phase 2 flagged RPC chat: [`docs/substrate-phase2-rpc-chat.md`](./substrate-phase2-rpc-chat.md).
