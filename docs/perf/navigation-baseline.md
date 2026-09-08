# Navigation Runtime Baseline Report

**Repository:** `Cozea/electron-app`  
**Inspected Baseline SHA:** `073df5230d2400684434ea6b7db27b0aafc72ddc`  
**Working Branch:** `perf/navigation-runtime-v2`  
**Date:** 2026-09-08  
**Environment:** macOS (Darwin arm64), Bun 1.4.0, Node v24.13.1, Electron 40, Vitest 4.1.11

---

## 1. Environment & Preflight

- **Commit:** `073df5230d2400684434ea6b7db27b0aafc72ddc` (HEAD of `main`)
- **Working Tree:** Isolated on branch `perf/navigation-runtime-v2`. Preserved working tree edits (desktop typography harmonization and performance cleanup). Fixed 3 minor unused variable errors in `ChatMarkdown.tsx`, `DevAppSettings.tsx`, and `SettingsSidebar.tsx`.
- **Preflight Verification:**
  - `bun run typecheck`: Passed (0 errors)
  - `bun run typecheck:electron`: Passed (0 errors)
  - `bun run typecheck:tests`: Passed (0 errors)
  - `bun run test`: Passed (2,560 passed, 5 skipped)
  - `bun run build`: Passed (electron-vite production bundle created successfully)

---

## 2. Findings and Baseline Architectural Inefficiencies (F01–F14)

| Finding | Verified Baseline Observation | Root Cause & Architectural Implication |
|---|---|---|
| **F01** | `WorkbenchKeepAliveHost` lives inside `ProjectWorkbenchSurface` | When navigating away from `/projects/p/:id/workbench` (e.g. to `/store`, `/inbox`, `/tasks`), `ProjectWorkbenchSurface` unmounts, destroying `WorkbenchKeepAliveHost` and all resident workbench states and Dockview instances. |
| **F02** | `ProjectLayout` provides ambient route/workspace/sync contexts | Retained sessions inside the layout receive whichever project/workspace the active route specifies rather than their own immutable session identity. |
| **F03** | Prefetch vs mount separate requests | `projectSwitchPrefetch` tracks its own in-flight promises, but mounted hooks (`useProjectWorkspaceResolution`, `useProjectLaneState`) call the underlying service directly, triggering redundant duplicate queries. |
| **F04** | Multiple independent polling loops | Both `ProjectLayout` and `ProjectSidebar` call `useProjectLaneState`, each running an independent 5-second polling interval executing `gitStatus` and lane derivation. |
| **F05** | Monolithic query cache persistence | `queryCache.ts` debounces a complete serialization of the entire query cache map to `localStorage` under key `cozea-query-cache`. |
| **F06** | Synchronous localStorage layout reads | `peekPersistedWorkbenchLayout` parses raw JSON from `localStorage['cozea:project-workbench-layouts']` synchronously during canvas setup and component render. |
| **F07** | Late debouncing of serialized state | `workbenchStore.ts` debounces storage calls at the `StateStorage.setItem` layer after `JSON.stringify` has already run on the main thread. |
| **F08** | Synchronous main-process file I/O | `WorkbenchSessionManager.persist()` invokes synchronous filesystem writes (`fs.writeFileSync`) on `ensureSession`, `activateSession`, and `backgroundSession` hot paths. |
| **F09** | Mount-driven IPC activation cascade | `useWorkbenchSessionLifecycle` triggers `ensureSession` -> `activateSession` on component mount and `backgroundSession` on unmount. Unmount cancellation discards React state but does not cancel in-flight Electron IPC. |
| **F10** | Runtime service authority split | Runtime hosts (`WorkspaceRuntimeHostsGate`, `TerminalViewHostGate`) live outside the route outlet, but UI presentation controls their attachment ambiguously. |
| **F11** | Opacity-based pseudo-suspension | `WorkbenchActivity` keeps React Activity `mode="visible"` and conceals hidden workbenches with `opacity: 0; pointer-events: none;`. Offscreen Dockview instances, animations, and DOM measurement callbacks continue running. |
| **F12** | Ambiguous return navigation tests | Previous interaction benchmarks returned via `/changes` (which redirects to workbench) and treated `requestAnimationFrame` callbacks as proof of visual paint. |
| **F13** | Catalog startup fetch race | `useWorkspaceCatalogSnapshot` starts an initial fetch and registers push updates, but multiple early subscribers do not share an in-flight initial request promise. |
| **F14** | Ambient route param consumption | `useAccessibleProject` falls back to `useParams()` from TanStack Router, forcing retained session components to re-render whenever the URL changes. |

---

## 3. Concrete Call-Site Inventory

### 3.1 Session Lifecycle Callers
- `apps/desktop/electron/services/WorkbenchSessionManager.ts`: Core session manager; contains `ensureSession`, `activateSession`, `backgroundSession`, and sync `persist()`.
- `apps/desktop/electron/ipc/registerWorkbenchSessionHandlers.ts`: Registers `workbenchSession:ensureSession`, `workbenchSession:activateSession`, `workbenchSession:backgroundSession`.
- `apps/desktop/electron/preload.ts`: Exposes `window.electronAPI.workbenchSession` with `ensureSession`, `activateSession`, `backgroundSession`.
- `apps/desktop/src/features/workbench/hooks/useWorkbenchSessionLifecycle.ts`: React hook calling `ensureSession` -> `activateSession` on mount, `backgroundSession` on unmount.
- `apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx`: Invokes `useWorkbenchSessionLifecycle` at line 136.
- `apps/desktop/src/features/devapps/model/projectDevAppRuntimeLifecycle.ts`: Invokes `workbenchSession.ensureSession` at line 22.
- `apps/desktop/src/features/workbench/WorkbenchDevServerTile.tsx`: Invokes `ensureSession` at line 274.
- `shared/electronApiTypes.ts`: Type definitions for `ensureSession`, `activateSession`, `backgroundSession`.

### 3.2 Workspace & Lane Callers
- `apps/desktop/src/features/workspace/useProjectWorkspaceResolution.ts`: Component-level hook calling `workspace.resolveProject`.
- `apps/desktop/src/features/workbench/hooks/useProjectLaneState.ts`: Component-level hook polling `gitStatus` every 5s.
- `apps/desktop/src/features/projects/lib/projectSwitchPrefetch.ts`: Prefetch helpers calling `resolveProject` and `prefetchProjectLaneState`.
- `apps/desktop/src/features/projects/layouts/ProjectLayout.tsx`: Calls `useProjectWorkspaceResolution` and `useProjectLaneState`.
- `apps/desktop/src/features/projects/ui/ProjectSidebar.tsx`: Calls `useProjectLaneState` for active project.
- `apps/desktop/src/features/projects/ui/sidebar/ProjectSidebarTreeItem.tsx`: Calls `useProjectLaneState` for tree item projects.
- `apps/desktop/src/features/workbench/WorkbenchHeaderBranchControl.tsx`: Consumes project lane state.

### 3.3 Layout & KeepAlive Hierarchy
- `apps/desktop/src/features/projects/layouts/ProjectLayout.tsx`: Root route layout for projects; currently wraps sidebar, header, and route Outlet.
- `apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx`: Route component rendering `<ProjectWorkbenchSurface />`.
- `apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx`: Hosts `WorkbenchKeepAliveHost` and binds route hooks to workbench state.
- `apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx`: Manages resident session list in local React state (`useState`); renders `WorkbenchDockviewSession` inside `WorkbenchActivity`.
- `apps/desktop/src/features/workbench/WorkbenchActivity.tsx`: Conceals inactive sessions via CSS `opacity: 0` without suspending layout or measurement.

### 3.4 Persistence Callers & Storage Keys
- `cozea-query-cache`: LocalStorage key used by `apps/desktop/src/app/model/queryCache.ts`. Monolithic JSON serialization.
- `cozea:project-workbench`: Key in `apps/desktop/src/lib/workbenchStore.ts`. Zustand persist store with debounced `setItem`.
- `cozea:project-workbench-layouts`: Key in `apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts`. Synchronous `localStorage` reads in `peekPersistedWorkbenchLayout`.
- `flushWorkbenchStorage`: Called in `workbenchStore.ts`, `useWorkbenchDockviewRuntime.ts`, `WorkbenchAssistantChatTile.tsx`, `useWorkbenchAssistantTileController.tsx`.

### 3.5 Route Param & Ambient Scope Callers
- `apps/desktop/src/contexts/project/useAccessibleProject.ts`: Reads `useParams()` from TanStack Router.
- `apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx`: Reads `useLocation()`, `useSearchParams()`, `useActiveWorkbenchScope()`, `useAccessibleProject()`.
- `apps/desktop/src/features/projects/pages/LegacyProjectRedirectPage.tsx`: Reads `useParams()`, `useLocation()`.
- `apps/desktop/src/features/projects/pages/ProjectConflictsPage.tsx`: Reads `useAccessibleProject()`.
- `apps/desktop/src/features/projects/pages/ProjectTeamPage.tsx`: Reads `useAccessibleProject()`.
- `apps/desktop/src/features/projects/pages/AgentSkillsPage.tsx`: Reads `useSearchParams()`.
- `apps/desktop/src/features/projects/pages/ScheduledTasksView.tsx`: Reads `useSearchParams()`.
- `apps/desktop/src/features/projects/pages/SkillBuildsView.tsx`: Reads `useSearchParams()`.

### 3.6 Lifecycle / Shutdown Callers
- `apps/desktop/electron/main.ts`: Listens to `app.on('before-quit')`.
- `apps/desktop/electron/registerAppLifecycle.ts`: Listens to `app.on('before-quit')`.
- `apps/desktop/electron/services/WorkbenchSessionManager.ts`: Listens to `app.once('before-quit')`.
- `apps/desktop/src/lib/workbenchStore.ts`: `window.addEventListener('beforeunload', flush)`.
- `apps/desktop/src/features/assistant/model/assistantStore.ts`: `window.addEventListener('beforeunload')`.
- `apps/desktop/src/hooks/useProjectPresence.ts`: `window.addEventListener('beforeunload')`.
