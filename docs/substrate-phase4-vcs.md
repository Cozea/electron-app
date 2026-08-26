# Substrate Phase 4 — VCS scaffold (4a–4e)

Phase 4 of the T3 substrate rebase: introduce a flagged **`VcsDriver`** path that wraps existing Cozea `GitCore` / Changes checkpoints without deleting them yet. Collab overlay (journal, conflicts, lanes) stays; there is **no permanent second status broadcaster**.

Companion plans: `docs/t3code-upgrade-path.md` §3.8, `docs/t3code-implementation-plan.md` Phase 4 / Track F / Track B (PRs #74 / #78).

## Flag

| Flag | Env | Default |
| --- | --- | --- |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS=1` | **off** |

## Layout

| Piece | Path | Role |
| --- | --- | --- |
| Flag | `electron/substrate/flags.ts` | `readSubstrateVcsFlags` / `isSubstrateVcsEnabled` |
| `VcsDriver` | `electron/substrate/vcs/VcsDriver.ts` | Capability-shaped contract (T3-aligned) |
| `GitVcsDriver` | `electron/substrate/vcs/GitVcsDriver.ts` | Adapter over `GitCorePort` (wraps GitCore; **do not delete GitCore**) |
| Effect wiring | `electron/assistant-runtime/vcs/makeGitVcsDriverFromGitCore.ts` | Builds driver from Effect `GitCore` when flag on |
| Status invalidate | `electron/substrate/vcs/statusInvalidation.ts` | **Single** bus for agent + Changes + collab hooks |
| Checkpoint facade | `electron/substrate/vcs/checkpointsFacade.ts` | One Changes read entry; driver stubs delegate (no third stack) |
| Push safety | `electron/substrate/vcs/pushSafety.ts` | Refuse mismatched feature→upstream |
| Worktree orphan hooks | `electron/substrate/vcs/worktreeOrphanCleanup.ts` | Track B–aligned detection + prune hook surface |
| Bootstrap | `electron/substrate/vcs/bootstrap.ts` | Registers facade + broadcaster subscription on **Electron main boot** and workspace sync IPC (`registerWorkspaceSyncHandlers`) — idempotent |

## Exit criteria status

### 4a — Agent VCS cutover (scaffold)

| Criterion | Status |
| --- | --- |
| `VcsDriver` interface + `GitVcsDriver` wrapping GitCore | **Done** (adapter; GitCore retained) |
| Flag default off | **Done** |
| Full replace of WS `git.*` / delete GitCore on agent paths | **Not yet** (later 4a) |
| `subscribeVcsStatus` / paginated `listRefs` / PTY single ownership | **Not yet** |

### 4b — One checkpoint owner (scaffold)

| Criterion | Status |
| --- | --- |
| Document dual capture (`CheckpointStore` vs `gitCheckpoints`/worker) | **Done** (this doc + deprecation on `gitCheckpoints.ts`) |
| Changes UI reads via facade / driver stubs when flag on | **Done** (`GitChangesBroadcaster` → `getChangesCheckpointReads`) |
| Delete `gitCheckpoints` + worker | **Not yet** (facade over big-bang delete) |
| Exactly one capture implementation in-process | **In progress** — single *entry* for Changes; orchestration store still separate until full 4b |

### 4c — One status stream (prep)

| Criterion | Status |
| --- | --- |
| Single `invalidateVcsStatus(cwd)` API | **Done** |
| Collab overlay hooks documented + wired on sync mutations | **Done** (`registerWorkspaceSyncHandlers` → `invalidateVcsStatus`) |
| Replace `GitChangesBroadcaster` IPC poll with `VcsStatusBroadcaster.streamStatus` | **Not yet** |
| No permanent second broadcaster | **Done** (explicit ADR in code comments; Changes remains the UI fan-out, not a fork) |

### 4d — Collab overlay boundary

| Criterion | Status |
| --- | --- |
| Keep journal / conflict / salvage / lane-merge IPC | **Kept** (no schema changes) |
| Document: overlay must not bypass push-safety / status cache | **Done** (this section + invalidate wiring) |
| Delete duplicate branch/worktree IPC once `vcs.*` exists | **Not yet** |

**Overlay contract (keep):**

- Sync journal enqueue/ack (`workspaceSync:*`)
- Conflict read/resolve + `gitRuntime` merge-tree
- Salvage/reclone / shared-main health
- Lane → collab merge

**Must call** `invalidateVcsStatus(projectPath)` after cwd-mutating collab ops (pull/replay/restore/commit/…). Do not call raw `git push` paths that skip `evaluatePushSafety` / `GitVcsDriver.pushCurrentBranch`.

### 4e — Push / worktree safety gates

| Criterion | Status |
| --- | --- |
| Unit tests refusing mismatched feature→upstream | **Done** (`tests/electron/substrate/vcs/pushSafety.test.ts`, `GitVcsDriver.test.ts`) |
| Worktree orphan cleanup hook interface (Track B aligned) | **Done** (`worktreeOrphanCleanup.ts`) |
| Full orphan prune via `VcsDriver.removeWorktree` in product delete flow | **Partial** — hooks ready; product still uses GitCore until Track B + 4a merge |
| Stacked-action progress streaming | **Not yet** |

## What not to do

- Do not enable the flag by default in production yet.
- Do not add another checkpoint capture implementation.
- Do not grow `GitChangesBroadcaster` into a forever dual owner of agent status.
- Do not change Convex schema for this phase.

## Tests

```bash
bunx vitest run tests/electron/substrate/vcs
bun run typecheck
bun run typecheck:electron
bun run typecheck:assistant-runtime
```
