# Git-Backed Sync Migration Plan

## Goal

Replace the custom replica engine with a Git-backed durability model while preserving the current Cozea collaboration UX:

- **Yjs remains the live collaboration layer**
- **The visible project `.git` remains the working Git repo**
- **`main` is the only branch**
- **Cozea auto-pulls, auto-commits, and auto-pushes**
- **The Changes page remains the human-facing history surface**
- **Project membership is the real repo access gate**

This plan assumes Cozea owns the repo lifecycle for managed projects and that Git history is infrastructure, not user-facing product history.

## Product Principles

### Preserve

- Instant local editing
- Instant live collaboration through Yjs
- Automatic cloud durability
- Automatic project restore/open on another machine
- Changes/activity UI driven by Convex activity data

### Remove

- Custom replica snapshot comparison
- Replica bundle storage as the canonical source of truth
- Replica bootstrap/plan/execute as the primary sync path

### Replace With

- Real Git status/pull/push semantics on the visible project repo
- Yjs-to-filesystem-to-Git durability path
- Cozea-managed `origin/main` as the canonical cloud state

## Architecture

### Runtime Model

1. User or agent edits update the Yjs document
2. Yjs writes changes to the local filesystem
3. Cozea logs file changes to Convex for product history
4. Cozea batches local file changes into an automatic Git commit
5. Cozea pushes `main` to the Cozea-managed remote
6. On open/reconnect, Cozea fetches and pulls `main` from the Cozea-managed remote

### Source of Truth

- **Live state**: Yjs
- **Local working copy**: filesystem + visible `.git`
- **Durable canonical cloud state**: Cozea-managed Git `origin/main`
- **Human history**: Convex activity / Changes page

## Non-Goals

- Preserve human-readable Git history
- Support multiple long-lived branches
- Use Git commits as the product activity feed
- Keep legacy replica and Git as equal first-class sync systems long term

## Current Surfaces To Replace

### Replica Engine

- `electron/services/gitReplicaService.ts`
- `electron/ipc/registerSyncHandlers.ts`
- `shared/electronApiTypes.ts`
- `electron/preload.ts`
- `server/src/routes/replicaGit.ts`
- `convex/projectReplicaGit.ts`
- `convex/projectReplicaLfs.ts`
- `convex/schema.ts` replica tables

### Open / Sync Surfaces

- `src/features/projects/lib/projectOpenReplicaCheck.ts`
- `src/features/projects/lib/projectOpenAutoSync.ts`
- `src/features/projects/lib/recentProjectOpenSync.ts`
- `src/features/projects/components/ProjectCard.tsx`
- `src/features/projects/components/ProjectListRow.tsx`
- `src/components/context-switcher.tsx`
- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/contexts/ProjectSyncContext.tsx`
- `src/features/projects/components/ProjectSyncIndicator.tsx`

### Create / Import / Build

- `src/pages/NewProject.tsx`
- `src/pages/ProjectBuild.tsx`
- `electron/ipc/registerProjectHandlers.ts`

### Collaboration / Yjs Durability

- `src/contexts/YjsProjectContext.tsx`
- `src/hooks/useYjsFileWriteback.ts`
- `src/lib/yjs/ProjectFilesPersistence.ts`
- `convex/yjs.ts`
- `src/hooks/useCollabSession.ts`

### Sharing / Joining / Access

- `convex/projectInvites.ts`
- `convex/projectJoinLinks.ts`
- `convex/projectMembers.ts`
- `src/components/layouts/UnifiedHeader.tsx`
- `src/features/projects/pages/ProjectJoinPage.tsx`
- `src/features/projects/pages/ProjectTeamPage.tsx`

### Runtime Workspace Materialization

- `server/src/routes/runtimeWorkspaces.ts`

## Phase Plan

## Phase 1 — Project Git Metadata

### Objective

Make repo-backed sync a first-class project capability.

### Changes

- Extend `projects` in `convex/schema.ts` with fields such as:
  - `syncMode: "replica" | "git"`
  - `repoProvider`
  - `repoOwner`
  - `repoName`
  - `repoUrl`
  - `defaultBranch` (fixed to `main`)
  - `lastFetchedCommit`
  - `lastPushedCommit`
  - `gitAccessState`
  - `gitSyncError`
- Update project queries and mutations in `convex/projects.ts`

### Impact

- Every UI surface can tell whether a project is legacy replica-backed or Git-backed
- Sharing/open flows can validate repo availability before proceeding

### Acceptance Criteria

- Project records can express Git sync state without touching replica tables
- Existing projects remain readable without migration

## Phase 2 — Cozea Git Remote on the Server

### Objective

Stand up a Cozea-managed Git remote so the app syncs against our own Git service, not GitHub/GitLab.

### Changes

- Add server-side canonical repo storage and access routes
- Expose authenticated Git remote operations backed by project membership
- Make repo auth derive from Cozea auth/session, not provider integration tokens
- Replace the current assumption that `gitRepository.url` points to an external provider remote

### Impact

- Canonical cloud state becomes our own Git remote
- Repo access automatically follows project membership
- Sharing no longer depends on third-party provider collaborator APIs

### Acceptance Criteria

- Server can host/fetch/push project repos using project membership as the auth gate
- There is a stable canonical `origin` for Cozea-managed projects

## Phase 3 — Electron Git Sync Service

### Objective

Replace the active replica runtime with Git-native operations using the visible repo.

### Changes

- Build a new Git sync service on top of `electron/gitRuntime.ts`
- Add operations for:
  - `ensureRepo`
  - `cloneIfMissing`
  - `fetchMain`
  - `getStatus`
  - `pullMain`
  - `commitAndPush`
  - `getAheadBehind`
- Point those operations at the Cozea-managed remote from Phase 2
- Replace replica IPC definitions in:
  - `shared/electronApiTypes.ts`
  - `electron/preload.ts`
  - `electron/ipc/registerSyncHandlers.ts`

### Impact

- Electron becomes Git-native for sync
- The app no longer depends on replica bootstrap/plan/execute for new Git-backed projects

### Acceptance Criteria

- App can clone/fetch/pull/push a project repo through IPC
- Dirty worktree, clean worktree, and conflict states are surfaced as typed results

## Phase 4 — Open Flow Becomes Fetch + Status + Pull

### Objective

Make project open behave like a Git-native desktop client.

### Changes

- Replace `projectOpenReplicaCheck` with Git-based open status logic
- Update:
  - `ProjectCard.tsx`
  - `ProjectListRow.tsx`
  - `context-switcher.tsx`
  - `ProjectLayout.tsx`
  - `ProjectSyncContext.tsx`
  - `ProjectSyncIndicator.tsx`

### New Open Rules

- Local repo missing → clone
- Clean and behind `origin/main` → fast-forward pull
- Dirty and remote unchanged → open directly
- Dirty and remote ahead but merge succeeds → auto-merge and open
- Conflict → block and show sync review

### Impact

- Removes local-wipe heuristics from the primary open path
- Prevents sparse local filesystem states from being mistaken for canonical truth

### Acceptance Criteria

- Opening a project on another machine restores from Git state, not replica heuristics
- Open flow never silently degrades canonical state

## Phase 5 — Yjs Durability Routes Through Git

### Objective

Keep Yjs for live state while changing the durable sync tail from replica snapshots to Git commits.

### Changes

- Keep `YjsProjectContext` and `useYjsFileWriteback`
- Keep `ProjectFilesPersistence` as the product-history logger
- Replace replica enqueueing in `ProjectFilesPersistence` with Git batching

### New Behavior

- Local Yjs-originated file changes still:
  - write to disk
  - log activity to Convex
  - update tombstones
- But then they trigger:
  - queued Git sync
  - auto-commit
  - auto-push

### Commit Policy

- Debounced commit on idle
- Immediate commit before pull if dirty
- Immediate commit on close / critical transition
- Mechanical commit messages, e.g. `cozea: sync workspace`

### Impact

- Live collaboration UX remains nearly identical
- Durable cloud state becomes real Git `main`

### Acceptance Criteria

- Remote collaborator edits eventually appear in Git-backed canonical state without manual action
- Changes page remains driven by Convex activity, not Git history

## Phase 6 — Create / Import / Build Becomes Repo-Native

### Objective

Stop creating/importing projects through replica upload.

### Changes

- `NewProject.tsx`
  - new project: init repo, create remote if needed, push `main`
  - import: clone or connect existing repo
- `ProjectBuild.tsx`
  - final durability step becomes commit + push
- `registerProjectHandlers.ts`
  - align project creation/import helpers with repo-native lifecycle

### Impact

- A project becomes shareable when its Cozea-managed repo exists and `main` is pushed
- No separate canonical replica upload is required

### Acceptance Criteria

- New projects are fully materialized in the repo on creation/build completion
- Imported projects open from Git state, not replica state

## Phase 7 — Sharing and Joining Uses Project Membership

### Objective

Keep sharing semantics aligned with the Cozea-managed Git remote.

### Changes

- Keep invite and join flows centered on `projectMembers`
- Make server-side Git auth use project membership directly
- Ensure every code path that grants project membership also grants repo access implicitly
- Remove any dependence on external provider collaborator grants

### Impact

- “Shared in Cozea but files missing” class of bug goes away
- Membership and repo access stay aligned by construction

### Acceptance Criteria

- A joined member can always fetch/open files
- There is no separate repo-access workflow beyond project membership

## Phase 8 — Runtime Workspaces Pull From Git

### Objective

Make preview/build/runtime materialization depend on Git `main`, not replica hydration.

### Changes

- Replace replica-based hydration in `server/src/routes/runtimeWorkspaces.ts`
- Runtime workspace startup becomes:
  - clone/fetch
  - checkout `main`
  - run preview/build

### Impact

- Preview/build environments use the same canonical state users sync against

### Acceptance Criteria

- Runtime workspace files match Git canonical state
- No hidden replica-only state exists for runtime execution

## Phase 9 — Migration of Legacy Replica Projects

### Objective

Move existing replica-backed projects to Git without breaking access.

### Changes

- Add migration job/tooling to:
  - read canonical replica state
  - reconstruct repo contents
  - create or attach Cozea-managed repo
  - push canonical state to `main`
  - mark project `syncMode="git"`

### Rollout Mode

- During migration:
  - `syncMode="replica"` projects keep using the old path
  - `syncMode="git"` projects use the new path

### Impact

- No big-bang cutover required

### Acceptance Criteria

- Existing projects can be migrated incrementally
- No data loss during migration

## Phase 10 — Remove Replica Engine

### Objective

Delete the old sync system after migration completes.

### Changes

- Remove:
  - `server/src/routes/replicaGit.ts`
  - `convex/projectReplicaGit.ts`
  - `convex/projectReplicaLfs.ts`
  - replica cleanup crons
  - replica schema tables
  - replica-specific UI logic

### Impact

- One sync model only
- Less custom merge/debug logic
- Fewer failure classes

### Acceptance Criteria

- No active project depends on replica data
- All open/create/import/share flows run entirely on Git-backed logic

## Cross-Cutting Decisions

## 1. `main` Ownership

Cozea owns `main` for synced projects.

Implications:
- Cozea can auto-commit and auto-push freely
- Manual human-readable history is not required
- External Git workflows are not the product target

## 2. History UX

The Git log is infrastructure only.

The user-facing history remains:
- `activity`
- `fileChanges`
- comments
- reactions
- tasks

## 3. Conflict Policy

Conflicts should be rare in live-collab cases because Yjs remains the hot path.

Conflicts can still occur when:
- a user edits locally while offline
- the repo advanced remotely outside current Yjs session scope
- a machine has uncommitted local changes before pull

Resolution stays in product UI, not raw Git CLI.

## 4. Access Control

Project access and repo access must be aligned by construction.

The Cozea-managed Git remote should authorize by project membership. There should be no separate grant path.

## 5. Observability

Add structured logs for:
- fetch/pull/push lifecycle
- auto-commit triggers
- ahead/behind state
- conflict paths
- repo access failures

This is required for rollout safety.

## Risks

- Overly frequent auto-commits can cause repository churn
- Poor debounce policy can make push latency too visible
- Incorrect server-side Git authorization can break open/share flows if not reconciled
- Migration of binary/LFS-heavy projects needs dedicated handling

## Recommended Execution Order

1. Phase 1 — metadata
2. Phase 2 — Cozea Git remote
3. Phase 3 — Electron Git service
4. Phase 4 — open flow
5. Phase 5 — Yjs durability through Git
6. Phase 6 — create/import/build
7. Phase 7 — sharing/joining
8. Phase 8 — runtime workspaces
9. Phase 9 — migration
10. Phase 10 — replica deletion

## Immediate Next Step

Start with:

- project schema and metadata
- the Cozea-managed Git remote
- the new Electron Git sync service
- a Git-native project open check against the Cozea remote

That creates the first usable vertical slice without touching migration or sharing yet.
