# Track B — Thread deletion cleanup + orphan worktree prompts

Companion to Wave 0 Track B in `docs/t3code-implementation-plan.md` (on branch `cursor/t3code-upgrade-path-a002`). Upstream reference: T3 `ThreadDeletionReactor` + client `worktreeCleanup` / `useThreadActions.deleteThread`.

## What shipped

### Server: `ThreadDeletionReactor`

- Path: `electron/assistant-runtime/orchestration/Layers/ThreadDeletionReactor.ts`
- Drainable worker (no sleep-based tests) subscribed to `thread.deleted`
- Best-effort cleanup:
  1. `ProviderService.stopSession({ threadId })`
  2. `TerminalManager.close({ threadId, deleteHistory: true })`
- Wired through `OrchestrationReactor` + `makeServerRuntimeServicesLayer`
- Failures are logged; interrupts are preserved

### Client: orphan worktree keep vs prune

- Detection: `src/features/projects/lib/worktreeCleanup.ts` (`getOrphanedWorktreePathForThread`)
- Delete path: `src/features/projects/lib/deleteAssistantThread.ts`
  - Prompts via existing `NativeApi.dialogs.confirm` **before** `thread.delete`
  - Optional prune via existing `NativeApi.git.removeWorktree` (GitCore under the hood — **no third git owner**)
  - Does not block UI freeze: tile close happens after dispatch returns; reactor cleans sessions asynchronously
- UI entry: delete control on assistant chat tile chrome → `handleDeleteThread`

## How this feeds Phase 4e

Phase 4e (*Push / worktree safety gates*) will:

1. Move agent VCS onto `VcsDriver` / `vcs.*` RPC (Phase 4a first)
2. Re-home orphan prune from `GitCore.removeWorktree` → `VcsDriver` / `GitWorkflowService.pruneWorktrees` / `removeWorktree`
3. Keep this Track B **detection + prompt contract**:
   - Orphan = worktree path linked only to the deleted thread
   - Prompt keep vs prune before destructive remove
   - Server reactor still owns provider/terminal cleanup on `thread.deleted`
4. Add CI coverage for mismatched-upstream push refusal alongside this orphan path

Until 4a/4e land, callers must keep using GitCore/worktree WS methods already exposed on `NativeApi.git`.

## Tests

- `tests/electron/assistant-runtime/orchestration/Layers/ThreadDeletionReactor.test.ts` — drain-based cleanup
- `tests/src/features/projects/lib/worktreeCleanup.test.ts` — orphan detection
- `tests/src/features/projects/lib/deleteAssistantThread.test.ts` — keep vs prune prompt path

## Out of scope (intentionally)

- Full `VcsDriver`
- Changes checkpoint consolidation
- Convex
