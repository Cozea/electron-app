# App Refactor and Legacy Cleanup Plan

## Objective

Create a single execution plan to finish the half-landed refactors, remove architecture drift from older product eras, and leave the app in a state where:

- active code paths are clear and singular
- dead compatibility layers are either intentionally preserved or removed
- large orchestration files are split by responsibility
- renderer performance work can land on stable interfaces instead of moving targets
- `bun run typecheck` and `bun run lint` stay green throughout the effort

This document is the master roadmap for the remaining cleanup after the earlier workbench/sidebar and platform refactor passes.

## Why This Plan Exists

The codebase currently has three overlapping problems:

1. Earlier refactor extractions exist, but some were never fully rewired into the live app.
2. Older route, shell, settings, preview, and invite patterns are still present even though the product shape has changed.
3. Several large files still own too many concerns, which makes performance work and bug fixing harder than it should be.

The goal is not just to "split big files." The goal is to make the current architecture intentional again.

## Non-Goals

- Refactoring the task board in this plan
- Convex schema redesign
- Changing assistant runtime wire protocols unless required for type safety later
- Replacing Electron with another platform abstraction
- Large visual redesigns

## Guiding Principles

### Prefer One Active Path Per Capability

If the app has both:

- an old monolith and a new extracted module, or
- a legacy route and a modern route, or
- direct `window.electronAPI` calls and a feature client wrapper

then the end state should be one canonical path, not two.

### Reconnect or Delete, Never Leave Orphaned

Every extracted module must end in one of two states:

- wired into active production paths, or
- deleted as abandoned work

No "maybe later" islands should remain in the tree without an explicit owner.

### Behavior First, Cleanup Second

We should preserve:

- routing behavior users still rely on
- workbench state and lane behavior
- project open/sync safety
- billing correctness
- assistant functionality

We can simplify internal structure aggressively, but only after identifying which behavior is actually current product behavior.

### Performance Work Needs Stable Seams

Do not pile performance changes on top of drifting interfaces. First stabilize:

- route ownership
- shell composition
- workbench/runtime ownership
- Electron bridge boundaries

Then optimize.

## Status Legend

- `active canonical`: current production path we intend to keep and improve
- `compatibility shim`: intentionally preserved old path that should stay minimal
- `candidate for reconnection`: extracted refactor work that likely should be wired back in
- `candidate for deletion`: leftover module or helper that likely should be removed
- `candidate for rename/modernization`: still active, but named or shaped around an older product model

## Current Problem Map

## 1. Incomplete Refactor Extractions

These files exist as newer seams or controllers, but are not consistently used by the active app:

- [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
- [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx)
- [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)
- [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
- [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts)
- [billingShared.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/billingShared.ts)
- [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts)
- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts)

These need a firm decision: reconnect them or delete them.

## 2. Legacy Product Shapes Still Present

These areas still carry assumptions from older product eras:

- legacy project routes:
  - [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx)
  - [LegacyProjectRedirectPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx)
  - [projectRoutes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts)
- legacy invite/join flow:
  - [projectShare.ts](/Users/admin/Downloads/electron-app-main/shared/projectShare.ts)
  - [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx)
- legacy file tree fallback:
  - [FileTree.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/FileTree.tsx)
- old "project pages" concepts:
  - [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts)
  - [DevServerPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx)
  - [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx)

## 3. Large Active Monoliths Still Owning Too Much

The largest remaining active files worth deliberate decomposition are:

- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)
- [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx)
- [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx)
- [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx)
- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts)
- [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts)
- [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts)
- [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts)

## 4. Electron Bridge Coupling Is Still Broad

The renderer still talks to Electron directly in many places instead of through feature clients:

- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [routeScanner.ts](/Users/admin/Downloads/electron-app-main/src/utils/routeScanner.ts)
- [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts)
- [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts)
- [wsNativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/wsNativeApi.ts)

## 5. Assistant and Runtime Type Debt Is Still Deep

The largest long-term stabilization target remains the assistant/runtime cluster, especially files still carrying `@ts-nocheck` or legacy mapping glue.

Examples:

- [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts)
- [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
- [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
- [providerRuntime.ts](/Users/admin/Downloads/electron-app-main/shared/assistant-contracts/providerRuntime.ts)
- [main.ts](/Users/admin/Downloads/electron-app-main/electron/assistant-runtime/main.ts)
- [MessagesTimeline.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/MessagesTimeline.tsx)

## Phase 0 Live Inventory

### Verification Baseline

- `bun run typecheck`: passed on 2026-04-09
- `bun run lint`: passed on 2026-04-09 with 32 warnings and 0 errors

### Protected Behavior Checklist

These flows are explicitly protected during the cleanup work:

- workbench lane switching and URL sync
- workbench tile open/focus behavior
- assistant tile load, restore, and branch-aware behavior
- project open and git sync entry flows
- settings navigation across personal, workspace, and team surfaces
- project join link acceptance and project invite acceptance
- legacy invite/join compatibility redirects until formally retired
- billing dialogs, checkout entry points, and invoice links
- dev server and preview behavior

### Route Entry Snapshot

The route file is already partly lazified via `createLazyRouteComponent`, but it still carries several compatibility paths and older product surfaces in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx).

Notable active and legacy paths:

- `active canonical`: `/projects/join/$token` -> [ProjectJoinPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectJoinPage.tsx)
- `active canonical`: `/projects/invite/$inviteId` -> [ProjectInvitePage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectInvitePage.tsx)
- `compatibility shim`: `/join/project/$token` -> same join page
- `compatibility shim` leaning toward `candidate for deletion`: `/invite/$token` -> [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx), which explicitly says the legacy token flow is retired
- `compatibility shim`: `/projects/$slug` -> [LegacyProjectRedirectPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx)

### Large File Hotspots

Current files at roughly 800+ lines include:

- [ClaudeAdapter.ts](/Users/admin/Downloads/electron-app-main/electron/assistant-runtime/provider/Layers/ClaudeAdapter.ts) `3184`
- [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts) `2704`
- [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) `2424`
- [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts) `2396`
- [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) `2376`
- [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts) `2236`
- [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts) `2218`
- [composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/composerDraftStore.ts) `2218`
- [TasksPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/TasksPage.tsx) `2063`
- [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) `2029`
- [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) `1503`
- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) `1402`
- [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx) `1320`
- [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx) `1275`
- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) `1264`
- [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) `1254`
- [HeaderProjectShareButton.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx) `1148`
- [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) `1078`
- [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx) `1008`

### `@ts-nocheck` Footprint Snapshot

The `@ts-nocheck` surface is still very large, with the deepest concentration in:

- `assistant contracts`: `/shared/assistant-contracts/*`
- `assistant shared helpers`: `/shared/assistant-shared/*`
- `assistant runtime`: `/electron/assistant-runtime/*`
- renderer assistant UI and stores:
  - [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts)
  - [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
  - [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
  - [composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/composerDraftStore.ts)
  - [terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/terminalStateStore.ts)
  - [MessagesTimeline.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/MessagesTimeline.tsx)
- older app infrastructure:
  - [env.ts](/Users/admin/Downloads/electron-app-main/src/env.ts)
  - [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts)
  - [wsNativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/wsNativeApi.ts)
  - [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts)
  - [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts)

### Direct Electron Bridge Hotspots

Raw `window.electronAPI`, `window.desktopBridge`, or `window.nativeApi` usage remains widespread. The highest-leverage active areas are:

- `active canonical`:
  - [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
  - [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
  - [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
  - [routeScanner.ts](/Users/admin/Downloads/electron-app-main/src/utils/routeScanner.ts)
  - [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts)
  - [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx)
  - [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
- `bridge compatibility layer still active`:
  - [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts)
  - [wsNativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/wsNativeApi.ts)
  - [workbenchBranchControlShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/workbenchBranchControlShared.ts)
  - [assistantRuntimeMetadataStore.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts)

### Reconnect-or-Delete Candidates

#### Workbench controller split

- [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts): `candidate for reconnection`
- [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx): `candidate for reconnection`
- [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts): `candidate for reconnection`

Current signal:

- these modules have definitions in-tree
- they do not currently show active upstream imports from the main route/component entry points in the quick audit

#### Billing split

- [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx): `candidate for reconnection`
- [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts): `candidate for reconnection`
- [billingShared.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/billingShared.ts): `candidate for reconnection`

Current signal:

- the billing folder mostly references itself in the quick audit
- [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) remains the obvious live monolith

#### Project-open client split

- [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts): `candidate for reconnection`
- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts): `candidate for reconnection`
- [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts): `candidate for reconnection`

Current signal:

- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts) imports the client/types cluster
- the cluster does not yet appear to be broadly imported by active route-level project-open code in the quick audit

### Legacy and Compatibility Tags

- [buildLegacyProjectJoinPath()](/Users/admin/Downloads/electron-app-main/shared/projectShare.ts#L24): `candidate for deletion`
- `/join/project/$token` in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx#L423): `compatibility shim`
- `/invite/$token` in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx#L695): `compatibility shim` leaning toward `candidate for deletion`
- [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx): `compatibility shim`, because it explicitly states the legacy flow is retired
- [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts): `candidate for rename/modernization`
- [DevServerPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx): `active canonical` but tied to older preview/server ownership
- [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx): `active canonical` but tied to older preview/server ownership
- [FileTree.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/FileTree.tsx) legacy renderer toggle: `compatibility shim`

## Success Criteria

This plan is complete when all of the following are true:

- every extracted-but-unwired module is either connected to the active app or removed
- settings, workspace, and project shells use one deliberate composition strategy
- legacy project and invite routes are either fully preserved as compatibility shims or formally retired
- the "project pages" naming and preview/server state model is either upgraded to the workbench model or isolated as compatibility only
- duplicate assistant store surfaces are collapsed
- the worst renderer-to-Electron coupling is replaced by feature clients
- the workbench/controller decomposition is actually used, not merely present on disk
- the largest remaining service files have a clear responsibility split
- `bun run typecheck` and `bun run lint` pass at the end of every phase

## Overall Strategy

We should execute this in three layers:

1. Stabilize seams and ownership.
2. Remove dead or duplicate paths.
3. Split the remaining large active files once ownership is clear.

Trying to split giant files before deciding which path is canonical will create more drift, not less.

## Phase 0: Baseline, Inventory, and Guardrails

### Goal

Freeze the current architecture map so cleanup work is deliberate.

### Tasks

- [completed] Create a fresh live inventory of:
  - active route entry points
  - large files over roughly 800 lines
  - files still using `@ts-nocheck`
  - direct `window.electronAPI`, `window.desktopBridge`, and `window.nativeApi` usage
  - extracted modules with zero or suspiciously low inbound references
- [completed] Mark each questionable module as one of:
  - `active canonical`
  - `compatibility shim`
  - `candidate for reconnection`
  - `candidate for deletion`
- [completed] Record route behaviors that must not regress:
  - workbench open/focus/lane behavior
  - project open flows
  - settings navigation
  - invite acceptance
  - billing flows
  - dev server / preview flows
- [completed] Capture a baseline verification routine:
  - `bun run typecheck`
  - `bun run lint`
  - key manual navigation checks

### Deliverables

- updated inventory section in this file
- explicit tagging of candidate modules
- a short regression checklist stored alongside this plan

### Acceptance Criteria

- no major cleanup starts until every ambiguous module has an owner decision

## Phase 1: Reconnect-or-Delete Audit

### Goal

Resolve all half-landed refactor modules so the codebase stops carrying both the old and new structure at once.

### Workstream 1A: Workbench Refactor Modules

#### Candidate modules

- [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
- [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx)
- [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)

#### Live audit finding

Decision: `reconnect`, not `delete`.

Current evidence from the live audit:

- [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) is still a large Dockview runtime owner and does not currently import [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts).
- [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) is still a large assistant controller/view hybrid and does not currently import [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx).
- [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) is still a large branch orchestration component and does not currently import [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts).
- The extracted hooks exist and export coherent controller surfaces, but the quick inbound-reference audit shows only their own definitions, which means the split was started and never completed.

#### Migration progress

- [completed] [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) now delegates to [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts).
- [completed] [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) now delegates to [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx) and [WorkbenchAssistantDiffDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog.tsx).
- [completed] [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) now delegates Dockview runtime ownership to [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts).
- [completed] The shared Dockview helper/runtime path was aligned with the live workbench behavior:
  - browser and dev-server panels now use the shared placement helper instead of the page-local duplicate logic
  - runtime-only selection preview panels are now readable through [WorkbenchDockPanels.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDockPanels.tsx)
  - persisted layout hydration now flows through [workbenchLayoutPersistence.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/workbenchLayoutPersistence.ts) instead of page-local layout snapshots

#### Tasks

- [completed] Confirm whether the active workbench still duplicates logic these hooks were meant to own.
- [completed] If yes, rewire the active page/component tree to use them.
- [ ] If no, delete the extracted hooks and move any useful pure helpers back into smaller canonical modules.
- [completed] Remove duplicate logic in:
  - [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx)
  - [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx)
  - [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx)

#### End State

- there is exactly one controller path for Dockview runtime, assistant tile orchestration, and branch control orchestration

### Workstream 1B: Billing Refactor Modules

#### Candidate modules

- [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
- [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts)
- [billingShared.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/billingShared.ts)

#### Live audit finding

Decision: `reconnect`, not `delete`.

Current evidence from the live audit:

- [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx) is a pure content surface and does not own shell/access concerns.
- [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts) already returns a complete page-model for the billing UI.
- [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) was still a live monolith despite the extracted billing modules being internally coherent.

#### Migration progress

- [completed] [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) is now a thin wrapper over:
  - [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts)
  - [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
  - [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx)
  - [WorkspaceAccessNotice.tsx](/Users/admin/Downloads/electron-app-main/src/components/workspaces/WorkspaceAccessNotice.tsx)
- [completed] The route-level `surface` and `route` props were preserved while moving orchestration out of the page file.

#### Tasks

- [completed] Decide whether [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) should become a thin route shell.
- [completed] If yes, rewire the route to the extracted controller/content modules.
- [ ] If no, remove the extracted billing folder and keep a smaller decomposition plan entirely inside the active page tree.

#### End State

- there is one billing architecture, not a live monolith plus an unwired rewrite

### Workstream 1C: Project Open / Desktop Client Modules

#### Candidate modules

- [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts)
- [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
- [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts)

#### Live audit finding

Decision: `reconnect`, not `delete`.

Current evidence from the live audit:

- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) is still the active coordinator for project-open and git-open behavior.
- The extracted client/access/types cluster already matches the active responsibility boundaries:
  - typed desktop bridge access in [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts)
  - user-facing access/repository prompts in [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
  - shared public types in [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts)
- The safest migration path is to keep [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) as the coordinator while routing its bridge and access work through the extracted modules.

#### Migration progress

- [completed] [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) now routes desktop bridge calls through [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts).
- [completed] Repository/source-control readiness prompts now flow through [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts).
- [completed] Public project-open types are re-exported from [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) via [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts), so downstream callers keep a stable import path during the migration.
- [completed] Verification after the reconnect:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors

#### Tasks

- [completed] Reconfirm active callers of [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts).
- [completed] Decide whether the feature client layer becomes canonical.
- [completed] If yes, route all active project-open behavior through the client/access/types cluster.
- [ ] If no, delete the orphaned cluster and make a fresh smaller decomposition inside the active module.

#### End State

- project-open logic uses one canonical bridge boundary

### Acceptance Criteria For Phase 1

- no extracted module remains in limbo
- all active imports point to the chosen canonical path
- dead extraction leftovers are removed

## Phase 2: Workbench and Sidebar Canonicalization

### Goal

Finish the workbench/sidebar architecture so the decomposition is real and the old monolith patterns do not creep back in.

### Tasks

- [completed] Ensure [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) is a coordinator, not the owner of panel runtime internals.
- [completed] Ensure [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) is a thin view layer over controller hooks and dialogs.
- [completed] Ensure [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) is a shell over a dedicated controller/service.
- [completed] Reduce [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) to shell composition, with tree rows and lane summaries coming from focused components/selectors.
- [completed] Reconcile any remaining store APIs around sidebar summaries and lane metadata so the tree does not depend on broad workbench objects.
- [ ] Delete or merge any earlier split files that are no longer needed after canonicalization.

### Specific Cleanup Targets

- workbench runtime ownership
- assistant tile runtime status/config ownership
- branch-control action building
- sidebar lane summary derivation
- transient preview tile ownership

### Acceptance Criteria

- the large workbench files act as route/component shells
- controller and selector logic lives in focused hooks/modules
- there is no duplicated controller logic between active shells and extracted hooks

### Phase 2 Progress

- [completed] [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) now delegates Dockview runtime internals to [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts), which makes the page a coordinator around lanes, overlays, and route state instead of the Dockview owner.
- [completed] [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) remains a thin wrapper over [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx) and [WorkbenchAssistantDiffDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog.tsx).
- [completed] [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) remains a thin wrapper over [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts).
- [completed] [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) now uses the extracted sidebar modules:
  - [ProjectSidebarTreeItem.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx)
  - [SidebarLaneTiles.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/SidebarLaneTiles.tsx)
  - [projectSidebarShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarShared.ts)
  - [projectSidebarState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarState.ts)
- [completed] The active sidebar now consumes focused lane summaries through [buildWorkbenchLaneSidebarSummary](/Users/admin/Downloads/electron-app-main/src/stores/useProjectWorkbenchStore.ts#L568) rather than rendering its own inline tile/status derivation path.
- [completed] Verification after the sidebar canonicalization slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors

## Phase 3: Shell, Settings, and Route Architecture Unification

### Goal

Make page framing consistent across settings, workspace, and project routes.

### Problems To Solve

- personal settings pages still use older direct shell patterns
- workspace/team settings pages use a partly migrated route shell pattern
- nested rails and duplicate framing logic are still easy to reintroduce

### Target Areas

- [Account.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Account.tsx)
- [Appearance.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Appearance.tsx)
- [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [Members.tsx](/Users/admin/Downloads/electron-app-main/src/pages/teams/Members.tsx)
- [Roles.tsx](/Users/admin/Downloads/electron-app-main/src/pages/teams/Roles.tsx)
- [General.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx)
- [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx)
- [Sync.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Sync.tsx)
- [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx)
- [AppShellLayout.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/AppShellLayout.tsx)

### Tasks

- [completed] Define one canonical shell composition strategy for:
  - personal settings
  - team/workspace settings
  - project-scoped settings
- [completed] Standardize content embedding mode so inner pages do not each reinvent framing.
- [completed] Remove remaining nested sidebar/rail ownership from pages that should only provide content.
- [completed] Update route metadata and page props to use the chosen shell model consistently.

### Acceptance Criteria

- every settings-style page renders content into the same shell contract
- local page-level sidebars only remain where they are truly product-specific

### Phase 3 Progress

- [completed] Personal settings routes now use the same shell path as the workspace and team settings pages:
  - [Account.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Account.tsx)
  - [Appearance.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Appearance.tsx)
  - [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
  - [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [completed] The active shell contract for settings-style routes is now:
  - page routes render content through [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx)
  - drawer routes render content-only variants through [SettingsDrawer.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsDrawer.tsx)
- [completed] Route propagation was standardized across the shell boundary:
  - personal settings drawer entries now pass `route` through to their page modules
  - [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx) now passes `route` to [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx) like the rest of the settings surfaces
- [remaining] The main shell inconsistency left in this phase is project-scoped settings:
  - [ProjectSettingsPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectSettingsPage.tsx) is an embedded workbench surface rather than a participant in the shared settings shell contract
  - the live audit shows this is intentional product framing rather than leftover page-shell drift, so it is treated as the canonical project-scoped settings model for now

## Phase 4: Legacy Route and Invitation Cleanup

### Goal

Resolve long-lived compatibility layers that may no longer match the current product.

### Workstream 4A: Legacy Project Routes

#### Files

- [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx)
- [LegacyProjectRedirectPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx)
- [projectRoutes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts)

#### Tasks

- [completed] Determine whether old project slug URLs still need to work.
- [completed] If yes, reduce the legacy path to a tiny compatibility redirect only.
- [completed] `not applicable`: old project slug URLs still need to work as documented compatibility redirects.

### Workstream 4B: Legacy Invitation Flow

#### Files

- [projectShare.ts](/Users/admin/Downloads/electron-app-main/shared/projectShare.ts)
- [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx)
- [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx)

#### Tasks

- [completed] Reconcile whether legacy token join links are actually supported.
- [completed] If disabled, remove route builders and dead messaging paths that imply support.
- [completed] `not applicable`: the legacy invite-token flow is retired rather than supported.

### Acceptance Criteria

- the app no longer advertises or carries dead legacy route flows
- compatibility routes, if kept, are intentionally minimal and documented

### Phase 4 Progress

- [completed] Legacy project slug URLs remain intentional compatibility behavior:
  - [LegacyProjectRedirectPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx) is already the minimal canonical redirect surface for `/projects/$slug/...`
  - [ProjectLayout.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/layouts/ProjectLayout.tsx) still needs [buildLegacyProjectPath](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectRoutes.ts#L12) while a user is inside that compatibility entry path
- [completed] The legacy public project-join alias remains intentional compatibility behavior:
  - `/join/project/$token` in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx#L423) still routes directly to the active [ProjectJoinPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectJoinPage.tsx)
  - [App.tsx](/Users/admin/Downloads/electron-app-main/src/App.tsx#L272) still treats that alias as a public-auth route, which confirms it is not dead code yet
- [completed] The legacy invite-token flow is retired rather than active:
  - [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx) is a retirement page, not an acceptance flow
  - `/invite/$token` in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx#L691) is therefore kept only as a compatibility message path for old links
- [completed] Removed dead code that implied broader legacy support than the live app actually provides:
  - deleted [SettingsSectionsList.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/SettingsSectionsList.tsx), which no longer had any active imports
  - removed `buildLegacyProjectJoinPath()` from [projectShare.ts](/Users/admin/Downloads/electron-app-main/shared/projectShare.ts) because the compatibility alias is route-only and no longer needs a public URL builder

## Phase 5: Project Pages, Preview, and Dev Server Model Cleanup

### Goal

Resolve the older "project pages" architecture that predates the workbench-centric model.

### Target Areas

- [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts)
- [DevServerPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx)
- [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx)
- [WorkbenchDevServerTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx)

### Questions To Resolve

- Is `useProjectPagesStore` still the correct owner for preview/dev-server state?
- Should dev-server state move under a workbench/runtime model instead?
- Which behaviors are still legacy compatibility, and which are current product behavior?

### Tasks

- [completed] Map every current caller of `useProjectPagesStore`.
- [completed] Decide whether to:
  - rename and modernize it into a preview/dev-server runtime store, or
  - isolate it as a compatibility store and move active workbench features elsewhere
- [completed] Remove legacy naming and comments that describe no-longer-primary product flows.
- [completed] Align dev server, preview, and workbench tiles around one runtime ownership model.

### Acceptance Criteria

- preview/dev-server state has a modern owner name and clear place in the architecture
- the workbench no longer depends on an older product abstraction by accident

### Phase 5 Progress

- [completed] The live audit showed the workbench already owns the active preview/dev-server runtime:
  - [WorkbenchDevServerTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx) is the only active dev-server surface
  - [useDevServerManager.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useDevServerManager.ts) is the active runtime owner
- [completed] The older standalone preview/dev-server surface was dead and has been removed:
  - deleted [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx)
  - deleted [DevServerPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx)
- [completed] The old `useProjectPagesStore` model was reduced out of the active architecture:
  - deleted [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts)
  - deleted the intermediate renamed store [usePreviewRuntimeStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/usePreviewRuntimeStore.ts) once the audit confirmed no live runtime callers remained
  - extracted the still-live shared types into [previewRuntimeTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/previewRuntimeTypes.ts)
- [completed] Related legacy wording was cleaned up:
  - [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts) no longer describes dev-server config discovery as a `ServerControl` concern

## Phase 6: Assistant Store and Runtime Consolidation

### Goal

Reduce duplicate assistant stores, remove legacy mapping glue where possible, and prepare the assistant/runtime area for deeper typing work.

### Target Areas

- [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts)
- [composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/composerDraftStore.ts)
- [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
- [terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/terminalStateStore.ts)
- [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)

### Tasks

- [completed] Confirm which assistant store files are actively imported.
- [completed] Collapse duplicate stores so there is one canonical draft store and one canonical terminal state store.
- [completed] Remove compatibility re-export files if they are no longer needed.
- [completed] Audit and reduce legacy mapping helpers in [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts), especially where they preserve outdated provider or session status shapes.
- [completed] Keep public selectors and serialized storage behavior stable during the transition.

### Acceptance Criteria

- no duplicate assistant state implementations remain
- compatibility wrappers are either thin and intentional or removed

### Phase 6 Progress

- [completed] The active assistant renderer imports already flow through the canonical stores:
  - [composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/composerDraftStore.ts)
  - [terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/terminalStateStore.ts)
  - [types.ts](/Users/admin/Downloads/electron-app-main/src/stores/types.ts)
- [completed] The duplicate assistant-prefixed implementations were collapsed into thin compatibility wrappers:
  - [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
  - [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
  - [assistant-modelSelection.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-modelSelection.ts)
  - [assistant-storage.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-storage.ts)
  - [assistant-types.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-types.ts)
- [completed] The live assistant/workbench surfaces now import canonical types directly:
  - [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts)
  - [workbenchAssistantShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/workbenchAssistantShared.ts)
  - [CozeaChatSurface.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/CozeaChatSurface.tsx)
- [completed] The temporary compatibility files were removed once the live import graph reached zero inbound references:
  - deleted [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
  - deleted [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
  - deleted [assistant-modelSelection.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-modelSelection.ts)
  - deleted [assistant-storage.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-storage.ts)
  - deleted [assistant-types.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-types.ts)
- [completed] Assistant thread-session normalization now flows through [threadSession.ts](/Users/admin/Downloads/electron-app-main/src/stores/threadSession.ts), which removes the inline provider/session-status translation helpers from [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts) while keeping the public `ThreadSession` shape stable for the UI.
- [completed] The assistant chat surface no longer maintains a duplicate local type model:
  - [session-logic.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/session-logic.ts), [MessagesTimeline.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/MessagesTimeline.tsx), and [ChangedFilesTree.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/ChangedFilesTree.tsx) now import canonical types from [types.ts](/Users/admin/Downloads/electron-app-main/src/stores/types.ts)
  - deleted [src/features/projects/components/assistant/chat/types.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/types.ts)
  - deleted [src/features/projects/components/assistant/types.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/types.ts)
- [completed] Verification after completing the `Phase 6` consolidation:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors

## Phase 7: Electron Client Facade Cleanup

### Goal

Stop letting renderer feature code grow ad hoc direct Electron bridge dependencies.

### Target Areas

- [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
- [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
- [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [routeScanner.ts](/Users/admin/Downloads/electron-app-main/src/utils/routeScanner.ts)
- [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts)
- [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts)
- [wsNativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/wsNativeApi.ts)

### Tasks

- [x] Define feature-scoped client layers:
  - project client
  - storage client
  - tooling client
  - preview/runtime client
  - desktop bridge alias client
- [x] Migrate direct bridge calls in the highest-traffic renderer features first.
- [x] Decide whether `desktopBridge`, `nativeApi`, and `electronAPI` all still need to coexist.
- [x] Remove deprecated alias layers once downstream callers are migrated.

### Acceptance Criteria

- most renderer feature code depends on typed feature clients instead of raw global bridge objects
- compatibility bridge aliases are reduced and documented

### Phase 7 Progress

- [completed] The first feature-scoped client slice now covers settings surfaces:
  - added [settingsDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/settingsDesktopClient.ts) for shared settings/dialog bridge access
  - added [storageSettingsClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/storageSettingsClient.ts) for storage-specific bridge calls
  - added [toolingSettingsClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/toolingSettingsClient.ts) for runtime/git-health bridge calls
- [completed] The settings pages no longer access `window.electronAPI` directly:
  - [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
  - [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
- [completed] The second feature-scoped client slice now covers project analysis and preview/runtime detection utilities:
  - added [projectAnalysisDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/projectAnalysis/projectAnalysisDesktopClient.ts) for project file listing, project file reads, directory reads, and runtime capability lookup
  - [routeScanner.ts](/Users/admin/Downloads/electron-app-main/src/utils/routeScanner.ts) now routes project file access through that client
  - [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts) now routes file-system and runtime-capability access through that client
- [completed] The third feature-scoped client slice now makes the active project-open coordinator consistent with its existing bridge layer:
  - [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) now routes `ensureCollabLane` and the remaining git-open sync operations through [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts)
- [completed] The fourth feature-scoped client slice now reduces the remaining `desktopBridge` / `nativeApi` alias drift to one intentional low-level helper:
  - added [desktopBridgeClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/desktopBridgeClient.ts) for websocket bootstrap resolution, assistant runtime status bootstrap/subscription, and shared context-menu dispatch
  - rewired [ProjectSidebarTreeItem.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx), [workbenchBranchControlShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/workbenchBranchControlShared.ts), [nav-user.tsx](/Users/admin/Downloads/electron-app-main/src/components/nav-user.tsx), and [useProjectCreationMenu.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectCreationMenu.ts) to the shared context-menu client
  - rewired [assistantRuntimeMetadataStore.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts), [useAssistantRuntimeStatus.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/useAssistantRuntimeStatus.ts), [assistant-wsTransport.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-wsTransport.ts), [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts), [ProjectFavicon.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectFavicon.tsx), and [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts) to the shared bootstrap helper
  - outside the intentional low-level bridge layer, the only remaining raw bridge-global usage is the environment detector in [env.ts](/Users/admin/Downloads/electron-app-main/src/env.ts)
- [completed] Coexistence decision for bridge layers:
  - `electronAPI` remains the canonical typed Electron IPC surface for most renderer features
  - [desktopBridgeClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/desktopBridgeClient.ts) is the narrow compatibility layer for bootstrap-only capabilities still exposed through `desktopBridge` and `nativeApi`
  - [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts) and [wsNativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/wsNativeApi.ts) remain the assistant transport/runtime compatibility layer rather than a feature-level dependency
- [completed] Verification after the first `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] Verification after the second `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] Verification after the third `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] Verification after completing `Phase 7`:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors

## Phase 8: Remaining Large-File Service Decomposition

### Goal

Continue splitting the largest remaining backend and desktop service files, but now from a stable architectural baseline.

### Priority Targets

- [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts)
- [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts)
- [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts)
- [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
- [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts)

### Tasks

- [completed] For each file, document the current responsibility clusters.
- [completed] Extract pure helpers and isolated workflows first.
- [completed] Split orchestration from transport:
  - route registration vs handler logic
  - command parsing vs effect execution
  - shared normalization vs workflow coordination
- [completed] Keep public interfaces stable during each slice.

### Acceptance Criteria

- each target file has clearer sub-modules and fewer unrelated concerns in one place
- the remaining top-level file acts as a coordinator, not the whole subsystem

### Phase 8 Progress

- [completed] Responsibility clusters have been refreshed before the next extraction so we can keep the decomposition deliberate instead of opportunistic:
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) currently combines:
    - repository initialization and identity setup
    - remote sync workflows (`fetchMain`, `pullMain`, `pushMain`, `commitAndPush`)
    - replay/restore/adopt flows
    - repo health classification
    - conflict file read/resolve flows
    - low-level git metadata and parsing helpers
  - [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) currently combines:
    - shell/command execution helpers
    - dependency install and dev-server command resolution
    - terminal and dev-server process lifecycle
    - workspace hydration and runtime lookup
    - access checks and route registration glue
- [completed] The first `Phase 8` extraction slice reconnected the remote-sync cluster in [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts), using existing helper modules instead of creating another layer:
  - [gitRemoteSync.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitRemoteSync.ts)
  - [gitReplayWorkspaceState.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitReplayWorkspaceState.ts)
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) now delegates `fetchMain`, `pullMain`, `pushMain`, and `commitAndPush` to [gitRemoteSync.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitRemoteSync.ts)
  - the top-level service dropped from `2423` lines to `2117` lines without changing its public interface
  - the next `gitSyncService.ts` slice is now clearer: replay/restore/adopt remains the next large workflow cluster to extract or reconnect
- [completed] Verification after the first `Phase 8` service-decomposition slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] The second `Phase 8` extraction slice reconnected the replay/conflict helper layer in [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts):
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) now delegates captured-workspace restore/apply, conflict auto-resolution, and sequencer finalization to [gitReplayWorkspaceState.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitReplayWorkspaceState.ts)
  - the duplicate stash-drop, auto-resolve, conflict-file write, conflict-stage checkout, binary-conflict copy, and sequencer-completion implementations were removed from the service
  - the top-level service dropped again from `2117` lines to `1779` lines while keeping the public API stable
  - the remaining `gitSyncService.ts` clusters are now much clearer: repository initialization, replay/restore/adopt coordination, repo health classification, conflict file read/resolve entry points, and low-level git metadata helpers
- [completed] Verification after the second `Phase 8` service-decomposition slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] The third `Phase 8` extraction slice reconnected the shared git defaults and status helpers:
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) now imports branch/remote defaults, status parsing, and remote/ref normalization from [gitSyncShared.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncShared.ts)
  - the duplicate local constant definitions, repo/status interfaces, and local parse/normalize/error-helper implementations were removed from the service
  - the top-level service dropped again from `1779` lines to `1644` lines while preserving the same public method surface
- [completed] Verification after the third `Phase 8` service-decomposition slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- [completed] The fourth `Phase 8` extraction slice split command execution and preview readiness helpers out of [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts):
  - added [runtimeExecution.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/runtimeExecution.ts) for workspace command capture, git command execution, and git auth header helpers
  - added [runtimePreview.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/runtimePreview.ts) for port allocation, readiness probes, and runtime preview reachability checks
  - kept [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) as the coordinator for locks, runtime maps, terminal event plumbing, and route registration
  - the top-level route module dropped from `2029` lines to `1392` lines
- [completed] The fifth `Phase 8` extraction slice split Stripe pricing, schedule, and invoice-scoping helpers out of [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts):
  - added [pricing.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe/pricing.ts) for plan normalization, preferred-price resolution, and catalog payload shaping
  - added [subscriptionHelpers.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe/subscriptionHelpers.ts) for subscription schedule helpers and invoice scoping
  - kept [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts) focused on route registration, auth checks, and webhook coordination
  - the top-level route module dropped from `2704` lines to `2201` lines
- [completed] The sixth `Phase 8` extraction slice split project metadata and pagination helpers out of [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts):
  - added [projectGitMetadata.ts](/Users/admin/Downloads/electron-app-main/convex/lib/projectGitMetadata.ts) for slug and git repository metadata helpers
  - added [projectPagination.ts](/Users/admin/Downloads/electron-app-main/convex/lib/projectPagination.ts) for page filtering, sorting, pagination, and item shaping
  - kept [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts) focused on queries, mutations, and team/repository workflows
  - the top-level Convex module dropped from `2396` lines to `2120` lines
- [completed] The seventh `Phase 8` extraction slice split organization access, role, and permission helpers out of [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts):
  - added [organizationAccess.ts](/Users/admin/Downloads/electron-app-main/convex/lib/organizationAccess.ts) for canonical membership selection, permission checks, role key generation, admin-equivalent guardrails, and AI-provider sanitization
  - kept [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts) focused on organization queries/mutations and storage/billing coordination
  - the top-level Convex module dropped from `2236` lines to `1861` lines
- [completed] Verification after completing `Phase 8`:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
  - the remaining top-level files now act much more like coordinators than full subsystems, so the plan can move forward to `Phase 9`

## Phase 9: Assistant Runtime and Type-Safety Burn-Down

### Goal

Reduce long-term risk in the assistant/runtime area by shrinking `@ts-nocheck` and outdated contract adapters.

### Target Areas

- [providerRuntime.ts](/Users/admin/Downloads/electron-app-main/shared/assistant-contracts/providerRuntime.ts)
- [main.ts](/Users/admin/Downloads/electron-app-main/electron/assistant-runtime/main.ts)
- [MessagesTimeline.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/MessagesTimeline.tsx)
- neighboring files under:
  - `/Users/admin/Downloads/electron-app-main/shared/assistant-contracts`
  - `/Users/admin/Downloads/electron-app-main/shared/assistant-shared`
  - `/Users/admin/Downloads/electron-app-main/electron/assistant-runtime`
  - `/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat`

### Tasks

- [ ] Prioritize the highest-centrality `@ts-nocheck` files first.
- [ ] Replace broad suppression with explicit typing and narrow helper types.
- [ ] Remove stale runtime/provider compatibility translations where the current product no longer needs them.
- [ ] Keep serialization, IPC, and provider behavior stable while doing so.

### Acceptance Criteria

- the assistant/runtime surface has materially fewer type-suppressed files
- core store/runtime contracts are explicit and testable

## Phase 10: Final Legacy Deletion Pass

### Goal

Delete the leftovers that were intentionally preserved only until migrations were complete.

### Candidates

- disconnected refactor files not chosen as canonical
- dead route builders
- hidden legacy renderer toggles
- compatibility bridge aliases no longer referenced
- compatibility wrappers around assistant stores or runtime helpers no longer referenced

### Tasks

- [ ] Run dead-code search after each major migration.
- [ ] Remove files only after inbound references are zero and behavior checks are green.
- [ ] Update plan docs and internal comments to reflect final architecture.

### Acceptance Criteria

- the tree no longer contains large amounts of abandoned migration scaffolding

## Detailed Decision Rules

### Reconnect vs Delete

Reconnect an extracted module if all are true:

- it expresses a better separation than the active monolith
- its responsibilities still match the current product
- rewiring it will reduce duplication rather than add another layer

Delete it if any are true:

- the product shape changed and the abstraction no longer fits
- active code already evolved differently
- keeping it would require compatibility glue that adds no product value

### Preserve Compat vs Retire Compat

Preserve a compatibility path only if:

- there is live user value in old routes/links/behavior, or
- the migration cost would create support burden right now

Retire it if:

- the product already disabled the behavior in practice
- the compat path mostly adds maintenance surface and confusion

## Verification Plan

### Required On Every Phase

- [ ] `bun run typecheck`
- [ ] `bun run lint`

### Required Manual Checks During Relevant Phases

- [ ] project list -> project open -> workbench load
- [ ] workbench lane switching
- [ ] open/focus tile URL behavior
- [ ] assistant chat tile load, send, and restore behavior
- [ ] branch control actions open correctly
- [ ] settings navigation across personal, workspace, and team surfaces
- [ ] billing navigation and checkout-related dialogs
- [ ] invite acceptance or redirect behavior
- [ ] dev server and preview panel behavior

### Required Architecture Checks

- [ ] orphaned module search returns only intentional compatibility shims
- [ ] direct Electron bridge usage count is lower after the facade phase
- [ ] `@ts-nocheck` count is lower after the assistant/runtime phase

## Execution Order

This is the recommended order.

1. Phase 0: baseline and tagging
2. Phase 1: reconnect-or-delete audit
3. Phase 2: workbench/sidebar canonicalization
4. Phase 3: shell/settings/route unification
5. Phase 4: legacy route and invite cleanup
6. Phase 5: project pages / preview / dev server cleanup
7. Phase 6: assistant store consolidation
8. Phase 7: Electron client facade cleanup
9. Phase 8: remaining large-file service decomposition
10. Phase 9: assistant runtime/type-safety burn-down
11. Phase 10: final legacy deletion pass

This order matters because each later phase benefits from the ownership decisions made earlier.

## Risks

### High-Risk Areas

- workbench runtime and Dockview wiring
- project open and git sync behavior
- billing correctness
- preview/dev-server ownership
- assistant runtime/store serialization

### Risk Controls

- migrate one ownership seam at a time
- prefer adapter layers during transitions over wide rewrites
- delete only after inbound reference verification
- keep route behavior tests and manual smoke checks current

## Deliverables At The End

At the end of this plan we should have:

- a smaller set of clearly canonical modules
- fewer large god files
- fewer legacy routes and feature toggles
- fewer bridge aliases and fewer raw renderer Electron calls
- a materially smaller `@ts-nocheck` footprint
- a codebase that is safer to optimize for startup and route performance

## Progress Log

### 2026-04-09

- Created this master plan to unify the remaining refactor work, legacy cleanup, reconnect-vs-delete decisions, and verification gates into one execution document.
- Folded in the known unfinished areas:
  - incomplete workbench controller adoption
  - billing split not fully wired
  - project-open client/access/type extraction not fully adopted
  - legacy project and invite routes
  - file tree fallback and old project-pages naming
  - broad renderer-to-Electron coupling
  - assistant store duplication and assistant/runtime type debt
- Established the recommended order of operations so later performance work can build on stable architecture instead of partial migrations.
- Executed the first half of `Phase 0`:
  - refreshed the live route snapshot in [routes.tsx](/Users/admin/Downloads/electron-app-main/src/router/routes.tsx)
  - refreshed the large-file hotspot inventory
  - refreshed the `@ts-nocheck` footprint snapshot
  - refreshed the direct Electron bridge hotspot list
  - tagged the first reconnect-or-delete candidates and legacy compatibility paths
- Captured the current baseline verification status:
  - `bun run typecheck` passed
  - `bun run lint` passed with 32 warnings and 0 errors
- Started `Phase 1A` workbench reconnect-or-delete audit.
- Recorded the first concrete direction decision:
  - the extracted workbench controller hooks are orphaned, not obsolete
  - the current direction for `Phase 1A` is to reconnect them into the active workbench shells rather than delete them
- Landed the first two `Phase 1A` reconnects:
  - [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx) is now a thin UI wrapper over [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)
  - [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx) is now a thin UI wrapper over [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx)
- Audited the remaining Dockview runtime reconnect and recorded the key integration gap:
  - [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts) was structurally the right target, but it initially sat ahead of the active page in its layout persistence and runtime-preview assumptions
- Completed the remaining `Phase 1A` Dockview reconnect:
  - [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) now delegates Dockview runtime ownership to [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
  - [workbenchDockview.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/workbenchDockview.ts) now owns the active browser/dev-server panel placement logic instead of a page-local duplicate
  - [WorkbenchDockPanels.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDockPanels.tsx) now resolves runtime-only selection preview tiles through the runtime provider, so the hook's transient preview model is live instead of stranded
- Completed the `Phase 1B` billing reconnect:
  - [Billing.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) is now a thin route wrapper
  - the active billing implementation now flows through [useBillingController.ts](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts) and [BillingContent.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx)
- Completed the `Phase 1C` project-open reconnect:
  - [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) remains the active coordinator
  - desktop bridge access now flows through [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts)
  - repository/source-control access prompts now flow through [projectOpenAccess.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts)
  - public project-open types now come from [projectOpenTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts) while keeping the existing [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) import surface stable for callers
- Verification after the billing reconnect:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Verification after the first reconnect slices:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Verification after completing the remaining `Phase 1A` Dockview reconnect:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Completed the first `Phase 2` sidebar canonicalization slice:
  - [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) now renders through [ProjectSidebarTreeItem.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx) instead of its old inline tree item implementation
  - sidebar lane/tile rendering now comes from [SidebarLaneTiles.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/SidebarLaneTiles.tsx)
  - sidebar shared types and persisted-state helpers now come from [projectSidebarShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarShared.ts) and [projectSidebarState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarState.ts)
  - [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx) dropped from `1502` lines to `810` lines
- Verification after the first `Phase 2` sidebar slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Completed the first `Phase 3` shell/settings unification slice:
  - [Account.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Account.tsx), [Appearance.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Appearance.tsx), [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx), and [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx) now render through [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx) instead of owning [AppShellLayout.tsx](/Users/admin/Downloads/electron-app-main/src/components/layouts/AppShellLayout.tsx) directly
  - [SettingsDrawer.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsDrawer.tsx) now passes the current route through the personal settings drawer entries, keeping the drawer path aligned with the page-shell contract
  - [SourceControl.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx) now passes `route` into [SettingsRouteShell.tsx](/Users/admin/Downloads/electron-app-main/src/components/settings/SettingsRouteShell.tsx) for consistency with the other settings surfaces
- Verification after the first `Phase 3` shell/settings slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Completed the first `Phase 4` legacy-route cleanup slice:
  - confirmed `/projects/$slug/...` remains an intentional compatibility route through [LegacyProjectRedirectPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/LegacyProjectRedirectPage.tsx)
  - confirmed `/join/project/$token` remains an intentional public compatibility alias to [ProjectJoinPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectJoinPage.tsx)
  - confirmed `/invite/$token` is a retired compatibility message path through [AcceptInvitation.tsx](/Users/admin/Downloads/electron-app-main/src/pages/AcceptInvitation.tsx)
  - removed the dead legacy builder `buildLegacyProjectJoinPath()` from [projectShare.ts](/Users/admin/Downloads/electron-app-main/shared/projectShare.ts)
  - deleted the unused legacy project settings navigation component [SettingsSectionsList.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/SettingsSectionsList.tsx)
- Verification after the first `Phase 4` legacy-route cleanup slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 31 warnings and 0 errors
- Completed the first `Phase 5` preview/dev-server ownership cleanup slice:
  - confirmed the active dev-server runtime already lives in [WorkbenchDevServerTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx) and [useDevServerManager.ts](/Users/admin/Downloads/electron-app-main/src/hooks/useDevServerManager.ts)
  - deleted the dead standalone legacy preview/dev-server components [ServerControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ServerControl.tsx) and [DevServerPanel.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/DevServerPanel.tsx)
  - removed the leftover old store path [useProjectPagesStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/useProjectPagesStore.ts) and the intermediate renamed store [usePreviewRuntimeStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/usePreviewRuntimeStore.ts)
  - extracted the still-live shared preview types into [previewRuntimeTypes.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/previewRuntimeTypes.ts)
- Verification after the first `Phase 5` preview/dev-server cleanup slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 30 warnings and 0 errors
- Completed the first `Phase 6` assistant store consolidation slice:
  - confirmed the active renderer imports already use [composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/composerDraftStore.ts), [terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/terminalStateStore.ts), and [types.ts](/Users/admin/Downloads/electron-app-main/src/stores/types.ts)
  - converted the assistant-prefixed duplicate implementations into thin compatibility re-exports:
    - [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
    - [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
    - [assistant-modelSelection.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-modelSelection.ts)
    - [assistant-storage.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-storage.ts)
    - [assistant-types.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-types.ts)
  - rewired live assistant/workbench imports onto canonical types in [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts), [workbenchAssistantShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/workbenchAssistantShared.ts), and [CozeaChatSurface.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/CozeaChatSurface.tsx)
- Verification after the first `Phase 6` assistant store slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 30 warnings and 0 errors
- Completed the second `Phase 6` assistant store consolidation slice:
  - deleted the now-unreferenced assistant-prefixed compatibility store files:
    - [assistant-composerDraftStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
    - [assistant-terminalStateStore.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
    - [assistant-modelSelection.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-modelSelection.ts)
    - [assistant-storage.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-storage.ts)
    - [assistant-types.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-types.ts)
  - removed the duplicate assistant chat type layer by rewiring [session-logic.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/session-logic.ts), [MessagesTimeline.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/MessagesTimeline.tsx), and [ChangedFilesTree.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/ChangedFilesTree.tsx) to the canonical [types.ts](/Users/admin/Downloads/electron-app-main/src/stores/types.ts), then deleting [src/features/projects/components/assistant/chat/types.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/types.ts) and [src/features/projects/components/assistant/types.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/types.ts)
  - moved thread-session normalization into [threadSession.ts](/Users/admin/Downloads/electron-app-main/src/stores/threadSession.ts), which removed the inline legacy provider/status helpers from [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts)
- Verification after the second `Phase 6` assistant store slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the first `Phase 7` Electron client-facade slice:
  - added typed settings bridge wrappers in [settingsDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/settingsDesktopClient.ts), [storageSettingsClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/storageSettingsClient.ts), and [toolingSettingsClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/settings/toolingSettingsClient.ts)
  - rewired [Storage.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Storage.tsx) and [Tooling.tsx](/Users/admin/Downloads/electron-app-main/src/pages/settings/Tooling.tsx) to those clients, removing raw `window.electronAPI` usage from both settings pages
- Verification after the first `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the second `Phase 7` Electron client-facade slice:
  - added [projectAnalysisDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/projectAnalysis/projectAnalysisDesktopClient.ts)
  - rewired [routeScanner.ts](/Users/admin/Downloads/electron-app-main/src/utils/routeScanner.ts) and [projectDetector.ts](/Users/admin/Downloads/electron-app-main/src/utils/projectDetector.ts) to that client, removing direct `window.electronAPI` access from both utilities
- Verification after the second `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the third `Phase 7` Electron client-facade slice:
  - rewired [projectOpenGitSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) to use [projectOpenDesktopClient.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts) for the remaining project and sync bridge calls, removing its direct `window.electronAPI` usage
- Verification after the third `Phase 7` client-facade slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the fourth `Phase 7` Electron client-facade slice:
  - added [desktopBridgeClient.ts](/Users/admin/Downloads/electron-app-main/src/lib/desktopBridgeClient.ts) as the intentional low-level alias client for websocket bootstrap resolution, assistant runtime status bootstrap/subscription, and shared context-menu dispatch
  - rewired [ProjectSidebarTreeItem.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx), [workbenchBranchControlShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/workbenchBranchControlShared.ts), [nav-user.tsx](/Users/admin/Downloads/electron-app-main/src/components/nav-user.tsx), and [useProjectCreationMenu.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectCreationMenu.ts) to the shared context-menu client
  - rewired [assistantRuntimeMetadataStore.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts), [useAssistantRuntimeStatus.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/useAssistantRuntimeStatus.ts), [assistant-wsTransport.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-wsTransport.ts), [assistant-store.ts](/Users/admin/Downloads/electron-app-main/src/stores/assistant-store.ts), [ProjectFavicon.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectFavicon.tsx), and [nativeApi.ts](/Users/admin/Downloads/electron-app-main/src/lib/nativeApi.ts) to the shared bootstrap helper
  - confirmed that outside the intentional low-level bridge layer, the only remaining raw `window.desktopBridge` / `window.nativeApi` usage is the environment detector in [env.ts](/Users/admin/Downloads/electron-app-main/src/env.ts)
- Closed the `Phase 7` coexistence decision:
  - `electronAPI` stays the canonical typed IPC surface for renderer features
  - `desktopBridgeClient.ts` is the narrow compatibility seam for bootstrap-only capabilities
  - `nativeApi.ts` and `wsNativeApi.ts` stay as the assistant runtime transport layer, not a feature-level dependency
- Verification after completing `Phase 7`:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Started `Phase 8` service decomposition by refreshing the current responsibility map:
  - confirmed that [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) still owns remote sync, replay/restore/adopt, health classification, conflict resolution, and low-level git helpers
  - confirmed that [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) still owns shell execution, dependency/dev-server command resolution, terminal/dev-server lifecycle, hydration, access checks, and route registration glue
- Completed the first `Phase 8` extraction slice:
  - reconnected the existing [gitRemoteSync.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitRemoteSync.ts) helper into [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts)
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) now delegates `fetchMain`, `pullMain`, `pushMain`, and `commitAndPush` instead of owning those workflow implementations inline
  - the top-level file dropped from `2423` lines to `2117` lines while keeping its public method surface stable
- Verification after the first `Phase 8` extraction slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the second `Phase 8` extraction slice:
  - reconnected the existing [gitReplayWorkspaceState.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitReplayWorkspaceState.ts) helper into [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts)
  - [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts) now delegates captured-workspace replay/apply, conflict auto-resolution, and sequencer finalization instead of carrying duplicate helper implementations inline
  - removed the duplicated stash-drop, conflict-write, conflict-stage checkout, binary-conflict copy, and auto-resolve helper implementations from the service
  - the top-level file dropped again from `2117` lines to `1779` lines while keeping its public method surface stable
- Verification after the second `Phase 8` extraction slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the third `Phase 8` extraction slice:
  - reconnected the shared defaults, status parser, and ref-normalization helpers from [gitSyncShared.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncShared.ts) into [gitSyncService.ts](/Users/admin/Downloads/electron-app-main/electron/services/gitSyncService.ts)
  - removed the duplicate local git constants, repo/status interfaces, and parse/normalize/error helper implementations from the service
  - the top-level file dropped again from `1779` lines to `1644` lines while preserving the same public method surface
- Verification after the third `Phase 8` extraction slice:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Completed the fourth `Phase 8` extraction slice:
  - added [runtimeExecution.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/runtimeExecution.ts) and [runtimePreview.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/runtimePreview.ts)
  - moved workspace/git command execution plus preview port/readiness helpers out of [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts)
  - [runtimeWorkspaces.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) dropped from `2029` lines to `1392` lines
- Completed the fifth `Phase 8` extraction slice:
  - added [pricing.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe/pricing.ts) and [subscriptionHelpers.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe/subscriptionHelpers.ts)
  - moved Stripe plan/catalog resolution, subscription schedule helpers, and invoice scoping out of [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts)
  - [stripe.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/stripe.ts) dropped from `2704` lines to `2201` lines
- Completed the sixth `Phase 8` extraction slice:
  - added [projectGitMetadata.ts](/Users/admin/Downloads/electron-app-main/convex/lib/projectGitMetadata.ts) and [projectPagination.ts](/Users/admin/Downloads/electron-app-main/convex/lib/projectPagination.ts)
  - moved project slug/git metadata helpers and paginated list shaping out of [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts)
  - [projects.ts](/Users/admin/Downloads/electron-app-main/convex/projects.ts) dropped from `2396` lines to `2120` lines
- Completed the seventh `Phase 8` extraction slice:
  - added [organizationAccess.ts](/Users/admin/Downloads/electron-app-main/convex/lib/organizationAccess.ts)
  - moved canonical membership, permission, role-key, and admin-equivalent guard helpers out of [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts)
  - [organizations.ts](/Users/admin/Downloads/electron-app-main/convex/organizations.ts) dropped from `2236` lines to `1861` lines
- Verification after completing `Phase 8`:
  - `bun run typecheck` passed
  - `bun run lint` passed with 29 warnings and 0 errors
- Post-`Phase 8` verification pass:
  - `bun run test` is still not globally green because of older suite drift outside the refactor slices:
    - missing-module imports in tests like [managedProviderProxy.test.ts](/Users/admin/Downloads/electron-app-main/tests/managedProviderProxy.test.ts), [modelIdResolution.test.ts](/Users/admin/Downloads/electron-app-main/tests/modelIdResolution.test.ts), [modelServePolicy.test.ts](/Users/admin/Downloads/electron-app-main/tests/modelServePolicy.test.ts), [streamError.test.ts](/Users/admin/Downloads/electron-app-main/tests/streamError.test.ts), [surfaceErrors.test.ts](/Users/admin/Downloads/electron-app-main/tests/surfaceErrors.test.ts), [radonFeatures.test.ts](/Users/admin/Downloads/electron-app-main/tests/electron/radonFeatures.test.ts), and [radonProtocol.test.ts](/Users/admin/Downloads/electron-app-main/tests/electron/radonProtocol.test.ts)
    - one stale assertion in [authCallbackState.test.ts](/Users/admin/Downloads/electron-app-main/tests/authCallbackState.test.ts)
    - browser-environment assumptions in [workbenchSearchParamSync.test.ts](/Users/admin/Downloads/electron-app-main/tests/workbenchSearchParamSync.test.ts) and [workbenchStoreSelectors.test.ts](/Users/admin/Downloads/electron-app-main/tests/workbenchStoreSelectors.test.ts)
  - the targeted refactor-related suites are green:
    - `bunx vitest run tests/stripeRoutes.test.ts tests/billingSwitch.test.ts tests/billingErrors.test.ts tests/accountEntitlements.test.ts tests/devServerLifecycle.test.ts tests/devServerRestartScheduler.test.ts tests/workspaces.test.ts tests/projectPreviewCapture.test.ts tests/workspaceProjectAccess.test.ts tests/organizationRolePermissions.test.ts tests/projectRuntimeStore.test.ts tests/importTerminalCommand.test.ts`
    - result: `12` files passed, `45` tests passed
  - app boot smoke:
    - `bun run dev` compiled Electron main and preload successfully, started the renderer dev server on `http://localhost:5184/`, and reached `starting electron app...` without build/startup errors in the terminal
    - this terminal-only environment did not let us click through the GUI interactively, so route-by-route manual smoke checks still need a live UI session
  - live Electron renderer smoke via Chromium remote debugging on `127.0.0.1:9222`:
    - `/settings/account`, `/settings/storage`, `/settings/tooling`, `/workspace/source-control`, `/workspace/sync`, `/projects/.../workbench`, and `/projects/.../team` all reached `document.readyState === 'complete'` within the 7 second sample window and rendered route-appropriate content
    - `/workspace/source-control` redirected cleanly to `/settings/source-control`
    - `/workspace/sync` redirected cleanly to `/settings/cloud-storage`
    - `/projects` did not stay on the project list; it redirected back into the last-open workbench URL and raised repeated `Maximum update depth exceeded` promise exceptions from `@tanstack/react-router` / `react-dom_client` during the transition
    - sampled renderer heap stayed roughly in the `109 MB` to `195 MB` used-heap range across the tested routes, with the project team view landing at the high end of that range during the smoke pass
