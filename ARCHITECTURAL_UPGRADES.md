# Live Workspace Architecture

This document is the source of truth for Cozea's multi-project runtime architecture.

`implementation_plan.md` covers the shipped T3-style Git-backed Changes feed. This document covers the larger workbench, workspace, process, and sync architecture that must make Cozea feel like a mix of OpenAI Codex and VS Code:

- many live workspaces
- one focused at a time
- terminals and dev servers stay alive
- browser surfaces can freeze
- collaboration and background agent edits keep syncing
- project switches never cause runtime ownership bleed

Everything below is intentionally concrete. The goal is not to describe a vibe. The goal is to define the exact product contract, ownership model, runtime boundaries, migration rules, and remaining implementation work.

## Executive Summary

Cozea must stop behaving like it has one mutable "active project path" that every subsystem races to follow.

The correct model is:

- a workspace is the unit of ownership
- a workspace has one canonical local root
- a workspace has one canonical `gitCwd`
- processes belong to a workspace
- sync belongs to a workspace
- the visible route only attaches a view to an existing workspace runtime

The user-level promise is simple:

- switching focus is fast
- terminals do not die on focus switch
- dev servers do not die on focus switch
- hidden browsers may freeze or detach
- hidden workspaces may keep syncing in the background
- agent edits and remote collaboration remain correct while another workspace is focused

## Product Contract

These are non-negotiable product rules.

1. Project switching must not rebind one workspace's terminal, dev server, browser, preview, or sync runtime to another workspace.
2. A terminal or dev server only dies when the user explicitly kills it, closes the workspace, or a narrow policy trims something explicitly marked ephemeral.
3. The app may freeze views aggressively, but it may not freeze active collaboration or active background mutation.
4. Route changes are presentation changes. They are not ownership changes.
5. Changing a local root is an explicit relink operation that creates or selects another workspace. It is never a soft mutation of an existing live workspace.
6. Multi-project multitasking is the default operating mode, not an edge case.
7. There is no hard-reset fallback in the normal product flow.

## What To Learn From T3

The important lesson from T3-style tools is not just the one-column UI. It is the ownership model behind the UI.

What T3-style tools get right:

- a workspace is first-class
- every workspace has one canonical root
- terminals, previews, and diffs belong to that workspace
- switching focus attaches the UI to a different workspace
- switching focus does not rewrite a single global current path

What Cozea must copy:

- strong workspace identity
- stable ownership boundaries
- warm background sessions
- freezing presentation instead of killing processes

What Cozea must add on top:

- route-independent Yjs sync
- route-independent filesystem watchers
- route-independent writeback and checkpoint capture
- collaborative correctness while backgrounded
- Git-backed review state per workspace

## Terminology

### Workspace

A workspace is the canonical runtime owner for one local project root under one project/lane pairing.

It owns:

- local root path
- Git root
- process bindings
- sync bindings
- lifecycle state
- view attachment state

### `workspaceId`

The stable identifier for a workspace runtime.

Product term:

- `workspaceId`

Current main-process code term:

- `sessionKey`

The end state is that these mean the same thing. Renaming code from `sessionKey` to `workspaceId` is optional; the ownership semantics are not optional.

### `focusedWorkspaceId`

The workspace currently attached to the main visible route.

### `localRootPath`

The canonical filesystem root for a workspace. This is the root used for:

- file watching
- Yjs writeback
- terminal cwd
- agent file sync

### `gitCwd`

The canonical Git root for Git-backed review features. This is separate from `localRootPath`.

Rules:

- `localRootPath` may exist without `gitCwd`
- Git-backed review only runs when the workspace's own local root is the Git root
- nested folders must not inherit diff stats from an ancestor checkout

### `workspaceSelectionId`

This is user-level route memory only. It may be used for:

- "last workbench route for this user"
- sidebar restoration

It must never be used for:

- terminal ownership
- browser partition ownership
- dev server ownership
- preview ownership
- sync ownership

### Process Layer

Real long-lived OS/runtime processes:

- terminals
- dev servers
- native preview runtimes

### Sync Layer

Live project state and replication:

- Yjs docs
- collaboration provider
- IndexedDB hydration
- filesystem watchers
- writeback
- checkpoint capture
- background reconciliation

### View Layer

Visible UI only:

- React trees
- Monaco instances
- browser DOM hosts
- diff viewers
- heavy subscriptions and polling

## Non-Negotiable Invariants

1. There is no single mutable global "active project path" used for runtime ownership.
2. Every long-lived resource has exactly one owner.
3. A workspace's owner identity does not change while it is alive.
4. Focus switching only changes the attached view.
5. A terminal never changes owners after creation.
6. A running dev server never changes owners after creation.
7. A hidden workspace with active mutation must remain sync-hot.
8. Git-backed review state is always keyed by `gitCwd`, never inferred from some broader current path.
9. Unbound routes may exist, but unbound workspaces do not own processes or sync.
10. Legacy weak identity may be migrated, but it may not continue to drive ownership.

## Workspace Identity

The current weak key of `projectId::laneId` is not enough. It collapses different local roots into one runtime identity.

The canonical workspace identity must be path-aware:

```ts
workspaceId =
  projectId + "::" +
  laneId + "::" +
  workspacePathSegment(normalizedLocalRootPath)
```

Initial implementation details:

- normalize path separators
- trim trailing separators
- lower-case on Windows
- derive a human-readable basename slug
- append a stable hash of the normalized local root

Equivalent current shape:

```ts
${projectId}::${laneId}::${slug}-${sha1(normalizedLocalRootPath).slice(0, 12)}
```

Rules:

- two different local roots must never share a live workspace runtime
- the same local root for the same project/lane must resolve to the same workspace identity
- if a route points at a different local root, it must resolve to another workspace instead of mutating the current one

### Unbound State

If a project has no local root attached yet:

- the route can still exist
- project metadata can still render
- workbench process and sync ownership must stay disabled

`unbound` is a route state, not a meaningful long-lived runtime state.

## Ownership Model

| Resource | Owner | Notes |
| --- | --- | --- |
| `localRootPath` | workspace | Immutable for the life of the runtime |
| `gitCwd` | workspace | Separate from `localRootPath` |
| Yjs doc | workspace | Lives beyond route mount |
| collab provider | workspace | Lives beyond route mount |
| filesystem watcher | workspace | Lives beyond route mount |
| writeback bridge | workspace | Lives beyond route mount |
| checkpoint capture | workspace | Lives beyond route mount |
| dev server process | workspace | Never rebound |
| native preview session | workspace | Never rebound |
| browser storage partition | workspace | Keyed by `workspaceId`, not `workspaceSelectionId` |
| browser tile model | workspace | View hosts may detach |
| terminal process | terminal, linked to workspace | Terminal owner never changes |
| terminal buffer and metadata | terminal, linked to workspace | Restored by workspace binding |
| React panel mount | view | Detach and remount freely |
| Monaco editor instance | view | Detach and remount freely |
| embedded browser DOM host | view | Freeze or detach freely |

### Ownership Rule

The general rule is:

- workspace owns runtimes
- terminal owns its own process and buffer, but belongs to one workspace forever
- view owns only visible presentation

## Runtime Layers

### Process Layer

This layer owns:

- terminals
- dev servers
- native preview runtimes

Rules:

- never kill on project switch
- only kill on explicit user action, explicit workspace close, or explicit trimming of ephemeral browser-only resources
- process ownership is immutable

### Sync Layer

This layer owns:

- Yjs docs
- collaboration provider
- IndexedDB hydration
- filesystem watchers
- writeback
- checkpoint capture
- background reconciliation
- dirty-state tracking

Rules:

- this layer survives route unmount
- this layer stays fully live for active or mutating workspaces
- this layer may only be reduced when the workspace is proven idle
- if any mutation signal appears while hidden, the workspace must promote back to sync-hot

### View Layer

This layer owns:

- React trees
- Monaco instances
- browser DOM hosts
- heavy UI polling
- diff renderers

Rules:

- this layer may freeze aggressively
- view detach must not change ownership
- view attach must be cheap because it is attaching to an existing runtime

## Workspace Registry

There are two registries and one identity.

### 1. Main-process workspace registry

This owns:

- terminals
- dev server state
- native preview state
- browser bindings
- durable workspace session metadata

Current file:

- `electron/services/WorkbenchSessionManager.ts`

### 2. Renderer workspace runtime registry

This must own:

- Yjs doc/controller lifecycle
- collab provider lifecycle
- watcher lifecycle
- writeback lifecycle
- Git-cleanup lifecycle
- view attachment reference counts

This registry does not exist as a first-class subsystem yet. It is the biggest missing piece.

### Target record shape

```ts
interface WorkspaceRuntimeRecord {
  workspaceId: string
  projectId: string
  laneId: string
  localRootPath: string | null
  gitCwd: string | null
  lifecycle: "focused" | "background-hot" | "background-warm" | "background-frozen" | "closed"
  pinned: boolean
  openedAt: number
  lastFocusedAt: number
  lastBackgroundedAt: number | null
  viewAttachmentCount: number
  terminalBindings: Record<string, string>
  browserBindings: Record<string, string>
  nativePreviewLocator: object | null
  sync: {
    started: boolean
    connected: boolean
    collaboratorCount: number
    pendingWriteback: boolean
    pendingCheckpointCapture: boolean
    activeMutation: boolean
    dirty: boolean
    lastMutationAt: number | null
  }
}
```

Required indexes:

- `byWorkspaceId`
- `byProjectLaneAndRoot`
- `lastFocusedByProjectAndLane`
- `focusedWorkspaceId`

## Lifecycle State Machine

### States

| State | Process Layer | Sync Layer | View Layer |
| --- | --- | --- | --- |
| `focused` | attached | attached | attached |
| `background-hot` | alive | fully live | detached or mostly detached |
| `background-warm` | alive | live, low-pressure | detached |
| `background-frozen` | alive only if safe and useful | reduced only when proven idle | fully detached |
| `closed` | released | released | detached |

### Promotion rules

A workspace must promote to `background-hot` or `focused` when any of these are true:

- a bound terminal is running
- an agent is actively editing through a bound terminal
- a dev server is running
- a native preview session is active
- collaborators are connected
- local writeback is pending
- checkpoint capture is pending
- filesystem watchers detect active mutation
- the user focuses the workspace

### Demotion rules

Initial default policy:

- `focused -> background-hot` on focus loss if any activity signal is true
- `focused -> background-warm` on focus loss if no activity signal is true
- `background-hot -> background-warm` after 2 minutes of no active mutation, no collaborators, and no terminal or dev-server activity
- `background-warm -> background-frozen` after 10 minutes of idle time if no mutation-capable runtime remains
- ephemeral browser surfaces may be trimmed after 60 seconds while frozen or sooner under memory pressure

These are default thresholds, not sacred values. The important part is the policy shape:

- freeze view first
- trim ephemeral browser state second
- do not kill terminals or dev servers because focus changed
- do not freeze active sync

### Forbidden transitions

These are never allowed:

- rebinding a running terminal from workspace A to workspace B
- rebinding a running dev server from workspace A to workspace B
- reusing workspace A's browser partition for workspace B
- tearing down Yjs for a hidden workspace that is still mutating
- rewriting an existing live workspace's `localRootPath` to another path as a normal navigation side effect

## Focus, Attach, and Relink Flows

### Opening a workspace

1. Resolve `projectId`, `laneId`, and `localRootPath`.
2. Resolve or create the `workspaceId`.
3. Ensure the main-process workspace record exists.
4. Ensure the renderer sync runtime exists.
5. Attach the visible route to that workspace.
6. Promote it to `focused`.

### Switching focus

1. Detach the current route from workspace A.
2. Demote workspace A according to activity signals.
3. Attach the route to workspace B.
4. Promote workspace B to `focused`.
5. Do not kill anything owned by workspace A unless an explicit trim policy applies to ephemeral browser surfaces.

### Relinking a local root

This is the critical rule.

If a project/lane resolves to a different local root:

1. create or resolve another `workspaceId`
2. attach the view to that workspace
3. optionally copy non-runtime view preferences
4. leave the old workspace alive until explicit close or background policy trimming

It is never acceptable to mutate a live workspace's root in place.

### Closing a workspace

Closing is explicit. It may:

- kill workspace-owned terminals
- stop the workspace dev server
- stop native preview
- destroy browser bindings
- release Yjs and watchers

Closing is the main destructive action. Project switching is not.

## Sync Architecture

This is the main unfinished area.

Today, route-mounted code still owns too much of the sync layer. That is why the architecture is only partly complete even though process ownership is much better.

### End-state design

Introduce a renderer-side workspace runtime controller that lives outside the visible route.

Recommended modules:

- `src/features/projects/workspaces/workspaceIdentity.ts`
- `src/features/projects/workspaces/WorkspaceRuntimeRegistry.ts`
- `src/features/projects/workspaces/WorkspaceRuntimeProvider.tsx`
- `src/features/projects/workspaces/WorkspaceSyncRuntime.ts`
- `src/features/projects/workspaces/WorkspaceViewAttachment.tsx`

This controller must own:

- Yjs doc creation and destruction
- collaboration session bootstrap
- IndexedDB hydration
- filesystem watcher start and stop
- agent file sync bridge
- binary file sync bridge
- writeback bridge
- checkpoint cleanup
- background mutation signals

### Current route-coupled files that must be refactored

- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/contexts/ProjectSyncProviderRuntime.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `src/contexts/YjsProjectContext.tsx`
- `src/hooks/useAgentFileSync.ts`
- `src/hooks/useYjsFileWriteback.ts`
- `src/features/projects/hooks/useProjectCheckpointCleanup.ts`
- `src/features/projects/hooks/useProjectGitCwd.ts`

### Route after refactor

After the refactor, the route layer should only:

- resolve which workspace to attach to
- subscribe to runtime state
- provide view-only context
- render attached editors, panels, and overlays

It should not:

- create the Yjs doc
- own watcher lifetime
- own writeback lifetime
- own collaboration provider lifetime

### Required sync signals

Every workspace runtime must surface these signals:

- `collaboratorCount`
- `isConnected`
- `pendingWriteback`
- `pendingCheckpointCapture`
- `dirty`
- `lastMutationAt`
- `activeTerminalMutation`
- `watcherHealthy`

These signals feed background policy.

## Yjs Policy

This is the critical correctness rule.

If an agent is editing code in a terminal while the user switches to another project, freezing Yjs or writeback for that workspace is a bug.

Why:

- files keep changing on disk
- Cozea stops seeing mutations
- checkpoint ranges drift from reality
- comments and review context go stale
- resuming later requires repair or full rescan

The product rule is:

- freeze presentation, not collaboration state

### A workspace must stay sync-hot when any of these are true

- a bound terminal is running an agent or code-writing command
- a dev server is running and may still mutate files
- live collaborators are connected
- local writes are pending writeback
- checkpoint capture is pending
- filesystem watchers observe active mutation

### What may still freeze safely

- Monaco editors
- diff viewers
- embedded browser rendering
- hidden panel UI
- expensive view subscriptions

### `background-frozen` safety rule

`background-frozen` is only allowed when the controller can prove:

- no active terminal mutation
- no active collaborators
- no dev server mutation risk
- no pending writeback
- no pending checkpoint capture

Even then, keep enough signal to re-promote quickly. The safest default is:

- keep a lightweight root watcher alive
- destroy only heavy view resources

## Yjs 14 Adoption

Cozea should lean into the Yjs 14 direction instead of staying anchored to older v13-era patterns.

Repo state on `2026-04-17`:

- the repo is pinned to the npm-published Yjs 14 line in `package.json`
- local persistence and writeback code has already been adapted away from older map-event assumptions toward generic `YEvent` and `keysChanged`
- upstream GitHub release candidates are ahead of the npm-published line, so ecosystem compatibility still matters

### Required Yjs 14 patterns

New code should default to:

- generic `YEvent` observers
- `keysChanged` instead of older map-specific change assumptions
- delta/content APIs where structured rendering matters
- preserving transaction origin and collaborative provenance as long as possible
- keeping checkpoint identity and remote-origin identity inside the CRDT flow

### Product-level use of Yjs 14

Cozea should intentionally use Yjs 14 concepts in these areas:

- workspace sync internals
- review and suggestion flows
- future authorship-aware Changes views
- future blame-style collaborative history

### Attribution policy

When the npm-published Yjs 14 line and the surrounding provider ecosystem make attribution primitives practical to ship safely, Cozea should prefer Yjs-native attribution over building a separate homegrown authorship model.

Until then:

- keep provenance in transaction origins and checkpoint metadata
- do not flatten collaborative state into plain strings earlier than necessary

### Compatibility policy

The Yjs ecosystem will lag the core package for some time. Cozea should:

- stay on the npm-published Yjs 14 line
- validate custom provider, writeback, IndexedDB, and Monaco paths after each bump
- prefer adapting our code to Yjs 14 semantics instead of waiting for every peer dependency to refresh metadata

## Terminal Model

Terminals should feel like VS Code terminals:

- long-lived
- bound to a workspace
- restorable when the UI remounts
- still alive when hidden

Rules:

- terminal creation binds `terminalId -> workspaceId`
- terminal output buffering stays with that terminal
- the UI may detach from the terminal
- project switching must restore the existing binding instead of creating a replacement terminal
- explicit kill is the main destructive action

### Agent terminals

Agent terminals are not special in ownership terms. They follow the same model, but they must emit stronger activity signals so the owning workspace stays sync-hot while the agent is writing code.

## Browser and Preview Model

Browser surfaces are more disposable than terminals, but they are still workspace-owned.

Rules:

- browser state belongs to a workspace
- the visible browser host belongs to the view layer
- browser storage partitions for workspace-scoped tabs key off `workspaceId`
- ephemeral browser tiles may be trimmed under memory pressure
- dev server ownership remains with the workspace
- native preview sessions remain with the workspace

Important distinction:

- freezing the browser UI is acceptable
- killing the dev server on focus switch is not

## Git and Checkpoint Model

The Git-backed review system described in `implementation_plan.md` is part of workspace ownership.

Rules:

- `localRootPath` owns filesystem scope
- `gitCwd` owns Git-backed review scope
- both belong to the workspace
- switching focus must never cause one workspace to read another workspace's Git state
- checkpoint refs and ephemeral change rows are workspace-owned review state

This is already largely in good shape because the Changes system now uses:

- local Git checkpoints for real patches
- Convex for lightweight timeline rows and comments
- canonical `gitCwd` instead of inferring Git ownership from broader paths

## Why Earlier Cozea Builds Felt Wrong

The old failure mode was predictable:

- weak identity keyed by only project and lane
- route-mounted sync lifecycle
- browser/workspace storage tied to user-level selection rather than runtime identity
- UI stores and layouts shaped more like routes than workspaces

That leads directly to:

- terminals appearing in the wrong project
- previews seeming to belong to whichever project was focused last
- path changes being treated like session mutation
- hidden workspaces rebuilding instead of reattaching

## Current Implementation Status On 2026-04-17

### Landed

| Area | Status | Key files |
| --- | --- | --- |
| Path-aware workspace identity in main process | landed | `electron/services/WorkbenchSessionManager.ts` |
| Explicit `sessionKey` targeting across workbench IPC | landed | `shared/electronApiTypes.ts`, `electron/preload.ts`, `electron/ipc/registerWorkbenchSessionHandlers.ts` |
| Terminal, browser, dev-server, and native preview bindings use explicit workspace identity | landed | `useWorkbenchSessionLifecycle.ts`, `ProjectWorkbenchPage.tsx`, `WorkbenchDockPanels.tsx`, `WorkbenchTerminalTile.tsx`, `WorkbenchDevServerTile.tsx`, `useWorkbenchBrowserView.ts`, `useWorkbenchDockviewRuntime.ts` |
| Browser workspace storage keyed to workspace runtime instead of user-level route memory | landed | `ProjectWorkbenchPage.tsx`, browser workbench bindings |
| Yjs 14 event-model adaptation in local persistence/writeback | landed | `src/hooks/useYjsFileWriteback.ts`, `src/lib/yjs/ProjectFilesPersistence.ts` |
| Renderer-side workspace runtime registry | landed | `src/features/projects/workspaces/*`, `src/App.tsx` |
| Route-independent sync ownership | landed | `ProjectLayout.tsx`, `ProjectSyncContext.tsx`, `ProjectSyncProviderRuntime.tsx`, `YjsProjectContext.tsx` |
| Path-aware renderer workbench store and layout restore path | landed | `src/stores/useProjectWorkbenchStore.ts`, `ProjectWorkbenchPage.tsx`, `ProjectSidebar.tsx`, `ProjectSidebarTreeItem.tsx`, `useWorkbenchDockviewRuntime.ts`, `useProjectWorkbenchSearchParamSync.ts` |
| Lifecycle-aware renderer workspace state and backgrounding | landed | `useWorkspaceRuntimeStore.ts`, `WorkspaceRuntimeHosts.tsx`, `useWorkbenchSessionLifecycle.ts`, `ProjectWorkbenchPage.tsx` |
| Header workspace indicator and lifecycle/debug visibility | landed | `WorkspaceLifecycleIndicator.tsx`, `ProjectWorkbenchPage.tsx`, `electron/services/WorkbenchSessionManager.ts` |

### Partially landed

| Area | Status | Why it still matters |
| --- | --- | --- |
| Full lifecycle policy across sync layer | partial | `background-frozen` workspaces now drop hosted sync providers and Yjs interest roots, but there is still room to tune finer-grained subresource throttling if profiling shows waste |

### Practical result today

What is fixed already:

- process ownership bleed is much less likely
- terminals and previews bind to the correct workspace identity
- project switches do not soft-reassign one live session into another root
- hidden workspace runtimes stay alive after route detach
- workbench layouts and tile state isolate by local root instead of only `projectId::laneId`
- the active project route can host sync without first visiting `/workbench`
- relink and close are explicit product actions in both the header and project sidebar
- switching roots can copy path-scoped workbench/layout state forward once instead of forcing a blank restore
- explicitly closed roots stop passive reattachment until the user reopens or relinks them
- frozen workspaces no longer stay mounted in hosted sync providers or Yjs interest roots

## Remaining Refinement Plan

The architecture pass is implemented. What remains after this document is follow-up optimization and regression prevention, not missing ownership/product flows.

### Phase 1: Harden lifecycle policy across sync and process layers

Deliverables:

- compute `focused`, `background-hot`, `background-warm`, and `background-frozen` from richer signals
- surface activity signals from terminals, dev servers, collab presence, writeback, and watchers
- trim only browser/view resources by default
- never kill terminals or dev servers on focus switch
- optionally reduce frozen-workspace sync cost without breaking correctness

Primary files:

- `electron/services/WorkbenchSessionManager.ts`
- new renderer workspace runtime policy modules
- `src/hooks/useDevServerManager.ts`
- workbench tile controllers and sync runtime modules

Acceptance:

- a hidden workspace with an active agent terminal remains sync-hot
- a hidden idle workspace may freeze view resources without losing correctness
- any extra sync throttling for frozen workspaces is explicit and reversible

### Phase 2: Explicit relink, restore, and close flows

Status: landed on 2026-04-17

Delivered:

- explicit `Relink Local Folder` action in the workbench header
- explicit `Relink Local Folder` action in the project sidebar
- explicit `Close Workspace` action in the workbench header
- explicit `Close Workspace` action in the current-project sidebar menu
- one-time cloning of path-scoped workbench/layout state when a project is relinked to a new root that has no existing path-scoped state
- closed-root suppression so the route does not immediately auto-reattach to the same local folder

Primary files:

- project open/local path resolution flows
- workbench restore flows
- sidebar restore flows

Acceptance:

- changing local root never mutates a live workspace in place
- restore behavior remains fast and predictable
- explicit close is the only path that tears down retained bindings for that root

### Phase 3: Product polish, observability, and QA

Status: landed with manual QA matrix on 2026-04-17

Delivered:

- clear workspace indicators in the header
- internal logging for workspace lifecycle transitions
- internal logging for unexpected ownership mismatches
- scenario-based QA matrix in `WORKSPACE_RUNTIME_QA.md`

Primary files:

- header/workbench presentation files
- workspace runtime modules
- scenario tests and logging hooks

Acceptance:

- switching between hot workspaces feels near-instant
- ownership bugs are detectable in logs
- regressions are caught by scenario testing instead of user reports

## Migration Rules

These rules apply during implementation.

1. Do not hard reset user state.
2. Do not kill existing terminals as part of a migration.
3. Do not kill dev servers as part of a migration.
4. Migrate weak identity lazily to path-aware identity.
5. If two legacy records collide, keep the newest bound record and leave older records unbound or inactive instead of merging them.
6. Legacy persisted layouts should be copied forward on first access, not dropped.
7. Any cleanup that can destroy a process must require explicit workspace close or an explicit ephemeral-resource policy.

## Verification Matrix

The architecture is complete only when all of these scenarios pass.

The maintained runnable checklist now lives in `WORKSPACE_RUNTIME_QA.md`.

### Workspace identity

1. Open project A at root X and project A at root Y.
2. Confirm terminals, layouts, and browser surfaces do not bleed between them.

### Terminal persistence

1. Start a long-running terminal in workspace A.
2. Switch to workspace B.
3. Switch back to workspace A.
4. Confirm the original terminal is still alive and still bound to A.

### Dev server persistence

1. Start a dev server in workspace A.
2. Switch to workspace B.
3. Confirm A's dev server remains running.
4. Switch back and confirm preview reattaches.

### Background agent edit correctness

1. Start an agent/code-writing terminal in workspace A.
2. Focus workspace B.
3. Confirm A stays sync-hot.
4. Confirm file mutations, checkpoints, and review state remain correct.

### Background collaboration correctness

1. Open workspace A on two devices or two collaborator sessions.
2. Background one of them.
3. Edit from the other.
4. Confirm the backgrounded workspace remains correct and reattaches cleanly.

### Browser freeze policy

1. Open ephemeral browser tiles in workspace A.
2. Background A until frozen.
3. Confirm ephemeral browser surfaces may be trimmed.
4. Confirm terminals and dev server still follow the workspace rules.

### Git review correctness

1. Make edits in a repo-root workspace.
2. Confirm the Changes feed, header stats, and checkpoint cleanup use `gitCwd`.
3. Confirm nested non-root workspaces do not inherit ancestor Git review state.

### Explicit close

1. Close a workspace explicitly.
2. Confirm terminals, browsers, preview, and sync are released for that workspace only.

## Success Criteria

This architecture is complete when the following are all true:

- project switching never causes process ownership bleed
- a running terminal survives focus switches
- a running dev server survives focus switches
- hidden browser views can freeze without breaking workspace ownership
- agent edits continue syncing while another workspace is focused
- Yjs remains live for mutating workspaces
- same-project multi-root workspaces have isolated renderer state
- the UI feels fast because it is attaching to existing runtimes instead of rebuilding them

## Final Decision

The architecture decision is:

- Cozea is a multi-workspace product
- workspace identity is path-aware
- process ownership is immutable
- sync ownership must move out of the route
- view freeze is allowed
- collaboration freeze during active mutation is not allowed

This is the bar for the product. Anything weaker reintroduces the exact class of bugs the user is complaining about.
