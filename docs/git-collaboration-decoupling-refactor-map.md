# Git / Collaboration Decoupling Refactor Map

Last reviewed: 2026-04-15

## Implementation Status

This map is now implemented on the active product path.

### Completed on the live path

- websocket-only client collaboration path through [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx) and [CollabWsProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/CollabWsProvider.ts)
- git removed from collaborative durability in:
  - [ProjectSyncProviderRuntime.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/contexts/ProjectSyncProviderRuntime.tsx)
  - [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts)
  - [useYjsFileWriteback.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useYjsFileWriteback.ts)
  - [BinaryFileSync.ts](/Users/admin/Downloads/electron-app-main/src/lib/sync/BinaryFileSync.ts)
- project open moved onto a local-first Cozea path in:
  - [projectOpenLocal.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenLocal.ts)
  - [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)
- branch compatibility simplified to:
  - shared branch = collaboration enabled
  - non-shared branch = local-only mode
- last-branch memory now uses the smaller [projectBranchSessionStore.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectBranchSessionStore.ts)
- project creation and local import no longer require remote repo setup in:
  - [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
  - [useLocalProjectImport.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useLocalProjectImport.ts)
  - [convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- member/share flows no longer automate repo access in:
  - [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)
  - [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
- active project and settings flows now use a smaller repository-integration mental model instead of exposing git sync / collab-branch controls by default:
  - [projectRepositoryIntegration.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepositoryIntegration.ts)
  - [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
  - [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx)
  - [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- new project creation no longer writes default git-sync metadata just because a repository is attached:
  - [convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- project records no longer carry `syncMode`, `sourceControl.activeCollabBranch`, or `sourceControl.syncPolicy` on the active schema path:
  - [schema.ts](/Users/admin/Downloads/electron-app-main/convex/schema.ts)
  - [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
  - [projectPagination.ts](/Users/admin/Downloads/electron-app-main/convex/lib/projectPagination.ts)
- stale git-era helpers were removed from the active tree:
  - [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
  - [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
  - [projectLaneContext.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectLaneContext.ts)
  - [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts)
- end-to-end encrypted collaboration is now active on the websocket collaboration path through:
  - [collabKeys.ts](/Users/admin/Downloads/electron-app-main/electron/collabKeys.ts)
  - [CollabEncryptionService.ts](/Users/admin/Downloads/electron-app-main/electron/services/CollabEncryptionService.ts)
  - [collab.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts)
  - [yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts)
  - [cipherEnvelope.ts](/Users/admin/Downloads/electron-app-main/src/lib/collab/cipherEnvelope.ts)
  - [EncryptedLocalSnapshotStore.ts](/Users/admin/Downloads/electron-app-main/src/lib/collab/EncryptedLocalSnapshotStore.ts)
  - [useCollabSession.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useCollabSession.ts)
  - [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx)
- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
- legacy plaintext room assumptions have been removed from the live collaboration path; any stale pre-encryption payloads are cleared when a shared room initializes
- trusted-device key sharing, recovery-code based non-destructive device recovery, key rotation, automatic key rotation on device revocation, destructive room recovery, and revoked-device blocking are now implemented on the active encrypted collaboration path

## Goal

Refactor Cozea so collaboration is fully Cozea-native and git becomes optional, explicit tooling.

The target product model is:

- opening a project never depends on GitHub, repo access, clone, branch state, or provider automation
- live collaboration is powered by Cozea membership + Yjs + websocket transport + local writeback
- project durability is Cozea durability, not auto-commit / auto-push
- project creation never requires a remote repository
- git remains available only as explicit user tooling, similar in spirit to `t3code`

This document is a concrete refactor map against the current codebase, not just a product note.

## Non-goals

- Do not remove the ability to use git locally.
- Do not remove terminals or manual command-line workflows.
- Do not remove the ability to connect GitHub as an optional integration.
- Do not rewrite the Yjs collaboration layer unless needed for durability cleanup.

## Product Decision

After this refactor, the source of truth for collaboration is:

- Cozea project membership
- Cozea collaborative document state
- Cozea awareness / presence
- local filesystem materialization on each device

Git becomes:

- local branch tooling
- commit / push / pull / PR tooling
- optional remote repository attachment
- optional export / import / publish workflow

This means a project with no git remote must still feel fully first-class.

## Collaboration Transport Decision

Cozea will standardize on:

- one dedicated websocket collaboration transport
- one collaboration protocol
- one room/session model

Cozea will not keep:

- a mixed Convex-tail vs websocket runtime path for normal live collaboration
- duplicate transport semantics in the renderer

### Why

- a single websocket collaboration path is a cleaner enterprise architecture
- it gives us tighter control over:
  - sequencing
  - acknowledgements
  - reconnect behavior
  - room lifecycle
  - observability
  - encrypted collaboration behavior
- it reduces conceptual duplication in [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx), where we currently branch between websocket and Convex providers

### Important nuance

This does **not** mean the server stops existing in the collaboration path.

In the current app, websocket collaboration still persists updates server-side through:

- [server/src/routes/collab.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts)
- [convex/yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts)

So the websocket decision is about:

- transport quality
- protocol control
- architecture clarity

not about avoiding the server entirely.

## Encryption Direction

Encryption is now part of the live websocket collaboration path.

Detailed architecture: [collaboration-encryption-architecture.md](./collaboration-encryption-architecture.md)

Target sequence:

1. standardize on websocket-only collaboration
2. simplify collaboration semantics and remove git coupling
3. add encryption on top of the websocket collaboration model

### Encryption intent

The desired future state is:

- server stores collaboration payloads as opaque encrypted blobs
- clients hold the decryption capability
- collaboration metadata can remain server-visible as needed for routing and authorization
- file contents are unreadable to the server on the encrypted collaboration path

The sequencing logic above is now what the repo follows in practice: transport unification first, then git decoupling, then encryption.

## Current Coupling Inventory

Today git is still deeply involved in collaboration and project open.

### 1. Project open is git-gated

Current open flow in [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts):

- resolves remote config through [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts)
- checks source-control readiness through [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- checks / provisions repository access through [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- ensures collab lane state before open
- prepares local git repo state before navigation

This flow is called directly from [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx).

### 2. Collaborative durability is routed through git

The collaboration runtime currently attaches git durability at multiple points:

- [ProjectSyncProviderRuntime.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/contexts/ProjectSyncProviderRuntime.tsx)
- [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts)
- [useYjsFileWriteback.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useYjsFileWriteback.ts)
- [BinaryFileSync.ts](/Users/admin/Downloads/electron-app-main/src/lib/sync/BinaryFileSync.ts)

All of those rely on [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts), which:

- debounces collaborative edits
- ensures / initializes local git repo state
- commits all changes
- fetches / rebases / pushes
- treats `syncPolicy` as the durability contract

That is the biggest architectural coupling in the app.

### 3. Collaboration semantics are branch-shaped

The lane model is currently git-shaped:

- registry: [projectLaneRegistry.ts](/Users/admin/Downloads/electron-app-main/electron/projectLaneRegistry.ts)
- renderer hook: [useProjectLaneState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts)
- workbench control: [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)

The current concepts:

- `collabLane`
- personal lanes
- worktrees
- branch switching

all implicitly teach users that collaboration is fundamentally a git branch workflow.

### 4. Membership and sharing still trigger repo automation

Repository access automation appears in collaboration-adjacent surfaces:

- [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)
- [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
- [projectRepoAutomation.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAutomation.ts)

That means:

- removing a member can revoke repo access
- inviting a member can sync provider access
- sharing can flush git before invite/share

This is exactly the coupling the refactor should remove.

### 5. Project creation still assumes remote automation matters early

[CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx) currently:

- reads workspace source-control readiness
- blocks some creation/import flows on GitHub setup
- provisions project bindings through `api.sourceControl.upsertProjectBinding`

That makes git feel like part of project creation, not an optional later step.

### 6. Project data model still carries too much git-first product meaning

Current project records still bundle collaboration-adjacent behavior into git-shaped fields in:

- [convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- [convex/sourceControl.ts](/Users/admin/Downloads/electron-app-main/convex/sourceControl.ts)

Examples:

- `sourceControl.activeCollabBranch`
- `sourceControl.syncPolicy`
- `sourceControl.workingCopyMode`
- `sourceControl.setupMode`
- project `syncMode`

This makes the core project entity heavier and more git-opinionated than the product should be.

### 7. Project settings still treat source control as core project behavior

Source-control assumptions are embedded into:

- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
- [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx)
- [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts)

Current project settings still expose:

- remote repo binding
- active collab branch
- auto sync
- setup mode

Those should no longer define how collaboration works.

### 8. Error handling still assumes git is part of project access

[projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts) maps many project-open failures to:

- repo corruption
- missing provider identity
- pending repository invitation
- project history not ready

That whole layer should get much smaller once git is off the critical path.

## Desired End State

### Project open

Open flow should become:

1. check Cozea project membership
2. resolve or create local project folder
3. hydrate from local cache / Yjs snapshot
4. start collaboration session
5. render workbench

It should not:

- check source-control readiness
- check repository invitations
- clone repo
- ensure collab branch
- create or switch worktrees

### Collaboration durability

Durability should become:

- Yjs document state
- websocket-backed collaborative persistence
- local filesystem writeback
- local cache / IndexedDB recovery

It should not:

- auto-stage changes
- auto-commit
- auto-fetch
- auto-rebase
- auto-push

### Git usage

Git should be explicit and manual:

- if the local folder is a git repo, Cozea can show passive status
- if the user wants to branch / commit / push / create PRs, they do so manually
- those actions may be available in the UI, but never block collaboration

### Branch switching and collaboration

This is the most important constraint to preserve during the refactor:

- one live collaboration session can only exist against one stable working tree
- switching git branches rewrites the working tree
- therefore branch switching must immediately disable collaboration

So the target rule is:

- shared branch/context = collaboration enabled
- any other branch = local-only mode

This means we are **not** saying “git does not matter at all”.
We are saying:

- git is not the collaboration backbone
- but branch divergence still defines whether the current working tree is compatible with the shared Yjs document universe

### Remembered branch behavior

Branch choice should remain fully manual, but Cozea should remember the user’s last local branch per project on that device.

That remembered state should be:

- per user
- per project
- per device
- last opened local branch
- last collaboration-capable branch context

On reopen:

- if the project opens on the shared branch, Cozea can enable collaboration
- if it opens on a remembered non-shared branch, Cozea opens in local-only mode

## Collaboration / Branch State Model

The product state model should become:

### State A: Shared collaborative mode

- working tree matches the project’s shared branch/context
- Yjs collaboration is attached
- presence is attached
- remote file writeback is enabled
- Cozea sync UI is active

### State B: Local branch mode

- working tree is on a non-shared branch
- Yjs collaboration is detached
- presence is detached
- remote writeback is disabled
- project remains fully usable locally
- git operations remain manual

### Transition: shared branch -> local branch

When the user manually switches away from the shared branch:

1. Cozea detects requested branch change
2. Cozea detaches Yjs collaboration first
3. Cozea stops collaboration writeback/presence
4. branch switch proceeds
5. UI enters local-only branch mode

### Transition: local branch -> shared branch

When the user manually returns to the shared branch:

1. Cozea detects branch compatibility with the shared collaboration context
2. if the working tree is safe to reattach, collaboration is re-enabled
3. Yjs room / awareness reconnect
4. UI returns to collaborative mode

### Critical invariant

Yjs state must never span incompatible branch working trees.

That means:

- no single collaboration room for multiple branches
- no collaboration writeback while on a non-shared branch
- no silent branch switch while still attached to the shared collab room

## Surface-by-Surface Target Behavior

## Create project

After the refactor:

- creating an empty project should never require GitHub readiness
- importing a local folder should never require creating a remote first
- creating a remote repository should become an optional follow-up action
- the default project entity created in Convex should be collaboration-ready without any source-control payload
- repo binding, if desired, should happen later as an explicit optional attach step

Main surface:

- [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)

## Open project

After the refactor:

- clicking a project in the sidebar should always attempt a Cozea-native open first
- local path resolution stays
- local folder creation or recovery stays
- collaboration hydration stays
- git clone / remote history repair / repo access checks disappear from the default path

Main surface:

- [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)

## Close project

After the refactor:

- closing or backgrounding a project should not flush git state
- closing should only flush Cozea collaboration state if needed
- no branch / lane cleanup should be required to safely close a project

Main areas affected:

- workbench session lifecycle
- project sync runtime shutdown
- any remaining `beforeunload` git hooks inherited from [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts)

## Workbench header

After the refactor:

- the workbench header identity should be project-first, not branch-first
- collaboration status can stay visible
- branch status should move to optional git tooling if we keep it

Main surfaces:

- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx)

## Members and invites

After the refactor:

- inviting someone means they can collaborate in Cozea
- adding or removing someone should not grant or revoke provider repo access
- repo-access status badges disappear from team management

Main surface:

- [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)

## Share button / join links

After the refactor:

- the share button should only manage Cozea links and Cozea membership
- it should not flush git first
- it should not depend on provider automation state

Main surface:

- [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)

## Project settings

After the refactor:

- project settings should lead with project metadata and collaboration settings
- optional repository settings should become secondary
- “active collab branch” should disappear from core settings
- “auto sync” should stop meaning git auto-sync

Main surfaces:

- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
- [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx)

## Workspace source control settings

After the refactor:

- this page becomes optional repo integration setup
- it is no longer part of project collaboration onboarding
- the copy should teach “connect GitHub if you want repo tooling”, not “connect GitHub so collaboration works”

Main surface:

- [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)

## Sync status UI

After the refactor:

- sync means Cozea sync
- online/offline state remains useful
- upload/download phrasing should only be used if it truly refers to Cozea collaboration transport
- any git-specific success language should move to optional git tooling

Main surface:

- [ProjectSyncIndicator.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSyncIndicator.tsx)

## Local storage / project folders

After the refactor:

- local folders remain important
- storage repair still matters
- deleting a local project copy should not be framed as repairing git first
- restore should prefer local cache and Cozea collaborative state

Main surfaces:

- [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts)

## Activity and audit

After the refactor:

- file activity continues to be logged
- activity should reflect Cozea collaboration events, not git publication
- if we later want explicit publish history, that should be a separate git activity stream

Main surface / infra:

- [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts)
- [convex/activity.ts](/Users/admin/Downloads/electron-app-main/convex/activity.ts)

## Refactor Strategy

This should not be done as a big bang. The safe path is:

1. standardize on websocket-only collaboration transport
2. remove git from the collaboration hot path
3. remove git from project open
4. demote git/GitHub UI from collaboration and sharing surfaces
5. simplify the lane / branch model
6. only then delete stale git-collaboration abstractions
7. add encryption on top of the unified websocket collaboration path

## Phase Map

## Phase 0: Standardize On Websocket-Only Collaboration

Status: completed on the active client path

### Goal

Collapse collaboration onto one dedicated websocket transport before deeper product simplification.

### Files to change

- [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx)
- [CollabWsProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/CollabWsProvider.ts)
- [useCollabSession.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useCollabSession.ts)
- [YConvexProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexProvider.ts)
- [YConvexAwarenessProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexAwarenessProvider.ts)
- [server/src/routes/collab.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts)
- [convex/yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts)
- [convex/yjsAwareness.ts](/Users/admin/Downloads/electron-app-main/convex/yjsAwareness.ts)

### Exact changes

- Remove the runtime branch in [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx) that chooses between websocket and Convex-tail collaboration.
- Make websocket session bootstrap the single normal live-collaboration path.
- Keep Convex persistence as backend storage only, not as a parallel client transport.
- Demote or remove [YConvexProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexProvider.ts) and [YConvexAwarenessProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexAwarenessProvider.ts) from the active client transport path.
- Keep [server/src/routes/collab.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts) as the collaboration gateway and harden it as the enterprise realtime entrypoint.
- Keep [convex/yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts) and [convex/yjsAwareness.ts](/Users/admin/Downloads/electron-app-main/convex/yjsAwareness.ts) as persistence/storage infrastructure behind the websocket path until encryption lands.

### Outcome

There is one collaboration transport to reason about, one room/session protocol, and one encrypted collaboration surface.

## Phase 1: Stop Git From Participating In Collaborative Durability

Status: completed on the active collaboration path

### Goal

Collaborative edits should persist to Cozea and local disk only.

### Files to change

- [ProjectSyncProviderRuntime.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/contexts/ProjectSyncProviderRuntime.tsx)
- [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts)
- [useYjsFileWriteback.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useYjsFileWriteback.ts)
- [BinaryFileSync.ts](/Users/admin/Downloads/electron-app-main/src/lib/sync/BinaryFileSync.ts)
- [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts)
- [ProjectSyncIndicator.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSyncIndicator.tsx)

### Exact changes

- Remove `GitDurabilityCoordinator` usage from:
  - `triggerSync`
  - Yjs file persistence
  - remote writeback
  - binary sync
- Redefine `triggerSync` in [ProjectSyncProviderRuntime.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/contexts/ProjectSyncProviderRuntime.tsx) to mean:
  - flush local pending collaboration state
  - or re-run Cozea sync/reconciliation
  - never perform git operations
- Update [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts) comment and behavior so it becomes:
  - activity log persistence
  - Cozea durability scheduling
  - not git durability
- Update [BinaryFileSync.ts](/Users/admin/Downloads/electron-app-main/src/lib/sync/BinaryFileSync.ts) so binary changes queue Cozea persistence, not git sync.
- Delete [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts) entirely once no longer referenced, or temporarily replace it with a thin no-op compatibility shim if the rollout is staged.
- Reword [ProjectSyncIndicator.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSyncIndicator.tsx) so:
  - “sync” means Cozea collaboration sync
  - it does not imply git upload/download semantics

### Outcome

Live collaboration stops depending on git entirely.

## Phase 2: Remove Git From Project Open

Status: completed on the default project-open path

### Goal

Opening a project should never require GitHub/provider setup or repo access.

### Files to change

- [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)
- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- [projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts)
- any route state still depending on `syncMode: "git"`

### Exact changes

- Replace `prepareGitProjectForOpen(...)` in [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) with a new Cozea-native open helper such as `prepareProjectForOpen(...)`.
- New open helper should only:
  - resolve local path
  - remember local path
  - ensure local folder exists if needed
  - optionally restore local snapshot / hydrate state
- Remove calls to:
  - `ensureProjectSourceControlReadyForOpen`
  - `ensureProjectRepositoryAccessForOpen`
  - remote git reconciliation
  - collab lane bootstrapping
- Delete or strongly demote [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts). Its logic should only be reachable from explicit repo actions later.
- Delete or heavily shrink [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts).
- Simplify [projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts) so project-open errors are about:
  - membership
  - billing / seat
  - local path / storage repair
  - collaboration snapshot recovery
  - not repo access and branch history repair

### Outcome

Project open becomes Cozea-first and much more reliable.

## Phase 3: Stop Treating Lanes As Branches

Status: completed for the active workbench model, with smaller branch-session compatibility still intentionally retained

### Goal

The workbench should no longer present collaboration as a git-lane workflow, while still respecting that branch switching disables collaboration.

### Files to change

- [projectLaneRegistry.ts](/Users/admin/Downloads/electron-app-main/electron/projectLaneRegistry.ts)
- [useProjectLaneState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts)
- [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)
- [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx)
- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [projectSidebarShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarShared.ts)

### Exact changes

- Remove the concept that every project has a git-backed `collabLane` that collaboration depends on.
- Replace it with a simpler branch compatibility model:
  - shared branch/context => collaborative mode
  - non-shared branch => local-only mode
- Keep branch switching fully manual.
- Make Cozea remember the last branch used locally for each project on each device.
- Replace [useProjectLaneState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts) and [projectLaneRegistry.ts](/Users/admin/Downloads/electron-app-main/electron/projectLaneRegistry.ts) with a smaller dedicated branch session store such as `projectBranchSessionStore`, whose only job is:
  - remember the last branch used for a project on this device
  - remember whether that branch is the shared collaboration branch or a local-only branch
  - restore reopen behavior without carrying lane/worktree semantics
- Remove personal-lane/worktree creation as the default branch-switch behavior in [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts).
- Before any branch switch away from the shared branch, explicitly detach Yjs collaboration.
- When switching back to the shared branch, allow collaboration reattach.
- Remove the branch control from the default collaboration identity in the workbench header, or at minimum make its mode explicit:
  - `Shared branch · Live`
  - `Feature branch · Local only`
- If manual git tooling remains prominent, move it behind an optional git tool surface instead of the core collaboration header.

### Outcome

Users stop learning that collaboration equals “shared branch + personal branch”, while Cozea still safely prevents Yjs from spanning incompatible branch states.

## Phase 4: Demote GitHub / Source Control To Optional Tooling

Status: completed on the active product path

### Goal

GitHub integration should become optional repo tooling, not collaboration setup.

### Files to change

- [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [useWorkspaceSourceControl.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useWorkspaceSourceControl.ts)
- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
- [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx)
- [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
- [RepositoryProvisioner.tsx](/Users/admin/Downloads/electron-app-main/src/components/git/RepositoryProvisioner.tsx)
- [providerRepositoryManagement.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/providerRepositoryManagement.ts)

### Exact changes

- Reframe [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx) as optional “Git Providers” or “Repository Integrations”, not something collaboration needs.
- In [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx), split project settings into:
  - core project settings
  - optional repository settings
- Remove “active collab branch” and “auto sync” from the default mental model.
- In [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx), keep only explicit repo-attachment settings such as:
  - provider
  - repo URL
  - default branch for manual tooling if we still want it
- In [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx), remove source-control readiness as a blocker for normal project creation and local import.
- Repository provisioning should become an optional step after project creation, not part of collaboration bootstrap.
- New projects should be created with the minimum collaboration-first metadata only; repo metadata should only be written if the user explicitly opts into repository setup.

### Outcome

Users can collaborate without ever thinking about GitHub.

## Phase 5: Remove Repo Automation From Membership And Sharing

Status: completed on the live membership/share surfaces

### Goal

Project invites and member management should be purely Cozea-level concerns.

### Files to change

- [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)
- [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
- [projectRepoAutomation.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAutomation.ts)
- [projectRepoAccess.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAccess.ts)
- related Convex repo-access endpoints once UI is removed

### Exact changes

- Remove repo-access status badges and repository invitation logic from [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx).
- Remove `flushProjectBeforeShare` git behavior from [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx).
- Sharing a project should only:
  - create / revoke Cozea invites
  - manage Cozea project membership
  - optionally create a Cozea join link
- Move [projectRepoAutomation.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAutomation.ts) out of collaboration surfaces. Keep it only for explicit repo admin actions if still needed.
- Demote [projectRepoAccess.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAccess.ts) to optional git tooling status computation.

### Outcome

Invites stop implying repo access.

## Phase 6: Simplify Project Data Model

Status: completed on the active model, with optional repository-binding compatibility fields intentionally retained

### Goal

Project collaboration metadata should no longer be branch-centric.

### Current model pressure points

[convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts) and [convex/sourceControl.ts](/Users/admin/Downloads/electron-app-main/convex/sourceControl.ts) currently still carry fields that collaboration depends on:

- `sourceControl.provider`
- `sourceControl.repoUrl`
- `sourceControl.activeCollabBranch`
- `sourceControl.defaultBranch`
- `sourceControl.syncPolicy`
- `sourceControl.workingCopyMode`
- `sourceControl.setupMode`

### Target model

Project records should separate:

- collaboration metadata
- optional repo integration metadata

Suggested shape:

- collaboration:
  - collaboration enabled
  - last durable snapshot metadata
  - local materialization hints
- repository integration:
  - provider
  - repo URL
  - optional manual branch preference
  - optional provider connection metadata

### Strong simplification rule

The base `projects` entity should not need git-shaped fields to exist or function.

That means the default project record should be able to work with:

- identity
- ownership / organization
- local path hints
- collaboration metadata
- optional imported-from metadata

And nothing else.

Git-specific fields should move behind an optional nested repository integration object and only exist when the user actually attaches a repo.

### Migration approach

- Do not delete existing source-control fields immediately.
- First stop reading them from collaboration and project-open code.
- Then migrate them to an optional repo integration object.
- Simplify project creation so new projects stop writing unnecessary git/source-control defaults into the project record.
- Only after the UI and open flow are stable should schema cleanup happen.

### Outcome

The schema stops encoding “git branch = collaboration branch”.

## Phase 7: Reframe The UI Language

Status: completed on the main user-facing settings and collaboration surfaces

### Goal

The app should stop teaching users that git is part of collaboration.

### UI changes

- Project open errors should not mention GitHub setup unless the user is doing an explicit repo action.
- “Sync” in collaboration surfaces should mean Cozea collaboration sync.
- “Source Control” should become optional tooling language.
- The default workbench header should not foreground branch state as the main collaboration identity.
- Project settings should lead with:
  - members
  - collaboration
  - sharing
  - storage / local folder
  - optional repo integration

### Files most affected

- [ProjectSyncIndicator.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSyncIndicator.tsx)
- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)
- [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts)

## Backend / Schema Map

These backend areas will need careful treatment once the frontend is off the git path.

## Keep as collaboration backend

- [convex/yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts)
- [convex/yjsAwareness.ts](/Users/admin/Downloads/electron-app-main/convex/yjsAwareness.ts)
- [convex/projectMembers.ts](/Users/admin/Downloads/electron-app-main/convex/projectMembers.ts)
- [convex/projectJoinLinks.ts](/Users/admin/Downloads/electron-app-main/convex/projectJoinLinks.ts)

## Demote from core collaboration

- [convex/sourceControl.ts](/Users/admin/Downloads/electron-app-main/convex/sourceControl.ts)
- repo-access tables and mutations used by repository invitation automation

## Migrate carefully

- [convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)

Migration rule:

- first stop using git fields for collaboration logic
- then move them into optional repository integration metadata
- only then delete or rename schema fields

## File-by-File Action Map

## Remove from collaboration path

- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts)
- [projectLaneRegistry.ts](/Users/admin/Downloads/electron-app-main/electron/projectLaneRegistry.ts)
- [useProjectLaneState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts)
- [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)

## Keep as core collaboration infrastructure

- [YjsProjectContext.tsx](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx)
- [CollabWsProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/CollabWsProvider.ts)
- [useCollabSession.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useCollabSession.ts)
- [ProjectSyncProviderRuntime.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/contexts/ProjectSyncProviderRuntime.tsx)
- [ProjectFilesPersistence.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/ProjectFilesPersistence.ts)
- [useYjsFileWriteback.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useYjsFileWriteback.ts)

## Keep as collaboration persistence infrastructure

- [server/src/routes/collab.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts)
- [convex/yjs.ts](/Users/admin/Downloads/electron-app-main/convex/yjs.ts)
- [convex/yjsAwareness.ts](/Users/admin/Downloads/electron-app-main/convex/yjsAwareness.ts)

## Remove from active client transport path

- [YConvexProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexProvider.ts)
- [YConvexAwarenessProvider.ts](/Users/admin/Downloads/electron-app-main/src/lib/yjs/YConvexAwarenessProvider.ts)

## Demote to optional git tooling

- [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts)
- [projectRepoAutomation.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAutomation.ts)
- [projectRepoAccess.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectRepoAccess.ts)
- [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [ProjectSettingsSourceControlPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/settings/ProjectSettingsSourceControlPanel.tsx)
- [RepositoryProvisioner.tsx](/Users/admin/Downloads/electron-app-main/src/components/git/RepositoryProvisioner.tsx)

## Simplify after rollout

- [projectCloudAccessPresentation.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectCloudAccessPresentation.ts)
- [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)
- [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
- [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)

## Rollout Order

This is the safest order:

1. Remove git durability from collaborative write paths.
2. Standardize on websocket-only collaboration transport.
3. Remove git gating from project open.
4. Make sharing / invites purely Cozea-level.
5. Hide or demote branch / lane UI from the main workbench.
6. Simplify project settings and project creation.
7. Migrate project schema semantics.
8. Delete stale git-collaboration code.
9. Add encryption on top of the websocket collaboration model.

## Compatibility Plan

### Transitional behavior

During the rollout:

- existing projects may still have `sourceControl` metadata
- existing local folders may still be git repos
- existing UI can continue to show passive git state if present
- existing users may still reopen projects on remembered feature branches
- websocket collaboration may still persist through Convex storage while client-side transport is being unified

But:

- none of that should block project open
- none of that should participate in collaboration durability
- remembered non-shared branches should reopen in local-only mode, not silently rejoin collaboration

### Safe compatibility shims

Temporary shims are acceptable for:

- legacy `sourceControl` fields still being present on projects
- legacy route state still carrying `syncMode: "git"`
- workbench header still optionally showing git status if a repo exists
- a short-lived adapter that reads the old lane registry once and migrates the remembered branch into the new smaller branch session store on first open

Temporary shims are not acceptable for:

- repo access checks on project open
- auto-committing collaborative edits
- auto-pushing on sync

## Risks

### 1. Users who relied on automatic git publication may be surprised

Mitigation:

- make the product decision explicit
- keep manual git tooling visible where appropriate

### 2. Some recovery flows currently piggyback on git

Mitigation:

- define explicit Cozea recovery behavior:
  - restore from local cache
  - restore from Yjs/Convex state
  - rescan local project folder

### 3. Branch-control removal can feel like lost power

Mitigation:

- move git operations into an explicit Git tool surface rather than deleting capability

### 4. Silent collaboration reattach could corrupt state

Mitigation:

- make branch compatibility explicit
- only attach Yjs on the shared branch/context
- always detach before branch switch away from shared mode

## Success Criteria

The refactor is successful when all of these are true:

- a user can join and open a shared project without GitHub configured
- live collaboration uses one websocket transport path, not a websocket-vs-Convex client split
- collaborative edits never trigger automatic commits or pushes
- adding or removing project members does not touch provider repo access
- project open failures no longer mention repository invitations in the normal case
- the workbench no longer presents personal lanes/worktrees as the core collaboration model
- switching to another branch always disables collaboration safely
- reopening on a remembered feature branch opens in local-only mode
- a project with no git remote feels completely normal
- the architecture is ready for encrypted collaboration payloads as a follow-up phase

## Completed Execution Slice

The highest-value first slice described above has now been completed:

1. [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts) was removed from collaborative durability and deleted.
2. [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) now uses the local-first [projectOpenLocal.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenLocal.ts) helper instead of the old git-gated open flow.
3. [ProjectTeamPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx) and [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx) no longer automate repo access.
4. [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx) now creates collaboration-first projects without source-control readiness or default remote assumptions.

The remaining work is mostly compatibility cleanup and future-hardening, not the core product shift itself.
