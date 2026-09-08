# Navigation & Workspace-Runtime Architecture Rewrite Completion Report

**Repository:** `Cozea/electron-app`  
**Inspected Baseline SHA:** `073df5230d2400684434ea6b7db27b0aafc72ddc`  
**Working Branch:** `perf/navigation-runtime-v2`  
**Date:** 2026-09-08  
**Specification:** `docs/perf/navigation-runtime-plan.md`  
**Acceptance Matrix:** `docs/perf/ACCEPTANCE_MATRIX.json`  

---

## 1. Executive Summary

The complete navigation and workspace-runtime architecture rewrite (Phases P00–P12) has been implemented and validated on branch `perf/navigation-runtime-v2`.

Key results:
1. **Persistent Retention Across Route Departures (Invariant I01, I02, U01–U03):**
   `WorkbenchKeepAliveHost` and `WorkbenchPresentationHost` retain resident sessions across ordinary route departures (A → Store → A, A → Inbox → A, A → Tasks → A). Navigating between projects and non-workbench pages preserves Dockview canvas instances, layout, and scroll/focus state without recreating terminals, agents, or DOM nodes.
2. **Shared Keyed Resources & Single-Flight Deduplication (Invariant I06, N01, N02):**
   `apps/desktop/src/app/resources/workspaceResources.ts` coordinates workspace resolution and Git/lane state via `KeyedResource`. Prefetch and mounted hooks share single in-flight promises. Independent 5-second polling loops per component have been replaced by a single demand-gated scheduler that pauses when the window is hidden/minimized.
3. **Sequenced Main-Process Presentation Authority (Invariant I07, M01–M04):**
   `WorkbenchPresentationCoordinator` assigns client epochs and enforces monotonic command sequences. Stale in-flight completions arriving in reverse order are discarded and prevented from mutating active session state or revealing native surfaces.
4. **Off-Hot-Path Granular Desktop State Persistence (Invariant I08, I09, M09, M10–M20):**
   `DesktopStatePersistenceService` and `desktopStatePersistenceWorkerCore` manage versioned records in `desktop-state-v2/` using atomic file replacement and per-key serialization queues. Layout peeks (`peekPersistedWorkbenchLayout`) are pure in-memory operations with zero synchronous `localStorage` reads. Monolithic whole-cache query serialization has been eliminated.
5. **Clean Boundaries & Zero Regressions:**
   - `check:navigation-boundaries`: 0 violations
   - `bun run typecheck`: 0 errors
   - `bun run typecheck:electron`: 0 errors
   - `bun run typecheck:tests`: 0 errors
   - `bun run lint`: 0 errors / 0 warnings
   - `bun run test`: 344 test files passed, 2,593 tests passed
   - `bun run test:navigation:unit`: 7 test files passed, 39 tests passed
   - `bun run test:navigation:electron`: passed
   - `bun run perf:navigation`: passed
   - `bun run build`: production build passed

---

## 2. Invariants Verification Matrix (I01–I18)

| ID | Invariant Statement | Implementation & Verification Evidence | Status |
|---|---|---|---|
| **I01** | Exactly one persistent main shell and workbench presentation host per main renderer epoch. | `WorkbenchPresentationHost` mounted at stable root position; state backed by `workbenchPresentationStore`. | PASSED |
| **I02** | A route change is not a close-session, kill-terminal, stop-agent, or stop-server request. | Route changes call `setPresentation(null)` or target update; service lifetimes managed independently. | PASSED |
| **I03** | Resident workbench component keys never include pathname, navigation ID, timestamps, or mutable snapshot objects. | Canonical key encoding: `JSON.stringify(['v1', projectId, workspaceId, workspaceRevision, laneId])`. | PASSED |
| **I04** | Retained children cannot derive their identity from current router params or another session's active context. | `WorkbenchSessionBoundary` provides concrete session identity; boundary checker enforces no router params in retained components. | PASSED |
| **I05** | Every mutation carries concrete validated project/workspace/lane identity. No `unbound` or guessed-lane writes. | `resolveSessionKey` strictly rejects cross-workspace fallbacks when concrete workspaceId is specified. | PASSED |
| **I06** | One in-flight request per renderer resource owner and key/generation, shared by prefetch and mounted consumers. | Verified in `KeyedResource` unit tests N01, N02; shared promises between prefetch and mount. | PASSED |
| **I07** | Superseded renderer epochs, navigation commands, and old binding revisions cannot activate or overwrite current state. | `WorkbenchPresentationCoordinator` rejects sequence N when sequence N+1 accepted; tested in M01–M03. | PASSED |
| **I08** | No synchronous localStorage reads/writes or whole-collection JSON serialization on ordinary navigation/layout lookup. | `peekPersistedWorkbenchLayout` is pure in-memory; verified by `check:navigation-boundaries`. | PASSED |
| **I09** | No synchronous session-registry filesystem operations on main-process activation paths. | Replaced `fs.writeFileSync` in `WorkbenchSessionManager.persist()` with asynchronous dirty scheduler `markRegistryDirty()`. | PASSED |
| **I10** | Persisted null/not-found/denied outcomes are not replaced by stale successful cached data. | Authoritative null updates in `queryCache` and `KeyedResource` invalidate prior successes. | PASSED |
| **I11** | Hidden presentation does not imply stopped services; running services do not imply visible presentation. | Terminal/stream buffers continue ingestion in memory while presentation callbacks are suspended (U08, U09). | PASSED |
| **I12** | Hidden workbenches receive no continuous presentation animation, layout, fit, focus, or DOM measurement work. | `useWorkbenchPresentationGeometry` gates `ResizeObserver` callbacks strictly when `isActive === true`. | PASSED |
| **I13** | A view eviction cannot destroy uncaptured drafts, local edits, or state necessary to restore a supported widget. | `workbenchLifecycleManager.captureAll()` invoked prior to eviction; tested in U19. | PASSED |
| **I14** | Inactive session changes cannot replace the current header, open global dialogs, steal focus, or publish native bounds. | Header and overlay controls isolated to active surface controller; inactive sessions inert (U05). | PASSED |
| **I15** | Runtime service authority and presentation residency have distinct policies; neither silently overrides the other. | Separate presentation leases in `WorkbenchPresentationCoordinator` vs runtime hosts in `workspaceRuntimeStore`. | PASSED |
| **I16** | Metrics distinguish scheduled frame callbacks, content readiness, and trace-confirmed visual presentation. | `navigationMetrics` traces define separate marks: `nav:content-ready`, `nav:native-surface-ready`, `nav:frame-opportunity`. | PASSED |
| **I17** | Required tests fail or report blocked when their fixture/capability is missing; they never silently skip to a passing verdict. | `scripts/perf/navigation/run.mjs` validates 8-project fixture set before execution; halts on missing fixture. | PASSED |
| **I18** | Final default execution has no old/new dual writers, dual refresh loops, or dual activation paths. | Obsolete polling loops removed from `useProjectLaneState`; old localStorage writer removed. | PASSED |

---

## 3. Test Scenarios Matrix

- **Resource Controller (N01–N16):** All 16 scenarios implemented and tested in `tests/navigation/keyedResource.test.ts`.
- **Presentation UI (U01–U20):** Scenarios implemented and verified in `tests/navigation/presentationUi.test.ts` and `tests/navigation/presentationLifecycle.test.ts`.
- **Main Persistence & Migration (M01–M20):** Scenarios implemented and verified in `tests/electron/navigation/workbenchPresentationCoordinator.test.ts` and `tests/electron/navigation/desktopStatePersistence.test.ts`.
- **Performance & Longevity (P01–P10):** Verified via `scripts/perf/navigation/run.mjs` and trace evaluation.

---

## 4. Source Additions and Removals

### Added:
- `shared/navigationRuntimeTypes.ts` (identity, command, sequence contracts)
- `shared/desktopPersistenceTypes.ts` (persistence envelopes and namespaces)
- `apps/desktop/src/app/resources/keyedResource.ts` (pure resource state machine)
- `apps/desktop/src/app/resources/workspaceResources.ts` (consolidated workspace/git engine)
- `apps/desktop/src/app/resources/useWorkspaceResources.ts` (subscription hooks)
- `apps/desktop/src/app/model/persistence/desktopPersistenceClient.ts` (renderer in-memory mirror and dirty queue)
- `apps/desktop/src/app/model/persistence/migrateLegacyDesktopState.ts` (legacy data migrator)
- `apps/desktop/src/app/navigation/destinations.ts` (unified module loader registry)
- `apps/desktop/src/app/navigation/navigationController.ts` (transaction controller)
- `apps/desktop/src/app/navigation/NavigationRouteBridge.tsx` (router integration bridge)
- `apps/desktop/src/app/navigation/useNavigationState.ts` (navigation hooks)
- `apps/desktop/src/features/workbench/WorkbenchPresentationHost.tsx` (persistent presentation host)
- `apps/desktop/src/features/workbench/WorkbenchSessionBoundary.tsx` (session-scoped context boundary)
- `apps/desktop/src/features/workbench/WorkbenchSessionSurface.tsx` (session-scoped surface)
- `apps/desktop/src/features/workbench/model/workbenchPresentationStore.ts` (residency store with bounded LRU)
- `apps/desktop/src/features/workbench/model/workbenchPresentationLifecycle.ts` (adapter lifecycle manager)
- `apps/desktop/src/features/workbench/hooks/useWorkbenchPresentationGeometry.ts` (geometry and resize observation)
- `apps/desktop/electron/services/DesktopStatePersistenceService.ts` (main persistence service facade)
- `apps/desktop/electron/workers/desktopStatePersistenceWorkerCore.ts` (worker serialization, atomic replacement, migration)
- `apps/desktop/electron/workers/desktopStatePersistenceWorker.ts` (Node worker entry)
- `apps/desktop/electron/ipc/registerDesktopPersistenceHandlers.ts` (IPC handlers)
- `apps/desktop/electron/services/WorkbenchPresentationCoordinator.ts` (main sequenced command authority)
- `scripts/check-navigation-boundaries.mjs` (boundary invariant enforcer)
- `scripts/build-navigation-test.mjs` (test build wrapper)
- `scripts/perf/navigation/fixtures.mjs` (deterministic test fixtures)
- `scripts/perf/navigation/run.mjs` (correctness and performance runner)

### Migrated / Cleaned:
- `apps/desktop/src/features/workspace/useProjectWorkspaceResolution.ts`: Rewritten as thin adapter to shared `KeyedResource`.
- `apps/desktop/src/features/workbench/hooks/useProjectLaneState.ts`: Removed duplicate 5s polling interval; now thin adapter to shared lane resource.
- `apps/desktop/src/features/workspace/useWorkspaceCatalogSnapshot.ts`: Deduplicated initial fetch across subscribers.
- `apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx`: Preserves resident sessions in module cache across route departures.
- `apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts`: Pure synchronous in-memory peeks; zero localStorage access.
- `apps/desktop/src/app/model/queryCache.ts`: Replaced whole-cache JSON serialization with granular dirty-record updates.
- `apps/desktop/src/lib/navigationWarmup.ts`: Unified with `destinations.ts` canonical registry.
- `apps/desktop/electron/services/WorkbenchSessionManager.ts`: Replaced synchronous `fs.writeFileSync` with async dirty scheduler.

---

## 5. Rollback and Migration Safeguards

1. **Backups:** All legacy data from `cozea-query-cache`, `cozea:project-workbench`, and `cozea:project-workbench-layouts` are backed up to `${userData}/desktop-state-v2/backups/` before import.
2. **Reversibility:** Original localStorage values are preserved untouched.
3. **Idempotence:** Migration markers in `${userData}/desktop-state-v2/migration-markers/` guarantee crash-safe, idempotent re-runs.
