# Local Runtime And Project Path Plan

## Summary

Cozea currently has two separate architectural problems:

1. Local desktop workflows are still too cloud-coupled.
2. The active project's local filesystem path is still being re-resolved in too many places.

These problems should be addressed separately, but they reinforce each other.

This document also records the broader architecture study around those problems so it remains usable if working context is compacted later.

It now covers:

- what the app actually is today
- where authority overlaps between local and cloud systems
- what those overlaps imply
- the cleanup order to get back to a coherent local-first architecture

## Deep Study: What Cozea Actually Is Today

Cozea is no longer just "an Electron app with a React frontend."

In practice it is a hybrid of:

- a local desktop IDE shell
- a React product app
- a Convex-backed product database
- a Fastify SaaS control plane
- a Yjs collaboration runtime
- a Git-backed project durability system
- a local T3-derived assistant runtime

That matters because many current bugs are not isolated implementation mistakes. They are the result of multiple partially-migrated systems sharing the same project, preview, collaboration, and assistant surfaces.

### Current Runtime Layers

#### Renderer / Product App

The renderer treats Convex and auth as foundational application infrastructure.

Key files:

- `src/main.tsx`
- `src/App.tsx`
- `src/contexts/AuthContext.tsx`
- `src/contexts/OrganizationContext.tsx`
- `src/contexts/ConvexProvider.tsx`

#### Electron Shell

Electron main is a large orchestrator for:

- windows
- IPC
- preview/dev-server integration
- auth bridge
- terminal/runtime control
- project filesystem actions

Key files:

- `electron/main.ts`
- `electron/preload.ts`
- `electron/ipc/registerPreviewHandlers.ts`
- `electron/ipc/registerProjectHandlers.ts`
- `electron/ipc/registerRuntimeHandlers.ts`

#### Local Assistant Runtime

The desktop app contains a substantial T3-derived assistant runtime under `electron/assistant-runtime`.

Key files:

- `electron/assistant-runtime/main.ts`
- `electron/assistant-runtime/boot.ts`
- `src/lib/nativeApi.ts`
- `src/lib/wsNativeApi.ts`

There are also older Electron-local assistant services still present:

- `electron/services/AgentChatService.ts`
- `electron/services/AgentProviderService.ts`

These older services appear to be legacy/parallel infrastructure rather than the canonical runtime.

#### Fastify Control Plane

The server in `server/` is not just auth. It currently acts as:

- auth gateway
- organization/member API
- billing gateway
- collaboration session gateway
- remote runtime workspace control plane
- source-control auth service
- Git HTTP/auth surface

Key files:

- `server/src/index.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/collab.ts`
- `server/src/routes/runtimeWorkspaces.ts`
- `server/src/routes/git.ts`

#### Convex Product Backend

Convex currently holds:

- users and organizations
- projects and memberships
- subscription and billing state
- Yjs document state
- project presence
- Git sync metadata and storage accounting

Key files:

- `convex/schema.ts`
- `convex/projects.ts`
- `convex/yjs.ts`
- `convex/projectPresence.ts`
- `convex/lib/workspaceLimits.ts`

## Main Architectural Problem: Overlapping Authority

The root issue is not one broken subsystem. It is overlapping authority.

Today, all of the following believe they partially own important project behavior:

- Electron
- Convex
- the Fastify server
- the local assistant runtime
- renderer feature code

This creates systems that are each individually understandable, but collectively ambiguous.

### Examples Of Overlap

#### Assistant Runtime

- `src/lib/nativeApi.ts` now expects the preload/native bridge in desktop mode.
- `src/lib/wsNativeApi.ts` remains as explicit web-mode transport support.
- `electron/preload.ts` exposes the desktop assistant bridge.
- `electron/assistant-runtime` is the substantial real assistant runtime.

Implication:
The desktop contract is much clearer now, but the repo still contains a few compatibility shims around old persisted keys and runtime migration paths.

#### Collaboration

- `src/contexts/YjsProjectContext.tsx` makes Convex central to Yjs bootstrap and tail sync.
- `src/features/projects/contexts/ProjectSyncContext.tsx` still requests a collab session through `useCollabSession`.
- `src/hooks/useCollabSession.ts` calls `/collab/capabilities` and `/collab/session` on the Fastify gateway.
- `server/src/routes/collab.ts` still acts as a session authority and WS negotiation layer.

Implication:
The desktop app is still too dependent on cloud collaboration negotiation for flows that should feel local-first.

#### Project Runtime / Preview

- Electron owns local dev-server and preview integration.
- `server/src/routes/runtimeWorkspaces.ts` also defines a remote runtime workspace model.
- `src/features/projects/pages/ProjectPagesPage.tsx` coordinates preview, route scanning, inspector state, and visual editing in the renderer.

Implication:
Preview instability is not surprising. Several layers believe they partially own runtime state.

#### Sync / Durability

- `electron/services/gitSyncService.ts` is a real Git-native local sync surface.
- `docs/git-backed-sync-migration-plan.md` clearly states that Git-backed sync is the target architecture.
- the active sync journal still preserves migration from old replica-named persisted state.

Implication:
The migration is largely complete in live code, but persistence compatibility remains in the sync journal for older local installs.

## Problem 1: Cloud And Local Are Not Clearly Separated

Today, parts of the desktop app still put cloud services on the hot path for workflows that should be local-first.

Examples in the current codebase:

- Auth is cloud-backed through `VITE_AUTH_SERVER_URL` in `src/contexts/AuthContext.tsx`.
- Convex is treated as required app infrastructure in `src/contexts/ConvexProvider.tsx`.
- Yjs bootstraps from Convex in `src/contexts/YjsProjectContext.tsx`.
- Project sync still requests a collaboration session from the gateway in `src/features/projects/contexts/ProjectSyncContext.tsx` via `src/hooks/useCollabSession.ts`.

This is the wrong default for a desktop app operating on local files.

### What Should Be Local By Default

- Project filesystem access
- Preview and dev-server lifecycle
- Assistant runtime
- Git state, diffs, and repository operations
- Single-user editor state
- Yjs bootstrap for local editing

### What Can Stay Cloud-Backed

- Auth and organization membership
- Optional team collaboration and sharing
- Optional backups / remote history
- Billing and workspace policy

### Desired Rule

The local app must keep working when cloud services are unavailable, except for features that are inherently cloud-only.

### Stronger Implication

The issue is not that cloud services exist. The issue is that cloud services are still participating in the desktop runtime's critical path too early.

Cloud should augment the local app, not define whether the local app can stably function.

## Problem 2: Local Project Path Is Being Recomputed Too Often

The current code still treats the project path as something to repeatedly "figure out" instead of something to resolve once and then carry through the session.

Examples:

- `src/features/projects/layouts/ProjectLayout.tsx` resolves and recovers `effectiveLocalPath`.
- `src/features/projects/lib/projectOpenGitSync.ts` has its own `resolveTargetProjectPath(...)` fallback.
- `src/components/context-switcher.tsx` still falls back to `window.electronAPI.project.getLocalPath(...)` when opening a project.
- `src/features/projects/contexts/ProjectSyncContext.tsx` mirrors `localPath` into local state again as `currentLocalPath`.
- `electron/ipc/registerProjectHandlers.ts` exposes `project:getLocalPath`, which delegates to `electron/projectPathResolution.ts`.

### Why It Is Happening

Right now Cozea effectively has multiple competing "truths" for a project's local path:

- Cloud/member-stored `project.localPath`
- Derived path from `projectsDirectory + slug`
- Local recovery / relocation state
- Session-local state such as `effectiveLocalPath` / `currentLocalPath`

That leads to repeated fallback logic and path-dependent UI resets.

### Additional Implication

The deeper problem is not just "path lookup is slow" or "path lookup is duplicated."

The real problem is that `localPath` is being used for two different roles:

- machine-local filesystem location
- implicit project identity / reset key inside the renderer

That makes innocent path churn ripple outward into preview resets, sync resets, terminal resets, and assistant confusion.

## Strong Position: Local Path Should Be Persisted Locally

The project path should not be repeatedly derived from `projectsDirectory + slug` during normal app operation.

That derived lookup should be a fallback or recovery mechanism only.

For a given machine and user, the active local project path should be:

- resolved once
- stored locally
- reused as the canonical path for subsequent sessions

This is especially true because the path usually does not change often.

## T3 Reference Direction

Reference clone used for comparison: `/Users/admin/Downloads/t3code`

T3's direction is better here because it treats workspace `cwd` as a persisted local identity, not something that must be reconstructed from a slug every time:

- `apps/web/src/store.ts` persists project `cwd` values in local storage (`expandedProjectCwds`, `projectOrderCwds`).
- `apps/web/src/store.ts` maps incoming projects directly to `cwd: project.workspaceRoot`.
- `apps/server/src/config.ts` persists local runtime state under the app's local state directory (`state.sqlite`, `settings.json`, `worktrees/`).

That is the correct model for Cozea:

- project path is local machine state
- project id is product identity
- cloud can mirror metadata if useful, but cloud should not be the authority for the local filesystem path

## Current Contradictions To Resolve

### 1. Local-First Product, Cloud-First Boot Paths

Cozea behaves like a local IDE in the UI, but key flows still depend on:

- auth gateway availability
- collab session issuance
- Convex-backed synchronization

This mismatch is a major source of fragility.

### 2. One Assistant UX, Multiple Assistant Backends

The product increasingly assumes one canonical assistant UX, but the repo still contains:

- the T3-derived desktop runtime
- renderer WS fallback assumptions
- older Electron-local assistant services

This creates ambiguity around ownership, transport, and error handling.

### 3. Git-Native Direction, Replica-Era Surfaces Still Present

The intended sync model is already documented and partially implemented, but old replica-era concepts still exist in the codebase.

This forces the app to carry migration complexity in normal runtime behavior.

### 4. Project Identity vs Local Workspace Location

`projectId` should be product identity.

`localPath` should be stable machine-local workspace location.

But today `localPath` still participates too much in renderer identity and lifecycle control.

## Desired Cozea Model

### Identity Split

- `projectId`: canonical product identity
- `localPath`: canonical machine-local workspace root for this machine/user
- cloud metadata: optional mirror, not the primary source of truth for the active local path

### Resolution Rule

Only project entry / recovery flows should be allowed to resolve or repair the local path.

Everything downstream should consume an already-resolved value.

### Resolution Flow

1. Read locally persisted path for this project on this machine.
2. If it exists and is valid, use it.
3. If it is missing or broken, enter explicit recovery / relocation flow.
4. Only in that recovery flow should slug-based derivation or folder creation happen.
5. Once recovered, update the local persisted record and continue.

## Implementation Direction

### 1. Make Local Path A Desktop-Local Registry

Persist a local path registry in desktop-local state, keyed by project id.

Possible storage locations:

- Electron settings JSON
- existing local app database
- dedicated local path registry file

The important part is that it is local-first and authoritative for this machine.

### 2. Demote `project:getLocalPath`

`project:getLocalPath` should become a recovery helper, not a normal renderer dependency.

It should not be the common way normal features obtain the current path.

### 3. Collapse Path Resolution To One Boundary

Allowed path-resolution owners:

- project open flow
- project recovery / relocation flow
- initial project-layout bootstrap

Not allowed:

- arbitrary feature components re-deriving path
- sync hooks independently falling back to path lookup
- UI surfaces keying broad state transitions off raw path churn

### 4. Pass Down One Canonical Session Value

After resolution, the app should pass one canonical `resolvedProjectPath` downward via context.

Downstream code should treat it as input, not something to recompute.

### 5. Keep Cloud Metadata Optional

If cloud wants to keep a mirrored `project.localPath` for convenience, that is acceptable as secondary metadata.

It should not be the primary authority for the desktop app's active local workspace path.

## Concrete Refactor Map

The order matters. These steps should not be treated as equal parallel cleanup.

### Phase 1: Establish Local Runtime As The Default Authority

Objective:
Make local desktop execution the primary runtime for normal project work.

Scope:

- project filesystem access
- preview/dev-server lifecycle
- assistant runtime access
- Git operations
- local editor state

Initial targets:

- `electron/main.ts`
- `electron/preload.ts`
- `src/env.ts`
- `src/features/projects/pages/ProjectPagesPage.tsx`
- `src/features/projects/components/ServerControl.tsx`

Expected result:
The desktop app should remain usable even when cloud services are degraded, except for cloud-only features.

### Phase 2: Introduce A Local Project Path Registry

Objective:
Persist canonical project path locally and stop normal feature code from deriving it repeatedly.

Direction:

- add a desktop-local registry keyed by project id
- resolve path once on project open / recovery
- pass a single resolved path downward
- reserve slug-based derivation for recovery only

Initial targets:

- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/lib/projectOpenGitSync.ts`
- `src/components/context-switcher.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `electron/ipc/registerProjectHandlers.ts`
- `electron/projectPathResolution.ts`

Expected result:
Path churn stops driving unrelated UI and runtime resets.

### Phase 3: Collapse Assistant Runtime To One Desktop Contract

Objective:
Make the T3-derived runtime the single assistant authority on desktop and remove ambiguity.

Direction:

- keep `electron/assistant-runtime` as the real local assistant runtime
- remove renderer ambiguity about WS fallback vs preload-native access
- confirm and delete older unused assistant service paths
- make preload the single transport boundary

Initial targets:

- `electron/assistant-runtime/**`
- `src/lib/nativeApi.ts`
- `src/lib/wsNativeApi.ts`
- `electron/preload.ts`
- `electron/services/AgentChatService.ts`
- `electron/services/AgentProviderService.ts`

Expected result:
There is one answer to "how the desktop app talks to the assistant runtime."

### Phase 4: Make Collaboration Truly Local-First With Cloud Augmentation

Objective:
Keep Yjs as live state while reducing cloud dependence in desktop collaboration startup.

Direction:

- local Yjs bootstrap should succeed without cloud session negotiation
- Convex remains important for persistence and shared state
- Fastify collab session/bootstrap should be optional or strictly bounded
- presence and collaboration health should not imply full editor availability

Initial targets:

- `src/contexts/YjsProjectContext.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `src/hooks/useCollabSession.ts`
- `server/src/routes/collab.ts`
- `convex/yjs.ts`
- `convex/projectPresence.ts`

Expected result:
Collaboration degrades gracefully instead of making the editor feel broken.

### Phase 5: Finish The Git-Backed Sync Migration

Objective:
Stop carrying two sync architectures.

Direction:

- keep Git-backed durability
- keep Yjs as live state
- remove replica-era runtime paths once replacement coverage is complete

Initial targets:

- `docs/git-backed-sync-migration-plan.md`
- `electron/services/gitSyncService.ts`
- `electron/services/syncJournalStore.ts`
- remaining replica-named migration shims and UI copy

Expected result:
The app has one durability model instead of a migration-shaped runtime.

### Phase 6: Narrow The Server Into Clearer Roles

Objective:
Reduce the conceptual and operational overload of the current Fastify server.

Direction:

- stop thinking of `server/` as merely an auth gateway
- split responsibilities conceptually first, physically second
- clarify which APIs are auth/org control plane surfaces
- clarify which APIs are collaboration gateway surfaces
- clarify which APIs are runtime workspace control plane surfaces
- clarify which APIs are Git service surfaces

Initial targets:

- `server/src/index.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/collab.ts`
- `server/src/routes/runtimeWorkspaces.ts`
- `server/src/routes/git.ts`

Expected result:
The server becomes understandable as a set of explicit services instead of one growing control-plane blob.

## Execution Notes

This section records the completed architecture sweep so later work can resume from the actual landed state rather than the original plan.

### Phase 1 Completed: Local Runtime Is The Default Authority

- Local project bootstrap now prefers desktop-local state before cloud member metadata.
- The Electron app now starts the local assistant runtime during desktop boot.
- Preload now exposes a desktop bridge with the assistant runtime WS URL so the renderer no longer guesses a desktop runtime endpoint.
- The renderer only falls back to a web WS URL when `VITE_WS_URL` is explicitly configured.

Key files:

- `electron/main.ts`
- `electron/preload.ts`
- `src/lib/nativeApi.ts`
- `src/env.ts`

### Phase 2 Completed: Local Project Path Registry Added

- Added a desktop-local project path registry keyed by `projectId`.
- `project:getLocalPath` now checks the local registry first, then uses slug-based recovery only as a fallback.
- Project open/layout flows now prefer the local registry over cloud `memberLocalPath`.
- Resolved project paths are persisted locally after open/layout resolution.

Key files:

- `electron/projectPathRegistry.ts`
- `electron/ipc/registerProjectHandlers.ts`
- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/lib/projectOpenGitSync.ts`
- `src/components/context-switcher.tsx`

### Phase 3 Completed: One Desktop Assistant Contract

- Desktop now has one assistant runtime path: preload exposes the desktop bridge, and renderer assistant access goes through that bridge-backed native API path.
- Blind renderer fallback to an assumed desktop WS endpoint was removed.
- The old unused Electron assistant services were deleted.

Key files:

- `electron/main.ts`
- `electron/preload.ts`
- `src/lib/nativeApi.ts`
- `src/types/electron.d.ts`
- `electron/services/AgentChatService.ts`
- `electron/services/AgentProviderService.ts`

### Phase 4 Completed: Collaboration Is Local-First

- Collaboration transport now defaults to `convex`, with `ws` as explicit opt-in only.
- Project sync only requests a cloud collab session when WS mode is explicitly enabled.
- Convex/Yjs startup remains available without WS gateway negotiation.
- WS gateway errors are now framed as optional WebSocket-collab failures, not generic collaboration bootstrap failures.

Key files:

- `src/contexts/YjsProjectContext.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `src/hooks/useCollabSession.ts`

### Phase 5 Completed: Git-Backed Sync Migration Advanced

- The active Electron sync hot path now imports a `syncJournalStore` surface instead of importing `syncReplicaStore` directly.
- Local open/bootstrap flows now persist resolved project paths as part of the Git-native open flow.
- Dead server replica routes were deleted.
- Convex replica modules and replica schema tables were removed.
- The sync journal now uses Git/journal terminology in its live schema while still importing legacy local state on upgrade.

Key files:

- `electron/services/syncJournalStore.ts`
- `electron/ipc/registerSyncHandlers.ts`
- `electron/main.ts`
- `convex/schema.ts`
- `convex/projectFiles.ts`
- `convex/lib/workspaceLimits.ts`
- `docs/git-backed-sync-migration-plan.md`

### Phase 6 Completed: Server Roles Are Explicit

- The Fastify server now declares explicit service roles instead of silently registering everything as one blob.
- Runtime workspace control-plane routes and collaboration gateway routes are now clearly feature-gated.
- Root and health responses now report enabled service roles so control-plane shape is visible at runtime.

Key files:

- `server/src/index.ts`
- `server/src/server/features.ts`
- `server/src/server/app.ts`
- `server/src/server/start.ts`
- `server/src/entrypoints/auth-control-plane.ts`
- `server/src/entrypoints/collab-runtime.ts`
- `server/src/entrypoints/git-service.ts`

## Remaining Compatibility Shims

The architecture debt called out in the original sweep is now removed from live runtime code.

There are no remaining renderer `t3code:*` storage migration shims, and the Fastify control plane now has explicit entrypoints for auth-control, collab/runtime, and git instead of existing only as a single bootstrap path.

## Concrete Current Refactor Targets

The most obvious current targets are:

- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/lib/projectOpenGitSync.ts`
- `src/components/context-switcher.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `electron/ipc/registerProjectHandlers.ts`
- `electron/projectPathResolution.ts`

## Invariants For Future Refactors

These should be treated as architectural guardrails.

### Local Runtime Invariants

- Local filesystem actions must not require cloud availability.
- Preview/dev-server control must stay local by default.
- Assistant runtime access in Electron must have one canonical transport boundary.
- Git operations must use the resolved local workspace path, not re-derived path guesses.

### Cloud Invariants

- Cloud may own auth, orgs, billing, sharing, and optional collaboration services.
- Cloud should not be the primary authority for the current desktop workspace path.
- Cloud degradation should not make the local app feel fully unavailable unless the feature is inherently cloud-only.

### Identity Invariants

- `projectId` is product identity.
- local path is machine-local runtime state.
- `localPath` must not act as hidden UI identity in places that really mean `projectId`.

## Why This Document Exists

This document is intentionally broader than a narrow local-path note.

It is the compact architectural reference for:

- why the current app feels fragile
- which overlapping systems are causing that fragility
- the order in which those systems should be untangled

If working context is compacted later, this file should be treated as the canonical reminder of the current diagnosis and the recommended cleanup sequence.

## Final Position

Cozea needs:

1. A hard architectural separation between local runtime concerns and cloud concerns.
2. A locally persisted canonical project path, resolved once and reused, instead of repeated slug-based derivation.
3. One canonical assistant runtime path on desktop.
4. Completion of the Git-backed sync migration so the app stops carrying both old and new sync models.

The local path should be saved locally and treated the way T3 treats workspace `cwd`: persistent local runtime state, not something to keep recomputing during normal use.
