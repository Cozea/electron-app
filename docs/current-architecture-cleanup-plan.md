# Current Architecture Cleanup Plan

## Purpose

Clean up the app as it exists today.

This plan is not a shell rewrite, not a "make it more Codex-like" redesign, and not a justification for replacing the current route/layout system.

The goal is to remove migrated cruft, narrow responsibilities, and modernize inherited code while preserving the current product model:

- workspace-aware
- project-aware
- workbench-centered
- Electron-first

The current app already has a real shell, a real header composition system, and a real workbench model. The cleanup work should respect those.

## What We Got Wrong Before

The previous plan drifted into architecture replacement instead of cleanup.

That was the wrong framing.

The current app already has:

- a shell owner in [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx)
- a shared header composition system in [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx), [useProjectChromeHeader.tsx](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectChromeHeader.tsx), and [useProjectHeader.ts](<home>/Downloads/electron-app-main/src/hooks/useProjectHeader.ts)
- a project/workbench route model in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- a real workbench-centric runtime surface in [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)

So the correct plan is:

- preserve the existing shell and header architecture
- clean migrated leftovers inside it
- reduce duplication and dead paths
- split large files only where responsibility boundaries are already visible

## Core Principles

### Preserve Existing Ownership

Do not introduce a new shell layer if the current one already owns the concern.

Current canonical owners:

- app/project shell: [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx)
- header composition: [useProjectChromeHeader.tsx](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectChromeHeader.tsx) + [useProjectHeader.ts](<home>/Downloads/electron-app-main/src/hooks/useProjectHeader.ts)
- workbench runtime page: [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- workbench tiles/runtime: [WorkbenchDockPanels.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDockPanels.tsx)

### Clean Up Migrated Structure, Don’t Replace It

This app was migrated from an older product shape. The right job is to remove drift:

- dead compatibility
- stale naming
- duplicate stores/helpers
- route aliases that should be tiny shims
- giant files carrying concerns from older eras

Not to replace the app with a new abstraction stack.

### Desktop UX Is a Hard Constraint

This is an Electron desktop app. Local surfaces should not feel like cloud pages.

That means:

- avoid new full-screen route loading states for local transitions
- prefer preserving shell continuity during route changes
- keep local runtime surfaces feeling immediate
- do not add extra shell layers that create visual churn

### Header Layout Is Already Solved

The current workbench header pattern is the one to preserve:

- left: static shell/workbench controls
- center: workbench identity
- right: global shell actions

Do not move project admin, team navigation, or sync status into unrelated header clusters.

## Non-Goals

- replacing `ProjectLayout` with a new runtime shell
- replacing the current header model
- changing the core route hierarchy just to fit a new IA theory
- removing workspace/project concepts
- turning the app into a thread-first chat shell
- sweeping visual redesign without first cleaning structure

## Canonical Current Model

The current app should be understood as:

1. workspace
2. project
3. per-project workbench
4. tiles inside workbench

That is already reflected in the code:

- workspace and scope resolution: [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts)
- project shell and route ownership: [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx)
- project/workbench routes: [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- workbench runtime: [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- per-project workbench state: [useProjectWorkbenchStore.ts](<home>/Downloads/electron-app-main/src/stores/useProjectWorkbenchStore.ts)

The cleanup plan should sharpen this model, not replace it.

## Real Cleanup Targets

### 1. Route and Compatibility Drift

The route tree still carries migrated compatibility paths and fallback-era behavior.

Primary files:

- [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- [ProjectsLaunchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectsLaunchPage.tsx)
- [LegacyProjectRedirectPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx)
- [projectRoutes.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts)
- [projectShare.ts](<home>/Downloads/electron-app-main/shared/projectShare.ts)
- [AcceptInvitation.tsx](<home>/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx)

Cleanup objective:

- identify which routes are true product paths
- reduce old aliases to tiny compatibility redirects
- remove dead compatibility helpers
- stop carrying dead invite/join assumptions

### 2. Layout and Header Cleanup Inside Existing Shell

The shell is correct, but still carries migrated complexity.

Primary files:

- [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx)
- [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx)
- [useProjectChromeHeader.tsx](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectChromeHeader.tsx)
- [ProjectShellTitleBarLeft.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ProjectShellTitleBarLeft.tsx)
- [LayoutToggles.tsx](<home>/Downloads/electron-app-main/src/components/layouts/LayoutToggles.tsx)

Cleanup objective:

- keep one shell owner
- keep one header composition path
- remove stale special cases that no longer match the current layout
- make header logic easier to reason about without changing the composition model

### 3. Sidebar Cleanup

The sidebar is a major source of inherited complexity and state coordination.

Primary files:

- [ProjectSidebar.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)
- [ProjectSidebarTreeItem.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx)
- [projectSidebarShared.ts](<home>/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarShared.ts)
- [projectSidebarState.ts](<home>/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarState.ts)

Cleanup objective:

- reduce project tree orchestration complexity
- isolate persistence and ordering helpers
- remove leftover assumptions from older page-era navigation
- keep the current sidebar behavior while making ownership explicit

### 4. Workbench Page Cleanup

The workbench is the core product surface, but the cleanup here should be internal, not architectural.

Primary files:

- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [useProjectWorkbenchSearchParamSync.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectWorkbenchSearchParamSync.ts)
- [useWorkbenchDockviewRuntime.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
- [workbenchLayoutPersistence.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/workbenchLayoutPersistence.ts)

Cleanup objective:

- keep current route and header behavior
- reduce page size and coordination logic
- isolate URL sync, layout persistence, and Dockview runtime concerns
- keep the workbench inside the existing shell model

### 5. Preview / Dev Server / “Project Pages” Leftovers

Some active naming and files still reflect older product models.

Primary files:

- [useProjectPagesStore.ts](<home>/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts)
- [DevServerPanel.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx)
- [ServerControl.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx)
- [WorkbenchDevServerTile.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx)

Cleanup objective:

- confirm what is still active
- rename or isolate old “project pages” terminology
- remove dead components if the workbench tile is the real owner

### 6. Project Open / Git Sync / Runtime Service Cleanup

These areas are still large and clearly show layered migration history.

Primary files:

- [projectOpenGitSync.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts)
- [runtimeWorkspaces.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts)

Cleanup objective:

- split by responsibility, not by trend
- keep the existing feature flow intact
- reduce the blast radius of future fixes

### 7. Settings / Team / Workspace Surface Cleanup

The app still contains structure from older workspace/team/product eras.

Primary files:

- [SettingsSidebar.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/SettingsSidebar.tsx)
- [SettingsDrawer.tsx](<home>/Downloads/electron-app-main/src/components/settings/SettingsDrawer.tsx)
- [General.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- [SourceControl.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx)
- [Roles.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Roles.tsx)

Cleanup objective:

- preserve current settings/admin navigation
- remove dead compatibility or duplicate shells
- clarify which surfaces are project-scoped versus workspace-scoped

## Explicit “Do Not Do Again” Rules

These are hard rules for this cleanup pass:

- Do not add a new shell layer if [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx) can own the concern.
- Do not add new full-screen loading shells for local desktop transitions.
- Do not move project/team/admin actions into the workbench header unless they already belong there.
- Do not replace the current header composition system.
- Do not create new architecture docs that assume the current shell is wrong by default.
- Do not leave parallel “new way” and “old way” implementations unless one is a tiny compatibility shim.

## Revised Execution Plan

### Phase 0: Freeze the Current Architecture

- Confirm and document the canonical owners already present in the app.
- Mark earlier rewrite-oriented planning docs as historical, not authoritative for current cleanup.
- Use this document as the cleanup source of truth.

Exit criteria:

- one clear statement of current shell/header/workbench ownership
- no ambiguity about whether the app is being rewritten or cleaned up

### Phase 1: Route and Compatibility Cleanup

- Audit all project/workbench/settings/invite/join routes.
- Reduce legacy paths to tiny redirects where still needed.
- Delete dead legacy helpers.
- Keep deep links working where users still rely on them.

Progress:

- `/join/project/$token` is now reduced to a tiny compatibility redirect to the canonical `/projects/join/$token` route.
- `/invite/$token` is intentionally still kept for now because it is still part of auth/workspace-selection exemptions and serves an explicit retired-flow message.
- Legacy slug routing is intentionally still kept for now because [LegacyProjectRedirectPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx), [parseProjectRoute](<home>/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts), and [buildLegacyProjectPath](<home>/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts) are still part of active navigation and context resolution.
- [ProjectsLaunchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectsLaunchPage.tsx) copy was tightened to use workbench language instead of older page-era wording.
- Common local project routes now load eagerly in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx) instead of showing avoidable route-chunk loading interstitials for the normal desktop flow:
  [ProjectLayout](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx),
  [ProjectsLaunchPage](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectsLaunchPage.tsx),
  [ProjectWorkbenchPage](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx),
  [TasksPage](<home>/Downloads/electron-app-main/src/features/projects/pages/TasksPage.tsx),
  [ProjectTeamPage](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx),
  [ProjectConflictsPage](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectConflictsPage.tsx),
  and [NewProject](<home>/Downloads/electron-app-main/src/pages/NewProject.tsx).
- [ProjectsLaunchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectsLaunchPage.tsx) and [NewProject.tsx](<home>/Downloads/electron-app-main/src/pages/NewProject.tsx) no longer return blank `null` states during fast local transitions; they now keep a stable in-shell loading surface instead.

Exit criteria:

- route ownership is clear
- dead route logic is removed or minimized
- no broad compatibility scaffolding remains by accident

### Phase 2: Header and Shell Cleanup

- Keep [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx) as shell owner.
- Keep [useProjectChromeHeader.tsx](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectChromeHeader.tsx) as the main header composer.
- Reduce special-case logic in header-related helpers.
- Document the actual header zones and what belongs in each.
- Project Share is visible only on a workbench route with a resolved project ID. `ProjectLayout` passes its `isWorkbenchView` flag to `useProjectChromeHeader`, which also preserves page-level `hideShare` overrides. Global pages and other project views do not mount the Share control.

Progress:

- [useProjectHeader.ts](<home>/Downloads/electron-app-main/src/hooks/useProjectHeader.ts) now updates the shared header store without clearing it on every dependency change; reset is now unmount-only.
- [useProjectHeaderStore.ts](<home>/Downloads/electron-app-main/src/stores/useProjectHeaderStore.ts) now no-ops identical writes and no longer relies on `@ts-nocheck`.
- [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx) and [ProjectLayout.tsx](<home>/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx) no longer carry the stale unused `breadcrumbs` prop from an older header composition shape.

Exit criteria:

- one understandable header composition path
- no duplicated ownership of shell/header controls

### Phase 3: Sidebar Cleanup

- Extract persistence/order helpers where useful.
- Reduce the main sidebar component’s orchestration burden.
- Keep project/workbench navigation behavior stable.

Progress:

- Project-sidebar route/selection derivation now lives in [projectSidebarRoutes.ts](<home>/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarRoutes.ts) instead of being embedded inline inside [ProjectSidebar.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx).
- The sidebar still owns rendering and actions, but the current route-state rules for workbench vs settings vs project submenu are now explicit and isolated.

Exit criteria:

- sidebar code is smaller and more explicit
- no behavior regression in navigation, expansion, rename/delete, or workbench restore

### Phase 4: Workbench Internal Cleanup

- Split [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) by responsibility.
- Keep current header injection model.
- Keep current route/search-param behavior unless explicitly cleaning a dead path.
- Narrow selectors and runtime wiring where possible.

Progress:

- [useProjectWorkbenchSearchParamSync.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectWorkbenchSearchParamSync.ts) is now reconnected to the live workbench behavior, including browser/dev-server open targets.
- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) no longer carries the lane/open/focus search-param effects inline; that coordination now lives in the dedicated hook again.
- The page still owns its current header injection and overlay rendering model; this pass only removed coordination clutter, not UI ownership.
- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) no longer blocks the whole workbench on lane-state resolution. It now bootstraps from the route `projectId` immediately and only waits for the local workbench store entry itself.
- Local-loading cleanup also touched related project surfaces:
  [ProjectTeamPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx),
  [ProjectSettingsPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx),
  [ProjectConflictsPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectConflictsPage.tsx),
  and [TasksPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/TasksPage.tsx) now use calmer inline loading states instead of blank or oversized blockers.
- [useScopedWorkspacePeopleData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedWorkspacePeopleData.ts) no longer treats seat-management billing data as part of the core “members page is loading” gate, so [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx) can render people data without waiting on a secondary billing fetch.

Exit criteria:

- workbench page becomes easier to reason about
- no shell or IA rewrite

### Phase 5: Large Service Cleanup

- Split oversized backend/Electron services by actual domain responsibilities.
- Keep external contracts stable.
- Prefer extracting helpers/services over renaming feature ownership.

Exit criteria:

- smaller files
- clearer service boundaries
- stable behavior

### Phase 6: Delete Real Migrated Debris

- Remove dead files and dead comments.
- Remove stale names that encode older product shapes when the active owner is known.
- Keep compatibility only where it protects real current behavior.

Exit criteria:

- fewer “this app used to be X” artifacts
- fewer abandoned abstractions and helper layers

## Verification Standard

Every phase should preserve:

- `bun run typecheck`
- `bun run lint`
- project open -> workbench load
- workbench header behavior
- sidebar navigation
- lane switching
- changes/settings overlays
- project settings/team/settings routes

For desktop-sensitive areas, also confirm:

- no new full-screen loading experiences for local transitions
- no new route churn that makes the app feel like a web dashboard

## Immediate Next Work

If we continue from this corrected plan, the next cleanup pass should be:

1. Continue sidebar decomposition in [ProjectSidebar.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)
2. Keep trimming workbench coordination inside [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) and [useWorkbenchDockviewRuntime.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
3. Revisit remaining workspace guard loaders in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx) so scope resolution does not over-block local settings transitions
4. Clean the remaining “secondary data blocks primary content” cases in workspace/team surfaces

That sequence respects the current app instead of fighting it.
