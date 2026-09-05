# T3 full server import — execution plan

Date: 2026-08-26  
Status: **planning** (post PR #99 merge to `main`)  
Companions: `docs/t3code-upgrade-path.md`, `docs/t3code-implementation-plan.md`, `docs/substrate-cutover-checklist.md`, `docs/substrate-gap-table.md`, `docs/substrate-ipc-inventory.md`, `docs/substrate-t3-pin.md`

---

## 1. North star

**Replace `electron/assistant-runtime/` with upstream T3 `apps/server`** as the single execution engine, while **keeping all Cozea product overlays** (Convex/E2E Yjs, WorkOS, dockview, DevApps, sync journal, collab conflict UI, native preview).

After this epic:

```text
Electron main          → supervisor + Cozea IPC overlays only
@cozea/server child    → T3 apps/server (orchestration, providers, VCS, terminals)
Renderer               → @cozea/client-runtime (RPC streams, no WS :3773)
assistant-runtime/     → DELETED
```

**Not in scope:** rewriting dockview, moving Convex into the server, becoming T3's web/mobile shell.

---

## 2. Where we are today (post PR #99)

| Layer | Reality |
| --- | --- |
| Shadow `:4783` | Cozea scaffold + JSON-RPC (`health`, `chat.*`, `orchestration.*`) |
| `@cozea/server` | Boots scaffold + **`startAssistantRuntime()`** on `:3773` |
| `OrchestrationRpcProxy` | RPC → WS proxy into **legacy** runtime |
| Providers | Substrate drivers; Claude/Cursor/Codex live turns still hit legacy orchestration |
| Renderer | Dual path: WS `:3773` **and** substrate RPC (events via `useSubstrateOrchestrationSync`) |
| VCS | Cozea `GitVcsDriver` wraps `GitCore` (legacy) — not T3 server VCS |
| Inventories | 215 IPC handlers classified (150 keep, 60 move-to-server, 5 delete) |

**Key insight:** PR #99 finished the **cutover plumbing**. The **engine is still Cozea `assistant-runtime`**. T3 import replaces that engine — it does not redo cutover work.

---

## 3. Strategy decisions (lock before Phase T1)

| Decision | Recommendation | Rationale |
| --- | --- | --- |
| **Vendor shape** | Git submodule `vendor/t3code` @ pin `a3a8cbd6` | Matches Phase 0 plan; diffable; updatable |
| **Server packaging** | Cozea `apps/server` **wraps** vendored T3 `apps/server` entry | Keeps Electron spawn contract; Cozea branding + env injection |
| **Package manager** | **Bun for Cozea repo**; T3 server child runs via **isolated install** (submodule's pnpm lock OR prebuilt bundle) | T3 upstream is pnpm/`vp`; forcing Bun into T3 server day-one is high risk |
| **Contracts** | **Wholesale adopt** T3 `packages/contracts` groups; keep Cozea extensions in `@cozea/contracts/collab`, `catalog`, `devapps` | Gap table: prefer adopt over fork (see `substrate-gap-table.md`) |
| **Cutover style** | **Strangler by domain** (orchestration → providers → VCS → terminals) with flags per domain | Dual-run until parity tests pass; never big-bang delete |
| **Ports** | T3 server owns `:4783` RPC; **retire `:3773`** when orchestration cut over | Already established shadow port range |
| **Userdata** | Migrate Cozea SQLite assistant DB → T3 persistence schema with explicit migration PR | Blocker for deleting assistant-runtime |

### Open spike (Phase T0, blocking T1)

**Can T3 `apps/server` boot in our shadow child with acceptable latency on macOS arm64 CI?**

- If yes → child spawns T3 server process (Node 22+) with pnpm/vp from submodule
- If no → prebuild server bundle in CI artifact (esbuild/tsc bundle of T3 server entry)

---

## 4. Phases

### Phase T0 — Vendor + build spike

**Goal:** Submodule lands; CI can compile/boot T3 server in isolation.

| Task | Deliverable |
| --- | --- |
| Add `vendor/t3code` submodule @ `a3a8cbd6` | `.gitmodules`, CI `submodule: recursive` |
| Pin update script | `scripts/vendor/sync-t3code-pin.mjs` |
| Boot spike | `scripts/spike-t3-server-boot.mjs` — health + list providers, no Electron |
| Document Bun/Node boundary | `docs/substrate-t3-build.md` |
| Refresh gap table row "Spawned Node server" | `missing` → `in progress` |

**Exit:** spike green on Linux CI; pin recorded; no product behavior change.

**Flag:** none (dev-only).

---

### Phase T1 — T3 server dual-run in shadow child

**Goal:** Shadow child runs **both** T3 server **and** legacy runtime; RPC routes to T3 when flagged.

| Task | Deliverable |
| --- | --- |
| `apps/server/src/t3Bootstrap.ts` — spawn T3 server entry from vendor | T3 readiness on same `/.well-known/cozea/substrate/ready` contract **or** T3 native ready proxied |
| Flag `cozea.t3.server` / `COZEA_T3_SERVER=1` (default **off**) | `electron/substrate/flags.ts` |
| RPC router: when T3 on, orchestration methods hit **T3 native RPC**, not `OrchestrationRpcProxy` | `rpcOrchestrationHandlers.ts` |
| Keep `startAssistantRuntime()` when T3 off or T3 boot fails | fallback |
| Smoke | `scripts/smoke-t3-server.mjs` |

**Exit:** With flag on, `orchestration.getSnapshot` served by T3; with flag off, unchanged. No workbench change required yet.

**Go/no-go:** T3 server stable start/stop 50x in CI without port leaks.

---

### Phase T2 — Contracts + client-runtime wholesale

**Goal:** One typed RPC surface; stop growing Cozea-only contract duplicates.

| Task | Deliverable |
| --- | --- |
| Vendor-sync or replace `packages/contracts` with T3 groups: `orchestration`, `provider`, `terminal`, `vcs`, `git`, `keybindings`, `background` | Expand from 3 methods → full `WsRpcGroup` |
| Add Cozea-only modules: `collab`, `catalog`, `devapps` (server never implements — desktop IPC only) | `@cozea/contracts/collab.ts` etc. |
| Port T3 `client-runtime` supervisor patterns (connection, retry, session generation, atoms) | Replace `assistant-wsTransport` for substrate sessions |
| Delete renderer `orchestrationReadModelProjector` folding when `cozea.t3.server` + `cozea.substrate.primary` | subscribe to T3 projections |

**Exit:** Flagged session: renderer uses **only** RPC client-runtime; no WS `:3773` for orchestration.

**Depends on:** T1.

---

### Phase T3 — Orchestration engine cutover

**Goal:** T3 `OrchestrationEngine` is the only turn/approval/diff/checkpoint owner.

| Task | Deliverable |
| --- | --- |
| Userdata migration: Cozea assistant SQLite → T3 persistence (projects, threads, messages, checkpoints) | `electron/substrate/migrations/t3-orchestration-userdata.ts` |
| Wire workbench: `thread.turn.start`, approvals, diffs, checkpoint revert via T3 RPC only | remove `api.orchestration.dispatchCommand` WS path when flagged |
| Image attachments on RPC path | extend turn payload |
| Delete `OrchestrationRpcProxy`, stop `startAssistantRuntime()` when T3 + primary | `apps/server/bootstrap.ts` |
| Port/adapt `ThreadDeletionReactor` (Track B merged — verify on T3 engine) | tests |

**Exit:** Flag on → full chat loop (send, stream, approve diff, revert checkpoint) without `:3773`.

**Go/no-go:** Side-by-side test suite: same thread on legacy vs T3 produces equivalent projections (allow known diffs documented).

---

### Phase T4 — Provider engine cutover

**Goal:** T3 driver registry + session runtimes replace assistant-runtime providers.

| Domain | T3 source | Cozea legacy to retire |
| --- | --- | --- |
| OpenCode | `Drivers/OpenCodeDriver` | `opencodeDriver` stubs + runtime adapter |
| Cursor | `Drivers/CursorDriver` + ACP | `cursorDriver.ts` RPC wrapper |
| Claude | `ClaudeAdapter` + tests | `claudeDriver.ts` + 3.3k adapter |
| Codex | `CodexSessionRuntime` (~2.3k) | `codexLiveSession` + thin adapter |
| Grok | optional | n/a |

| Task | Deliverable |
| --- | --- |
| Provider snapshot stream → model picker / status banner | no WS `serverProvidersUpdated` |
| Instance-scoped sessions + migrations 027/028 | see `docs/t3-provider-instance-port-todo.md` |
| Codex deep parity checklist | home layout, multi-instance, continuation identity |

**Exit:** Provider picker/skills/slash on T3 path matches upstream smoke tests.

**Depends on:** T3 (orchestration must run turns on T3 providers).

---

### Phase T5 — VCS + terminals on T3 server

**Goal:** One git owner; agent PTY on server.

| Task | Deliverable |
| --- | --- |
| Replace `GitCore` / Cozea `GitVcsDriver` internals with T3 `VcsDriver` + `GitWorkflowService` | wire existing Cozea substrate vcs IPC invalidation hooks |
| `subscribeVcsStatus` stream replaces poll/broadcasters | Phase 4c completion on T3 |
| `terminal.attach` RPC for turn-bound PTYs | retire duplicate runtime PTY for agent tiles |
| Collab overlay boundary (4d): journal/conflict IPC **invalidate** T3 status cache | document in `substrate-ipc-inventory.md` |
| Retire 60 `move-to-server-rpc` IPC handlers that duplicate T3 | per inventory rows |

**Exit:** No agent git/PTY code in `assistant-runtime/` (already deleted or unreachable).

---

### Phase T6 — Delete legacy runtime

**Goal:** Remove ~46k LOC.

| Delete | After |
| --- | --- |
| `electron/assistant-runtime/**` | T3–T5 exit |
| `OrchestrationRpcProxy`, `assistantWsBridge.ts` | T3 |
| WS `:3773` server | T2–T3 |
| `OrchestrationRpcProxy` tests → T3 integration tests | T3 |
| Flag `COZEA_SUBSTRATE_PRIMARY=0` path (legacy opt-out) | 1 release after default-on T3 |

**Exit:** `rg assistant-runtime electron/` → 0; CI green; smoke scripts use T3 only.

---

### Phase T7 — Remote backends (DesktopBackendPool)

**Goal:** SSH/WSL catalog entries become real.

| Task | Deliverable |
| --- | --- |
| Port T3 `DesktopBackendPool` secondary instances | `electron/substrate/RemoteBackendPool.ts` |
| Wire `remoteEnvironments.ts` to running backends | UI env picker |
| Spawn T3 server on remote host (SSH) or WSL distro | parity with local smoke |

**Depends on:** T6 (local T3 solid).

---

### Phase T8 — Monorepo reshape (last)

| Task | Deliverable |
| --- | --- |
| Physical move `electron/` + root `src/` → `apps/desktop/` | import path codemod |
| `apps/server` owns vendored T3 body | no `vendor/` imports from desktop |
| Bun vs pnpm/`vp` final decision | document in AGENTS.md |

**Blast radius:** high — do last.

---

## 5. Cloud swarm map (parallelization)

This section defines **what can run in parallel**, **hard serial gates**, and **recommended agent waves**. Companion: `docs/t3code-implementation-plan.md` §6–7 (Wave 0 product tracks — mostly merged in PR #99).

### 5.1 Hard serial gates

These phases form the spine. Each needs the previous phase's output:

```text
T0 (vendor submodule + spike)
  → T1 (T3 dual-run in shadow child)
    → T2 (contracts + client-runtime)
      → T3 (orchestration cutover + userdata migration)
        → T6 (delete assistant-runtime)
```

| Gate | Why serial |
| --- | --- |
| T0 → T1 | T1 needs vendored `vendor/t3code` and a green boot spike |
| T1 → T2 | T2 needs a live T3 RPC surface to type against |
| T2 → T3 | T3 needs contracts + client supervisor before renderer cutover |
| T3 → T6 | Deletion requires every domain off legacy (`assistant-runtime`) |

**Do not** delete `assistant-runtime` or flip T3 defaults until T3 go/no-go passes.

### 5.2 Parallelism summary

| Window | Max agents | Phases |
| --- | ---: | --- |
| None (spine) | 1 | T0 → T1 → T2 → T3 |
| **Peak** | **4** | T4 (×3 provider PRs) + T5 (VCS) — all after T3 |
| Moderate | 2 | T5 internal (4a–4c vs 4d–4e); late T2 + migration prep |
| Post-deletion | 1 | T7 remote backends; **T8 monorepo last** (avoid overlap with T7) |

### 5.3 Biggest parallel window — after T3

Once orchestration runs on T3, **T4 (providers) and T5 (VCS/terminals) run fully in parallel**:

```text
                    ┌── T4 Providers ──────────┐
T3 orchestration ───┤                          ├──► T6 Delete legacy
                    └── T5 VCS + terminals ────┘
```

**Coordination rule:** neither track deletes shared legacy code until **both** declare domain parity. Merge order before T6: all T4 provider PRs + T5 VCS PR(s) green.

### 5.4 Within T4 — providers

| Branch | Scope | Parallel? |
| --- | --- | --- |
| `cursor/t3-providers-opencode-cursor-a002` | OpenCode + Cursor drivers | **Yes** — together or split across agents |
| `cursor/t3-providers-claude-a002` | Claude adapter + session runtime | **Yes** — parallel with OpenCode/Cursor |
| `cursor/t3-providers-codex-deep-a002` | Codex deep parity (~2.3k LOC) | **Serial after others** — largest; prove patterns on one provider first |

At peak: **3 provider PRs in parallel**, then Codex solo.

### 5.5 Within T5 — VCS + terminals

Sub-slices 4a→4e have internal order, but two tracks can overlap:

| Track | Slices | Owner focus |
| --- | --- | --- |
| **VCS spine** | 4a → 4b → 4c | `VcsDriver`, checkpoints, `subscribeVcsStatus`, `terminal.attach` |
| **Collab + safety** | 4d + 4e | IPC boundary docs, collab invalidation hooks, push/worktree CI gates |

| Slice | Can start when |
| --- | --- |
| **4a** Agent VCS + `terminal.attach` | T3 green (foundation) |
| **4b** One checkpoint owner | 4a underway |
| **4c** Status stream unification | Late 4b |
| **4d** Collab overlay boundary | **Immediately with 4a** — docs + IPC classification, minimal server code |
| **4e** Push/worktree safety gates | **Parallel with 4a/4b** — write CI tests while VCS lands |

Suggested split: one agent on `cursor/t3-vcs-terminals-a002` (4a–4c), optional second on `cursor/t3-vcs-collab-boundary-a002` (4d–4e) if merge conflicts are manageable.

### 5.6 Early prep (beside the spine)

Non-product work that can start before its consuming phase:

| Work | Start | Feeds |
| --- | --- | --- |
| Userdata migration design + dry-run CLI | T1–T2 | T3 PR 5 |
| Parity test harness (legacy vs T3 projections) | T1 | T3 go/no-go |
| `docs/substrate-t3-build.md` (Bun/Node boundary) | T0 | T1 |
| Gap table / IPC inventory updates | Anytime | T5 4d |
| `t3Bootstrap.ts` scaffold (no wiring) | T0 spike | T1 |
| **Track F** — local-first git status split | Now (if not merged) | T5 4c |

### 5.7 T2 internal — limited overlap

Default: **serial** — contracts (PR 3) then client-runtime (PR 4) to avoid merge conflicts in `packages/contracts`.

Optional 2-agent split if file ownership is explicit:

- Agent A: `orchestration.*`, `provider.*` contract groups
- Agent B: client-runtime connection supervisor (no contract edits)

**T3 userdata migration (PR 5)** can start during **late T2** — SQLite schema work does not require renderer off WS `:3773`.

### 5.8 After T6

```text
T6 (delete legacy)
  └── T7 Remote backends (SSH/WSL pool)     ← safe alone
  └── T8 Monorepo reshape                   ← strictly last (high import-path blast radius)
```

Do **not** run T7 and T8 in parallel — T8 touches every path and will conflict with T7.

### 5.9 Agent waves (recommended)

```text
WAVE 1 (launch now)
  Agent 1: T0 vendor + spike                    ← gate; must finish first

WAVE 2 (after T0 green)
  Agent 1: T1 dual-run
  Agent 2: userdata migration design + parity harness scaffold

WAVE 3 (after T1 green)
  Agent 1: T2 contracts                         ← serial default
  Agent 2: T2 client-runtime                    ← or wait for Agent 1

WAVE 4 (after T2 green)
  Agent 1: T3 userdata migration
  Agent 2: T3 orchestration cutover             ← serial within T3; migration can lead

WAVE 5 (after T3 green) — MAX PARALLELISM
  Agent 1: T4 OpenCode + Cursor
  Agent 2: T4 Claude
  Agent 3: T5 VCS 4a–4c
  Agent 4: T5 collab boundary 4d + safety 4e
  Then solo: T4 Codex deep parity

WAVE 6
  Agent 1: T6 delete assistant-runtime

WAVE 7
  Agent 1: T7 remote backends
  (T8 monorepo reshape after T7 settles)
```

### 5.10 Swarm coordination rules

1. **One track per branch/PR** — no drive-by refactors outside the track scope.
2. **Read** this plan + `docs/t3code-upgrade-path.md` before starting.
3. **Never invent a third execution boundary** (no new fat-main git/PTY/provider owners).
4. **Flags default off** for new T3 domains until that track's exit criteria pass.
5. **Blocked on ownership conflict** — stop and document; do not fork a parallel stack.
6. Each PR: `bun run typecheck`, targeted vitest, named smoke script, flag documented.
7. **T6 is gated** on T4 + T5 completion — no early deletion PRs.

### 5.11 Wave 0 status (product tracks beside spine)

Merged in PR #99 — no longer block T0:

| Track | Branch | Status |
| --- | --- | --- |
| A — Command palette | `cursor/command-palette-a002` | ✅ merged |
| B — Thread deletion reactor | `cursor/thread-deletion-cleanup-a002` | ✅ merged |
| C — Browser automation MVP | `cursor/browser-automation-mvp-a002` | ✅ merged |
| D — Sync/connection status | `cursor/sync-connection-status-a002` | ✅ merged |
| E — NDJSON observability | `cursor/obs-ndjson-a002` | ✅ merged |
| Inv — Inventories + gap table | `cursor/substrate-inventories-a002` | ✅ merged |
| F — Local-first git status split | `cursor/git-status-local-remote-a002` | ⬜ ship beside T0–T2 if not on `main` |

---

## 6. PR sequence (recommended)

Serial spine; see **§5 Cloud swarm map** for parallel waves.

| # | Branch prefix | Phase | Scope |
| --- | --- | --- | --- |
| 1 | `cursor/t3-vendor-submodule-a002` | T0 | submodule + spike script + CI |
| 2 | `cursor/t3-server-dual-run-a002` | T1 | T3 boot in shadow child + flag |
| 3 | `cursor/t3-contracts-adopt-a002` | T2 | contracts wholesale + Cozea extensions |
| 4 | `cursor/t3-client-runtime-a002` | T2 | supervisor + renderer WS removal (flagged) |
| 5 | `cursor/t3-userdata-migration-a002` | T3 | SQLite migration |
| 6 | `cursor/t3-orchestration-cutover-a002` | T3 | turns/approvals/diffs on T3 |
| 7 | `cursor/t3-providers-opencode-cursor-a002` | T4 | parallel |
| 8 | `cursor/t3-providers-claude-a002` | T4 | parallel |
| 9 | `cursor/t3-providers-codex-deep-a002` | T4 | serial (largest) |
| 10 | `cursor/t3-vcs-terminals-a002` | T5 | VCS + terminal.attach (4a–4c) |
| 10b | `cursor/t3-vcs-collab-boundary-a002` | T5 | optional parallel: collab boundary + safety gates (4d–4e) |
| 11 | `cursor/t3-delete-assistant-runtime-a002` | T6 | deletion |
| 12 | `cursor/t3-remote-backends-a002` | T7 | SSH/WSL pool |
| 13 | `cursor/t3-monorepo-reshape-a002` | T8 | optional last |

Each PR: `bun run typecheck`, targeted vitest, smoke script named in PR description, flag documented.

**Wave 5 launch checklist (after T3):** 4 agents may start simultaneously on PRs #7, #8, #10, and optionally #10b; hold PR #9 (Codex) until at least one of #7/#8 is green.

---

## 7. Flags (cumulative)

| Flag | Phase | Default during epic |
| --- | --- | --- |
| `cozea.t3.server` | T1 | off → on when T3 stable |
| `cozea.t3.orchestration` | T3 | off until migration tested |
| `cozea.t3.providers` | T4 | off per provider |
| `cozea.t3.vcs` | T5 | replaces/enhances `cozea.substrate.vcs` |
| Existing `cozea.substrate.*` | — | stay on; T3 subsumes engine, not flags |

Final state: `cozea.t3.server=1` implies primary substrate path; legacy flags become no-ops then removed.

---

## 8. What stays on Cozea IPC forever

From inventory (**150 keep-ipc**):

- Collab encryption + Yjs notify
- Sync journal + conflict resolve
- WorkOS/session chrome
- Workspace catalog + DevApps
- Native preview + browser tiles
- Project FS helpers (until optional server FS RPC)
- Window/menus/updates

**Rule:** T3 server never sees Convex tokens, Yjs room keys, or WorkOS secrets.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| T3 won't run under Bun | Isolated Node child + pnpm from submodule; prebuild fallback |
| Userdata migration data loss | Export/import CLI; dry-run on copy; rollback flag |
| Dual-run drift (WS + RPC) | T2 explicitly removes WS for flagged sessions |
| Codex parity depth | Dedicated PR; don't block T3 orchestration on Codex |
| CI submodule size | Shallow submodule; optional sparse checkout |
| 215 IPC accidental duplication | Inventory-driven deletes only after T3 RPC exists |

---

## 10. Verification matrix

| Phase | Automated | Manual |
| --- | --- | --- |
| T0 | `scripts/spike-t3-server-boot.mjs` | — |
| T1 | `scripts/smoke-t3-server.mjs` | shadow logs |
| T2 | contracts decode tests | — |
| T3 | orchestration parity vitest | workbench send/approve/revert |
| T4 | provider snapshot tests | model picker/skills |
| T5 | vcs + terminal integration | git status + agent terminal |
| T6 | no `assistant-runtime` imports | full regression |
| T7 | remote smoke (if CI can) | SSH manual |

---

## 11. Definition of done (entire epic)

1. `electron/assistant-runtime/` deleted
2. No WS `:3773` in production path
3. All agent turns/providers/VCS/terminals on T3 server
4. Cozea overlays (Convex/Yjs/collab/DevApps) unchanged and green
5. Default flags on; no legacy opt-out required
6. `docs/substrate-cutover-checklist.md` updated — T3 section closed

---

## 12. Immediate next step

**Start Phase T0 only:** submodule + boot spike + CI. Do **not** delete assistant-runtime or flip defaults until T3 go/no-go passes.

Suggested first PR: `cursor/t3-vendor-submodule-a002`.
