# Workbench and Sidebar Refactor Plan

## Objective

Refactor the workbench and project sidebar to reduce unnecessary rerenders, isolate Dockview layout churn from shared app state, and break the largest components into smaller modules without regressing current behavior.

## Constraints

- Preserve all current workbench and sidebar functionality.
- Keep existing URL behaviors for lane switching, `openTile`, `focusTile`, and changes overlay.
- Avoid changing Electron IPC contracts, Convex schema, or assistant runtime behavior.
- Work incrementally on top of the current dirty worktree without reverting unrelated edits.

## Success Criteria

- Dockview layout changes no longer update the shared workbench Zustand store on every resize/drag.
- Sidebar subscriptions no longer depend on full workbench objects when they only need tile summaries.
- `ProjectSidebar.tsx` and `ProjectWorkbenchPage.tsx` are reduced by extracting focused hooks/components/modules.
- Workbench hydration, layout persistence, sidebar highlighting, and assistant tile behaviors continue to work.
- `bun run typecheck` and `bun run lint` pass.

## Execution Plan

### Phase 1: Baseline and Safe Performance Wins

- [completed] Create and maintain this plan doc during execution.
- [completed] Isolate persisted Dockview layout snapshots from the shared workbench store.
- [completed] Narrow Zustand selectors used by the sidebar and workbench panels.

### Phase 2: Sidebar Refactor

- [completed] Extract sidebar persistence helpers and workbench summary selectors.
- [completed] Extract sidebar lane/tile rendering into dedicated components.
- [completed] Reduce the prop surface of the project tree row component.

### Phase 3: Workbench Refactor

- [completed] Extract Dockview reconciliation and seam/edge helpers into dedicated modules.
- [completed] Extract workbench query-param synchronization into a hook.
- [completed] Extract Dockview runtime wiring and layout persistence into a dedicated persistence module.

### Phase 4: Deep Workbench Decomposition

- [completed] Extract assistant tile runtime/config/binding/action orchestration into focused hooks and dialog components.
- [completed] Extract branch-control menu building, bridge compat helpers, and lane-action orchestration into a dedicated hook/service layer.
- [completed] Extract page-level Dockview runtime orchestration into a reusable hook.
- [completed] Move transient seam/edge selection previews out of shared workbench store metadata and into the Dockview runtime layer.

### Phase 5: Verification

- [completed] Run typecheck and lint.
- [completed] Fix any regressions found during verification.
- [completed] Record final status and follow-up opportunities in this document.

## Progress Log

### 2026-04-07

- Started plan-driven refactor execution.
- Confirmed the core pressure points:
  - Shared workbench store currently persists serialized Dockview layout.
  - Workbench page mirrors Dockview events back into Zustand.
  - Sidebar reads broad workbench state for lane/tile display.
  - Sidebar and workbench page are both very large orchestration components.
- Split Dockview snapshot persistence out of the shared workbench Zustand store into [workbenchLayoutPersistence.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/workbenchLayoutPersistence.ts).
- Added focused sidebar selectors to avoid subscribing project rows to full workbench objects and layout churn.
- Extracted sidebar row rendering into:
  - [ProjectSidebarTreeItem.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/ProjectSidebarTreeItem.tsx)
  - [SidebarLaneTiles.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/SidebarLaneTiles.tsx)
  - [projectSidebarShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarShared.ts)
  - [projectSidebarState.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/sidebar/projectSidebarState.ts)
- Extracted workbench Dockview helpers into [workbenchDockview.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/workbenchDockview.ts).
- Extracted workbench URL/search-param synchronization into [useProjectWorkbenchSearchParamSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectWorkbenchSearchParamSync.ts).
- Reduced top-level file size:
  - [ProjectSidebar.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx): 1433 -> 756 lines
  - [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx): 1213 -> 888 lines
- Verification results:
  - `bun run lint` passed with existing warnings only.
  - `bun run typecheck` still fails, but only due to pre-existing unrelated errors in:
    - [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
    - [General.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- Post-refactor regression fix:
  - Fixed an infinite rerender loop in `ProjectSidebarTreeItem` caused by subscribing to a selector that rebuilt a fresh lane-summary object on every store read.
  - The sidebar row now subscribes to the active lane's raw workbench record and memoizes its derived summary locally, which gives React a stable external-store snapshot again.
- Continued the workbench refactor in one pass:
  - Extracted assistant tile orchestration into:
    - [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx)
    - [useAssistantServerConfig.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useAssistantServerConfig.ts)
    - [workbenchAssistantShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/workbenchAssistantShared.ts)
    - [WorkbenchAssistantDiffDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog.tsx)
  - Extracted branch control orchestration into:
    - [useWorkbenchBranchControl.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/useWorkbenchBranchControl.ts)
    - [workbenchBranchControlShared.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/workbenchBranchControlShared.ts)
    - [workbenchBranchCompat.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/branch-control/workbenchBranchCompat.ts)
  - Extracted Dockview runtime/controller logic into [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts).
  - Moved transient seam/edge selection previews out of the shared workbench store and into runtime-only Dockview state exposed through [WorkbenchDockPanels.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchDockPanels.tsx).
  - Updated [workbenchDockview.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/lib/workbenchDockview.ts) so panel reconciliation preserves runtime-only preview panels instead of deleting them during normal store-backed reconciles.
- Reduced top-level workbench orchestration files further:
  - [WorkbenchAssistantChatTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx): 1253 -> 62 lines
  - [WorkbenchHeaderBranchControl.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx): 1077 -> 64 lines
  - [ProjectWorkbenchPage.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx): 1213 -> 403 lines
- Verification results after the second pass:
  - `bun run lint` passed with existing warnings only.
  - `bun run typecheck` still failed at that point, but only due to pre-existing unrelated errors in:
    - [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
    - [General.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/General.tsx)
- Completed the remaining follow-up items:
  - Introduced a shared assistant runtime metadata service in [assistantRuntimeMetadataStore.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts) so assistant tiles no longer each create their own runtime-status and server-config bridge subscriptions.
  - Rewired [useAssistantRuntimeStatus.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/useAssistantRuntimeStatus.ts) and [useAssistantServerConfig.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useAssistantServerConfig.ts) to read from that shared snapshot.
  - Replaced the selection tile's `ResizeObserver`-driven layout mode state in [WorkbenchSelectionTile.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/WorkbenchSelectionTile.tsx) with a CSS/container-query-based layout in [workbench.css](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/workbench.css).
  - Added pure workbench route-intent helpers to [useProjectWorkbenchSearchParamSync.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useProjectWorkbenchSearchParamSync.ts), which also made lane/open/focus logic easier to verify in tests.
  - Fixed the previously unrelated typecheck blockers in:
    - [CreateProjectDialog.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/CreateProjectDialog.tsx)
    - [General.tsx](/Users/admin/Downloads/electron-app-main/src/pages/workspace/General.tsx)
  - Added targeted regression coverage:
    - [workbenchSearchParamSync.test.ts](/Users/admin/Downloads/electron-app-main/tests/workbenchSearchParamSync.test.ts)
    - [workbenchLayoutPersistence.test.ts](/Users/admin/Downloads/electron-app-main/tests/workbenchLayoutPersistence.test.ts)
    - [workbenchStoreSelectors.test.ts](/Users/admin/Downloads/electron-app-main/tests/workbenchStoreSelectors.test.ts)
- Final verification results:
  - `bun run typecheck` passed.
  - `bun run lint` passed with existing warnings only.
  - `bun x vitest run tests/workbenchSearchParamSync.test.ts tests/workbenchLayoutPersistence.test.ts tests/workbenchStoreSelectors.test.ts` passed.
  - `bun run test` still fails due unrelated pre-existing suite drift outside this workbench/sidebar refactor:
    - several tests import modules that no longer exist in the current repo shape
    - [authCallbackState.test.ts](/Users/admin/Downloads/electron-app-main/tests/authCallbackState.test.ts) has an outdated expectation for the current auth-state payload shape

## Final Status

- Shared workbench metadata and live Dockview layout persistence are now separated.
- Sidebar subscriptions are narrower and no longer depend on full per-lane workbench objects.
- The largest sidebar and workbench concerns have been split into reusable modules/hooks.
- Assistant tile, branch control, and Dockview runtime orchestration are no longer embedded directly in the largest page/component files.
- Transient selection preview panels are now runtime-only and no longer churn the shared workbench store during edge/seam insertion flows.
- Assistant runtime metadata is now shared across tiles instead of each tile attaching duplicate bridge listeners.
- The workbench follow-up checklist is complete; remaining failures are broader repo-level test drift outside this refactor scope.
- No functionality was intentionally removed; the refactor preserved lane switching, tile focus/open flows, assistant lane tiles, and layout restore behavior.

## Follow-Up Opportunities

- If we want to keep shrinking write scopes, the biggest remaining internal slices are still:
  - [useWorkbenchAssistantTileController.tsx](/Users/admin/Downloads/electron-app-main/src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx)
  - [useWorkbenchDockviewRuntime.ts](/Users/admin/Downloads/electron-app-main/src/features/projects/hooks/useWorkbenchDockviewRuntime.ts)
- If we want the whole repo test suite green, the next pass should address the unrelated missing-module suites and the stale auth callback expectation.
