# Platform Refactor Plan

## Objective

Refactor the next largest cross-cutting areas of the app after the workbench/sidebar pass, while preserving current behavior and avoiding schema or IPC contract changes.

## In Scope

- Assistant renderer store/runtime duplication
- Billing page decomposition
- Unified header decomposition
- Renderer-side Electron client cleanup
- Git/runtime workspace pipeline modularization

## Out of Scope

- Task board refactor
- Convex schema changes
- Electron IPC contract changes
- Assistant runtime protocol changes

## Success Criteria

- Duplicate assistant store files are consolidated behind shared foundations.
- The billing page and unified header no longer act as single giant orchestration files.
- Git/runtime workspace logic is split into smaller modules with clearer responsibilities.
- Renderer code uses narrower Electron client helpers in the refactored areas.
- `bun run typecheck` and `bun run lint` pass.

## Execution Plan

### Phase 1: Planning

- [completed] Audit current hotspots and confirm the next refactor targets.
- [completed] Keep this document updated as work lands.

### Phase 2: Assistant Store Consolidation

- [completed] Remove near-duplicate assistant store implementations by reusing shared modules.
- [completed] Keep public imports stable while reducing duplicated logic and type-suppressed surfaces.

### Phase 3: Billing Decomposition

- [completed] Extract billing data orchestration into a dedicated hook.
- [completed] Extract major billing sections into focused presentational components.

### Phase 4: Unified Header Decomposition

- [completed] Extract invite inbox logic into a focused component/hook.
- [completed] Extract project share and repo-access orchestration into focused modules.
- [completed] Keep the top-level header focused on shell/layout composition.

### Phase 5: Electron And Git/Runtime Cleanup

- [completed] Add typed renderer-side Electron client helpers for the refactored surfaces.
- [completed] Extract project open git-sync flow into smaller focused modules.
- [completed] Extract runtime workspace route helpers into focused modules without changing external routes.

### Phase 6: Verification

- [completed] Run typecheck and lint.
- [completed] Run targeted checks where available.
- [completed] Record final outcomes and remaining follow-up opportunities.

## Progress Log

### 2026-04-07

- Started the post-workbench platform refactor pass.
- Audited the current hotspots and confirmed the highest-leverage remaining targets:
  - duplicate assistant store/runtime modules
  - large billing and unified header components
  - heavy renderer-side `window.electronAPI` usage in the git/open pipeline
  - oversized runtime workspace and git service modules
- Confirmed especially strong duplication in:
  - [composerDraftStore.ts](<home>/Downloads/electron-app-main/src/stores/composerDraftStore.ts)
  - [assistant-composerDraftStore.ts](<home>/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
  - [terminalStateStore.ts](<home>/Downloads/electron-app-main/src/stores/terminalStateStore.ts)
  - [assistant-terminalStateStore.ts](<home>/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
- Confirmed the next large component/page targets:
  - [Billing.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/Billing.tsx)
  - [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx)
- Confirmed the next large service/pipeline targets:
  - [projectOpenGitSync.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts)
  - [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts)
  - [runtimeWorkspaces.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts)
- Consolidated the obvious assistant duplicate store surfaces while preserving existing import paths:
  - [assistant-modelSelection.ts](<home>/Downloads/electron-app-main/src/stores/assistant-modelSelection.ts)
  - [assistant-storage.ts](<home>/Downloads/electron-app-main/src/stores/assistant-storage.ts)
  - [assistant-types.ts](<home>/Downloads/electron-app-main/src/stores/assistant-types.ts)
  - [assistant-terminalStateStore.ts](<home>/Downloads/electron-app-main/src/stores/assistant-terminalStateStore.ts)
  - [assistant-composerDraftStore.ts](<home>/Downloads/electron-app-main/src/stores/assistant-composerDraftStore.ts)
- Split the billing surface into a shell, shared billing helpers, a controller hook, and focused content sections:
  - [Billing.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/Billing.tsx) now acts as the route shell and guard.
  - [billingShared.ts](<home>/Downloads/electron-app-main/src/pages/workspace/billing/billingShared.ts) centralizes plan metadata and pure helpers.
  - [useBillingController.ts](<home>/Downloads/electron-app-main/src/pages/workspace/billing/useBillingController.ts) owns billing orchestration and actions.
  - [BillingContent.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx) renders the page sections and dialogs.
- Split the unified header into a composition shell plus focused collaboration controls:
  - [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx)
  - [HeaderInboxButton.tsx](<home>/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderInboxButton.tsx)
  - [HeaderProjectShareButton.tsx](<home>/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
  - [HeaderProjectChangesButton.tsx](<home>/Downloads/electron-app-main/src/components/layouts/unified-header/HeaderProjectChangesButton.tsx)
  - [headerShared.ts](<home>/Downloads/electron-app-main/src/components/layouts/unified-header/headerShared.ts)
- Narrowed renderer-side Electron usage in the project-open flow:
  - [projectOpenDesktopClient.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenDesktopClient.ts) wraps the renderer bridge calls used by project open.
  - [projectOpenAccess.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenAccess.ts) owns source-control and repository access readiness checks.
  - [projectOpenTypes.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenTypes.ts) holds the shared project-open types.
  - [projectOpenGitSync.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts) now composes those helpers instead of directly reaching into `window.electronAPI`.
- Extracted shared git helper logic out of the Electron git sync service into [gitSyncShared.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncShared.ts), reducing duplicated branch/remote/status normalization logic inside [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts).
- Extracted common normalization and path helpers from [runtimeWorkspaces.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) into [shared.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/shared.ts) without changing the external route contract.
- Continued the runtime workspace split by moving route registration into focused modules:
  - [lifecycle.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/routes/lifecycle.ts)
  - [files.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/routes/files.ts)
  - [terminal.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/routes/terminal.ts)
  - [preview.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/routes/preview.ts)
  - [types.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces/types.ts)
- Continued the git sync split by moving the stash replay / auto-resolve / sequencer helpers into [gitReplayWorkspaceState.ts](<home>/Downloads/electron-app-main/electron/services/gitReplayWorkspaceState.ts), leaving [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts) as a thinner coordinator for those flows.
- Split the git remote synchronization family into [gitRemoteSync.ts](<home>/Downloads/electron-app-main/electron/services/gitRemoteSync.ts), moving the `fetch`, `pull`, `push`, and `commitAndPush` flows out of [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts).
- Removed `@ts-nocheck` from the central assistant renderer state files:
  - [assistant-store.ts](<home>/Downloads/electron-app-main/src/stores/assistant-store.ts)
  - [types.ts](<home>/Downloads/electron-app-main/src/stores/types.ts)
- Captured the top-level file-size reduction at the main entry points:
  - [UnifiedHeader.tsx](<home>/Downloads/electron-app-main/src/components/layouts/UnifiedHeader.tsx): `1915 -> 426` lines
  - [Billing.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/Billing.tsx): `2375 -> 42` lines, with the UI and controller logic moved into focused billing modules
  - [projectOpenGitSync.ts](<home>/Downloads/electron-app-main/src/features/projects/lib/projectOpenGitSync.ts): `1263 -> 1029` lines after moving shared types and access/client helpers out
  - [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts): `2423 -> 1600` lines after extracting shared helper logic, replay/conflict orchestration, and the remote sync flows
  - [runtimeWorkspaces.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts): `3970 -> 2028` lines after extracting shared helpers, route registration modules, and the preview proxy/upgrade layer
- Verification completed:
  - `bun run typecheck` passed
  - `bun run lint` passed with existing repo warnings only

## Remaining Follow-Up Opportunities

- Continue shrinking [gitSyncService.ts](<home>/Downloads/electron-app-main/electron/services/gitSyncService.ts) by extracting clone/adopt/restore flows or repo-health/replay orchestration into deeper sub-services if we want another simplification pass.
- Continue shrinking [runtimeWorkspaces.ts](<home>/Downloads/electron-app-main/server/src/routes/runtimeWorkspaces.ts) by extracting the dependency-install/dev-server lifecycle helpers and possibly the runtime state container itself.
- Remove more `@ts-nocheck` and legacy assistant runtime debt in the deeper assistant runtime/contracts surfaces now that the central renderer store is back under typecheck.
- Revisit the task board later as a separate refactor track; it was intentionally excluded from this pass.
