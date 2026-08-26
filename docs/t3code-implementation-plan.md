# Cozea × T3 Substrate — Full Implementation Plan

Date: 2026-08-26  
Companion to: `docs/t3code-upgrade-path.md` (architecture diagnosis)  
Upstream pin target: [pingdotgg/t3code](https://github.com/pingdotgg/t3code) `main` (record exact SHA at Phase 0 freeze)

This is the **execution plan**: phases, parallel tracks, ownership, flags, exit criteria, and the cloud-swarm wave map. Use the upgrade-path doc for *why*; use this doc for *what ships next*.

---

## 0. North star

Rebase Cozea’s **agent/runtime substrate** onto modern T3 (spawned Node server + Effect RPC + `client-runtime` + `VcsDriver`) while keeping Cozea’s **product overlays** (Convex/E2E Yjs, WorkOS, workspace catalog, Project DevApps, dockview workbench, sync journal, distribution).

**Not a product rewrite. Not endless Claude/Codex cherry-picks onto old contracts.**

```text
┌─────────────────────────────────────────────────────────────┐
│ Cozea overlay (KEEP)                                        │
│  Convex · Yjs E2E · WorkOS · catalog · DevApps · dockview   │
│  sync journal · conflict UI · native preview · release      │
└───────────────────────────┬─────────────────────────────────┘
                            │ narrow adapters / invalidate hooks
┌───────────────────────────▼─────────────────────────────────┐
│ T3-derived substrate (REBASE ONTO)                          │
│  DesktopBackendPool · Effect RPC /ws · client-runtime       │
│  provider drivers · orchestration · VcsDriver · terminals   │
│  NDJSON/OTLP · BackgroundPolicy                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Non-negotiables

### Always

- Package manager: **Bun** (`bun install`, `bun run typecheck`, `bun run lint`)
- Convex: **`bunx convex deploy` only** — never `convex dev`
- Branch names: `cursor/<descriptive-name>-a002`
- Commits: imperative `<type>: <description>`
- Preserve userdata / feature-flag dual-run during cutovers
- Run `bun run typecheck` before considering a track done

### Never

- Selective provider ports onto flattened `ServerProvider` without contract rebase
- Move Convex/Yjs into the T3 server
- Rewrite dockview into T3’s agent-first web shell
- Add more renderer-side `domainEvent` projectors on the old path
- Dual owners for status / checkpoint / PTY after a cutover phase exits
- Commit secrets / `.env` / `convex/_generated`

### Ask / flag before expanding scope

- New third-party dependencies
- `convex/schema.ts` changes
- Auth/WorkOS flow changes
- Default-on flip of substrate flags (shadow → primary)

---

## 2. Keep vs move matrix (summary)

| Concern | Disposition |
| --- | --- |
| Assistant orchestration, providers, agent git, agent PTY | **Move → server RPC** |
| Terminals bound to turns / agent cwd | **Move → server** |
| Connection supervisor + assistant atoms | **Move → client-runtime** |
| Window/menus/updates/native preview | **Keep IPC** |
| Workspace catalog, DevApps, path registry | **Keep IPC / product** |
| Yjs notify, sync journal, conflict resolve, lane→collab | **Keep overlay IPC** (+ invalidate substrate) |
| Changes checkpoint-worker (duplicate capture) | **Delete after 4b** |
| `GitChangesBroadcaster` poll | **Replace after 4c** |
| Fat `startAssistantRuntime` in main | **Delete after Phase 5** |

Full IPC/store inventories are **Wave 0 deliverables** (Track Inventory).

---

## 3. Feature flags

| Flag | Purpose | Default |
| --- | --- | --- |
| `cozea.substrate.shadowServer` | Spawn T3-derived server; no UI switch | off → on in Phase 1 |
| `cozea.substrate.rpcChat` | Chat tile uses Effect RPC path | off until Phase 2 exit |
| `cozea.substrate.providers` | Driver registry path | off until Phase 3 |
| `cozea.substrate.vcs` | Agent VCS via `VcsDriver` | off until Phase 4a |
| `cozea.substrate.primary` | Default new sessions to substrate | off until Phase 5 |
| `cozea.palette.enabled` | Command palette UI | on when Track A ships |
| `cozea.browser.agentAutomation` | Agent browser automation MVP | off until Track C safe |
| `cozea.obs.ndjson` | NDJSON traces on runtime/server | off → on after smoke |

Flags live in one module (prefer existing settings/config surface). Each phase PR must document how to flip its flag.

---

## 4. Spine phases (serial)

These are the rebase backbone. Parallel product tracks (§5) may ship **before** the spine finishes, but must not invent a third execution boundary.

### Phase 0 — Freeze & instrument

**Owners:** Inventory swarm + docs  

**Do:**

1. Tag substrate baseline SHA on Cozea `main`.
2. Pin upstream T3 SHA (submodule or `vendor/t3code` + script); document in this file.
3. Classify every `ipcMain.handle` → `keep-ipc` | `move-to-server-rpc` | `delete`.
4. Classify Zustand stores → `product` | `assistant-runtime` | `bridge`.
5. Living gap table: contracts methods, provider capabilities, reactors (extend `docs/agent-pipeline-restoration-audit.md`).
6. Freeze ad-hoc Claude/Codex cherry-picks unless production-blocking.

**Exit:** inventories merged; CI green; pin recorded.

### Phase 1 — Shadow server

**Do:**

- Package T3 `apps/server` (Cozea-branded fork/package) as child process from Electron (`DesktopBackendPool`-shaped).
- Readiness health-check; logs under Cozea log dir.
- Dedicated port range (avoid clash with `:3773`).
- Internal-only RPC smoke (devtools / script) — **no product UI switch**.

**Exit:** start/stop reliable on macOS/Linux/(Windows if CI covers); `shadowServer` flag works.

### Phase 2 — Contracts + flagged chat

**Do:**

- Land `packages/contracts` + Cozea `client-runtime` composition.
- Adapter so `CozeaChatSurface` / workbench assistant tile can use Effect RPC streams behind `rpcChat`.
- Stop renderer orchestration folding for flagged sessions (subscribe to projections).

**Exit:** end-to-end chat for ≥1 provider (prefer Cursor or OpenCode). Dockview/Convex untouched.

**Go/no-go:** if flagged chat is not competitive, pause before Phase 3–5 burn.

### Phase 3 — Provider wholesale rebase

**Do:**

- T3 driver registry + managed snapshots (pending → enrich → capabilities/skills/slash/account models).
- Claude + Codex parity with upstream session runtimes (Codex is the deepest gap).
- Grok optional.

**Exit:** picker/status/skills/slash match upstream on flagged path; old in-process providers deprecated.

### Phase 4 — Terminals & VCS (split)

#### 4a Agent VCS + terminal ownership

- Replace `assistant-runtime/git/GitCore` + WS `git.*` with `VcsDriver` / `GitWorkflowService` / RPC `vcs.*` + `git.*`.
- Push-safety, paginated `listRefs`, local/remote status, worktree prune, PR-head awareness.
- Orchestration checkpoints → `VcsDriver.checkpoints.*`.
- Turn-bound PTYs → server `terminal.attach`.

**Exit:** no `GitCore` on agent paths; `subscribeVcsStatus` drives agent status UI; one PTY owner per tile.

#### 4b One checkpoint owner

- Remove duplicate `gitCheckpoints` + `checkpoint-worker` capture path.
- Changes UI served from server checkpoint/diff/review **or** thin overlay over same driver.
- Map `scope: current|branch` without a second capture implementation.

**Exit:** exactly one capture implementation; Changes page green.

#### 4c One status stream

- Replace `GitChangesBroadcaster` IPC poll with `VcsStatusBroadcaster.streamStatus` (or fan-in adapter).
- After `GitSyncService` pull/replay/conflict resolve → **must** invalidate substrate status.

**Exit:** one status stream; collab mutations refresh agent subscribers.

#### 4d Collab overlay boundary

**Keep IPC:** sync journal, conflict read/resolve + merge-tree, salvage/reclone, lane→collab merge.  

**Delete/move once `vcs.*` exists:** duplicate branch/checkout/worktree IPC.  

Document: overlay must not bypass push-safety / status cache.

**Exit:** conflict page + journal green; keep vs delete inventory updated.

#### 4e Push / worktree safety gates

- CI tests for mismatched-upstream push refusal.
- Orphan worktree cleanup on thread deletion (align with Track B).
- Stacked-action progress streaming where product needs it.

**Exit:** gates in CI; project-switch keep-alive still works.

### Phase 5 — Shrink Electron main

- Remove in-process `startAssistantRuntime` when `primary` defaults on.
- IPC allowlist: window/native/menus/updates + catalog + Yjs notify + DevApps + native preview + collab overlay.
- Optionally adopt Effect desktop layers for backend pool/updates.

**Exit:** main is supervisor + Cozea bridges; assistant crash ≠ desktop death.

### Phase 6 — Observability & remote readiness

- NDJSON + optional OTLP from server (Track E accelerates early scaffolding).
- Remote/SSH env catalog only after local path solid.
- Multi-client (web/mobile) becomes possible because of Phase 1–2 — not a separate rewrite.

### Phase 7 — Monorepo reshape (last)

- Split `apps/desktop`, `apps/server`, `packages/contracts`, `packages/client-runtime`; keep `convex/` as Cozea package.
- Bun vs pnpm/`vp` decision — **last**, high blast radius.

---

## 5. Parallel tracks (ship before / beside spine)

These are high-impact ports that **do not require** full rebase first. They must stay compatible with the spine (no new fat-main owners).

| Track | Name | Depends on | Spine touch |
| --- | --- | --- | --- |
| **A** | Command palette + keybindings UI | Existing contracts (`shared/assistant-contracts/keybindings.ts`, runtime keybindings) | None / thin |
| **B** | Thread-delete cleanup + orphan worktree prompts | Current orchestration + git | Feeds 4e |
| **C** | Agent browser automation MVP | Existing browser tiles + `docs/integrated-browser-architecture.md` | Flagged |
| **D** | Sync/connection status UX + demand-gated refresh | `ProjectSyncIndicator`, transport status | Soft; BackgroundPolicy later on server |
| **E** | Observability NDJSON (+ optional OTLP) | Runtime/server logging | Accelerates Phase 6 |
| **F** | Local-first git status split | Agent git status UI | Soft prep for 4a/4c — **no second broadcaster** |
| **Inv** | Phase 0 inventories + gap table | Docs only | Unblocks spine |

### Track A — Command palette

**Goal:** First-class command palette + keybindings discovery UI (contracts already exist; UI missing).

**Reference:** T3 `apps/web/src/components/CommandPalette.logic.ts`, `commandPaletteBus.ts`; Cozea `electron/assistant-runtime/keybindings.ts`, `shared/assistant-contracts/keybindings.ts`, `docs/vscode-desktop-parity-checklist.md`.

**Deliver:**

- Palette UI in workbench (Cmd/Ctrl+K or existing binding).
- Fuzzy search over registered commands; execute via existing command IDs.
- Surface keybinding conflicts / malformed config issues already reported by runtime.
- Feature flag `cozea.palette.enabled`.

**Exit:** open → find → run works for ≥10 core commands; typecheck + focused tests green.

**Out of scope:** full VS Code parity, remote command contribution model.

### Track B — Thread deletion reactor + worktree cleanup

**Goal:** Deleting a thread cleans provider/session artifacts and prompts for orphan worktrees (T3 `ThreadDeletionReactor`).

**Reference:** `/tmp` or upstream `apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts` (+ Services).

**Deliver:**

- Reactor/worker on delete path (drainable, no sleep-based tests).
- Detect orphan worktrees owned by deleted thread; prompt keep vs prune.
- Do not block UI freeze (navigate/detach patterns already fixed on delete project — mirror care).

**Exit:** delete thread leaves no dangling provider session; orphan prompt covered by test.

**Out of scope:** full VcsDriver; don’t invent a third git owner — call existing `GitCore`/worktree APIs until 4a.

### Track C — Agent browser automation MVP

**Goal:** Agent can drive the existing in-app browser tile (navigate, snapshot/a11y-lite, click/type) behind a flag.

**Reference:** `docs/integrated-browser-architecture.md`; T3 `previewAutomation` / preview contracts if useful.

**Deliver:**

- Minimal tool surface wired to existing browser/webview IPC.
- Flag `cozea.browser.agentAutomation` default **off**.
- Safety: only tiles user already has open / project-scoped URLs as product requires.

**Exit:** flagged demo: agent opens URL in tile and reports title/text; no default-on.

**Out of scope:** full Playwright fleet, cross-origin unrestricted browsing.

### Track D — Connection / sync-status presentation + BackgroundPolicy-lite

**Goal:** Users can tell **transport** (assistant WS/RPC) vs **data sync** (Convex/Yjs/journal) vs **git remote** phases apart; reduce wasteful refresh when backgrounded.

**Reference:** `ProjectSyncIndicator.tsx`; T3 `BackgroundPolicy`, `ThreadStatusIndicators`, connection supervisor concepts.

**Deliver:**

- Clear status model in UI (disconnected / reconnecting / connected × sync idle/syncing/error).
- Demand-gated refresh hooks for expensive polls (pause when window hidden / tile not visible) — **lite** version on Cozea today.
- Don’t conflate project `syncStatus` enum with assistant transport.

**Exit:** indicator copy/states distinguishable in UI; at least one poll path demand-gated; typecheck green.

### Track E — Observability NDJSON (+ OTLP optional)

**Goal:** Structured traces for “why is this turn stuck?”

**Reference:** T3 `apps/server/src/observability/**`; `docs/t3code-updates.md`.

**Deliver:**

- NDJSON span writer to Cozea log/userdata path behind `cozea.obs.ndjson`.
- Instrument turn start/end, provider call, git op boundaries (best-effort on current runtime).
- OTLP export optional behind env vars — don’t require Grafana in CI.

**Exit:** one turn produces readable NDJSON lines; flag off by default or documented.

### Track F — Local-first git status split (prep)

**Goal:** Split local vs remote refresh cadence **without** standing up a second broadcaster forever.

**Deliver:**

- Local status refresh fast; remote (fetch/ahead-behind) slower / demand-gated.
- Single invalidation API other services can call (journal/sync will use this in 4c).
- Explicit comment/ADR: this collapses into `VcsStatusBroadcaster` in 4c — do not grow a permanent fork.

**Exit:** UI feels snappier locally; remote polling documented; no new checkpoint stack.

### Track Inv — Inventories

**Deliverables (markdown under `docs/`):**

1. `docs/substrate-ipc-inventory.md` — every handler classified.
2. `docs/substrate-store-inventory.md` — Zustand classification.
3. Gap table update in `docs/agent-pipeline-restoration-audit.md` (or new `docs/substrate-gap-table.md`).
4. Record pinned T3 SHA in this plan’s header once chosen.

---

## 6. Sequencing diagram (spine + parallel)

```text
                    ┌──────── Track A palette ────────┐
                    ├──────── Track B deletion ───────┤
 Wave 0             ├──────── Track C browser (flag) ─┤──► merge independently
                    ├──────── Track D sync UX ────────┤
                    ├──────── Track E NDJSON ─────────┤
                    ├──────── Track F git status prep ┤
                    └──────── Track Inv inventories ──┘
                                      │
Phase 0 complete ─────────────────────┤
                                      ▼
Phase 1 shadow server ──► Phase 2 rpcChat ──► Phase 3 providers
                                      │
                    Phase 4a → 4b → 4c → 4d → 4e
                                      │
                                 Phase 5 thin Electron
                                      │
                      Phase 6 obs/remote (E may already help)
                                      │
                                 Phase 7 monorepo
```

---

## 7. Cloud swarm map

### Wave 0 (launch now — parallel, base `main`)

| Agent | Branch | Scope |
| --- | --- | --- |
| Inv | `cursor/substrate-inventories-a002` | Track Inv |
| A | `cursor/command-palette-a002` | Track A |
| B | `cursor/thread-deletion-cleanup-a002` | Track B |
| C | `cursor/browser-automation-mvp-a002` | Track C |
| D | `cursor/sync-connection-status-a002` | Track D |
| E | `cursor/obs-ndjson-a002` | Track E |
| F | `cursor/git-status-local-remote-a002` | Track F |

**Coordination rules for swarm agents:**

1. One track per branch/PR; no drive-by refactors.
2. Read this plan + `docs/t3code-upgrade-path.md`.
3. Prefer existing UI (`src/components/ui/`) and patterns.
4. Do not flip substrate primary flags.
5. Do not add dependencies without noting in PR for human approval.
6. If blocked on Electron/runtime ownership conflict with another track, stop and document — don’t invent a parallel stack.
7. Typecheck before PR ready; include short test plan in PR body.

### Wave 1 (after Phase 0 inventories land)

| Agent | Focus |
| --- | --- |
| P1 | Shadow server package + Electron spawn (`shadowServer`) |
| P2 prep | Contracts package scaffolding / Effect version strategy spike |

### Wave 2 (after Phase 1 exit)

| Agent | Focus |
| --- | --- |
| P2 | Flagged RPC chat path |
| P3a | OpenCode/Cursor driver rebase |
| P3b | Claude/Codex deep parity (larger) |

### Wave 3 (after Phase 2 go)

| Agent | Focus |
| --- | --- |
| 4a | VcsDriver agent cutover |
| 4b/4c | Checkpoint + status unification |
| 4d/4e | Overlay contract + safety gates |

---

## 8. Acceptance checklist (per PR)

- [ ] Implements exactly one track or one phase slice
- [ ] Flag documented (if any)
- [ ] `bun run typecheck` clean
- [ ] Tests added/updated where behavior is non-trivial
- [ ] No new dual owner for git/terminal/checkpoint
- [ ] PR links to this plan section
- [ ] Overlay keep-list respected (Convex/Yjs/DevApps/catalog/dockview)

---

## 9. Decision checkpoints

| After | Ask |
| --- | --- |
| Wave 0 Inv | Do we know what moves vs stays? |
| Phase 1 | Two processes stable with no UX change? |
| Phase 2 | Flagged chat competitive on Cursor/OpenCode? |
| Phase 3 | Claude/Codex OK without UI rewrite? |
| Phase 4a–e | Single VCS/checkpoint/status ownership + overlay green? |
| Phase 5 | Desktop crash/memory improved out-of-process? |

---

## 10. Key paths cheat sheet

### Cozea

- Runtime: `electron/assistant-runtime/**`
- IPC: `electron/ipc/**`
- Contracts: `shared/assistant-contracts/**`
- Transport/stores: `src/stores/assistant-wsTransport.ts`, `src/stores/assistant-store.ts`
- Sync UI: `src/features/projects/components/ProjectSyncIndicator.tsx`
- Git multi-owner: `electron/assistant-runtime/git/**`, `electron/gitCheckpoints.ts`, `electron/services/gitSyncService.ts`, `electron/services/GitChangesBroadcaster.ts`, `electron/services/syncJournalStore.ts`
- Browser: workbench browser tiles + `docs/integrated-browser-architecture.md`
- Keybindings: `electron/assistant-runtime/keybindings.ts`, `shared/assistant-contracts/keybindings.ts`

### Upstream T3 (study; pin SHA in Phase 0)

- Server: `apps/server/src/**`
- VCS: `apps/server/src/vcs/**`, `apps/server/src/git/**`
- Background: `apps/server/src/background/BackgroundPolicy.ts`
- Deletion: `apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts`
- Observability: `apps/server/src/observability/**`
- Desktop pool: `apps/desktop/src/backend/DesktopBackendPool.ts`
- Client: `packages/client-runtime/**`
- Contracts: `packages/contracts/src/**`
- Palette: `apps/web/src/components/CommandPalette.logic.ts`

---

## 11. Bottom line

**Wave 0** ships user-visible wins and inventories in parallel.  
**Phases 1–5** are the substrate rebase spine.  
**Phases 6–7** polish and reshape once the spine is default.

If forced to cut scope: keep **Inv + A + D + Phase 1→2**; defer C and deep Codex until after rpcChat go/no-go.
