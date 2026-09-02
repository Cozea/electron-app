# Loading Architecture Refactor Plan

Last reviewed: 2026-04-13

## Status

Implemented in the 2026-04-13 desktop-loading pass:

- common settings/admin routes are now eagerly imported in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx), so local code-split waits are no longer exposed for the everyday desktop settings surfaces
- login and onboarding now render directly from [App.tsx](<home>/Downloads/electron-app-main/src/App.tsx), and local `Storage` / `Tooling` snapshots are prewarmed after auth settles
- [useQueryCache.ts](<home>/Downloads/electron-app-main/src/stores/useQueryCache.ts) now has snapshot-aware semantics that distinguish fresh resolution from cached refresh state, including correct `null` handling
- scope/access hooks now expose refresh and resolution state instead of forcing page-level `loading` gates:
  - [useScopedOrganizationData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedOrganizationData.ts)
  - [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts)
  - [useScopedSettingsPage.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedSettingsPage.ts)
- people/admin surfaces now render shell-first with inline refresh instead of blocking cards:
  - [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx)
  - [Roles.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Roles.tsx)
  - [MemberDetails.tsx](<home>/Downloads/electron-app-main/src/pages/teams/MemberDetails.tsx)
- source control and billing now keep their structure visible while data refreshes in the background:
  - [SourceControl.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
  - [useScopedBillingData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedBillingData.ts)
  - [useBillingController.ts](<home>/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts)
  - [BillingContent.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
- the workbench now renders its shell as soon as the project identity exists in [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx), instead of waiting for the persisted workbench slice to hydrate first
- project/workspace context now reuses cached organization snapshots in [useProjectWorkspaceContext.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectWorkspaceContext.ts)

Still intentionally left for later passes:

- rare invite/join routes that genuinely depend on token or remote preview validity
- a few project-focused screens that still have must-block entity resolution
- tile/runtime prep states such as terminal, dev server, simulator, and diff preview, where container-first rendering is correct but the live runtime itself still needs prep

## Goal

Refactor Cozea's loading behavior so it feels like a fast desktop app, not a cautious web app.

The target experience is:

- app chrome appears immediately
- most settings and project surfaces render instantly
- cached/stale local state is shown first
- remote refresh happens in the background
- local runtime setup is shown inline, not as page-level blocking
- route-level and skeleton-style loading becomes rare

This plan is intentionally architectural. The problem is not "too many spinners" by itself. The problem is that we currently model unresolved state in a way that forces the UI to look broken on machines that are already fast enough.

## Core Diagnosis

Cozea currently has several web-app-oriented patterns that are working against a desktop feel:

1. Route-first loading
- Many screens are lazy-loaded with visible `Suspense` fallbacks in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx).
- This exposes local code loading as visible page loading.

2. Query-gated rendering
- Many pages render `loading` instead of rendering the shell and filling content progressively.
- Example hooks:
  - [useScopedGeneralData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedGeneralData.ts)
  - [useScopedWorkspacePeopleData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedWorkspacePeopleData.ts)
  - [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts)

3. Layered scope/access resolution before page render
- A settings page often depends on:
  - route scope resolution
  - organization lookup
  - member access
  - capability derivation
  - then page-specific data
- This makes `undefined` cascade into a visible loading gate.

4. Local work starts on mount
- Local-only or local-mostly tasks are often started only when the page opens:
  - storage scan
  - tooling/runtime checks
  - git inspection
  - source-control owner loading
  - lane/workbench restore
  - terminal/dev-preview boot

5. Cache exists but is not the default UI contract
- We have [useQueryCache.ts](<home>/Downloads/electron-app-main/src/stores/useQueryCache.ts), which is useful.
- But many screens still think in terms of `fresh data or loading` instead of `stale-first, refresh later`.

6. Renderer owns too much orchestration
- A lot of async setup is page-local or tile-local rather than owned by a longer-lived desktop service/store layer.
- This causes cold-start behavior every time a surface remounts.

7. Loading semantics are inconsistent
- Some surfaces show spinners.
- Some use shimmer.
- Some disable controls.
- Some block entire pages.
- Some do nothing until data arrives.

## Refactor Principles

These principles should govern the refactor.

### 1. Desktop Shell First

If we know what page the user is on, render the page shell immediately.

That means:

- page title
- section structure
- tables/containers
- last known values when available
- inline refresh state where needed

Do not block the whole page unless the route itself cannot be resolved truthfully.

### 2. Stale First, Fresh Later

For local and cloud-backed data alike, prefer:

- cached last-known state first
- background refresh second
- inline correction if data changes

The UI should not collapse to `Loading...` just because fresh data has not arrived yet.

### 3. Local Work Should Not Masquerade as Network Work

Local tasks like:

- route chunk load
- disk scan
- git branch list
- PTY startup
- simulator enumeration
- browser view attach

should not be surfaced with page-blocking loaders that feel like network lag.

### 4. Inline Over Blocking

Most remaining loading should become:

- inline row note
- muted status text
- tiny action spinner
- background refresh badge

not:

- full-page spinner
- card-sized spinner
- table replaced by loading message

### 5. Prewarm What We Can

If a desktop user is likely to open a surface soon, warm the local data and code before they ask for it.

Examples:

- settings chunks
- workbench lane state
- source-control namespace list
- storage snapshot
- tooling runtime status

### 6. Separate Route Readiness From Content Readiness

Do not use one `isLoading` to mean both:

- "we do not know where we are"
- "we know where we are, but some data is unresolved"

These must become separate concepts.

## Loading Taxonomy

Every current and future loading state should be classified as one of these:

### A. Must Block

The user cannot be shown a truthful shell yet.

Examples:

- auth bootstrap before app shell
- route access resolution when the destination itself may be invalid
- invitation token resolution when page identity depends on token validity

### B. Shell-First With Inline Refresh

The page identity is known. Some data is not ready.

Examples:

- settings pages
- members
- roles
- billing
- source control
- project settings

### C. Container-First Runtime Prep

The container should render immediately, but the live runtime inside it is not ready yet.

Examples:

- terminal
- dev preview
- iOS simulator preview
- browser tile attach

### D. Hidden/Prewarmed

The user should not see any loading UI at all in the common case.

Examples:

- route code chunks for commonly visited settings pages
- sidebar project list cache
- workbench lane restore

## Target Architecture

## 1. Persistent Desktop State Layer

Introduce a more explicit local-first desktop data layer for frequently visited surfaces.

This should hold:

- last-known workspace metadata
- last-known members/roles summaries
- last-known billing summary
- last-known source-control connection snapshot
- last-known storage snapshot
- last-known tooling/runtime snapshot
- last-known project/workbench state

This layer should live longer than individual pages and survive remounts.

Possible locations to extend:

- [useQueryCache.ts](<home>/Downloads/electron-app-main/src/stores/useQueryCache.ts)
- app-specific desktop snapshot stores alongside existing Zustand stores

### Requirements

- each cache entry records `data`, `timestamp`, and `freshness`
- surfaces can ask for:
  - `snapshot`
  - `isRefreshing`
  - `hasEverLoaded`
  - `error`
- stale data is rendered while refresh runs

## 2. Scope Resolution as App State, Not Page Gate

Today, page hooks repeatedly derive:

- route scope
- organization
- member access
- permissions
- capabilities

from stacked hooks.

Refactor toward:

- one shared resolved app context snapshot
- one refresh pipeline for it
- page hooks consume it without reintroducing page-level loading gates

Key files:

- [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts)
- [useScopedSettingsPage.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedSettingsPage.ts)
- [useScopedOrganizationData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedOrganizationData.ts)

### Desired end state

Pages receive:

- `scope`
- `workspace`
- `permissions`
- `capabilities`
- `isContextRefreshing`

They should almost never need:

- `if (isLoading) return <Loading...>`

## 3. Page Shell / Data Body Split

Every major screen should be refactored into two layers:

- stable shell
- refreshable body

### Shell

Always render:

- title
- description
- groups
- table headers
- toolbar/actions
- placeholders that preserve layout

### Body

Can show:

- stale values
- muted "Refreshing…" copy
- row-level unresolved values

This is especially important for:

- [General.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx)
- [Roles.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Roles.tsx)
- [Storage.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [Tooling.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [SourceControl.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [BillingContent.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)

## 4. Route Preload Strategy

Commonly visited desktop surfaces should be preloaded after app boot or when their nav is first revealed.

### High-priority preload candidates

- personal settings pages
- workspace settings pages
- members
- roles
- billing
- source control

### Target

Make route fallback UI effectively disappear in normal usage.

Relevant files:

- [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- [App.tsx](<home>/Downloads/electron-app-main/src/App.tsx)

## 5. Runtime Surface Managers

For heavy local surfaces, we should move from page-driven initialization to persistent managers.

### Workbench lane/session

Today:

- [useProjectLaneState.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts)
- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)

Target:

- restore lane/session state before or alongside route entry
- expose `snapshot + refreshing`, not `loading page`

### Terminal

Today:

- [WorkbenchTerminalTile.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchTerminalTile.tsx)
- [TerminalInstance.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/TerminalInstance.tsx)

Target:

- render tile instantly
- show minimal inline prep state inside terminal viewport
- preserve terminals more aggressively across tile/view focus changes

### Preview / Browser / Native Preview

Today:

- [WorkbenchDevServerTile.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx)
- [useWorkbenchBrowserView.ts](<home>/Downloads/electron-app-main/src/features/projects/components/workbench/useWorkbenchBrowserView.ts)
- [IosSimulatorViewport.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/previews/IosSimulatorViewport.tsx)

Target:

- container visible instantly
- runtime attach status stays inside the container
- page never blocks for tile runtime setup

## 6. Loading UI Reduction Rules

These rules should be enforced during refactor.

### Remove entirely

- route-level fallback UI for common pages once preload exists
- skeletons for ordinary settings pages
- table-level "Loading..." replacement when previous data exists

### Convert to inline

- settings `Loading ... settings`
- `Loading members...`
- `Loading roles...`
- `Loading projects...`
- `Loading workspace members...`

### Keep but shrink

- terminal prep
- dev preview startup
- simulator startup
- first auth bootstrap

## 7. Error and Loading Separation

We also need to separate:

- `has no data yet`
- `is refreshing`
- `is locally preparing`
- `has an error`

Right now many surfaces compress these into one state shape.

The target state model for a screen or section should look more like:

```ts
interface SurfaceState<T> {
  snapshot: T | null
  hasEverLoaded: boolean
  isRefreshing: boolean
  isPreparingLocalRuntime: boolean
  error: string | null
}
```

That removes a lot of current `undefined => loading gate` behavior.

## Refactor Phases

## Phase 1: Policy and Primitive Cleanup

Goal:

- establish the architectural defaults
- add missing primitives
- stop creating new blocking loaders

### Tasks

1. Add a small loading policy doc or section to developer docs.
2. Introduce shared concepts:
   - `isRefreshing`
   - `hasEverLoaded`
   - `isPreparing`
3. Add settings/table primitives for:
   - inline refresh note
   - stale snapshot badge
   - empty-but-refreshing row state
4. Ban new page-level `if (isLoading) return ...` in settings/project-admin pages unless justified.

### Files

- [docs/loading-state-inventory.md](<home>/Downloads/electron-app-main/docs/loading-state-inventory.md)
- [SettingsChrome.tsx](<home>/Downloads/electron-app-main/src/components/settings/SettingsChrome.tsx)
- shared table components as needed

## Phase 2: Remove Visible Route Loading For Common Surfaces

Goal:

- make desktop navigation feel instant

### Tasks

1. Preload common settings/admin routes after auth boot.
2. Preload on sidebar hover/open if needed.
3. Keep `RouteLoading` only for uncommon or truly cold routes.

### Files

- [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- [App.tsx](<home>/Downloads/electron-app-main/src/App.tsx)
- settings and sidebar/nav entry points

## Phase 3: Refactor Scoped Context To Snapshot + Refresh

Goal:

- stop making every page recompute loading-critical scope state independently

### Tasks

1. Refactor [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts) to return stable cached snapshot first.
2. Refactor [useScopedOrganizationData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedOrganizationData.ts) away from `undefined => page loading`.
3. Refactor [useScopedSettingsPage.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedSettingsPage.ts) so pages get resolved scope + refresh metadata, not a loading gate.

### Success condition

Workspace and personal settings pages can render their shells immediately.

## Phase 4: Settings Pages Shell-First Refactor

Goal:

- remove page-level loading theater from settings

### Targets

- [General.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- [SourceControl.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [BillingContent.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
- [Storage.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [Tooling.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [Account.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Account.tsx)

### Tasks

1. Remove page-blocking `Loading ...` returns.
2. Render current shell immediately.
3. Use cached values where possible.
4. Move refresh signals inline.
5. Keep only action-level spinners for explicit mutations.

## Phase 5: Members / Roles / Project Admin Refactor

Goal:

- make admin tables feel persistent and calm

### Targets

- [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx)
- [Roles.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Roles.tsx)
- [ProjectTeamPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectTeamPage.tsx)
- [ProjectSettingsPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx)

### Tasks

1. Show headers and table shell immediately.
2. Show cached rows immediately if present.
3. Replace full-table loading text with:
   - stale rows + inline refresh
   - or empty layout-preserving placeholders
4. Keep only per-action mutation spinners.

## Phase 6: Workbench Persistence Refactor

Goal:

- make workbench open instantly and hydrate in place

### Targets

- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [useProjectLaneState.ts](<home>/Downloads/electron-app-main/src/features/projects/hooks/useProjectLaneState.ts)
- workbench tile bootstrap hooks/components

### Tasks

1. Move lane/session restore earlier and make it snapshot-first.
2. Render workbench shell from cached layout immediately.
3. Convert tile setup to container-first runtime prep.
4. Reduce or remove visible whole-workbench loading.

## Phase 7: Local Runtime Prewarm

Goal:

- hide local-only waits

### Targets

- storage snapshot
- tooling runtime status
- source-control owners/namespaces
- workbench lane state
- common route chunks

### Tasks

1. Add background warm-up after auth/scope settle.
2. Add idle-time warm-up for likely next surfaces.
3. Persist warm results across route changes and app restarts where safe.

## Phase 8: Loading UI Unification

Goal:

- reduce loading vocabulary to a small set

### Keep only these patterns

1. Full-screen boot loader
2. Small centered route fallback for truly cold/uncommon routes
3. Inline muted refresh note
4. Inline action spinner
5. Runtime container prep state

### Remove

- skeletons on normal desktop settings pages
- page-sized "Loading..." cards where shell is already known
- table replacement loaders when stale data exists

## Surface-by-Surface Direction

## Surfaces That Should Usually Be Instant

- settings pages
- members
- roles
- billing
- source control
- project settings
- project team
- project sidebar

## Surfaces That Should Be Shell-First

- workbench
- tasks
- changes
- storage
- tooling

## Surfaces That Can Keep Small Explicit Prep States

- terminal
- dev server preview
- browser view attach
- iOS simulator/native preview
- conflicts file load

## What We Should Stop Doing

1. Stop using `undefined` as the primary reason to block a page.
2. Stop showing route fallback for common desktop destinations.
3. Stop replacing whole tables with `Loading...` text.
4. Stop treating local runtime prep like network delay.
5. Stop coupling page identity to data freshness.

## Risks

### 1. Stale data confusion

Mitigation:

- small refresh indicators
- clear mutation completion handling
- timestamps if needed for sensitive surfaces

### 2. More complicated state models

Mitigation:

- shared surface-state shape
- shared hooks/patterns
- avoid one-off loading logic in page components

### 3. Prewarm overhead

Mitigation:

- only warm common surfaces
- warm on idle
- use bounded caches and TTLs

### 4. Mixed local/remote surfaces remain messy

Mitigation:

- split them deliberately into:
  - shell
  - local prep
  - cloud refresh

## Success Metrics

We should consider the refactor successful when:

1. Common settings pages open with no visible route fallback.
2. Members, roles, and billing render their shell instantly.
3. Workbench opens from last-known layout immediately.
4. Storage/tooling pages show prior snapshot first.
5. The number of visible loading surfaces in normal usage drops sharply.
6. Skeleton usage becomes rare or disappears from desktop settings/admin flows.

## Recommended Execution Order

1. Phase 1: policy + primitives
2. Phase 2: route preload
3. Phase 3: scope/context snapshot refactor
4. Phase 4: settings pages
5. Phase 5: members/roles/project-admin pages
6. Phase 6: workbench snapshot-first
7. Phase 7: prewarm local runtime data
8. Phase 8: final loading UI cleanup

## Immediate First Refactor Targets

If we want the highest-value first wins, start here:

1. [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
   - reduce visible route fallback for common settings/admin screens
2. [useScopedAppContext.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedAppContext.ts)
   - return stable snapshot-first app context
3. [useScopedWorkspacePeopleData.ts](<home>/Downloads/electron-app-main/src/hooks/useScopedWorkspacePeopleData.ts)
   - stop collapsing multiple unresolved queries into a page-blocking `isLoading`
4. [General.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/General.tsx)
   - first shell-first settings conversion
5. [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx)
   - first shell-first table conversion
6. [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
   - move away from whole-workbench loading gate

## Final Position

The correct desktop posture for Cozea is:

- fast by default
- optimistic by default
- stale-first by default
- locally persistent by default

not:

- unresolved means loading
- local work means spinner
- route transition means fallback

That is the architectural shift this refactor plan is trying to codify.
