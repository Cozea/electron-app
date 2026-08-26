# Substrate cutover checklist

Date: 2026-08-26  
Companion: `docs/t3code-implementation-plan.md`, `docs/substrate-phases-complete.md`

This checklist separates **spine complete** (infrastructure wired) from **product cutover complete** (users can chat on default flags without legacy workarounds).

---

## Done — spine (Phases 0–7)

- [x] Shadow server spawn + readiness on `:4783`
- [x] Effect RPC contracts + `client-runtime`
- [x] Provider driver registry (OpenCode full; Claude/Codex/Cursor legacy adapters)
- [x] VCS driver + checkpoint consolidation (4a–4e)
- [x] Primary mode relocates in-process runtime to shadow child
- [x] NDJSON / OTLP observability
- [x] Monorepo `@cozea/substrate-*` re-exports
- [x] All substrate flags default **on**

---

## Done — product cutover (this PR)

- [x] Main process probes `:3773` when primary skips in-process boot and reports `assistantRuntime.phase === "ready"`
- [x] Workbench composer/model picker/send use `isChatReady` (not legacy-only `isRuntimeReady`)
- [x] Chat send prefers full orchestration path when runtime is reachable; substrate RPC is fallback only
- [x] RPC `chat.send` accepts optional `modelSelection` for bridge fallback turns
- [x] Smoke script accepts phase 2 **or** 3 ready payloads (default-on flags)
- [x] Provider fallback vitest is deterministic (`primaryEnabled: false` in bridge-unavailable case)

---

## Remaining — full T3 body (post-cutover)

These are **intentionally deferred** per the implementation plan. They are not blockers for “chat works on default flags.”

### Execution engine

- [ ] Land full upstream T3 `apps/server` DDD body behind shadow readiness contract
- [ ] Delete `electron/assistant-runtime/` boot from shadow child (runtime lives in T3 server only)
- [ ] Remove `assistantWsBridge` once RPC orchestration is native

### Providers

- [ ] Native substrate drivers for Claude, Codex (deep session runtime), Cursor — drop `legacy-adapter`
- [ ] Provider picker/status/skills/slash parity on substrate path without WS bridge

### Workbench orchestration over RPC

- [ ] Stream domain events / projections over RPC (stop renderer-side folding for substrate sessions)
- [ ] Approvals, diffs, checkpoints, image attachments over substrate RPC (not bridge)
- [ ] Thread settings flush + `/model` slash over RPC payload

### Remote / monorepo

- [ ] SSH/WSL remote environment catalog (stubs exist)
- [ ] Split `apps/desktop` + `apps/server`; Bun vs pnpm/`vp` decision (Phase 7 blast radius)

### Parallel product tracks (optional, not spine)

- [ ] Command palette (Track A)
- [ ] Thread deletion reactor + orphan worktree prompts (Track B)
- [ ] Agent browser automation MVP (Track C)
- [ ] Connection/sync status UX (Track D)

---

## Verification commands

```shell
bun run typecheck
bun run lint
bun test tests/substrate
bun test tests/electron/substrateDefaultBoot.test.ts
node scripts/smoke-substrate-rpc-chat.mjs
```

Default-on manual smoke (Electron):

```shell
bun run dev
# Open workbench agent tile → composer enabled → type + send → assistant reply
```

Opt-out legacy path (debug only):

```shell
COZEA_SUBSTRATE_PRIMARY=0 bun run dev
```

---

## Definition of done (product)

1. Default flags on, fresh boot, agent tile composer is enabled within ~90s
2. Send uses orchestration (`thread.turn.start`) when `:3773` is ready
3. Model picker changes persist and affect the next turn
4. Substrate RPC path remains as fallback when runtime is unreachable
5. No `COZEA_SUBSTRATE_PRIMARY=0` required for normal chat
