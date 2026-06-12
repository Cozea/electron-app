# Plan 005 — IPC hardening: authorize paths in `workspace:openInFinder`, fix silent unsubscribe failures

- **Status**: TODO
- **Written against**: commit `8a807045` (dirty working tree — `electron/ipc/registerWorkspaceHandlers.ts` is among the files being actively modified on this branch; the Drift check is mandatory here)
- **Category**: security / correctness (defense in depth)
- **Effort**: S (half a day)
- **Risk of change**: low

## Why this matters

Electron renderer → main IPC is a trust boundary: if the renderer is ever compromised (XSS in webview content, malicious markdown rendering, supply-chain script), main-process handlers are the last line of defense. The workspace handlers established a good authorization pattern — `resolveAuthorizedWorkspaceAccess` resolves a `workspaceId` + operation to a **verified** catalog workspace and confines `relativePath`/`cwd` inside the workspace root (`electron/workspaces/authorization.ts:21-90`, using `resolvePathWithinDirectory`). But a few handlers bypass it.

### Finding A — `workspace:openInFinder` accepts an arbitrary absolute path

`electron/ipc/registerWorkspaceHandlers.ts:107-109` (verified):

```ts
ipcMain.handle("workspace:openInFinder", async (_event, folderPath: string) => {
  await shell.openPath(folderPath)
})
```

Exposed to the renderer at `electron/preload.ts:1036` (`openInFinder: (folderPath: string) => ipcRenderer.invoke('workspace:openInFinder', folderPath)`; type at `shared/electronApiTypes.ts:1983`). A compromised renderer can `shell.openPath` anything — including launching files (openPath opens files with their default app, not just folders in Finder).

### Finding B — single-tier operation policy (known TODO, document-only this round)

`electron/workspaces/authorization.ts:78-79`:

```ts
// TODO: Enforce fine-grained operation policy (e.g. read-only roots)
// Currently we just trust that verificationStatus === "verified" is sufficient.
```

The `WorkspaceOperation` union (`authorization.ts:7-19`) already names 10 operations (`read-file` … `git-write` … `dev-server-start`), but they are accepted uniformly. Full per-operation ACLs need a product model for roles; **this plan only adds the seam** (see step 3), not the policy.

### Finding C — best-effort unsubscribes swallow failures silently

`electron/ipc/registerWorkspaceSyncHandlers.ts` — two handlers (`workspaceSync:unsubscribeGitChanges` ~:895-905 and `workspaceSync:unsubscribeGitDirtyState` ~:920-930, verified):

```ts
resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' }).then((access) => {
  const projectPath = access.gitRootPath ?? access.projectRootPath
  gitDirtyStateService.unsubscribe(event.sender, projectPath, options.scope)
}).catch(() => { /* ignore */ })
```

If authorization rejects (workspace deleted/forgotten mid-flight — which the in-flight catalog rearchitecture makes more likely), the service-side subscription for that `WebContents` is never released: stale watcher, leaked listener, and git polling against a dead workspace.

## Implementation steps

1. **Re-key `openInFinder` by workspace, not path.**
   - Change the handler to accept `{ workspaceId: string; laneId?: string | null; relativePath?: string | null }`, resolve via `resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: "open-external-editor", relativePath })` (that operation already exists in the union; if semantics feel wrong add `"reveal-in-finder"` to the `WorkspaceOperation` union instead — one line), and call `shell.openPath(access.fullPath ?? access.projectRootPath)`.
   - Follow the house pattern in the same family: `workspaceSync:subscribeGitDirtyState` (`registerWorkspaceSyncHandlers.ts:~908-918`) is a clean exemplar of resolve-then-act.
   - Update the preload signature (`electron/preload.ts:1036`) and the shared type (`shared/electronApiTypes.ts:1983`).
   - Update every renderer call site: `rg "openInFinder" src/ -l` and convert each from a path argument to the workspace-id shape. At plan time the callers live in the project sidebar / workspace actions area (`src/features/projects/hooks/useProjectWorkspaceActions.ts` is modified on this branch and is the likely hub) — they all already know their `workspaceId`, which is why this change is cheap.
   - If a call site genuinely has no `workspaceId` (e.g. revealing a not-yet-imported candidate folder from the import picker), do NOT re-widen the API: add a separate, explicitly-named handler `workspace:revealCandidateInFinder` that validates the path is one of the catalog's current candidate roots (`workspace:listCandidates` handler in the same file shows where candidates come from). **Escape hatch**: if more than one such caller exists, stop and report rather than multiplying bespoke handlers.

2. **Fix the silent unsubscribe catches.** In both handlers: on authorization failure, still attempt cleanup with the information available — `gitDirtyStateService` (and `gitDirtyStateService.unsubscribe`'s sibling for `unsubscribeGitChanges`) key subscriptions by `event.sender` + path; add/ use a service-level `unsubscribeAllForSender(event.sender, workspaceId?)`-style fallback if one exists (check `electron/services/GitChangesBroadcaster.ts` / the dirty-state service for an existing by-sender cleanup — `WebContents` destruction handlers usually have one), and replace `.catch(() => {})` with `.catch((error) => log.warn("unsubscribe cleanup failed", { workspaceId: options.workspaceId, error }))` using whatever logger the file already imports (match the file's existing logging idiom; check its imports).
3. **Make Finding B's TODO a real seam (no policy yet).** Extract the policy point into a tiny function inside `authorization.ts`, e.g. `assertOperationAllowed(workspace, lane, operation: WorkspaceOperation): void` that currently always passes, is called where the TODO sits (line 78), and carries the TODO comment. This turns a buried comment into a named, testable choke point future ACL work plugs into. No behavior change.
4. **Verification gate**: `bun run lint` && `bunx vitest run tests/workspace/` && full `bunx vitest run` (Node, never `--bun`; pre-existing known failure: `tests/electron/assistant-runtime/main.test.ts`, 11 CLI-boot timeouts). Manual smoke in `bun run dev`: right-click a project → Reveal in Finder still opens the correct folder.

## Test plan

The workspace-catalog contract suite is the house pattern: `tests/workspace/workspaceCatalog.test.ts` (in-memory layer + tmpdir markers). Add `tests/workspace/authorization.test.ts` (or extend the existing file if one covers `resolveAuthorizedWorkspaceAccess`):

- `relativePath` escaping the root (`"../../etc"`) → rejected (this exercises `resolvePathWithinDirectory`).
- unknown `workspaceId` → throws `Workspace not found`.
- unverified workspace that fails re-verification → throws.
- `assertOperationAllowed` is called for every resolve (a spy/wrapper test, or just an export-level unit test that it exists and passes through).

IPC-handler-level tests are thin here (handlers are registered against the real `ipcMain`); the authorization unit tests plus the renderer-side typecheck are the practical net. The signature change itself is enforced by `bun run typecheck` (renderer call sites) — and by `typecheck:electron` if plan 003 has landed.

## Hard boundaries

- In scope: `electron/ipc/registerWorkspaceHandlers.ts` (one handler), `electron/ipc/registerWorkspaceSyncHandlers.ts` (two catch blocks), `electron/workspaces/authorization.ts` (seam extraction), `electron/preload.ts` + `shared/electronApiTypes.ts` (one signature), renderer call sites of `openInFinder` only, new/extended test file under `tests/workspace/`.
- Out of scope: implementing actual per-operation ACL policy (needs product input), every other IPC handler family (`registerProjectHandlers.ts` had its git/gh call sites audited — they use spawn arg-arrays, no shell, no change needed), the dev-server and terminal handlers, anything in `electron/assistant-runtime/`.
- **This branch is actively rewriting the workspace catalog.** Do not refactor catalog internals; touch only the named seams.

## Done criteria (machine-checkable)

1. `rg "openInFinder: \(folderPath" electron/preload.ts shared/electronApiTypes.ts` → no hits (signature is workspace-keyed).
2. `rg "catch\(\(\) => \{ /\* ignore \*/ \}\)" electron/ipc/registerWorkspaceSyncHandlers.ts` → no hits.
3. `rg "assertOperationAllowed" electron/workspaces/authorization.ts` → ≥2 hits (definition + call).
4. `bunx vitest run tests/workspace/` → green, including the new traversal/authorization cases.
5. `bun run typecheck && bun run lint` → exit 0.

## Drift check

`registerWorkspaceHandlers.ts`, `useProjectWorkspaceActions.ts`, and the catalog files are **uncommitted-modified** on this branch right now. Before editing, diff the cited excerpts against the live tree (`rg "openInFinder" electron/ipc/registerWorkspaceHandlers.ts`). If the handler already takes a `workspaceId` or the file moved, reconcile with reality and report what differed; if the whole handler family was rearchitected, STOP and report instead of merging plans in your head.

## Maintenance note

Reviewers should treat any new `ipcMain.handle` that accepts an absolute path from the renderer as a smell — the question is always "why isn't this a `workspaceId` + relative path through `resolveAuthorizedWorkspaceAccess`?" The `assertOperationAllowed` seam is where the eventual read-only-roots / collaborator-role policy (see `docs/workspace-permissions-iam-plan.md`) plugs in.
