# Cozea ↔ pingdotgg/t3code Upgrade Path

Date: 2026-08-26  
Compared: Cozea `main` (`9b38f024`) vs upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (`a3a8cbd6`)

This is an architecture and migration brief. Cozea forked an **older** T3-shaped runtime and then grew a collaborative IDE product on top. Upstream T3 rewrote the substrate underneath. The goal is **not** to become T3; it is to **rebase the agent/runtime substrate onto modern T3** while keeping Cozea’s product surface.

Related prior notes in-repo: `docs/t3code-updates.md`, `docs/agent-pipeline-restoration-audit.md`.

---

## 1. One-sentence diagnosis

**Cozea’s clunk is mostly structural:** a fat Electron main that both owns OS/product concerns *and* hosts an in-process assistant runtime, talking to the renderer over a hand-rolled WebSocket push bus **plus** ~215 IPC handlers, with Zustand stores re-projecting orchestration state. **Modern T3 is a thin desktop shell around a spawned Node server**, with one typed Effect RPC contract and a shared `client-runtime` for every non-visual client concern.

---

## 2. Shape comparison

| Layer | Cozea today | Upstream T3 today |
| --- | --- | --- |
| Repo shape | Mostly single Electron app (`electron/`, `src/`, `convex/`) | pnpm monorepo: `apps/{server,web,desktop,mobile}` + `packages/*` |
| Execution boundary | Split: Electron IPC world **and** `electron/assistant-runtime` | One: `apps/server` |
| Client ↔ runtime | Custom WS + push bus (`wsServer.ts`, `assistant-wsTransport.ts`) | Effect RPC over `/ws` (`packages/contracts`, `packages/client-runtime`) |
| Desktop role | Fat main (~terminals, git sync, workspaces, Yjs, browsers, runtime) | Thin shell: backend pool, window, SSH/WSL, updates |
| Client state | Many Zustand stores + local projectors | Shared Atom factories in `client-runtime` |
| Providers | Claude / Codex / Cursor / OpenCode (partially backported) | Same + Grok; driver registry + richer snapshots/probes |
| Collab / org | Convex + E2E Yjs + WorkOS-shaped product | Local SQLite env; pairing/auth scopes; remote-ready |
| Observability | Thin / ad-hoc | NDJSON + OTLP spans/metrics |
| Desktop IPC density | **~215** `ipcMain.handle` | **~1** true handle surface (methods are narrow modules) |

### Size signals (order of magnitude)

| Area | Cozea | T3 |
| --- | ---: | ---: |
| Contracts | ~4.2k LOC | ~19.7k LOC |
| Runtime/server | ~46k (`assistant-runtime`) | ~232k (`apps/server/src`) |
| Client non-UI runtime | ad-hoc stores (~6k) | `client-runtime` ~34k |
| ClaudeAdapter | ~3.3k | ~4.7k (+ ~5k tests) |
| CodexSessionRuntime | ~97 | ~2.3k |

Upstream did not just “add features.” It **deepened the same domains** Cozea still carries in thinner/older form.

---

## 3. What T3 does better (the clunk/efficiency gaps)

### 3.1 One execution boundary

T3 rule (from their internals overview): *every provider process, terminal, git op, and filesystem read happens on the server, never in the client.*

Cozea violates that by design today:

- Assistant runtime in-process in Electron main (`electron/assistant-runtime/boot.ts`)
- Workbench terminals via IPC `TerminalService`
- Assistant PTY stack also inside the runtime
- Git split across runtime layers **and** Electron `gitRuntime` / sync services

**Why it feels clunky:** two owners for the same nouns (terminal, git, cwd), crash domains coupled (runtime fault can take the whole desktop), remote/mobile impossible without a rewrite.

### 3.2 Typed Effect RPC streams vs push bus + IPC

T3: `WsRpcGroup` with unary + `stream: true` members (`orchestration.subscribeShell`, `terminal.attach`, …). Auth is **per method**.

Cozea: request/response IDs over a custom WS, broadcast channels (`domainEvent`, `terminalEvent`, …), **and** a large IPC surface for “real” desktop work.

**Why T3 is less brittle:** clients subscribe to what they need; no global fan-out schema coupling; fewer “which bus owns this?” bugs.

### 3.3 Shared `client-runtime` supervisor

T3 `packages/client-runtime` owns connection lifecycle, retries, offline, auth wakeups, and Atom domain state. Web/mobile/desktop compose the same layer.

Cozea renderer builds reconnect in `assistant-wsTransport`, then re-folds events in Zustand (`assistant-store`, orchestration projectors).

**Why T3 is more efficient:** one retry owner, one session generation, no dual projection drift, cheaper multi-window/multi-client.

### 3.4 Provider driver model

T3 uses a clear `Drivers/*Driver.ts` + managed snapshot lifecycle (pending → enrich → capabilities/skills/slash commands/account models).

Cozea still has useful ports (Cursor/OpenCode relatively close) but:

- Shared `ServerProvider` / snapshot contracts are thinner (see `docs/agent-pipeline-restoration-audit.md`)
- Codex session runtime is dramatically thinner than upstream
- Selective backports keep leaving contract holes

**Why selective porting feels endless:** you copy adapter code onto an outdated contract/helper spine.

### 3.5 Orchestration completeness

Same event-sourced idea in both, but T3’s decider/engine/reactors (including deletion/checkpoint/provider ingestion) are fuller, transactional, and tested with drainable workers instead of sleeps.

Cozea also projects on the client — so the renderer is not a dumb subscriber.

### 3.6 Desktop as supervisor

T3 desktop: Effect layers, `DesktopBackendPool` (primary + WSL), restart/backoff, readiness via well-known endpoint, updates coordinated with backends.

Cozea desktop: large imperative `main.ts`, in-process runtime fiber, product services registered at boot.

### 3.7 Observability

T3: Effect spans, NDJSON traces, OTLP export, resource telemetry.

Cozea: mostly stubs/ad-hoc logs — harder to debug “why is this turn stuck?”

---

## 4. What Cozea must keep (do not “upgrade away”)

These are product differentiators, not legacy:

| Feature | Why it stays |
| --- | --- |
| Convex collab + E2E Yjs | Multiplayer editing / room keys / tombstones — T3 has no equivalent |
| WorkOS org/auth product shape | SaaS team model |
| Local workspace catalog (SQLite) | Multi-root identity, repair, import/copy semantics |
| Project DevApps (This Mac) | Machine-local launch recipes on Dev Server tiles |
| Dockview / multi-pane workbench | IDE shell T3 deliberately is not |
| In-app browser / native preview / DevApps store | Cozea workbench surfaces |
| Sync journal / durable local writes | Collab write pipeline |
| Existing Cozea distribution | Install base / release lanes |

**Framing:** treat modern T3 as the **agent/runtime substrate**. Cozea’s workbench + collab + DevApps remain an **overlay** composed beside that substrate.

---

## 5. Upgrade principles

1. **Substrate first, product second.** Stop selective Claude/Codex file ports onto old contracts.
2. **One execution boundary.** Spawn a T3-derived server process; Electron stops hosting orchestration long-term.
3. **One client↔runtime protocol.** Effect RPC + `client-runtime` for agent/shell/thread/terminal-agent paths.
4. **Narrow IPC.** Keep IPC for OS/collab/workspace-catalog/DevApps/native-preview only.
5. **No big-bang UI rewrite.** Keep dockview/Zustand product chrome; replace the assistant connection/store spine underneath.
6. **Preserve userdata.** Plan SQLite/event-log migrations; dual-run with feature flags.
7. **Effect version strategy.** Cozea’s effect-smol / pkg.pr.new pin vs T3’s published Effect beta is a dedicated milestone — treat as API migration, not a bump.

---

## 6. Phased upgrade path

### Phase 0 — Freeze and instrument (1–2 weeks of calendar focus, low product risk)

**Stop:** ad-hoc upstream cherry-picks into `electron/assistant-runtime/provider/*` unless they unblock production.

**Do:**

- Tag a “substrate baseline” commit of Cozea main.
- Vendor or submodule a pinned `pingdotgg/t3code` revision (start from current main SHA).
- Inventory Cozea IPC handlers → classify: `keep-ipc` / `move-to-server-rpc` / `delete`.
- Inventory Zustand stores → classify: `product` / `assistant-runtime` / `bridge`.
- Add a living gap table (contracts methods, provider capabilities, reactors) — extend `docs/agent-pipeline-restoration-audit.md` rather than rewriting history.

**Exit:** written map of what must move vs stay; CI still green on Cozea as-is.

---

### Phase 1 — Spawn T3 server beside Cozea (shadow mode)

**Do:**

- Package T3 `apps/server` (or a Cozea-branded fork package) as a child process from Electron, similar to T3 `DesktopBackendPool`.
- Health-check via readiness endpoint; logs to Cozea log dir.
- Do **not** switch the UI yet — optional internal devtools page that can open an RPC session and list providers/config.

**Exit:** Cozea desktop can start/stop a modern server process reliably on macOS/Linux/Windows CI smoke.

**Risk:** port collisions with existing `assistant-runtime` WS (today often `:3773`). Give the shadow server a dedicated port/range.

---

### Phase 2 — Adopt contracts + RPC client for assistant surfaces

**Do:**

- Introduce `packages/contracts` (from T3) and a Cozea `client-runtime` composition (or dependency on forked `client-runtime`).
- Build a thin adapter so `CozeaChatSurface` can run against Effect RPC streams **behind a flag**.
- Retire renderer-side orchestration event folding for flagged sessions (subscribe to projections instead).

**Exit:** one chat path works end-to-end on the new server for at least one provider (prefer Cursor or OpenCode first — historically closest).

**Keep:** dockview layout, project route, Convex presence — untouched.

---

### Phase 3 — Provider wholesale rebase

**Do:**

- Replace Cozea provider spine with T3 driver registry + managed snapshots.
- Bring Claude/Codex session/capability/skills/auth metadata to upstream parity (this is where Cozea is most behind — especially `CodexSessionRuntime`).
- Add Grok only if product wants it; not required for the path.

**Exit:** provider picker/status/skills/slash commands match upstream behavior on the flagged path; old in-process providers deprecated.

**Explicit non-goal:** rewriting Cozea model picker chrome — feed it richer snapshots instead.

---

### Phase 4 — Terminals & git-agent consolidation

**Do:**

- Agent/workbench terminals that belong to turns move to server `terminal.attach` RPC.
- Keep a **product terminal tile** path only if it still needs Electron-specific PTY provenance — but prefer one PTY owner.
- Git operations used by agents/checkpoints use server VCS; keep Cozea collab git sync / journal as overlay services.

**Exit:** no dual PTY stacks for the same tile; project switch keep-alive still works (port T3 patterns or keep Cozea keep-alive host, but one backend).

---

### Phase 5 — Shrink Electron main

**Do:**

- Delete in-process `startAssistantRuntime` boot path once flag defaults on.
- IPC allowlist: window/native/menus/updates + workspace catalog + Yjs notify + DevApps + native preview.
- Optionally adopt T3-style Effect desktop layers for backend pool/updates (can lag Phase 2–4).

**Exit:** main process is a supervisor + Cozea product bridges; assistant crash no longer implies desktop death.

---

### Phase 6 — Observability + remote readiness (optional but high leverage)

**Do:**

- OTLP/NDJSON from the server (copy T3 observability live layer).
- Environment catalog entries for remote/SSH later — only after local path is solid.
- Mobile/web clients become possible *because* of Phase 1–2, not as a separate rewrite.

---

### Phase 7 — Monorepo reshape (tooling, not product)

Only after runtime cutover:

- Split `apps/desktop`, `apps/server`, `packages/contracts`, `packages/client-runtime`, keep `convex/` as Cozea-specific app package.
- Decide Bun vs pnpm/`vp` (T3). This is high blast radius — do it last, not first.

---

## 7. Suggested sequencing diagram

```text
Phase 0  Freeze selective ports + inventory
   │
Phase 1  Spawn modern server (shadow)
   │
Phase 2  Flagged chat via Effect RPC + client-runtime
   │
Phase 3  Provider rebase (Claude/Codex parity)
   │
Phase 4  Terminal/git-agent single ownership
   │
Phase 5  Remove in-process runtime; narrow IPC
   │
Phase 6  Observability / remote envs
   │
Phase 7  Monorepo/tooling alignment
```

Cozea overlays (Convex, DevApps, workspace catalog, dockview) ride along from Phase 0 unchanged; they only grow new *adapters* to the substrate.

---

## 8. Near-term “do / don’t”

### Do now

- Use this doc as the north star for assistant-runtime PRs.
- Prefer upstream T3 commits that touch `packages/contracts`, `client-runtime`, provider drivers, orchestration reactors.
- Invest in workspace catalog + DevApps as Cozea product (already on main) — they don’t block substrate upgrade.

### Don’t now

- Don’t keep porting individual Claude/Codex functions onto flattened `ServerProvider`.
- Don’t add more renderer-side domainEvent projectors.
- Don’t move Convex/Yjs into the T3 server.
- Don’t rewrite dockview into T3’s agent-first web shell.

---

## 9. Decision checkpoints (go / no-go)

| After | Ask |
| --- | --- |
| Phase 1 | Can we run two processes stably without UX change? |
| Phase 2 | Is flagged chat competitive with old path on Cursor/OpenCode? |
| Phase 3 | Are Claude/Codex regressions gone without Cozea UI rewrites? |
| Phase 4 | Did terminal ownership reduce project-switch bugs? |
| Phase 5 | Did desktop crash rate / memory drop with out-of-process runtime? |

If Phase 2 fails product-wise, stop and reassess before Phase 3–5 burn.

---

## 10. Appendix — key paths

### Cozea

- Runtime boot: `electron/assistant-runtime/boot.ts`, `wsServer.ts`
- Providers: `electron/assistant-runtime/provider/Layers/*`
- Contracts: `shared/assistant-contracts/`
- Renderer transport/stores: `src/stores/assistant-wsTransport.ts`, `src/stores/assistant-store.ts`
- IPC: `electron/ipc/**`
- Product overlays: `convex/**`, `electron/workspaces/**`, `src/features/devapps/**`, workbench dockview under `src/features/projects/**`

### T3

- Internals: `docs/internals/overview.md`, `connection-runtime.md`
- Server: `apps/server/src/**`
- Contracts/RPC: `packages/contracts/src/rpc.ts`, `server.ts`
- Client runtime: `packages/client-runtime/**`
- Desktop pool: `apps/desktop/src/backend/**`

---

## 11. Bottom line

Upstream T3 is better where Cozea feels old: **process isolation, protocol, connection supervision, provider depth, and observability**. Cozea is better where T3 is not trying to compete: **collaborative IDE, org/auth, local workspace catalog, DevApps, multi-pane workbench**.

The upgrade path is a **substrate rebase**, not a product rewrite: spawn modern server → Effect RPC + client-runtime for agent surfaces → wholesale provider/orchestration parity → narrow Electron to supervisor + Cozea overlays.
