# Substrate cutover checklist

Date: 2026-08-26 (updated)  
Companion: `docs/t3code-implementation-plan.md`, `docs/substrate-phases-complete.md`

---

## ✅ Spine (Phases 0–7)

- [x] Shadow server spawn + readiness on `:4783`
- [x] Effect RPC contracts + `client-runtime`
- [x] Provider driver registry
- [x] VCS driver + checkpoint consolidation (4a–4e)
- [x] Primary mode relocates in-process runtime to shadow child
- [x] NDJSON / OTLP observability
- [x] Monorepo `@cozea/substrate-*` re-exports
- [x] All substrate flags default **on**
- [x] Phase 0 inventories merged (`docs/substrate-*-inventory.md`, gap table)

---

## ✅ Product cutover

- [x] Main probes `:3773` when primary skips in-process boot → reports runtime **ready**
- [x] Workbench composer/model picker/send use `isChatReady`
- [x] Chat send prefers full orchestration when runtime reachable; RPC is fallback
- [x] RPC `chat.send` accepts `modelSelection` for bridged turns
- [x] Smoke script accepts phase 2 or 3; Node-compatible sleep
- [x] Provider fallback vitest deterministic

---

## ✅ Execution engine (Cozea server package)

- [x] `@cozea/server` (`apps/server/`) — T3-shaped bootstrap behind shadow readiness contract
- [x] Shadow child delegates to `bootstrapCozeaSubstrateServer()` (no inline boot logic)
- [x] **Native orchestration RPC** — `orchestration.getSnapshot`, `dispatchCommand`, `getTurnDiff`, `getFullThreadDiff`, `replayEvents`, `orchestration.subscribe`
- [x] `OrchestrationRpcProxy` — persistent WS session to assistant runtime (replaces per-turn bridge in rpcChat)
- [x] `rpcChat` bridged turns use `executeRpcBridgedChatTurn` (not `assistantWsBridge`)
- [ ] **Full upstream T3 `apps/server` DDD import** — deferred; requires `vendor/t3code` submodule at pin SHA
- [ ] **Delete `electron/assistant-runtime/`** — runtime still required; delete after T3 server body replaces engine

---

## ✅ Providers

- [x] OpenCode full substrate driver (registry)
- [x] Codex full driver + live session (`codexLiveSession.ts`)
- [x] **Native Claude driver** (`claudeDriver.ts`) — `implementation: "full"`, live via orchestration RPC
- [x] **Native Cursor driver** (`cursorDriver.ts`) — `implementation: "full"`, live via orchestration RPC
- [x] Legacy adapters removed from default bootstrap (Codex legacy opt-in via `COZEA_SUBSTRATE_CODEX_LEGACY_ADAPTER=1`)
- [ ] OpenCode live CLI probe wiring (stubs remain in default hooks)
- [ ] Codex deep session-runtime parity vs upstream T3 (home layout, multi-instance)

---

## ✅ Workbench orchestration over RPC

- [x] `SubstrateOrchestrationClient` in `@cozea/client-runtime`
- [x] `useSubstrateOrchestrationSync` — domain events over RPC when substrate-primary active
- [x] Orchestration RPC supports approvals/diffs/checkpoints via `dispatchCommand` + `getTurnDiff` (same commands as WS)
- [ ] Renderer fully stops WS orchestration when substrate-primary (dual WS+RPC today — WS still works on `:3773`)
- [ ] Image attachments over substrate RPC fallback path

---

## ✅ Remote / monorepo

- [x] Remote env catalog probes SSH config + WSL availability (ready flags honest)
- [x] `apps/server` workspace package added
- [x] `apps/desktop/README.md` — desktop app lives at repo root today; physical move deferred
- [ ] SSH/WSL **backend pool** (spawn remote shadow instances)
- [ ] Physical split `electron/` → `apps/desktop`, full Bun vs pnpm/`vp` decision

---

## ✅ Parallel product tracks

- [x] **Track A** — Command palette + keybindings (`cozea.palette.enabled`)
- [x] **Track B** — Thread deletion reactor + orphan worktree prompts
- [x] **Track C** — Agent browser automation MVP (flagged, default off)
- [x] **Track D** — Connection/sync status UX (transport vs data-sync vs git-remote)
- [x] **Track E** — NDJSON obs (substrate spine; merged with phases)

---

## Remaining (requires upstream T3 vendor import)

1. [x] Add `vendor/t3code` submodule at `a3a8cbd6` + boot spike (`scripts/spike-t3-server-boot.mjs`)
2. [x] Phase T1 dual-run — spawn vendored T3 `apps/server` when `COZEA_T3_SERVER=1` (`bun scripts/smoke-t3-server.mjs`)
3. [x] Phase T2 contracts + client-runtime — sync T3 contract groups, `T3OrchestrationClient`, native shell sync when `t3Server: true`
4. [x] Phase T3 orchestration cutover — T3 owns commands when flagged; skip legacy `:3773` boot in shadow child
5. [ ] Delete `electron/assistant-runtime/` after parity
5. [ ] Delete `assistantWsBridge.ts` (kept for unit tests / migration reference)
6. [ ] SQLite userdata migration (`electron/substrate/migrations/t3-orchestration-userdata.ts` — scaffold only)
7. [ ] SSH/WSL DesktopBackendPool
8. [ ] Physical monorepo reshape

See `docs/substrate-t3-server-import-plan.md` (swarm map) and `docs/substrate-t3-build.md`.

---

## Verification

```shell
bun run typecheck
bun run lint
bun test tests/substrate
bun scripts/smoke-substrate-rpc-chat.mjs
bun test tests/src/features/projects/components/command-palette
node scripts/spike-t3-server-boot.mjs   # Phase T0 — vendor T3 server boot (Node >= 22.16)
bun scripts/smoke-t3-server.mjs         # Phase T1 — T3 dual-run orchestration RPC
bunx vitest run tests/substrate/t3OrchestrationCutover.test.ts  # Phase T3 — command API surface
```
