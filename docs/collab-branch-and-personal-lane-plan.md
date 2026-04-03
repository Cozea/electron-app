# Collab Branch And Personal Lane Plan

## Goal

Split the current single-branch model into two clearly different concepts:

- `activeCollabBranch`
  - project-scoped
  - shared
  - set in project settings
  - the branch our sync/collab system plugs into
- `personal lane`
  - machine-local and user-local
  - changeable from the header
  - used for personal development, PRs, pulls, merges, and local experimentation

The end state should let someone:

- keep the project connected to one shared collab branch
- work locally on a different branch/lane
- open PRs from their lane
- merge their lane back into the collab branch manually
- avoid breaking sync just because they changed their personal local branch

## Why The Current Model Is Wrong

Today the app still collapses too much into `defaultBranch`.

- Project config resolves one branch from `sourceControl.defaultBranch` / `gitRepository.defaultBranch`: [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts#L84)
- In attached/local-existing mode, the app overrides that with the branch currently checked out in the local repo: [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts#L205), [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts#L465)
- Settings actions like fetch/pull/push/ensure still resolve around that same branch concept: [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx#L299)

That means the app currently mixes:

- shared sync target
- local checked-out branch
- provider default branch
- fallback repo initialization branch

Those should not be the same thing.

## Target Model

### 1. Project Branches

Project source control metadata should expose:

- `activeCollabBranch`
  - the branch the app syncs against
  - the branch used by project durability/collab flows
  - editable in project settings
- `repoDefaultBranch`
  - informational provider/repository default branch
  - used for initial setup only
  - not used as the live sync target once the project is configured

### 2. Local Personal Lane

Each machine/user should have a local lane record:

- `laneId`
- `projectId`
- `branch`
- `worktreePath` or `checkoutPath`
- `isPrimary`
- `lastOpenedAt`

This state should live locally, not in shared project config.

### 3. Runtime Split

The important rule:

- collab/sync runs against the collab checkout on `activeCollabBranch`
- personal branch switching happens in a separate local lane/worktree

That avoids the current failure mode where changing your local branch also changes what the app thinks it should sync.

## Best Architecture Choice

The safest design is **not** “one checkout that changes branches.”

The safest design is:

- one canonical project checkout for the collab branch
- one or more personal worktree lanes for user branches

Why this is better:

- branch switching does not destabilize sync
- terminals/browsers/dev server can be attached to a lane explicitly
- PR flows map naturally to a lane branch
- merging back into collab branch is a real git action, not a hidden side effect

This also matches the user-facing language you already used: “branch/lane”.

## Proposed Domain Model

### Shared Project Model

Rename and split these semantics:

- current:
  - `sourceControl.defaultBranch`
  - `gitRepository.defaultBranch`
- target:
  - `sourceControl.activeCollabBranch`
  - `gitRepository.repoDefaultBranch`

Optional:

- keep a temporary compatibility read path from old `defaultBranch`
- migrate old `defaultBranch` into `activeCollabBranch`

### Local Registry Model

Add a machine-local lane registry, likely beside the existing local path registry:

- `projectId`
- `baseProjectPath`
- `activeLaneId`
- `lanes[]`
  - `id`
  - `name`
  - `branch`
  - `checkoutPath`
  - `isCollabLane`
  - `createdAt`
  - `updatedAt`

The collab lane should be explicit.

Example:

- lane `collab`
  - branch `develop`
  - checkout `/Projects/foo`
- lane `alex-feature-auth`
  - branch `feature/auth`
  - checkout `/Projects/.cozea/worktrees/feature-auth`

## User Experience

### Project Settings

Project settings should manage the shared branch contract:

- show `Active collab branch`
- show `Repository default branch`
- explain that the collab branch is what the app syncs against
- changing it should be a deliberate project-level action

This is the right place for:

- active collab branch
- sync policy
- remote URL/provider
- merge policy defaults

This is **not** the right place for:

- “what branch am I personally on right now?”

### Header Controls

Header git controls should become lane controls, closer to T3’s pattern:

- branch selector
- lane selector or branch context
- PR actions
- pull / push
- merge into collab branch
- possibly “switch to collab lane”

The workbench header should answer:

- what lane am I in?
- what branch is this lane on?
- what is the collab branch target?

Suggested compact display:

- project name centered
- current lane branch pill beside it
- subtle indicator when branch differs from collab branch

Example:

- `crossand-plans` `feature/auth` `target: develop`

### Workbench Binding

Tiles should bind to a lane/workspace context, not to “whatever branch the repo happens to be on”.

At minimum:

- browser tile
- terminal tile
- dev server tile

should all know which lane they are attached to.

That gives the right future behavior:

- open a terminal in your personal lane
- run dev server there
- open browser attached to that lane
- keep collab lane separate

## Sync Rules

### Collab Sync

Git durability and collab sync should only use:

- collab lane path
- active collab branch

The sync engine should stop inferring branch from the user’s current local checkout.

That means:

- `resolveEffectiveProjectGitBranch(...)` should stop being “whatever local attached repo is on”
- sync flows should resolve a dedicated collab target branch/path instead

### Personal Lane Operations

Personal lane operations should use the active lane path/branch:

- checkout
- commit
- pull
- push
- PR open
- merge / rebase onto collab branch

They should not mutate the collab sync target unless the user explicitly changes the project setting.

## Git Operations We Should Support

For a personal lane:

- checkout branch
- create branch
- pull lane branch
- push lane branch
- open PR from lane branch to active collab branch
- merge collab branch into lane branch
- merge lane branch into collab branch

For the collab lane:

- sync/fetch/pull/push as the app’s shared branch
- optionally open PR from collab branch to provider default branch if needed

## Migration Plan

### Phase 1. Rename Semantics Without Behavior Split

Goal:

- stop calling the shared branch “default branch”

Changes:

- add `activeCollabBranch`
- add `repoDefaultBranch`
- migrate old `defaultBranch` values into `activeCollabBranch`
- keep compatibility reads from old fields temporarily

Result:

- project config language becomes honest
- runtime can still behave mostly as before during transition

### Phase 2. Introduce Local Lane Registry

Goal:

- stop treating the current checkout branch as shared project truth

Changes:

- add local lane registry
- add explicit collab lane entry
- add active personal lane selection

Result:

- branch context becomes local and persistent

### Phase 3. Move Sync To Collab Lane Only

Goal:

- branch switching no longer breaks sync

Changes:

- make sync service resolve collab path + active collab branch explicitly
- remove fallback logic that reads branch from arbitrary current checkout

Result:

- collab system has one stable branch target

### Phase 4. Add Header Lane Controls

Goal:

- user can actually work in their lane

Changes:

- branch selector in header
- create/switch lane
- pull/push/PR actions
- merge lane into collab branch
- merge collab branch into lane

Result:

- T3-style git workflow in the workbench

### Phase 5. Cleanup Old Default-Branch Assumptions

Goal:

- eliminate ambiguous branch semantics

Changes:

- remove code paths using `defaultBranch` as live sync branch
- remove “current local checkout decides sync target” logic
- rename misleading APIs where possible

Examples:

- `gitFetchMain` / `gitPullMain` / `gitPushMain` naming is misleading today because they are branch-parameterized already
- project runtime helpers should resolve `collabBranch`, not “effective branch” from local status

## Concrete File Areas To Touch

### Shared/Convex/Data Model

- [convex/schema.ts](/Users/admin/Downloads/electron-app-main/convex/schema.ts)
- [convex/projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- [convex/sourceControl.ts](/Users/admin/Downloads/electron-app-main/convex/sourceControl.ts)
- [shared/versionControl.ts](/Users/admin/Downloads/electron-app-main/shared/versionControl.ts)
- [shared/electronApiTypes.ts](/Users/admin/Downloads/electron-app-main/shared/electronApiTypes.ts)

### Branch Resolution / Sync

- [projectGitRuntime.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/projectGitRuntime.ts)
- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [GitDurabilityCoordinator.ts](/Users/admin/Downloads/electron-app-main/src/lib/git/GitDurabilityCoordinator.ts)
- [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)

### Local Lane Registry

Likely new files near:

- local path registry / project registry in `electron/`
- workbench store area in `src/stores/`

### Header / Workbench Git Controls

- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [WorkbenchHeaderEditorControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderEditorControl.tsx)
- new branch/lane control components in `src/features/projects/components/workbench/`

## Behavior Rules

These should be enforced explicitly:

1. `activeCollabBranch` is project-shared.
2. Personal branch is local-only.
3. Sync never follows arbitrary local branch changes.
4. PRs are created from the personal lane by default.
5. Merge into collab branch is always explicit.
6. Project settings change the collab branch, not the user’s lane.

## Recommended End State

The cleanest end state is:

- project settings:
  - active collab branch
  - repo default branch
  - sync policy
- header:
  - personal lane branch selector
  - pull/push/PR/merge controls
- runtime:
  - collab lane pinned to collab branch
  - personal lane/worktree for day-to-day development

That gives you:

- predictable sync
- real branch workflows
- less ambiguity
- a path toward richer lane-aware workbench tiles later

## Code Cleanup Checklist

After implementation, we should remove or rename these old assumptions:

- references where `defaultBranch` really means “active collab branch”
- any fallback that treats current checked-out branch as shared sync truth
- ambiguous function names like `resolveEffectiveProjectGitBranch`
- UI copy saying “default branch” when we really mean “collab branch”
- branch logic inside settings that conflates local branch with shared branch

## Recommended Execution Order

1. Introduce `activeCollabBranch` and compatibility migration.
2. Add local lane registry.
3. Make sync run only on collab lane/branch.
4. Add header branch/lane controls.
5. Add PR/merge actions from lane to collab branch.
6. Remove old `defaultBranch` coupling and naming.

## Short Version

The best plan is not:

- one branch field for everything
- one checkout that changes branch and also drives sync

The best plan is:

- one shared `activeCollabBranch`
- one local personal lane/worktree
- sync pinned to collab
- PR/merge work done from the personal lane

## Execution Log

### Completed In This Pass

1. Shared collab-branch compatibility landed.
2. Local lane registry foundation landed.
3. Workbench runtime now follows the active local lane path.
4. Workbench header git controls now follow the collab-lane/personal-lane split.
5. Durability/runtime cleanup now pins sync to the explicit collab branch instead of inferring from checkout state.

### What Changed

- Added `sourceControl.activeCollabBranch` to the shared project model and kept compatibility reads/writes through the old `defaultBranch` path while we transition.
- Updated branch resolution in the runtime to prefer `activeCollabBranch` over the legacy field.
- Added a machine-local Electron lane registry in [projectLaneRegistry.ts](/Users/admin/Downloads/electron-app-main/electron/projectLaneRegistry.ts) with explicit collab lane support.
- Added project IPC/preload APIs for lane state so renderer workbench code can read and switch lanes.
- Updated project settings to expose `Active Collab Branch` separately from the repository default branch.
- Updated workbench header branch switching to use T3-style `status + listBranches` data and to create/reuse personal worktree lanes instead of treating the shared checkout as the user branch lane.
- Updated the workbench runtime path so terminal/dev-server tiles run against the active lane path instead of always using the one shared project path.
- Added a shared lane git-context helper so workbench and settings resolve the same collab lane path, active lane path, and remote credential context instead of duplicating branch/auth logic.
- Updated the workbench header branch control to show lane-aware status, remembered personal lanes, lane pull/push actions, merge-collab-into-lane, and PR open/start behavior.
- Added an in-app Electron merge bridge so the active personal lane can be merged back into the collab checkout and pushed without treating the personal lane as the sync target.
- Updated settings to reuse the shared collab-lane resolver instead of maintaining a second copy of the collab path/branch preparation flow.
- Updated durability publishing/runtime hydration cleanup so the explicit collab branch is preferred in both the renderer durability path and the server runtime workspace hydrator.

### T3 Learnings Applied

- Use `git.status` plus `git.listBranches` together for the branch selector.
- Deduplicate `origin/*` refs when the matching local branch exists.
- Treat worktree-backed branches as reusable destinations rather than always creating new ones.
- Keep lane/worktree state local instead of storing it in shared project config.
- Keep the branch toolbar centered on “what checkout am I operating on?” instead of letting generic project metadata silently override the active lane.

### Still Left

- PR start currently opens the provider compare/new-PR URL (or the existing PR URL) rather than creating the PR fully inside the desktop UI.
- Deeper cleanup of old `defaultBranch` naming is still pending in compatibility-facing shared types and backend records.
- Broader lane-awareness across every project surface is still incomplete outside the workbench/runtime path.

### Verification

- `bun run typecheck`
- `cd server && bun run build`
