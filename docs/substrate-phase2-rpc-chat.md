# Substrate Phase 2 — RPC chat (flagged)

Phase 2 adds a minimal Effect Schema / typed RPC surface and a client-runtime
connection supervisor so the workbench can talk to the Phase 1 shadow server
over a JSON WebSocket at `/rpc`. Product chat stays on the in-process assistant
runtime (`ws://127.0.0.1:3773`) unless both flags below are enabled.

## Flags

| Flag | Env | Default |
| --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER=1` | **off** |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT=1` | **off** |

Both must be on for the workbench adapter to use the substrate client. Primary
chat is not flipped.

Optional:

- `COZEA_SUBSTRATE_SHADOW_HOST` / `COZEA_SUBSTRATE_SHADOW_PORT` (default `127.0.0.1:4783`)
- `COZEA_ASSISTANT_RUNTIME_HTTP_ORIGIN` (default `http://127.0.0.1:3773`) — thin bridge probe
- `VITE_COZEA_SUBSTRATE_RPC_CHAT=1` — renderer visibility of the flag in Vite builds
- `VITE_COZEA_SUBSTRATE_SHADOW_URL` — override shadow HTTP base URL in the renderer

## Packages

- `packages/contracts` (`@cozea/contracts`) — Effect Schema + `RpcGroup` for `health`, `chat.send`, `chat.subscribe`
- `packages/client-runtime` (`@cozea/client-runtime`) — `ConnectionSupervisor` + `SubstrateChatClient`

## Wire protocol

WebSocket: `ws://127.0.0.1:4783/rpc`

```json
{ "type": "req", "id": "1", "method": "health", "payload": {} }
{ "type": "res", "id": "1", "ok": true, "result": { "ok": true, "role": "shadow", "phase": 2, "...": "..." } }

{ "type": "req", "id": "2", "method": "chat.send", "payload": { "text": "hello" } }
{ "type": "res", "id": "2", "ok": true, "result": { "turnId": "...", "mode": "echo", "accepted": true } }

{ "type": "req", "id": "3", "method": "chat.subscribe", "payload": { "turnId": "..." } }
{ "type": "event", "id": "3", "event": { "_tag": "delta", "text": "..." } }
{ "type": "done", "id": "3" }
```

## Bridge behavior

`health` and `chat.send` probe `GET {assistantOrigin}/__cozea/ready`.

- If reachable → `mode: "bridged"` (still echoes text; **TODO(phase3): real providers**)
- If unreachable → `mode: "echo"` stub

This is intentionally a thin bridge, not a rewrite of Claude/Codex/OpenCode/Cursor drivers.

## Workbench adapter

`src/substrate/rpcChatAdapter.ts` + `useSubstrateRpcChat` on the assistant tile
controller. When the flag is off, behavior is unchanged.

## Smoke

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=1 COZEA_SUBSTRATE_RPC_CHAT=1 \
  bun run scripts/smoke-substrate-rpc-chat.mjs
```

Or with the app:

```bash
COZEA_SUBSTRATE_SHADOW_SERVER=1 COZEA_SUBSTRATE_RPC_CHAT=1 bun run dev
```

## Exit criteria

- [x] Contracts package for health / chat.send / chat.subscribe
- [x] Client-runtime supervisor + chat client
- [x] Shadow server `/rpc` WS (flagged)
- [x] Flag default off; workbench adapter gated
- [x] Connect + ready smoke tests
- [ ] Competitive provider chat (Phase 3)

## Layout

- `packages/contracts/`
- `packages/client-runtime/`
- `electron/substrate-shadow-server/rpcChat.ts`
- `src/substrate/`
- Upstream pin: `docs/substrate-t3-pin.md`
- Phase 1: `docs/substrate-shadow-server.md`
