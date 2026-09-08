# Cozea: navigation and workspace-runtime implementation specification

**Repository:** `Cozea/electron-app`  
**Inspected baseline:** `main` at `073df5230d2400684434ea6b7db27b0aafc72ddc`  
**Specification date:** September 8, 2026  
**Purpose:** An implementation handoff to local coding agents. This is a design specification, not an implemented patch or a performance benchmark.  
**Target repository location:** `docs/perf/navigation-runtime-plan.md`

## 0. Execution directive

Implement a focused architectural rewrite that makes navigation select existing application state and retained presentation instances. Navigation must not unnecessarily recreate workbenches, own long-running services, duplicate workspace/Git requests, or perform synchronous persistence work.

Keep Electron, React, TanStack Router, Convex, the existing workspace service infrastructure, Dockview, and the current terminal/browser/agent integrations. Substantially refactor their ownership boundaries. Do not replace the application stack, redesign the UI, change collaboration semantics, or rewrite the AI runtime as part of this work.

The user has authorized a substantial pre-launch architectural change. This is **not** authorization to erase local data, reset repositories, kill running tasks during navigation, deploy to production, change credentials, or perform unrelated cleanup.

Use the installed dependency versions and the repository's Bun workflow. Read the root `AGENTS.md` and any applicable nested instructions before editing. Source code and installed type declarations take precedence over old architecture documents. Do not update Effect snapshot pins or regenerate contracts unrelated to the new narrow IPC interfaces. [R01]

### 0.1 Completion standard

The work is complete only when the new ownership model is the default, old competing execution paths are removed, mandatory correctness scenarios pass, and representative local production-build performance runs are recorded. A source scan, successful typecheck, or a collection of mocked cache tests is not enough.

When execution cannot be completed because the local environment lacks a required capability, report exactly which command and scenario were blocked. Do not mark a skipped mandatory scenario as passed. Continue with independent work that is possible; do not invent benchmark results.

### 0.2 Fixed decisions

| Topic | Decision |
|---|---|
| Router | Retain TanStack Router for URLs, history, matching, and deep links. Do not build a second router. |
| Application shell | One stable shell per authenticated main application window, outside the route subtree that changes. |
| Workbench retention | One persistent presentation host per main window; three ordinary resident workbench sessions by default. |
| Runtime ownership | Consolidate around `workspaceRuntimeStore`, runtime hosts, and `WorkbenchSessionManager`; do not create a second terminal/agent/session authority. |
| Request ownership | Shared keyed resources; components subscribe and request demand, not independent polling loops. |
| Persistence | Main-process facade plus one dedicated Node worker for serialization and file I/O; granular versioned records and coalesced writes. No new database dependency is needed for this scope. |
| Hidden Dockview instances | Preserve instances with an explicit presentation lifecycle and manual sizing. Do not use React Activity hiding around effects that own Dockview destruction. |
| Ordinary routes | Continue normal mounting/unmounting initially. Cache their data and prewarm modules. Do not retain every page. |
| Authorization | Cached content is not authority. Rejected access, identity changes, deletion, and binding revisions invalidate incompatible presentation state. |
| Rollout | One final architecture. Temporary migration shims are permitted only with named removal tasks in this plan. |
| Verification | Node unit tests plus real Electron UI tests and production-bundle interaction measurements. |

### 0.3 Out of scope

Do not change native window styling, replace browser surfaces with another browser technology, change terminal scrollback semantics, redesign chat rendering, introduce a new global state framework, alter providers/model APIs, or deploy Convex schema changes. Preserve the existing settings-window behavior and popout capabilities. Add narrow integration changes only where required by presentation ownership or safe persistence.

---

## 1. Baseline findings and what they require

These are source observations at the inspected commit, not measured performance rankings. Repository references are listed in Appendix A.

| ID | Verified source observation | Required consequence |
|---|---|---|
| F01 | `WorkbenchKeepAliveHost` stores sessions in React-local state, and `ProjectWorkbenchSurface` owns that host. [R03–R05] | Move presentation ownership above changing routes; do not merely increase the cache limit. |
| F02 | `ProjectLayout` supplies active route/workspace/sync contexts around its content. [R02] | Retained sessions require their own scoped context boundaries, independent of the selected route. |
| F03 | Workspace and lane prefetch helpers track in-flight promises, but mounted hooks call the underlying operations directly. [R08–R10] | Prefetch, mount, manual refresh, and reconciliation must share one request owner. |
| F04 | The sidebar and layout separately call the lane hook; the hook owns a five-second interval. [R02, R09, R11] | One reconciliation schedule per resource, not one per component. |
| F05 | `queryCache.ts` persists a full cache object through JSON/localStorage. [R12] | Replace automatic whole-cache persistence with explicit dirty-entry persistence. |
| F06 | `peekPersistedWorkbenchLayout()` reads and parses the localStorage collection; writes read/rewrite it. [R13] | Make all layout peeks strictly in-memory. |
| F07 | `workbenchStore.ts` debounces `StateStorage.setItem`, whose input is already a string. [R14, E04] | Move coalescing ahead of serialization, not just ahead of the final storage call. |
| F08 | `WorkbenchSessionManager.ensureSession`, `activateSession`, and `backgroundSession` call `persist()`, which reaches synchronous registry file writes. [R15] | Remove synchronous session-registry serialization/I/O from activation. |
| F09 | `useWorkbenchSessionLifecycle` chains ensure → activate; cancellation suppresses local snapshot application but does not itself cancel the later activation call. [R16] | Centralize presentation intent and reject superseded operations at the main-process authority too. |
| F10 | Workspace runtime hosts already live outside the outlet and have lifecycle/retention policies. [R17–R20] | Reuse them; do not add a competing runtime manager. |
| F11 | `WorkbenchActivity` always uses Activity visible and hides with opacity to retain imperative effects. [R06] | Implement explicit deactivation/measurement suspension; a prop flip to Activity hidden is not sufficient. |
| F12 | Performance harness return navigation uses `/changes`, which redirects to workbench; frame callbacks are named like paint milestones. [R21–R23] | Test real route departures and separate UI readiness from paint evidence. |
| F13 | Catalog mirroring already rejects older revisions, but initialization tracks completion rather than a shared in-flight initial request. [R24] | Preserve monotonic revisions and deduplicate startup fetches. |
| F14 | `useAccessibleProject` reads router params even when a project context supplies the data. [R25] | Remove ambient route subscriptions from retained presentation descendants. |

The optimization must address F01–F14 as one ownership problem. Do not treat adding memoization, a larger LRU, or more prefetch imports as an adequate substitute.

---

## 2. Required observable behavior

### 2.1 Navigation scenarios

| Scenario | Required foreground result | Permitted background work |
|---|---|---|
| Same tile clicked twice | No route navigation, no session activation, no persistence when the state is unchanged. | None caused by this click. |
| Different tile, same workbench | Update the active tile directly; retain Dockview and all unaffected widget instances. | Coalesced persistence of changed UI state. |
| Workbench A → workbench B, B resident | Commit B using validated cached scope and existing UI. No workspace/Git read or session ensure must be awaited before foreground display. | Idempotent presentation synchronization and freshness work. |
| A → Store/Inbox/Tasks → A | A survives departure when not evicted; returning does not recreate its Dockview. | Runtime work follows service policy. |
| Cold destination | A destination-specific shell appears without waiting for cloud freshness. State visibly distinguishes loading, missing binding, denied access, and failure. | Required identity/resource/module loads. |
| A → B → C while A/B are resolving | Only the latest accepted navigation can activate a surface. Late A/B results can populate valid A/B caches, not foreground C. | Shared non-mutating reads may finish when cancellation is unavailable. |
| Missing/ambiguous workspace binding | Show an actionable repair surface. Do not infer a different workspace or invent the collab lane. | A single explicitly requested read-only candidate scan. |
| Workspace relink/revision change | Immediately invalidate incompatible bindings and disable stale mutation controls. Rebuild only the affected instance after valid resolution. | Safe migration of explicitly approved local UI state. |
| Access revocation/deletion/account change | Hide incompatible content and stop unauthorized cloud activity. Preserve local files unless explicitly deleted. | Scoped cleanup/invalidation. |
| Memory-driven view eviction | Dispose presentation after its state is captured; do not equate eviction with closing a runtime. | Runtime retention follows explicit service ownership. |
| Settings drawer open/close | Underlying resident workbench remains mounted; restore focus appropriately. | Settings resource updates. |
| Popout remains visible while parent route changes | Popout remains bound to its original session and continues as a visible presentation consumer. | Other hidden surfaces can be deactivated. |

### 2.2 Non-negotiable invariants

Assign these IDs to tests, comments at critical boundaries, and the completion report.

| ID | Invariant |
|---|---|
| I01 | Exactly one persistent main shell and one workbench presentation host per main renderer epoch. |
| I02 | A route change is not a close-session, kill-terminal, stop-agent, or stop-server request. |
| I03 | Resident workbench component keys never include pathname, navigation ID, timestamps, display name, or mutable session snapshot objects. |
| I04 | Retained children cannot derive their identity from current router params or another session's active context. |
| I05 | Every mutation carries concrete validated project/workspace/lane identity and expected binding revision. No `unbound` or guessed-lane writes. |
| I06 | One in-flight request per renderer resource owner and key/generation, shared by prefetch and mounted consumers. |
| I07 | Superseded renderer epochs, navigation commands, invalidated resource generations, and old binding revisions cannot activate or overwrite current state. |
| I08 | No synchronous localStorage reads/writes or whole-collection JSON serialization on ordinary navigation/layout lookup/store-update paths covered by this plan. One-time migration is explicitly separate. |
| I09 | No synchronous session-registry filesystem operations on main-process activation paths. |
| I10 | Persisted `null`/not-found/denied outcomes are not replaced by stale successful cached data. |
| I11 | Hidden presentation does not imply stopped services; running services do not imply visible presentation. |
| I12 | Hidden workbenches receive no continuous presentation animation, layout, fit, focus, or DOM measurement work after deactivation settles. |
| I13 | A view eviction cannot destroy uncaptured drafts, local edits, or the state necessary to restore a supported widget. |
| I14 | Inactive session changes cannot replace the current header, open a global dialog, steal focus, or publish native overlay bounds. |
| I15 | Runtime service authority and presentation residency have distinct policies; neither silently overrides the other's explicit leases. |
| I16 | Metrics distinguish scheduled frame callbacks, content readiness, and trace-confirmed visual presentation. |
| I17 | Required tests fail or report blocked when their fixture/capability is missing; they never silently skip to a passing verdict. |
| I18 | Final default execution has no old/new dual writers, dual refresh loops, or dual activation paths. |

---

## 3. Target architecture and dependency rules

### 3.1 Stable component structure

`AppRoot` remains the root route component. In the authenticated main window, `AppContent` mounts a new `DesktopShell` at a stable tree position. Extract shell markup from `ProjectLayout`; `ProjectLayout` becomes only a thin project-route adapter, or an outlet-only compatibility wrapper where route matching still requires it. It must no longer own the retained host.

```text
AppRoot
  language/theme/auth providers
  AppContent
    DesktopRuntimeBridges                # mounted once after local bootstrap is usable
    DesktopShell                         # never keyed by current route/project
      ActiveRouteScopeBoundary           # active sidebar/header/ordinary-route context only
        Sidebar + header
        MainSurfaceArea                  # stable geometry and background
          WorkbenchPresentationHost      # persistent, never moved between portal containers
            WorkbenchSessionBoundary(A)  # overrides all project/workspace/sync identity
              WorkbenchSessionSurface(A)
            WorkbenchSessionBoundary(B)
              WorkbenchSessionSurface(B)
            WorkbenchSessionBoundary(C)
              WorkbenchSessionSurface(C)
          OrdinaryRouteViewport
            Router Outlet                # Store, Inbox, Tasks, repair, other existing pages
      ActiveSurfaceOverlayHost           # project settings/task cards/command UI
    WorkspaceRuntimeHostsGate            # existing runtime service owner
    TerminalViewHostGate                 # existing terminal instance infrastructure
    settings/dialog hosts
```

Do not move existing React elements between changing portal containers to implement this tree. Changing a portal container can defeat retention. Each workbench slot must keep a stable parent node and key throughout its residency.

Settings-only windows use their existing settings presentation path and must not initialize a main-workbench host or acquire its runtime visibility leases. Preserve public join/recovery/onboarding paths. Never mount private retained UI behind a public/authentication page merely to save a remount.

### 3.2 Concrete module layout

All paths below are relative to the repository root. **New** filenames are prescribed implementation locations, not claims that those files already exist.

| Location | Status | Responsibility |
|---|---|---|
| `shared/navigationRuntimeTypes.ts` | New | Wire-safe identity, presentation epoch/sequence, resource revision, and validation contracts. |
| `shared/desktopPersistenceTypes.ts` | New | Finite persistence namespaces and typed request/result envelopes. |
| `apps/desktop/src/app/navigation/destinations.ts` | New | Canonical route-to-destination mapping and shared module loader registry. |
| `apps/desktop/src/app/navigation/navigationController.ts` | New | Latest-intent state, readiness orchestration, cancellation, and command dispatch. Not a router. |
| `apps/desktop/src/app/navigation/useNavigationState.ts` | New | Narrow subscription hooks for pending/visible destination state. |
| `apps/desktop/src/app/navigation/NavigationRouteBridge.tsx` | New | One router integration point for direct URLs, browser history, native navigation, and typed commands. |
| `apps/desktop/src/app/shell/DesktopShell.tsx` | New | Persistent shell geometry and viewport composition. |
| `apps/desktop/src/app/shell/ActiveRouteScopeBoundary.tsx` | New | Active route context only, using shared resources. |
| `apps/desktop/src/app/resources/keyedResource.ts` | New | Small reusable resource state machine; no React dependency. |
| `apps/desktop/src/app/resources/workspaceResources.ts` | New | Workspace resolution, lane/Git reads, shared demand and invalidation. |
| `apps/desktop/src/app/resources/useWorkspaceResources.ts` | New | Narrow renderer subscriptions; no per-consumer poller. |
| `apps/desktop/src/app/model/persistence/desktopPersistenceClient.ts` | New | Renderer memory mirrors, dirty-record queue, hydration/flush acknowledgements. |
| `apps/desktop/src/app/model/persistence/migrateLegacyDesktopState.ts` | New | Idempotent, non-destructive legacy import. |
| `apps/desktop/src/features/workbench/WorkbenchPresentationHost.tsx` | New | Session residency and stable React slots. |
| `apps/desktop/src/features/workbench/WorkbenchSessionBoundary.tsx` | New | Session-scoped project/workspace/sync providers and explicit activity. |
| `apps/desktop/src/features/workbench/WorkbenchSessionSurface.tsx` | New | Session-owned Dockview content extracted from the route surface. |
| `apps/desktop/src/features/workbench/model/workbenchPresentationStore.ts` | New | Residency descriptors, activation sequence, bounded eviction; no service authority. |
| `apps/desktop/src/features/workbench/model/workbenchPresentationLifecycle.ts` | New | Widget activate/deactivate/dispose and safe eviction orchestration. |
| `apps/desktop/src/features/workbench/hooks/useWorkbenchPresentationGeometry.ts` | New | Visible-slot sizing and reactivation layout protocol. |
| `apps/desktop/electron/services/DesktopStatePersistenceService.ts` | New | Validated main facade to the persistence worker. |
| `apps/desktop/electron/workers/desktopStatePersistenceWorker.ts` | New | Serialization, parsing, record files, revisions, atomic replacement, migration backups. |
| `apps/desktop/electron/ipc/registerDesktopPersistenceHandlers.ts` | New | Narrow trusted-main-renderer persistence access. |
| `apps/desktop/electron/services/WorkbenchPresentationCoordinator.ts` | New | Epoch/sequence/lease validation around the **existing** session manager. No second session registry. |
| `tests/navigation/` | New test directory | Resource, controller, scope, lifecycle, and migration correctness. |
| `tests/electron/navigation/` | New test directory | Main presentation and worker tests in the existing Node test runner. |
| `scripts/perf/navigation/` | New harness directory | Real Electron navigation fixtures, runner, trace export, and budget evaluation. |

Keep `workbenchStore.ts` and `workspaceRuntimeStore.ts` neutral. They must not import feature implementations, React components, or the router. Avoid cycles among the shell, tiles, and their shared contracts. [R14, R17]

### 3.3 Ownership, not duplicated state

The navigation controller stores requested destination, accepted intent ID, and display readiness. The router remains the URL/history authority. The presentation store stores residency and instance identity, not another copy of the canonical tile model. Workspace resources store shared read snapshots. `WorkbenchSessionManager` remains the session/service binding authority. The persistence worker stores records but does not decide which project is active.

Existing `ProjectSyncProvider` currently both attaches runtimes and exposes contexts. Split those responsibilities. A session context bridge may expose a runtime's values, but mounting that bridge for a hidden retained view must not increment a route/focus attachment count. Attachments must represent actual foreground demand, not React component existence. [R19]

---

## 4. Identity and type contracts

Put the wire-safe shapes in `shared/navigationRuntimeTypes.ts`. Adapt existing repository types at module boundaries instead of inventing incompatible second versions of project/lane/workspace data.

```ts
export interface ResolvedWorkspaceIdentity {
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
}

export interface ResolvedWorkbenchIdentity extends ResolvedWorkspaceIdentity {
  laneId: string;
}

export interface PresentationCommand {
  clientEpoch: string;          // issued by main; bound to the sender WebContents
  sequence: number;             // increasing safe integer within that epoch
  navigationId: number;         // diagnostics/supersession only; not a persistence key
  target: ResolvedWorkbenchIdentity | null;
  retained: readonly ResolvedWorkbenchIdentity[];
}

export type PresentationCommandResult =
  | { status: 'applied'; sequence: number; sessionKey: string | null }
  | { status: 'superseded'; sequence: number }
  | { status: 'invalidated'; sequence: number; reason: string };
```

`target: null` means this window is presenting no main workbench: an ordinary route, pending unresolved destination, recovery screen, or application deactivation as explicitly defined by the window-visibility policy. It is **not** a close request. A separate visible popout retains its own presentation lease.

### 4.1 Three different keys

Do not conflate these:

| Key | Construction and usage |
|---|---|
| Existing model/storage scope | Preserve the current `buildWorkbenchScopeKey(projectId, laneId, workspaceId)` vocabulary for existing tile-state callers and migration. Do not silently reinterpret existing serialized keys. [R26] |
| Presentation instance key | Canonical tuple of local identity namespace, project ID, workspace ID, workspace revision, lane ID. Stable across route changes and display-name changes. Changes on binding invalidation. |
| Request/resource key | Includes all request inputs that affect correctness: resource kind, project/workspace identity, binding revision, expected repository identity where used, preferred workspace selection, and branch-knowledge dependency where used. |

Use one canonical tuple encoder, such as a version-prefixed JSON array, for new keys. Do not concatenate unescaped user-controlled strings with `::` and then parse them by guessing field positions.

The identity namespace for cloud-derived query data includes deployment identity and authenticated principal identity, plus organization/argument scope where the query requires it. Never persist tokens or secrets in cache keys or records. Local workspace identity is device-local and must not be conflated with cloud authorization.

### 4.2 Stable snapshots

Resource reads return stable object identities until the value or visible status actually changes. No new empty objects, arrays, or closures from `getSnapshot()`. React requires a cached snapshot representation for `useSyncExternalStore`; continuously creating new results can cause repeated updates. [E02]

Use narrow selectors for data/status. Refresh scheduling timestamps, subscriber counts, and request bookkeeping must not cause the entire shell to rerender.

### 4.3 Unknown is not missing

Represent unresolved data separately from authoritative null/not-found outcomes. A valid cloud `null` must override a previously cached project. A local missing-binding result is a repair state, not permission to construct an unbound workbench. A known local binding can support authorized existing offline behavior, but a stale cloud cache is not new authority to run cloud actions.

---
## 5. Navigation transaction and route integration

### 5.1 States

The controller has one current intent and one visible-surface selection per main window.

```text
idle
  → requested(intent N)
  → preparing(intent N, destination)
  → ready(intent N, validated target)
  → displayed(intent N)

requested/preparing/ready
  → superseded by intent N+1
  → error or repair state associated with intent N
```

An older promise is never allowed to set `displayed`. The navigation ID comparison must occur after each awaited prerequisite and immediately before any foreground or main-process presentation mutation.

A changed query parameter can be a new destination intent even when the pathname is unchanged. Distinguish pane visibility changes, tile-focus intents, settings overlays, and route changes. Do not reduce navigation identity to pathname alone.

### 5.2 Exact click path

Implement the following order in the shared navigation entry point:

1. Normalize the requested destination using the same route registry used by route components and prefetching.
2. Detect a true no-op. Same selected tile, same workbench, and no new intent payload returns immediately without routing or persistence. An intentional new tile command is not a no-op merely because the URL is unchanged.
3. Allocate an increasing navigation ID. Cancel the previous intent's foreground continuations. Leave a shared non-mutating read alive when another consumer still needs it.
4. Publish only the small pending/selected-navigation state needed for immediate acknowledgement. Do not copy the workspace store or serialize state here.
5. Resolve a cached, revision-valid destination descriptor from memory. If it is resident and ready, prepare its selection entirely in memory, without awaiting IPC, cloud queries, Git status, or storage. Commit that visible selection only with the accepted router destination in step 6.
6. Request the router transition once using the existing URL/history semantics. Synchronize display selection with the accepted router location so a blocked/cancelled route cannot leave a different surface selected.
7. On a cold target, display that target's shell/loading state. Make the outgoing surface non-interactive; never leave project A actionable beneath project B's title or URL. Prefer hiding A rather than showing it as if it were B.
8. Start missing **read-only** prerequisites concurrently where independent. Share the same promises used by prefetch. Apply dependency ordering only where data is truly needed: workspace identity before branch knowledge when no workspace ID is known.
9. When prerequisites resolve, recheck intent ID, principal epoch, workspace revision, and access outcome. Ensure the tile model only after its persisted hydration result and concrete scope are known.
10. Add/reuse the session presentation slot and reveal it. Publish header/selection from the same accepted descriptor.
11. Synchronize the main-process presentation command without placing its acknowledgement on the warm foreground path. State-dependent controls that require a not-yet-established backend session remain locally disabled until that specific session readiness arrives.
12. Queue persistence, revalidation, and low-priority warming independently. They must not turn completion of unrelated background work into a prerequisite for display.

For a warm A→B switch with both descriptors valid, the target is available at step 5 and main synchronization normally needs one command. For a cold B target, send an initial null-target command to supersede stale activation, then a later resolved-target command when B is ready. This is bounded synchronization, not a new request waterfall.

### 5.3 Route bridge: one source of URL truth

`NavigationRouteBridge` must handle typed in-app commands, browser Back/Forward, direct bootstrap URLs, legacy redirects, and native menu navigation. Keep router hooks for UI state and use router events for transaction observation/metrics; installed TanStack types are the compatibility authority. Current official documentation exposes navigation lifecycle events, but agents must not assume a newer documented event exists in the locked version. [E03]

The bridge must deduplicate the in-app request followed by its router event: both represent one logical navigation ID. A browser/history event not associated with a pending typed request creates its own navigation ID.

Do not maintain an independent history stack. Do not assign `window.location` or call `loadURL` for internal navigation. Preserve the existing initial bootstrap URL handling before router ownership begins. After that, URL changes go through the router except the existing narrowly scoped settings-drawer hash integration, which must remain tested rather than replaced accidentally.

Use an explicit descriptor identity or normalized route location to match an event to an intent. Do not use timestamps as an identity heuristic. Cancelled router transitions reset pending navigation feedback without destroying the still-current workbench.

### 5.4 Changes to existing files

| Existing file | Required change |
|---|---|
| `src/lib/navigation.ts` | Become a small adapter to the new controller/registry; remove independent warming and performance transaction ownership. Preserve call signatures during migration, then remove obsolete wrappers when all callers are migrated. |
| `src/lib/router.tsx` | Keep compatibility wrappers where needed, but avoid route-wide subscriptions in retained widget paths. Do not add a competing store/router here. |
| `src/router/routes.tsx` | Workbench route becomes a lightweight route adapter; it must not own `ProjectWorkbenchSurface`/the retained cache. Ordinary pages remain route components. |
| `src/App.tsx` | Mount `DesktopShell` and the controller bridge once for the usable authenticated main-window lifecycle. Preserve settings-only/recovery/onboarding branches. |
| `src/features/projects/layouts/ProjectLayout.tsx` | Extract persistent shell markup; replace query/IPC-owning hooks with shared resource access. It must not conditionally remove the stable shell when a project is missing. Show a route-level outcome instead. |
| `src/features/projects/pages/ProjectWorkbenchPage.tsx` | Return no heavy workbench body; destination metadata comes from the static registry and the single NavigationRouteBridge. Do not add a second registration effect in the route component. Ensure the ordinary viewport does not reserve duplicate visible content. |
| `src/features/projects/pages/ProjectWorkbenchSurface.tsx` | Split session-owned content, active-route intent handling, active overlays, and header publication. Retire the old all-in-one owner. |

Do not use Suspense around the whole shell as a shortcut. Each missing module should have a destination-local fallback with stable geometry. Keep the shell available during background authentication refresh; authoritative logout/revocation still tears down private presentation. Do not weaken authentication to preserve components.

### 5.5 Intent application

Move workbench navigation-state and query-param intent handling into one active-destination effect/controller adapter. Never run it independently inside every retained session. Preserve existing exactly-once behavior for tile focus, open tile, DevApp preview, lane selection, task overlays, and project settings.

Give each accepted payload an in-memory transaction identity. Consume it once for its intended concrete scope. Mark it consumed **after** the required synchronous mutation is accepted, not while lane/workspace identity remains unresolved. Retries after a prerequisite failure must not duplicate tiles. Browser Back/Forward must not replay an already-consumed create-tile intent unintentionally.

Branch checkout is a mutating operation, not prefetch. Reuse the existing branch-activation path and its safety checks; reject stale navigation-dependent continuation after the checkout result. Do not run a new `git checkout` from the shared read resource.

---

## 6. Shared workspace resources

### 6.1 Minimal resource engine

Implement `keyedResource.ts` as a small module, not a framework. It needs stable snapshots, a shared in-flight promise, generation invalidation, demand accounting, and disposal. Put transport-specific logic in `workspaceResources.ts`.

```ts
export type ResourceSnapshot<T> =
  | { status: 'empty'; generation: number }
  | { status: 'loading'; generation: number }
  | {
      status: 'ready'; generation: number; data: T;
      refreshing: boolean; error: Error | null;
    }
  | { status: 'error'; generation: number; error: Error };

export interface ResourceHandle<T> {
  read(): ResourceSnapshot<T>;               // memory only; stable reference
  subscribe(listener: () => void): () => void;
  ensure(reason: 'prefetch' | 'navigation' | 'refresh' | 'resume'): Promise<T>;
  invalidate(reason: string): void;
  acquireDemand(kind: 'foreground' | 'expanded-sidebar' | 'background'): () => void;
}
```

Use structured, serializable error DTOs at IPC boundaries; `Error` above is renderer-internal. Freshness metadata can remain private to the resource if it is not displayed. No I/O is started by `read()` or during React render.

### 6.2 Request algorithm

For each key maintain `generation`, `data`, `inflight`, `inflightGeneration`, `lastSuccessfulReadAt`, `invalidated`, and demand counts.

| Condition on `ensure()` | Result |
|---|---|
| Valid data and freshness policy permits reuse | Resolve cached data; do not call transport. |
| In-flight operation for current generation | Return the existing promise. |
| No suitable data/request | Start one transport operation and record its generation. |
| Completion for current generation and valid binding | Publish result using semantic equality/transport revision; retain previous data identity when unchanged. |
| Completion from invalid generation | Do not publish. Reject the obsolete ensure call with a typed ResourceSupersededError; never resolve a non-T sentinel through Promise<T>. Do not mutate a newer request's state. |
| Refresh error with valid cached data | Keep data and expose refresh failure; do not replace the screen with a spinner. |
| Error without data | Publish a retryable error outcome for this destination. |

`invalidate()` increments the generation immediately. An already-running request cannot clear the `inflight` reference of a newer request when its `finally` executes. On invalidation, retain stale data only when the invalidation reason permits it; binding changes, identity switches, deletion, and access denial must not continue exposing incompatible data.

If the transport supports abort, cancel when no consumer needs the work. If Electron IPC cannot cancel a dispatched operation, discard its stale result and guard mutations in main. Do not claim an `AbortController` cancels IPC automatically.

### 6.3 Domain resources

Implement these domain entries using existing APIs/DTOs:

| Resource | Initial source | Refresh/invalidation |
|---|---|---|
| Workspace catalog | Existing `getCatalogSnapshot` plus pushed revisions | Push-first; single shared initial request; retry explicitly with backoff. |
| Project workspace resolution | Valid ready catalog entry when it fully satisfies request inputs; otherwise `workspace.resolveProject` | Catalog binding changes, explicit repair/relink/forget, expected-repository change. |
| Git/branch knowledge | Shared existing `workspaceSync.gitStatus` transport and stored trusted branch knowledge | Mutation completion, reliable repository events where already available, shared reconciliation timer. |
| Project lane state | Derive with existing `resolveLaneBranchKnowledge` and `buildProjectBranchLaneState` | Branch resource/collab-branch changes; no new independent Git polling. |
| Project metadata | Existing Convex subscription or bounded scoped query cache | Convex remains authoritative; do not introduce independent continuous cloud polling. |

The catalog mirror must attach its event listener **before** starting the initial fetch. Track `initialFetchPromise`, not merely a boolean set after completion. Clear only the matching promise on failure. Reject an older fetch result after a newer pushed revision. Preserve unchanged per-project entry references where possible; replacing the entire snapshot must not notify every row of an unchanged entry.

### 6.4 Prefetch is non-mutating

Pointer/focus prefetch may import code, read project metadata, read the catalog, and request branch knowledge. It must not attach a folder, change active binding, create a workbench, start a terminal/server/agent, check out a branch, or register an active session.

Do **not** candidate-scan every row on pointer entry. Prefer `allowCandidateScan: false` for speculative resolution. On an actual destination with no complete ready binding, run at most one read-only candidate scan through the shared resource, then present repair choices. Audit the main implementation before using a method in speculative mode: if it can mutate bindings, split its read-only part instead of calling it from hover.

When the workspace ID is unknown at hover, prefetch resolution first and then branch knowledge from that result. Join the same resource chain after click. Do not launch another cold branch read from the mounted surface.

### 6.5 Reconciliation policy

Start with these explicit defaults, centralized in one policy module:

| Demand | Git/branch reconciliation interval |
|---|---|
| Foreground workbench or expanded sidebar consumer in visible window | 5 seconds, one refresh per key regardless of number of consumers |
| Retained hidden view without visible consumer | No view-driven polling |
| Window hidden/minimized | Pause view-driven reconciliation; service-owned background work remains independent |
| Window resumes | One shared stale check/refresh per demanded key; avoid a refresh stampede |
| Explicit Git mutation completes | Invalidate and refresh the affected key once |

Use a shared scheduler or one timer per resource, never one timer per component. An event arriving repeatedly must coalesce invalidation/refresh rather than start one subprocess per event. Introduce a 100 ms invalidation coalescing window for filesystem event bursts, but do not delay explicit user mutation completion readiness unnecessarily.

Retain up to 128 idle workspace/lane resource entries, removing undemanded least-recently-used entries after 10 minutes. Never evict an entry still demanded or serving a current request without a defined cancellation/result policy. These are initial engineering policy values, not measured optimal constants.

### 6.6 Consumer migration

Convert `useProjectWorkspaceResolution` and `useProjectLaneState` into thin subscriptions during migration. Remove their module-local competing maps and direct refresh/poll effects after all callers are switched.

Migrate `ProjectLayout`, `ProjectSidebar`, `ProjectSidebarTreeItem`, workbench branch controls, and `projectSwitchPrefetch` to the same resources. Preserve existing input signatures temporarily only if they forward to a single resource key builder. A wrapper must not keep a fallback transport request when a shared resource exists.

Search every use of `resolveProject`, `gitStatus`, `useProjectLaneState`, and `prefetchProjectLaneState`. Classify actual source-control actions separately from navigation reads. Do not delete legitimate explicit source-control operations. The completion report must list remaining call sites and their owner.

---

## 7. Persistent workbench presentation and context isolation

### 7.1 Residency model

The presentation store holds descriptors and residency metadata only. The canonical tile model stays in `useProjectWorkbenchStore`. The main session record stays in `WorkbenchSessionManager`.

Each resident record contains its immutable identity, instance ID, model scope key, runtime/session locator, captured context descriptor, last foreground sequence, hydration status, visibility state, and eviction blockers. `lastForegroundSequence` changes only when the session genuinely becomes foreground, not on every metadata update or background render.

Use a monotonic recency counter rather than wall-clock timestamps for deterministic LRU behavior. The existing equality check need not treat a timestamp as a visual prop, but the residency policy must not lose actual recency updates because two descriptors happen to compare equal.

The default resident limit is three ordinary sessions, including the visible workbench. An explicit visible popout is a presentation pin and is not silently evicted. Count and report those pins separately; the testable ordinary bound is `ordinaryResidentCount <= 3`. Closing a popout releases the pin. Do not manufacture pins merely because a terminal or agent runs in the background.

### 7.2 Context boundary

`WorkbenchSessionBoundary` receives a concrete session identity and subscribes only to resources for that identity. It must provide session-scoped versions of:

- Project data and project route compatibility fields.
- Workspace identity and binding revision.
- Lane/branch knowledge appropriate to that session.
- Sync/Yjs context values for that session's existing runtime ID.
- Presentation visibility and interaction permission.
- Command callbacks bound to that session, never to mutable ambient route variables.

Keep the provider structure mounted in the same order even when an optional value becomes unavailable. Do not branch between a provider-wrapped tree and an unwrapped tree.

Do not copy a live sync context once and freeze it forever. Session identity is immutable; the relevant session's data can update. The boundary must subscribe to that session's stable runtime ID, while hidden presentation consumers can avoid expensive visual subscriptions.

### 7.3 Remove ambient router dependencies

`useAccessibleProject` currently reads router params before selecting context values. Merely supplying another provider will not eliminate that route subscription. Create explicit context-only hooks for retained workbench descendants and migrate them. Keep a route-aware adapter for ordinary route components. Do not violate the Rules of Hooks by conditionally calling a router hook. [R25]

Define a structural import test that rejects direct imports of `useParams`, `useLocation`, `useSearchParams`, and route-aware `useActiveWorkbenchScope` from the new retained surface and session-specific tile integration boundary. Command UI may receive an injected navigation callback, but must not derive its own identity from the URL.

At integration, scan transitive retained dependencies, not only the top-level file. Produce a small inventory of exceptions. An exception needs a test proving it does not read active project identity or cause all retained sessions to process route intents.

### 7.4 Split route-level side effects

Extract the following from the retained session content and keep a single active-surface owner:

| Existing responsibility | New owner |
|---|---|
| Header publication (`useProjectHeader`) | Active shell/header adapter keyed to accepted visible descriptor |
| `settings=1` overlay parsing | Active route intent adapter |
| Task overlay navigation payload | Active overlay host |
| Command palette global registration | One active command context; per-session commands carry bound identity |
| Last-workbench-route persistence | Navigation controller after accepted activation, coalesced |
| Ensure/activate/background IPC | Main presentation synchronization bridge, not component mount/cleanup |
| Workspace/sync route attachment | Controller/service-demand bridge, not retained context provider existence |

When a hidden session changes, its own data may update. It must not call global header setters, show a dialog, consume a route intent, alter URL search parameters, or focus a control.

### 7.5 Safe eviction protocol

Eviction is ordered:

1. Select the oldest ordinary, inactive, unpinned resident session.
2. Recheck that it is still inactive and not the latest requested destination.
3. Ensure any ephemeral widget state is captured in the canonical model or its dedicated state owner. A pending IME composition, open unsaved editor state, or uncommitted composer value blocks destructive disposal until captured safely.
4. Freeze a scope/revision-tagged layout snapshot already maintained during visible edits. Do not run a full global serialization or unrelated filesystem read to evict.
5. Queue its persistence record and retain the in-memory recoverable state. View eviction does not need to wait for a disk write if all recoverable state remains owned elsewhere.
6. Deactivate native overlays and detach presentation-only subscriptions.
7. Dispose the Dockview presentation and its view-only widget attachments exactly once.
8. Remove the resident descriptor and release the presentation lease. Do not close the backend session.

For explicit app quit or account teardown, a durable flush may be required; that is a different operation from ordinary LRU view eviction. Handle worker/storage failure visibly according to Section 10 rather than silently discarding recovery state.

Memory-pressure trimming must use the same protocol. Do not use periodic fake memory estimates as a reason to kill running work. Use existing signals where available and a deterministic injectable pressure signal for tests.

---

## 8. Widget lifecycle, visibility, and geometry

### 8.1 Lifecycle contract

Implement a narrow adapter for each expensive presentation integration. It owns the UI instance; it does not replace the underlying service.

```ts
export interface WorkbenchPresentationAdapter {
  activate(input: {
    identity: ResolvedWorkbenchIdentity;
    activationSequence: number;
    width: number;
    height: number;
  }): void;
  deactivate(): void;
  captureViewState(): void;
  dispose(): void;
}
```

`activate` and `deactivate` must be idempotent. `dispose` must be terminal and idempotent. An adapter rejects calls for a different immutable identity. Async work it starts captures the activation sequence and cannot focus, measure, or reveal after deactivation.

### 8.2 Dockview sizing and hiding

Keep the Dockview instance and its owning React effects mounted while resident. Remove the misleading always-visible Activity wrapper once the explicit lifecycle is in place; use a stable DOM wrapper without Activity semantics for these imperative owners.

Disable Dockview's automatic container resizing and explicitly drive `api.layout(width, height)` from the visible presentation's geometry owner. Official Dockview documentation supports `disableAutoResizing` and manual `layout`; verify the exact locked package types before using the option. Do not upgrade Dockview solely because the latest documentation differs. [E05]

The final ordinary hidden-slot mechanism should be `display: none` on the stable wrapper **after** automatic measurement and presentation callbacks are gated. Retention means keeping the component/instance, not requiring its hidden DOM to keep participating in layout. Do not apply React Activity hidden to the Dockview owner, because it cleans up effects. [E01]

Implementation order matters:

1. Introduce explicit `surfaceVisible` throughout the adapter chain while retaining the existing opacity-based concealment temporarily.
2. Gate all instance layout/fit/focus and native-bound callbacks by active presentation sequence and visibility.
3. Turn off auto-resize on the locked Dockview API, replacing it with one visible-slot `ResizeObserver` owner.
4. On hide, deactivate adapters and suppress callbacks **before** the wrapper becomes `display: none`.
5. On reveal, expose the stable wrapper without focus, read the shared viewport's valid dimensions, and perform one necessary layout pass. Never call `layout(0, 0)`.
6. Fit visible terminal/editor views only after valid dimensions are available. Skip fit if dimensions and relevant font metrics are unchanged.
7. Enable native overlays only after matching bounds are ready. Restore focus last and only if the activation remains current.
8. Assert identical panel ratios and tile identities before/after hide/reveal at unchanged size.

Do not use `clip-path` or transform scaling to conceal a workbench. Do not leave the current opacity-only workaround as the final answer without passing the inactive-layout budgets. If an installed widget demonstrably depends on hidden laid-out DOM, isolate that widget's parking element at cached dimensions and document/test the exception; do not force every retained workbench to remain laid out. This exception is not permission to revive background animations or polling.

### 8.3 Widget-specific requirements

| Integration | Deactivate | Activate | Dispose view |
|---|---|---|---|
| Dockview | Disable presentation callbacks and measurement; keep model/instance. | Reconcile pending model changes once; layout only when needed. | Dispose UI instance, not backend workbench session. |
| Terminal | Detach focus/fit/paint demand as supported; keep process/output owner. Continue bounded parser/output handling needed for correct terminal state. | Attach existing terminal host, fit once, paint current buffer. | Release the view attachment only; do not kill terminal. |
| Editor | Capture selection/scroll; disable hidden measuring/decorations tied only to display. | Restore model/view state and perform necessary size update. | Preserve unsaved document model and undo state through its existing owner. |
| Assistant/chat | Keep canonical stream ingestion and durable thread state; suspend offscreen visual animation/expensive projection subscriptions. | Catch up from the current thread snapshot and restore scroll policy. | Do not stop/cancel an agent run. |
| Native browser surface | Explicitly mark native surface invisible/remove visible bounds; DOM CSS is not enough. Preserve partition/session identity. | Publish validated current bounds and visibility for the right owner/sequence. | Use existing surface-release policy only when no other presentation lease needs it. |
| Dev server/native preview | Keep runtime separate from preview's visual attachment. | Attach preview only when ready and still selected. | Do not stop server because its presentation was evicted. |
| Popout | Treat its window as a separate visible consumer; parent route hiding is not popout hiding. | Preserve original identity and input target. | Close only via existing explicit popout action/window closure. |

Native browser resources that are independently held for agent automation or preview tasks must not be released merely because a UI lease disappears. Preserve existing service-owned holds and add tests covering them.

### 8.4 Focus and overlay rules

Before hiding a surface, capture its logical focus target, not a permanently retained arbitrary DOM reference. Make it inert immediately. On activation, restore focus only when the navigation requested workbench focus and the user has not focused another shell control in the meantime. Search, command-palette, menu, and accessibility interactions must not be overridden by a late focus callback.

Maintain `aria-hidden`/inert semantics for inactive wrappers and ensure portals/native windows honor equivalent visibility. A CSS-hidden parent does not necessarily hide a portaled dialog or another native surface. All global menus/dialogs must be owned by the active overlay host or an explicit popout owner.

Respect reduced-motion settings. Do not add navigation animations to hide reconstruction delays. Avoid making a transition animation a prerequisite for destination interactivity.

---
## 9. Main-process presentation authority and session lifecycle

### 9.1 Replace mount-driven activation

Retire the active use of `useWorkbenchSessionLifecycle` for ensure/activate/background ownership. A read-only session subscription hook may replace it, but mounting or unmounting a route/view must not issue independent activation commands.

Introduce `WorkbenchPresentationCoordinator` as a thin coordinator around `WorkbenchSessionManager`. It validates sender/epoch/sequence and maps presentation leases to the existing session manager. It does not own a parallel collection of terminals, agents, or persistent sessions.

### 9.2 Narrow IPC surface

Add the following typed methods under the existing workbench session API, updating `shared/electronApiTypes.ts`, preload exposure, and handlers together:

| Proposed method/channel | Purpose |
|---|---|
| `workbenchSession:registerPresentationClient` | Issue a main-generated epoch for this trusted renderer document; return epoch plus current read-only session snapshot revision. |
| `workbenchSession:setPresentation` | Apply `PresentationCommand` using last-accepted-sequence semantics. |
| `workbenchSession:onPresentationInvalidated` | Notify a client that binding/access/session state requires its affected presentation to become non-interactive. |

Existing get/list/bind/close APIs remain where needed for explicit operations. Remove renderer uses of unsequenced activate/background commands after migration. Do not leave them available to circumvent the new coordinator. If remaining internal callers require those manager methods, keep them internal behind validation rather than exposing two foreground authorities.

Only trusted application renderers may register. Infer sender identity from Electron's event and actual frame/window; do not trust a renderer-supplied window ID. Reject external/untrusted browser tiles and frames. Settings-only windows cannot claim the main workbench's foreground lease. Validate DTO shape, safe integer sequence, string lengths, concrete scope fields, retained-list bounds, and expected binding revision before expensive processing.

Main-issued epochs are tied to a renderer document, not to a React component mount. Repeated subscriptions within that document reuse the client. Reload/crash/document destruction retires the epoch and releases its presentation demand. StrictMode effect replays must not mint competing clients.

### 9.3 Last-writer-wins algorithm

For each allowed client record track its epoch, highest accepted command sequence, desired target, retained identities, and active presentation lease.

On a command:

1. Validate sender and epoch; reject retired or cross-window epochs.
2. Validate syntax and bounds; reject malformed payloads without changing state.
3. Reject a sequence older than the highest accepted one. Equal-sequence retry must be idempotent only when the payload is identical; reject conflicting equal-sequence payloads.
4. Record the accepted desired command **before** awaiting workspace/session prerequisites.
5. Resolve/validate the concrete target and retained identities through main-owned catalog/session authority. A renderer-provided session key or workspace path is not proof of ownership.
6. After every await, compare the command with the still-current epoch and sequence. Abort stale activation without calling active-session/native-visibility mutation methods.
7. Commit the session presentation transition in one synchronous authority step once validated. Split existing manager methods where needed so preparation is not itself an unguarded late activation.
8. Update active and retained presentation leases. Reconcile the old target without affecting visible popouts/other windows.
9. Emit a scoped semantic state change and enqueue persistence; never wait for disk writes on this path.
10. Return an applied, superseded, or invalidated result. Renderer receipts are also checked against their current intent/sequence.

The guarantee is relative to commands accepted by main. A process cannot reject a future command it has not received. Tests must delay prerequisite completion so they prove that an older accepted operation cannot overtake a newer accepted command.

A pending cold navigation sends a null target to supersede old work while its destination resolves. A null target preserves appropriate retained UI/service leases and does not implicitly destroy the outgoing session. Once the target is validated, a new increasing sequence publishes it. Avoid sending commands for same-tile no-ops or unchanged payloads.

### 9.4 Session lookup and binding correctness

Audit `resolveSessionKey` and explicit-key paths. When a request contains a concrete workspace identity, do not fall back to the latest session for the same project/lane in a different workspace. An explicit session key must match the validated project/lane/workspace tuple. Existing compatibility fallback behavior must not be used for new navigation commands. [R15]

Reject binding-revision mismatch before activation or native bounds updates. Add explicit workspaceRevision metadata to live session records and exposed snapshots. New live session lookup must distinguish revisions; use a versioned exact-identity key or an equivalent validated revision index, never silently reuse a record for a new root revision. Keep old registry key parsing only in migration. Audit terminal/preview/dev-server binding lookups so an older-revision runtime cannot be attached as the new workspace merely because workspaceId and laneId match. Existing older-revision running work remains owned by its original service until explicit close/relink policy resolves it. On relink/deletion, revoke the affected presentation leases and increment the appropriate invalidation generation. Late requests cannot reopen a tombstoned/closed generation. A later explicit authorized reopen may create a fresh generation according to existing project-close semantics.

### 9.5 Coordinate existing retention policies

The current main session manager can freeze background sessions and release browser surfaces independently of the renderer's three-session retention policy. The new model must not leave the renderer claiming a retained usable native view after main silently destroyed it. [R15]

Use explicit leases:

| Lease/demand | Meaning |
|---|---|
| Main-window foreground presentation | This session is visible in that window. |
| Resident presentation | Its expensive UI is retained and may require a corresponding native surface resource. |
| Popout presentation | A visible detached window independently holds its presentation. |
| Service-owned demand | A terminal, running preview, agent automation, or other existing service needs a resource regardless of UI visibility. |

Modify `rebalanceBackgroundSessions`/policy sweeps so presentation-specific release respects those leases. The ordinary UI LRU is decided by the presentation host; resource pressure can request that host to trim. Main may release native presentation resources after the applicable presentation lease is relinquished, or after explicit invalidation/crash cleanup. Keep all existing service safety requirements; losing a UI lease does not authorize killing active tasks.

Do not redefine all existing runtime enum values unnecessarily. Add explicit visibility/residency demand alongside service lifecycle where possible. Fix `routeAttachmentCount` use so hidden retained providers are not counted as focused routes. Verify multi-consumer accounting with idempotent lease IDs, not fragile increment/decrement pairs that underflow during repeated cleanup.

### 9.6 Session registry persistence

Replace `persist()` on hot paths with `markRegistryDirty()`, which only records dirty state and schedules a later flush. Build the registry snapshot once per flush, not once per ensure/activate/background call. Run JSON serialization and filesystem writes in the persistence worker described below.

Restore the registry asynchronously behind a manager readiness promise. Do not overwrite new runtime records with a late initial load. Initial records remain background/non-active until an explicit presentation command selects them. Reading a registry never automatically resumes an agent or restarts a terminal.

Emit no store/IPC change for a true semantic no-op. Coalesce normal state broadcasts while retaining the existing guarantee that a close followed by reopen cannot hide the close event. Do not erase lifecycle invalidation in the name of deduplication.

---

## 10. Persistence redesign and non-destructive migration

### 10.1 What moves, and what does not

Move these domains to the new persistence pipeline:

| Domain | Persistence unit | Reason |
|---|---|---|
| Query display cache | One scoped query result entry | Avoid serializing all cached queries per result. |
| Workbench tile model | One project/workspace/lane model record | Avoid serializing every workbench per tile update. |
| Dockview layout | One scope/revision/reset-key record | Make peeks in-memory and writes granular. |
| Last workbench locator | One small identity-scoped locator record | Coalesce route metadata writes. |
| Main workbench session registry | Existing registry domain, snapshot per flush in worker | Remove synchronous main-process file I/O. |

Do not migrate credentials, keys, user documents, CRDT stores, canonical chat histories, or composer drafts as a side project. Preserve their current durability owners. Inspect whether any widget keeps uncaptured ephemeral state before allowing its new eviction path; fix that capture path without sweeping unrelated data migrations.

### 10.2 Transport and worker model

Use one main-owned Node worker for the new file-backed desktop-state records. Main determines the userData path and passes it to the worker; the renderer cannot choose filesystem paths.

`DesktopStatePersistenceService` offers finite operations such as load selected records, commit typed changed records, import a validated legacy domain, and flush through a known revision. The IPC handler exposes only allowed renderer namespaces. `sessionRegistry` is main-only. Validate namespace and key shape in main before forwarding. Perform full payload schema validation and serialization in the worker with bounded input limits.

All paths stay beneath an app-owned `desktop-state-v2/` directory. Derive filenames in the worker from a cryptographic hash of a canonical namespace/key tuple. Store the original canonical key inside the envelope and verify it on read. Do not incorporate raw project names, repository paths, or query strings into path segments.

Proposed envelope:

```ts
interface DesktopStateRecord<T> {
  schemaVersion: 1;
  namespace: 'queryCache' | 'workbenchModel' | 'workbenchLayout' |
             'lastWorkbenchRoute' | 'sessionRegistry';
  key: string;
  recordRevision: number;
  updatedAt: number;
  bindingRevision?: number;
  data: T;
}
```

Use structured-clone-safe data only. Do not pass React nodes, functions, runtime clients, or `Error` objects as stored content. Use one owner-approved serializer/validator for each namespace; do not expose an arbitrary filesystem CRUD endpoint.

### 10.3 Coalesce before serialization

The renderer tracks dirty **record keys and immutable snapshots**, not already-serialized whole stores. Debounce/merge before `JSON.stringify` or IPC payload construction. A newer dirty snapshot replaces an older queued snapshot for the same key; it must not be lost because it arrived within a throttle window.

Initial queue settings:

| Parameter | Initial value |
|---|---|
| Ordinary UI persistence debounce | 500 ms |
| Maximum age of a queued ordinary UI change while activity continues | 2 seconds |
| Query-cache persistence debounce | 1 second |
| Worker concurrent filesystem writes | 2 distinct keys; serial writes within each key |
| Renderer dispatch batch | At most 16 records; yield between batches |
| Soft ordinary payload target | At most 256 KiB per record; measure structured-clone cost |
| Hard query entry persistence limit | 1 MiB; keep oversized query result in memory but do not persist it |
| Query cache bounds | At most 250 entries and 16 MiB serialized-size accounting; evict by recency/age |
| Large workbench record behavior | Preserve it; chunk transport or split documented subrecords rather than drop user state |

The byte budget is a persistence budget, not a claim of exact live heap size. Compute serialized-size accounting in the worker rather than repeatedly stringifying the entire cache on the renderer to measure it. These policy values may only change with recorded evidence and a specification update; do not loosen them just to hide a regression.

Transferring data to a worker still has copying/structured-clone cost. Instrument renderer enqueue/dispatch separately from worker serialization. If a record exceeds the main-thread dispatch budget, split the transport unit while preserving a single logical commit revision. Off-thread serialization is not permission to send a 100 MB object in a click handler.

### 10.4 Store integration

Remove `persist(createJSONStorage(...))` from the workbench model's hot update path. Keep the existing actions/selectors and state semantics; add explicit dirty-scope signaling after accepted changes. Mark no scope dirty for a no-op. Bulk operations can mark an explicit collection of affected keys once.

Avoid a global subscriber that serializes or deeply compares every workbench on every tile mutation. If a subscriber is used to detect changed immutable record references, limit it to cheap record-identity comparison and prove its cost; never use a whole-store JSON fingerprint.

Change layout APIs as follows:

| API | Final behavior |
|---|---|
| `peekPersistedWorkbenchLayout(scopeKey, resetKey)` | Pure synchronous lookup in an already hydrated memory mirror; no storage access or parsing. |
| `ensureWorkbenchLayoutPersistenceReady()` | Replace with an explicit async per-scope hydration API or a typed hydration status; callers cannot set ready before it resolves. |
| `writePersistedWorkbenchLayout(...)` | Update in-memory record and enqueue changed record with captured scope/revision/reset key. |
| `clear/clone` layout helpers | Update memory and enqueue typed mutation/tombstone; preserve exact scope identity and reset-key rules. |
| `flushWorkbenchStorage()` | Async flush-through-revision contract; update all callers to await only at real lifecycle barriers. |

A queued layout snapshot always retains the scope and reset key under which it was captured. Never read the currently active route when the delayed write executes. A stale pre-reset write cannot overwrite a later layout reset.

### 10.5 Hydration ordering

Per-scope state is `uninitialized`, `loading`, `ready`, or `error`. Do not translate loading/error into an empty workbench and then persist that empty value.

For a cold scope:

1. Resolve validated workspace/lane identity.
2. Load model and layout records concurrently through the persistence service.
3. Validate envelope/schema/binding/reset metadata.
4. Hydrate existing state exactly once for that scope generation.
5. Only a confirmed absence may initialize a new empty workbench. Corruption is an error/recovery outcome, not confirmed absence.
6. Apply queued navigation intents after hydration and concrete identity are ready.
7. Start normal dirty tracking only after initialization; do not echo imported snapshots immediately back as new user edits.

During warm navigation, these mirrors already exist; no durable read is permitted on the foreground path. Metadata hydration may load lazily without blocking a resident UI. Do not make every navigation wait for the entire application's persistence database to load.

Late hydration must not replace edits made after a valid record was already loaded. Track load generation and current local revision. A later remote/durable snapshot that is older is ignored; an actual conflict is handled explicitly, not resolved by arrival order.

### 10.6 Atomicity, ordering, and failure

Serialize writes for a key. Assign revisions centrally in the service and enforce monotonic writes in the worker. Queue ordering must not allow an older write to rename over a newer one. Node's asynchronous filesystem operations are not automatically ordered; implement the ordering explicitly. [E07]

Write a complete new record to a temporary file in the same directory, close it, and atomically replace the committed target according to the supported platform's semantics. For record replacement errors, preserve the old valid record and retain the pending change for retry. Never delete the old committed file first as a fallback.

Separate three acknowledgements: queued in renderer memory, accepted by main/worker, and committed record revision. A `flushThrough(revision)` resolves only when the required records are committed, or returns a typed failure. Avoid calling a promise resolved at enqueue time “durable.” File replacement/ordinary flush is not a universal power-loss guarantee; use fsync where required by the selected durability policy and state the supported guarantee honestly.

The worker can reconstruct its index from validated record files. An optional index is advisory, not the only source of truth. Corrupt files are quarantined with diagnostic metadata; other records remain usable. Bound retry backoff and surface persistent failure without repeatedly blocking navigation.

### 10.7 Normal quit and controlled restart

Do not rely on `beforeunload` to finish asynchronous work. Integrate with the existing main-process close/quit/update orchestration. On a normal controlled quit, request UI capture, await flush-through revisions, and then continue closing. Use a guarded close flag to avoid recursive close loops.

After a two-second initial flush wait, show a bounded recovery choice or existing quit-progress UI if writes remain pending; do not silently claim success or freeze indefinitely. Default to preserving state and keeping the app open on a persistent critical flush failure. A force-quit/crash can still lose unacknowledged recent UI state; document this rather than promising impossibility.

Do not break the existing controlled-update agent continuation mechanism. Do not move its authority to the renderer or send a second Continue on navigation/rehydration. [R01]

### 10.8 Multi-window writers

The trusted main workbench renderer is the writer for its canonical workbench UI records. Settings-only windows do not independently write stale workbench copies; route their workbench commands through the existing main-window command path or the new validated command owner. Same-renderer popouts use the same canonical model owner.

For any existing independent workbench window support, add an explicit per-scope writer lease through main before enabling writes; reject conflicting stale writer revisions rather than last-arrival-wins overwrite. Do not accidentally introduce a single-writer assumption that corrupts an already supported multi-window path. Record the tested window modes in the completion report.

### 10.9 Legacy migration

Use `migrateLegacyDesktopState.ts` for these known sources: `cozea-query-cache`, `cozea:project-workbench`, `cozea:project-workbench-layouts`, and the existing last-route/session-registry sources located through their current helper functions. Do not guess undocumented storage keys; enumerate them from the inspected helpers in Phase P00.

Migration sequence:

1. Detect a missing completed domain-migration marker.
2. Read the legacy raw value once in a migration-only path. localStorage access itself is synchronous and cannot be moved into a Node worker; keep this out of ordinary navigation and report first-run migration timings separately.
3. Send raw data to the worker for parsing, validation, and a preserved backup. Do not repeatedly parse the same monolith in renderer hooks.
4. Validate each record independently. Preserve unrecognized/corrupt raw content in the backup; do not delete it or reinterpret it as an empty valid record.
5. Import records into the new format with idempotent source/key/checksum tracking. Never overwrite a newer existing v2 record.
6. Import identity-scoped UI records only when scope mapping is unambiguous. Do not invent a workspace or branch from an insertion-order “first workbench.”
7. Treat legacy unscoped query cache entries as untrusted presentation cache. Do not infer an authenticated owner from old query names. Preserve backup but repopulate entries whose owner cannot be established safely.
8. Verify committed imports, then write the domain migration-complete marker last.
9. Leave legacy raw values/backups untouched during this change; stop new writes to them. Do not leave dual writing enabled.
10. A crash before the marker reruns idempotently; it must not duplicate tiles, reset layouts, or replace newer records.

Preserve existing serialized workbench scope vocabulary. Add binding revision metadata to new envelopes and presentation/resource keys. On a relink, preserve the old record for recovery and copy/migrate only through the explicit relink workflow after validation. Do not silently reuse old branch paths, terminal IDs, or native-session ownership for the new root.

---

## 11. Module warming, data freshness, and startup

### 11.1 One destination registry

`destinations.ts` is the only source of route module loader functions. Route lazy components and prewarm functions call the **same cached loader promise**. Map at least Projects, Workbench, Store, Skills/Builds/Schedules, Inbox, Tasks, New Project, and all current settings pages.

Do not maintain unrelated import lists in `App.tsx`, `navigationWarmup.ts`, and project prefetch after migration. A failed prewarm clears only its matching cached attempt so an explicit navigation can retry. It must not poison future lazy rendering permanently.

### 11.2 Warming policy

Keep the lightweight shell/navigation/route adapters in the initial bundle. Load the first selected heavy workbench immediately after the local bootstrap identifies it, without awaiting all other hot routes before the shell renders.

After the initial destination is usable, warm a bounded next-working-set queue: current workflow's likely destinations, recent project, and common settings. Limit speculative module-loading concurrency to two. Do not initialize terminals, Dockview instances, collaboration, or preview services merely by importing a route module.

Pointer intent warms after a 75 ms hover dwell; keyboard focus warms immediately. Clicking before the dwell expires starts/joins the same request at navigation priority. Cancel speculative queued work on pointer exit when it has not started, but do not discard a useful shared in-flight promise.

Do not remount hidden routes solely to prewarm effects. Data prefetch is explicit through shared resources. Activity's hidden prerender does not automatically fetch effect-based data. [E01]

### 11.3 Startup boundaries

In `main.tsx`, retain the small bootstrap identity/initial-route handling required for correctness. Remove the await of heavy restored-workbench code before `createRoot` when it prevents the lightweight shell from rendering. Stage shell readiness, scope hydration, session readiness, and full workbench readiness separately. [R27]

A window opens with the correct theme and a stable local shell; unknown private identity still shows the proper recovery/auth boundary. Do not flash another account's cached UI. A cold deep link must win over a stored last-workbench locator. Settings windows must not restore a main workbench.

Startup migration is not a warm navigation benchmark. Record its duration and validate its safety separately. Do not hide a migration stall by excluding it from all reports.

### 11.4 React scheduling

Use transitions where the installed router/framework integration benefits, but do not assume wrapping external-store writes in `startTransition` makes them non-blocking. React may fall back to blocking behavior for external-store changes during a transition. Keep synchronous updates small through narrow subscriptions and less work, not labels. [E02]

Never hold the shell behind a large suspense boundary. Do not use `flushSync` broadly to manufacture an “immediate” frame. Avoid synchronously constructing hidden workbenches during an input handler. Warm retention should reuse already mounted instances; cold construction is measured honestly.

---
## 12. Instrumentation and performance acceptance

### 12.1 Trace identity and markers

Replace the single mutable pending-navigation marker with bounded per-navigation trace records. Each record has a navigation ID, source kind, destination kind, cache-temperature classification, start time, and phase outcomes. Do not record user project names, full filesystem paths, tokens, or query text in exported performance artifacts.

Required marks:

| Mark | Meaning |
|---|---|
| `nav:input` | Captured pointer/keyboard activation or history/native command receipt. |
| `nav:requested` | Controller accepted a distinct intent. |
| `nav:ack-commit` | Pending/selected navigation feedback committed. |
| `nav:route-accepted` | Router location/transition accepted for this intent. |
| `nav:scope-ready` | Concrete identity and lane knowledge are valid. |
| `nav:model-ready` | Required persisted model/layout hydration is complete or confirmed absent. |
| `nav:surface-commit` | Correct destination surface committed in the foreground. |
| `nav:content-ready` | Correct cached/current primary content and its local input handlers are usable. |
| `nav:native-surface-ready` | Required native preview/browser bounds and visibility acknowledged, when applicable. |
| `nav:presentation-ack` | Main accepted the matching presentation command. |
| `nav:frame-opportunity` | A frame callback occurred; explicitly not actual paint proof. |
| `nav:superseded` / `nav:error` | Terminal non-success outcome for that intent. |

A route wrapper mounting is not enough for `content-ready`. A workbench reports it only after its real Dockview content/model and required visible primary widget are ready for interaction; a loading indicator must never satisfy the ready predicate. A legitimately empty workbench is ready when its empty-state controls work. Store/Inbox/Tasks use an actual data-or-valid-empty-state predicate, not merely module evaluation.

`requestAnimationFrame` runs before repaint. Do not call its callback a measured first paint. Use Chromium tracing/frame screenshots to corroborate visual outcomes, and label synthetic frame timing as a proxy. [E06]

### 12.2 Required counters

Instrument the real creation/disposal/transport paths, not only route wrappers:

| Counter family | Required counts |
|---|---|
| Shell/presentation | Shell mounts, host mounts, resident descriptors, visible IDs, ordinary evictions, pin reasons |
| Widgets | Dockview create/dispose, terminal instance create/dispose, view attach/detach, editor view create/dispose |
| Hidden activity | Layout calls, terminal fit calls, DOM measurement callbacks, animation ticks, native visibility/bounds writes per hidden scope |
| Resources | Underlying resolve/Git calls, deduped joins, invalidations, active demand counts, poller count, stale result discards |
| Main commands | Presentation requests/applies/superseded outcomes, ensures, close/kill/stop calls, lease count |
| Persistence | Dirty record count, renderer dispatch time/bytes, worker serialize/write duration, commit revisions, failures, legacy accesses |
| UI work | Renderer long tasks, optional React commits in diagnostic build, frame gaps, readiness durations |

Counters must expose a read-only diagnostic snapshot and reset API only in an explicitly instrumented local/test build. Keep export buffers bounded. No instrumentation endpoint may be exposed to untrusted browser content. Do not disable context isolation or sandboxing to make testing convenient.

### 12.3 Measurement classes

Report these separately:

| Class | Definition |
|---|---|
| Resident warm | Same concrete revision, code loaded, model/resource data available, presentation instance retained. |
| Data warm, view cold | Resources/model present, but the presentation was evicted and must reconstruct. |
| Code cold | Route/widget code not loaded in this renderer epoch. |
| Identity cold | Workspace/lane knowledge must be resolved. |
| Startup/migration | Fresh process and/or legacy state import. |
| Native warm/cold | Native embedded surface remains resident or needs reattachment/recreation; distinguish from DOM readiness. |

Do not average these together into one “navigation speed” number. Do not report a warmed programmatic router call as a first-click measurement.

### 12.4 Initial performance gates

These are **proposed engineering acceptance targets**, not observed current performance or universal hardware guarantees. Run baseline and candidate on the same recorded reference machine with the same fixture/profile/window size/power conditions. Never silently raise thresholds to finish a task.

| Metric/scenario | Initial gate |
|---|---|
| Input acknowledgement | p95 acknowledgement visual proxy within two display periods + 5 ms; inspect trace evidence on failures. |
| Resident warm navigation, local primary content | p95 `input → content-ready` <= 75 ms; p99 <= 120 ms. Target median <= 35 ms. |
| Native resident warm surface when required | p95 `input → native-surface-ready` <= 120 ms, without blank/wrong-scope overlay. |
| Cold destination shell | p95 `input → surface-commit` <= 100 ms, regardless of artificial delayed network reads. |
| Cold content after all explicit local prerequisites ready | p95 additional renderer work to content-ready <= 150 ms for the fixed fixture. Report complete cold duration separately. |
| Warm navigation-attributable long tasks | No renderer task >= 50 ms in the fixed resident-warm fixture. |
| Warm critical-path storage/resolve/Git | Zero awaited persistence, resolve, or Git operations; zero synchronous storage calls. |
| Warm presentation command count | One or zero distinct target/lease updates per simple warm navigation; redundant retries/echoes fail structural tests. |
| Same tile re-click | Zero new route transactions, session commands, widget mounts, or persistence dirty records. |
| Returning retained workbench | Zero new Dockview instance or terminal instance for supported resident widgets. |
| Hidden workbench layout/fit/animation | Zero periodic calls in a 30-second steady-state hidden interval after settling, excluding an explicit tested theme/revision/eviction event. |
| Resource fan-out | Two consumers plus simultaneous prefetch cause one underlying pending read per key/generation. |
| Resident limit | At most three ordinary workbench presentations; explicit visible popout pins reported separately. |
| Renderer persistence dispatch | p95 per dispatch slice <= 4 ms; split/chunk if exceeded. |
| Startup regression | No >10% regression in comparable non-migration shell readiness; report absolute values as well. |

For isolated low-end hardware that cannot meet an absolute target, preserve all structural/correctness requirements, show baseline/candidate traces, and report the unmet gate. Do not relabel it passed or substitute a skeleton for content. The product owner can later revise a target with evidence; the implementation agent cannot silently waive it.

Record long-task duration and excess-over-50-ms duration separately. Do not call the sum of entire long tasks “Total Blocking Time” without defining the observation window and calculation. Optional navigation-window excess is `sum(max(0, duration - 50))` within the recorded window; it is not automatically the web page-load TBT metric.

### 12.5 Run procedure

Use a production-optimized renderer build, not a Vite development server, for timing gates. The instrumented build uses the same optimization settings and dependency versions as shipping. Diagnostic React/DevTools builds can explain commits but are not the primary latency benchmark.

Record commit, lockfile hash, Electron/Chromium/Node versions actually used, OS, CPU/architecture, RAM, display refresh, window dimensions, device power mode, background workload, instrumentation mode, and fixture size. Do not run baseline and candidate concurrently.

For each warm scenario, use three fresh app launches. Prepare the fixture, perform ten excluded warmup cycles, and collect 100 measured interactions per launch. Pool all 300 valid interactions per scenario, retaining per-launch statistics. Compute p95/p99 with the nearest-rank method and publish sample count/error count; never silently discard outliers.

For genuinely cold scenarios, use a fresh relevant cache/process state for each measured sample; at least 20 samples. Do not clear the user's actual profile. All fixture profiles and repositories live in a dedicated temporary root.

Use readiness predicates rather than arbitrary 1–5 second sleeps. A bounded timeout fails the scenario. Settling for baseline preparation is acceptable, but measurement begins at the actual input and includes resulting work.

Attach raw JSON metrics and at least one representative baseline and candidate Chromium trace for each primary scenario. Capture screenshots of expected active/inactive states where native visibility matters. Screenshots corroborate correctness; they do not independently prove low latency.

---

## 13. Test fixtures and mandatory test matrix

### 13.1 Local fixture

Build a deterministic local fixture in `scripts/perf/navigation/fixtures.mjs` with these entities:

| Fixture | Content |
|---|---|
| Project A | One valid workspace with main and feature branch knowledge; an assistant/chat tile containing 200 synthetic timeline rows, a terminal with 2,000 deterministic output lines, an editor with a 1,000-line text file, and a local browser preview. |
| Project B | Different workspace/root and branch, three ordinary tiles including a terminal/editor. Deliberately distinct titles/text to detect scope leakage. |
| Project C | Third valid workspace for rapid-switch and normal LRU tests. |
| Project D–H | Additional workspaces for eviction/capacity tests; no external network or model billing. |
| Broken project | Missing binding plus deterministic repair candidates. |
| Denied/deleted project | Explicit authoritative access outcome, not an indefinitely pending query. |
| Store/Inbox/Tasks | Deterministic local query adapters with success, empty, pending, and error outcomes; real page components and router. |
| Native preview | Local HTTP fixture page with a clear project-specific marker; use real Electron surface integration. |

Use test-only dependency injection at resource/transport boundaries, not replacement fake navigation UI. Production code must still use the same controller, shell, host, resource engine, model, and widget lifecycle. Do not bypass permission checks in shipping builds. Native terminal/browser correctness tests run real local services; synthetic provider streams must not call paid model APIs.

When the fixture needs authenticated context, use an isolated compiled test identity/provider, never the user's production account. Ensure test adapters are excluded from ordinary production builds and cannot be enabled merely by visiting a URL. Require an explicit local test build flag plus isolated userData profile. Test data must not write to production Convex; no Convex deployment is part of this plan.

The existing Vitest configuration runs in a Node environment. Use it for pure state machines and main-service tests. Put real browser/Electron integration in a separate harness, not a fake Node DOM claim. Reuse existing CDP/Playwright infrastructure when applicable. Playwright's Electron API is experimental; verify launch compatibility with the locked Electron/fuse configuration and do not weaken shipping fuses for tests. [R28, E08]

### 13.2 Resource/controller tests

| Test ID | Procedure | Required assertion |
|---|---|---|
| N01 | Two subscribers and prefetch request same unresolved workspace key. | Exactly one underlying resolve call; all receive the same current-generation outcome. |
| N02 | Resolve prefetch after the destination mounts. | No second mounted-hook request. |
| N03 | Invalidate while old request runs; start new request; resolve old last. | Old result cannot publish or clear the new in-flight promise. |
| N04 | Cached ready entry, background refresh fails. | Cached display survives; error is visible as refresh state, not empty data. |
| N05 | Authoritative null/denied follows cached project. | Cached success is no longer exposed as current authorized project. |
| N06 | Change preferred workspace, repository expectation, or binding revision. | Different correct key/invalidation; no incorrect cache hit. |
| N07 | Expand sidebar and foreground workbench for same resource. | One reconciliation operation per interval. |
| N08 | Minimize then resume window. | View-driven polling pauses; one shared resume refresh per stale key. |
| N09 | Many catalog subscribers mount before initial fetch resolves. | One listener and one initial request. |
| N10 | Catalog push revision 12 precedes initial fetch revision 11. | Revision 12 remains; unchanged entries retain stable references. |
| N11 | A→B→C with deferred prerequisites resolved in reverse order. | Only C foreground; A/B may populate only their still-valid resource entries. |
| N12 | Same href with new create-tile intent vs no-op click. | New command consumed once; no-op produces no transaction. |
| N13 | Back/Forward/direct link/native menu. | One accepted intent and one correct route outcome per interaction; no second history stack. |
| N14 | Router transition cancelled/blocked. | Pending feedback clears; previous accepted surface stays authoritative. |
| N15 | Hover/focus over projects. | No create/attach/checkout/activate/terminal/server/agent side effect. |
| N16 | Branch status unresolved with no trusted stored knowledge. | No invented collab lane/model write; typed pending/error outcome. |

### 13.3 Presentation and real UI tests

| Test ID | Procedure | Required assertion |
|---|---|---|
| U01 | A→Store→A through actual sidebar controls. | Same shell/host/Dockview IDs; A's focus/scroll/layout retained; no new terminal instance. |
| U02 | A→Inbox→A and A→Tasks→A. | Same retained instance guarantee; verify actual route/page visited. |
| U03 | A→B→A, distinct project text and workspaces. | Correct project scope, header, editor, terminal, and native preview; no context leakage. |
| U04 | Same tile twice, then another tile in A. | No router round trips or activation for same-workbench tile focus. |
| U05 | Hide A while B becomes visible. | A inert; no hidden portal/dialog, keyboard handler, header publication, or focus steal. |
| U06 | Resize window while A hidden, then return. | No hidden fit/layout; one necessary activation reconciliation; nonzero dimensions and preserved ratios. |
| U07 | Hide/show without resize. | No unnecessary layout reconstruction or geometry drift. |
| U08 | Agent synthetic stream continues in hidden A. | Canonical output advances; hidden animation/measurement does not; returning shows current output. |
| U09 | Terminal emits while hidden/evicted. | Process/output semantics preserved; no unbounded detached listener growth. |
| U10 | Browser tile hidden under ordinary route/settings overlay. | Native surface not visible/intercepting input; correct surface reappears on return. |
| U11 | Visit D with A/B/C resident. | Oldest ordinary inactive unpinned view evicted; active view never selected for eviction. |
| U12 | Evict then reopen a view with edits/draft/selection/scroll. | Data and supported view state recovered; runtime not closed by eviction. |
| U13 | Keep a popout from A open and navigate parent to B. | Popout stays on A; parent does not steal it; explicit close releases pin. |
| U14 | Project settings and task overlay intent. | Exactly one active overlay; hidden sessions do not consume it. |
| U15 | Cold initial scope hydrates persisted model slowly. | No empty default persisted before hydration; queued tile intent executes once afterward. |
| U16 | Authoritative project removal during pending switch. | Target cannot activate; private stale UI removed without deleting local files. |
| U17 | Settings-only window start/restart. | No main host or main foreground lease created. |
| U18 | StrictMode/HMR mount-cleanup replay in development. | No permanent duplicate bridge/listener/epoch/lease; production IDs stable across navigation. |
| U19 | Hold IME composition or unsaved editor state during eviction pressure. | Capture safely or block eviction; no lost input. |
| U20 | Hidden interval with theme change. | At most necessary one-time update, no recurring fit/animation/poll loop afterward. |

### 13.4 Main-process, worker, and migration tests

| Test ID | Procedure | Required assertion |
|---|---|---|
| M01 | Main accepts sequence 2 while sequence 1 prerequisite is delayed. | Sequence 1 cannot later activate or reveal native surfaces. |
| M02 | Retry same sequence/payload. | Idempotent result, no duplicate activation/persistence. |
| M03 | Same sequence with different payload, retired epoch, wrong sender. | Rejected without mutation. |
| M04 | Renderer reload/crash. | Old epoch invalid; presentation leases released; no late focus/activation. |
| M05 | Explicit session key for another workspace. | Rejected; no latest-project/lane fallback for concrete navigation identity. |
| M06 | Explicit close/delete races delayed activation. | Closed/invalid generation cannot be revived by the delayed request. |
| M07 | Ordinary view evicted while terminal/dev server/agent work runs. | No close/kill/stop from eviction. |
| M08 | Background policy sweep while UI/native surface held by lease. | No silent release of a still-required presentation/service surface. |
| M09 | Main activation with synchronous fs methods instrumented to fail. | Navigation/session persistence path performs no sync filesystem operation. |
| M10 | Many state changes inside debounce interval. | Latest snapshot committed; serialization once per selected dirty record/flush, not each event. |
| M11 | Slow revision 5 write finishes after revision 6 is queued. | File cannot end at revision 5 after revision 6 commits. |
| M12 | Storage write/rename/worker failure. | Old valid record survives; flush reports failure; dirty state retained for retry. |
| M13 | Crash before migration marker, restart import. | Idempotent import, no duplicate/reset/overwrite of newer v2 state. |
| M14 | Corrupt legacy record and valid neighboring record. | Corrupt source preserved/quarantined; valid record imported; no destructive clear. |
| M15 | Layout reset races pending old layout write. | Old reset-key snapshot cannot overwrite reset/new layout. |
| M16 | Hydration resolves after local/current-generation state changed. | Older snapshot ignored; no stale replacement. |
| M17 | Scoped query cache across account/deployment change. | No prior identity data leak; authoritative null wins. |
| M18 | Normal quit with pending writes. | Close awaits actual commit revision or reports failure; enqueue alone is not success. |
| M19 | Settings/secondary writer attempts stale model overwrite. | Rejected/routed through canonical owner; main model preserved. |
| M20 | Oversized query entry and large legitimate workbench state. | Query entry not persisted beyond cap; user state preserved via supported chunking/recovery path. |

### 13.5 Performance and longevity tests

| Test ID | Procedure | Required assertion |
|---|---|---|
| P01 | Resident A↔B 300 measured interactions. | Warm budgets met; zero duplicate resolve/Git or widget recreation. |
| P02 | A↔Store and A↔Inbox real route returns. | Warm retention/latency gates; test records actual non-workbench page. |
| P03 | No-hover cold project click and hover-immediate-click. | Separate cache classes; cold shell remains responsive; in-flight dedup works. |
| P04 | Rapid alternating inputs with delayed IPC/filesystem/query completion. | Latest destination correct and responsive; no stale main activation. |
| P05 | 100 cycles across eight projects plus ordinary pages. | Ordinary residents bounded; listener/observer/lease counts return to expected bounds. |
| P06 | Three populated retained views, one visible. | Hidden steady-state counters meet budgets; active input does not depend on hidden presentation work. |
| P07 | Populated query/layout/model persistence workload while switching. | No renderer serialization/storage spikes on hot path; worker dispatch slice budget recorded. |
| P08 | Packaged restart with migrated user-state fixture. | Correct scoped restored layout/tiles; no terminal duplication or phantom workspace. |
| P09 | Baseline/candidate memory sample after warmup and after stress cycles. | Explain retained vs leaked resources; no monotonically growing live instance/listener counts. Heap/RSS reported, not treated as exact per-view accounting. |
| P10 | Optimized production build with diagnostic code disabled. | No test hooks/security weakening; smoke navigation still works. |

Mandatory scenarios cannot disappear when their fixture is absent. The harness must fail fixture validation before measuring. Optional OS-specific tests may be marked blocked only with the missing capability and platform named; they are not evidence of cross-platform completion.

---

## 14. Ordered implementation phases

Each phase has a specific exit gate. Do not start a later destructive cutover before its prerequisites are tested. Independent agents can work in parallel only according to Section 15.

### P00 — Establish baseline and protect state

**Owner:** integration agent. **Dependencies:** none.

Read repository instructions; record HEAD, lockfile hash, build commands, existing diagnostics, and relevant local modifications. Rebase this specification's file mapping against current `main` if it advanced from the inspected SHA. Do not blindly reset the user's working tree to this SHA.

Create an isolated implementation branch/worktree and an isolated fixture profile. Inventory callers of the functions named in F01–F14. Locate all existing workbench persistence keys and lifecycle/shutdown callers. Read the installed Dockview/TanStack/Electron types relevant to this plan.

Deliver `docs/perf/navigation-baseline.md` with file/symbol map, build environment, current behavior, and captured baseline traces. Capture A→Store→A, A→B→A, same-tile focus, cold project click, and 30-second hidden activity before modifying the hot paths. A failing current scenario is valuable evidence, not a reason to skip it.

**Exit gate:** reproducible baseline fixture, recorded commit/environment, clean separation from the user's real profile, and a concrete call-site inventory.

### P01 — Add counters and correct regression scenarios

**Owner:** test/instrumentation agent. **Dependencies:** P00.

Implement trace IDs, real widget/transport counters, readiness predicates, and fixture validation. Replace `/changes` return-navigation as the primary test with actual Store/Inbox/Tasks route departures. Preserve old tests only as redirect/overlay tests.

Add Node tests for the intended resource/controller interfaces first, using deferred promises and deterministic clocks. Add the separate real Electron harness and run it against the baseline. Keep production behavior unchanged in this phase.

**Exit gate:** baseline failures are reproduced by tests/counters; current true positives still pass; no required scenario succeeds without fixtures.

### P02 — Freeze shared contracts and the resource engine

**Owner:** contracts/resources agent. **Dependencies:** P01's test scaffolding.

Create the shared identity/presentation/persistence types and validators. Implement canonical key builders and the small `keyedResource` state machine. Write N01–N10 and main epoch/sequence validator tests before routing components to them.

Record interface signatures in `docs/perf/navigation-contracts.md`. Freeze them for parallel implementation. Changes afterward require an explicit integration update, not independent incompatible copies by different agents.

**Exit gate:** deterministic resource/identity tests pass; pure modules have no React/router/Electron runtime import cycles.

### P03 — Implement worker persistence and migration infrastructure

**Owner:** persistence agent. **Dependencies:** P02.

Implement worker record storage, serial per-key revisions, atomic replacement, facade, typed IPC, and load/flush contracts. Add worker build entry/output handling through the existing electron-vite build configuration. Add packaged resource resolution tests so the worker path is not development-only.

Implement legacy backup/import and corruption/failure cases. Do not cut over every UI caller yet. Add M10–M20 and main registry persistence tests. Ensure no new dependency or native binary is required for the worker.

**Exit gate:** repeated/crashed migration safe, per-key ordering proven, failures preserve previous records, worker loads in optimized output.

### P04 — Consolidate workspace and branch reads

**Owner:** resources agent. **Dependencies:** P02.

Implement catalog initialization single-flight and stable per-entry snapshots. Convert workspace resolution, branch knowledge, and lane derivation to shared resources. Migrate prefetch, layout, sidebar, and row callers. Remove per-consumer pollers and competing maps.

Retain public hook names briefly only as thin shared-resource adapters. Add invalidation at repair/relink/forget/explicit Git mutation completion. Do not scan candidate folders on hover or create services during prefetch.

**Exit gate:** N01–N16 pass; call counts demonstrate one pending underlying read across prefetch/layout/sidebar; existing offline/missing-binding behavior preserved.

### P05 — Replace session activation and registry hot-path I/O

**Owner:** main-runtime agent. **Dependencies:** P02, P03.

Implement trusted client epochs, sequenced presentation commands, idempotence, invalidation events, and lease cleanup around `WorkbenchSessionManager`. Fix concrete-identity session lookup; remove unsafe latest-session fallback from navigation. Separate async preparation from activation commit.

Replace sync registry persistence with dirty scheduling to the worker. Add presentation leases to existing policy releases. Retain explicit close/terminal/server semantics. Keep an adapter from the current renderer path only until P07 connects the new controller; it must go through the sequenced authority, not bypass it.

**Exit gate:** M01–M09 and registry I/O tests pass, including reverse-order delayed completions and two visible presentation consumers.

### P06 — Cut over renderer persistence and hydration

**Owner:** persistence agent, integration edits coordinated. **Dependencies:** P03, P04.

Migrate query cache, workbench model, layout mirror, and last-route writes. Remove whole-store JSON/localStorage persistence from these hot paths. Replace fake synchronous readiness with explicit per-scope hydration state. Preserve scope/reset-key capture and fresh-null precedence.

Update flush callers to the new async lifecycle contract. Integrate normal quit/update barriers without modifying agent-continuation authority. Run migration/restart fixture tests before enabling retention changes that increase the number of saved scopes.

**Exit gate:** no hot-path localStorage/read-parse/write serialization; M10–M20 pass; packaged restart restores fixture state without empty overwrites.

### P07 — Extract stable shell and retained session boundary

**Owner:** shell/presentation agent. **Dependencies:** P04, P05, P06.

Create `DesktopShell`, move markup out of route lifetime, and add the persistent workbench host. Split `ProjectWorkbenchSurface` into a scoped session surface and a single active route/overlay controller. Introduce explicit context-only hooks and migrate retained dependencies away from ambient route identity.

Hook the route bridge/controller into the new main authority. During the change, only one tree may actually render/activate workbenches; do not render old and new simultaneously for comparison. Temporarily retain the proven opacity concealment while geometry is gated in P08.

**Exit gate:** U01–U05, U14–U18 pass; zero host/shell remount on real route departure; no hidden session's intent/header/focus leakage.

### P08 — Implement explicit widget presentation lifecycles

**Owner:** widget agent. **Dependencies:** P07 contract; can prepare adapters before final integration.

Implement activation/deactivation for Dockview, terminals, editor, chat, native browser/preview, and popouts. Introduce visible geometry ownership, disable Dockview auto-resize, and change hidden ordinary wrappers to layout-skipping concealment only after callback gating works.

Integrate exactly-once disposal and safe state capture. Verify native overlays independently from DOM wrappers. Do not stop agent/terminal ingestion to obtain a zero hidden-render counter.

**Exit gate:** U06–U13, U19–U20 pass; P06 hidden work counters meet requirements; unchanged geometry produces no layout drift.

### P09 — Unify warming and startup staging

**Owner:** shell/resources agent. **Dependencies:** P07, P08.

Make routes and warming use the same loader registry. Remove duplicated import lists. Add bounded speculation/dwell and coverage for Inbox/Tasks/current settings. Stage heavy restored-workbench loading after the lightweight shell is mountable. Preserve startup auth/deep-link precedence.

**Exit gate:** N13–N15, P03, P08 pass; cold shell renders without waiting for unrelated warmups; failed module warming can recover.

### P10 — Remove old paths and enforce boundaries

**Owner:** integration agent. **Dependencies:** P04–P09.

Delete competing keep-alive owner, old resource maps/pollers, direct renderer lifecycle activation path, obsolete full-cache storage adapters, and duplicate warmup lists. Rename or delete misleading diagnostics and stale flags. Keep essential legacy data import and URL compatibility, but not old execution logic.

Add import-boundary/source-structure tests for prohibited retained router dependencies, sync persistence APIs on hot paths, and duplicate lifecycle authority. Run the entire repository suite and all mandatory integration scenarios. Update architecture/performance docs and supersede conflicting old navigation guidance.

**Exit gate:** I01–I18 hold; no duplicate writers/pollers/hosts; no new `any`/`@ts-nocheck`/test skips introduced to silence failures.

### P11 — Tune against measured production traces

**Owner:** performance agent. **Dependencies:** P10.

Run the measurement procedure in Section 12. Investigate the largest remaining trace slices rather than guessing. Optimize only bottlenecks within this scope: callback identity cascades, overbroad subscriptions, excessive model projection, native-bound updates, redundant layout, transport batches, and warmup scheduling.

Do not solve poor timing by dropping content, clipping text, removing features, disabling security, weakening tests, reducing the fixture, or relabeling a loading shell as ready. Document any proposed scope extension before undertaking it.

**Exit gate:** absolute/structural performance gates pass on the recorded reference machine, or the exact unmet target is reported with evidence and no false pass.

### P12 — Final handoff and merge-ready review

**Owner:** integration/review agent. **Dependencies:** P11.

Run all final commands, inspect build output for worker/test-hook correctness, and verify the diff preserves unrelated user work. Produce `docs/perf/navigation-completion.md` with tests, measurements, source removals, migrations, remaining limitations, and rollback instructions.

Prepare a reviewable PR only when repository authorization/workflow permits it. Never publish a release, tag a production version, or deploy cloud changes as a side effect of completing this plan.

**Exit gate:** one final implementation with evidence, not just a proposal or partially enabled alternate path.

---
## 15. Parallel-agent work allocation

Use one integration owner. Agents must not independently edit shared contracts, preload, the root package manifest, or the same shell file. Parallelism is for non-conflicting packets; it is not permission to build separate versions of the architecture.

| Packet | Primary owner/files | Prerequisites | Required handoff |
|---|---|---|---|
| A — Baseline, fixtures, metrics | `scripts/perf/navigation/**`, navigation instrumentation tests/docs | P00 | Reproducible fixture, baseline report, ready-predicate contracts, counter API, failing baseline scenarios |
| B — Contracts and resources | `shared/navigationRuntimeTypes.ts`, `src/app/resources/**`, resource adapters | A scaffolding | Frozen types, key builders, resource tests, old/new call-site list |
| C — Persistence | `shared/desktopPersistenceTypes.ts`, persistence client/service/worker, layout/model persistence changes | B contracts | Worker protocol, migration evidence, flush contract, exact integration edits |
| D — Main presentation authority | `WorkbenchPresentationCoordinator`, session manager and session handlers | B; C facade | Epoch/sequence/lease tests, late-completion behavior, no-sync-I/O proof |
| E — Shell and session scope | `DesktopShell`, route/controller bridge, session boundary/host/surface | B; interfaces from C/D | Stable component tree, scoped callbacks, real route-return tests |
| F — Widget lifecycle | Workbench geometry/lifecycle adapters; narrowly needed terminal/chat/browser integration | E identity/activity contract | Hidden activity trace, sizing correctness, popout/native visibility tests |
| G — Integration/review | Root manifests, preload/shared API wiring, App/routes/config, final cleanup/docs | All packets | One final architecture, full validation and performance report |

The integration owner alone edits `shared/electronApiTypes.ts`, `apps/desktop/electron/preload.ts`, application bootstrap registration, root `package.json`, and shared build/test configuration. Packet owners supply exact required patches or coordinate commits; do not race writes to these files.

When only one local agent is available, execute P00–P12 sequentially. Do not simulate parallel agents by leaving partially working alternate implementations in the final branch.

### 15.1 Required packet completion note

Every packet writes a handoff note under `docs/perf/navigation-handoffs/` containing: changed files; finalized interfaces; tests run with exit codes; remaining failures with ownership; any data migration or runtime behavior change; and exact next integration action. State whether results came from real Electron, mocked unit tests, or static inspection.

Do not write “all good” without command evidence. Do not claim latency improvements from source inspection. Do not change another packet's contract without notifying the integration owner through the handoff note and updating shared tests.

---

## 16. File migration and removal checklist

This table is the final-state checklist. Temporary wrappers may exist during development, but the final implementation must satisfy the stated outcome.

| Existing module/symbol | Final outcome |
|---|---|
| `WorkbenchKeepAliveHost.tsx` | Replaced by the persistent presentation host; no route-local resident-list authority remains. |
| `workbenchKeepAlive.ts` | Retain/move tested bounded selection helpers only if used by the new store; remove old duplicated session authority. |
| `WorkbenchActivity.tsx` | Retired or renamed to accurately implement explicit presentation visibility; not an always-visible Activity presented as suspension. |
| `ProjectWorkbenchSurface.tsx` | Old combined route/runtime/view owner removed; split session surface, active overlays, and route intent adapter. |
| `useWorkbenchSessionLifecycle.ts` | No ensure/activate/background side effects on React mount/cleanup; replaced by read-only session subscription if the name survives. |
| `useProjectWorkspaceResolution.ts` | Thin shared-resource adapter or removed; no local competing map or direct per-consumer request. |
| `useProjectLaneState.ts` | Shared lane-resource subscription; no per-consumer `gitStatus` loop. |
| `projectSwitchPrefetch.ts` | Shared resource/module preparation only; no separate in-flight ownership or mutation. |
| `useWorkspaceCatalogSnapshot.ts` | Single initial in-flight fetch, monotonic revisions, lifetime cleanup and stable per-entry subscriptions. |
| `queryCache.ts` | Scoped in-memory display cache with dirty-entry persistence; fresh null/denied outcome wins. |
| `workbenchLayoutPersistence.ts` | In-memory peeks and async hydration/queued writes; preserved migration/reset-key semantics. |
| `workbenchStore.ts` | No hot whole-store JSON persistence; explicit dirty scopes; existing neutral dependency boundary preserved. |
| `ProjectSyncContext.tsx` | Separate runtime attachment ownership from scoped context bridging; hidden views do not become focused attachments. |
| `workspaceRuntimeStore.ts` / runtime policy | Reused, not replaced; visibility demand distinct from service activity; idempotent lease accounting. |
| `navigationWarmup.ts` / `App.tsx` import warmups | Unified registry/policy, no competing loader lists. |
| `localNavigation.tsx` / project switch marks | Transaction-specific accurate readiness metrics, bounded records; no frame callback mislabeled as observed paint. |
| `scripts/perf/interactions.mjs` | Keep useful diagnostics, correct return-route scenario and metric names; final gates live in the new real harness. |
| `WorkbenchSessionManager.persist()` | Dirty scheduling only on activation; serialization/I/O in worker. |
| `WorkbenchSessionManager` background release policy | Respects explicit presentation/service demand; no silently invalidating resident native UI. |
| Direct renderer `activateSession/backgroundSession` calls | Eliminated or routed through the single sequenced command authority; no bypass. |

Do not delete legacy URL redirects or safe data import merely because old runtime execution is being removed. Compatibility at the boundary is acceptable; duplicate active machinery is not.

---

## 17. Validation commands and evidence format

### 17.1 Repository preparation

The following are safe inspection commands, not permission to discard edits:

```bash
pwd
git status --short
git rev-parse HEAD
git log -1 --format='%H %cI %s'
git diff --stat
```

Use a new worktree if there is unrelated local work. Choose a unique branch name such as `perf/navigation-runtime-v2`. Do not execute `git reset --hard`, `git clean -fd`, or a blanket file deletion. Install with the repository's documented Bun bootstrap flow in that isolated worktree; preserve the locked versions. [R01]

Required inventory searches:

```bash
rg -n 'useWorkbenchSessionLifecycle|ensureSession|activateSession|backgroundSession' apps/desktop/src apps/desktop/electron shared tests
rg -n 'useProjectLaneState|prefetchProjectLaneState|prefetchProjectSwitch|resolveProject|gitStatus' apps/desktop/src apps/desktop/electron tests
rg -n 'WorkbenchKeepAliveHost|WorkbenchActivity|ProjectWorkbenchSurface|ProjectLayout' apps/desktop/src tests
rg -n 'peekPersistedWorkbenchLayout|writePersistedWorkbenchLayout|flushWorkbenchStorage|createDebouncedStorage|cozea-query-cache' apps/desktop/src apps/desktop/electron tests
rg -n 'useParams|useLocation|useSearchParams|useActiveWorkbenchScope|useAccessibleProject|useProjectHeader' apps/desktop/src/features/workbench apps/desktop/src/features/projects/pages
rg -n 'before-quit|beforeunload|will-prevent-unload|flushWorkbenchStorage' apps/desktop/src apps/desktop/electron
```

Read matches in context. A source match in an unrelated explicit Git action is not automatically a navigation defect. Conversely, deleting an import without replacing behavior is not a fix.

### 17.2 Add explicit new scripts

The integration owner adds these scripts to the existing root package manifest:

| Script name | Required implementation |
|---|---|
| `test:navigation:unit` | Run Vitest against `tests/navigation` and `tests/electron/navigation` using the existing Node configuration/mocks. |
| `build:navigation-test` | Run a Node build wrapper that sets an explicit local test-build flag and invokes the existing production build pipeline; no shell-dependent environment assignment. |
| `test:navigation:electron` | Run `scripts/perf/navigation/run.mjs --mode=correctness`; launch optimized output and validate isolated fixture/profile before testing. |
| `perf:navigation` | Run the same runner with `--mode=performance`; collect the Section 12 samples and enforce budgets. |
| `check:navigation-boundaries` | Run source/import checks for the ownership rules, plus tests proving any approved exception. |

The runner must verify build/commit/fixture fingerprints before use and refuse stale or missing builds. It must not silently switch to the development server when optimized output is unavailable.

Use the repository's current unsigned/no-publish packaging flow for packaged worker-path and restart tests. Follow its config rather than inventing a release command. Packaging is local-only: no tag, notarization credential changes, production upload, or cloud deployment.

An ordinary production build with test adapters excluded must also launch and pass an appropriate smoke test. If private navigation requires authentication unavailable in the isolated shipping profile, record exactly what was smoke-tested there; do not pretend unauthenticated startup validates all authenticated screens. The full UI flow is exercised in the optimized isolated test build, and an authorized real-profile local verification can be recorded separately without exporting private data.

### 17.3 Final command sequence

After implementing the new scripts, run:

```bash
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
bun run test:navigation:unit
bun run check:navigation-boundaries
bun run test
bun run audit:electron-ipc
bun run audit:electron-api-renderer
bun run build:navigation-test
bun run test:navigation:electron
bun run perf:navigation
bun run build
bun run perf:bundle-summary
```

Run the packaged worker/restart tests using the actual packaged app path produced locally. Record separate results for macOS and any other supported platform actually tested. Do not infer Windows correctness from a macOS run or vice versa.

Repository-wide pre-existing failures may exist. Preserve a baseline run, identify the exact pre-existing failure, and prove the patch does not introduce a regression. Do not add exclusions, loosen type checking, or change unrelated code merely to make the report green. A missing native dependency is a blocked capability with a named test, not a passing result.

### 17.4 Completion report schema

`docs/perf/navigation-completion.md` must contain:

| Section | Required content |
|---|---|
| Baseline/candidate | Exact SHAs and lockfile hashes. |
| Architectural result | Stable tree, resource owners, presentation protocol, persistence owners. |
| Data migration | Imported domains, backups, corrupt-data behavior, restart evidence. |
| Test results | Every N/U/M/P ID with pass/fail/blocked; commands, platform, exit codes. |
| Performance | Sample counts, distributions, fixture, machine, absolute and comparative metrics. |
| Correctness counters | Retention/mount/dispose, duplicate transport, stale-discard, hidden activity, close/kill/stop counts. |
| Deleted paths | Old owners/pollers/writers/warming lists removed. |
| Remaining limitations | Precise unverified or unmet behavior; no implied guarantee. |
| Rollback | How to revert code without destroying new/old state; use retained migration backups. |
| Review notes | IPC authorization, shutdown/flush semantics, popout behavior, no production operations. |

Do not make runtime rollback depend on an undocumented dual writer. A code rollback can use preserved legacy backups, but post-migration edits may require explicit export/import. Document that limitation; do not promise seamless downgrades unless they are tested.

---

## 18. Anti-drift rules and stop conditions

| Prohibited shortcut | Required alternative |
|---|---|
| Replace Electron/React/router before addressing ownership | Complete this targeted rewrite and measure; propose any stack change separately. |
| Add a new cache while leaving the old owner active | Consolidate one owner and remove the old execution path. |
| Increase LRU to hide repeated reconstruction | Fix host lifetime and context identity first. |
| Leave all hidden widgets active to preserve state | Separate UI effects from service/model ownership and implement deactivation. |
| Use Activity hidden around destructive widget effects | Introduce explicit widget lifecycle; test instance retention. |
| Persist the entire store through an async-looking storage adapter | Coalesce changed records before serialization and instrument dispatch cost. |
| Mark a loading spinner as content-ready | Use real content/valid-empty-state readiness predicates. |
| Remove polling everywhere without another freshness mechanism | Shared events plus a bounded reconciliation policy. |
| Treat a cached project as authorization | Respect current auth/denied outcomes and scope caches by identity. |
| Guess `collab`, another workspace, or first record while unresolved | Preserve a typed pending/repair state and wait for valid identity. |
| Return old-project UI under new-project context | Hide/inert old surface and atomically select matching context/content. |
| Rely solely on renderer cancellation | Reject stale mutations at main authority after awaits. |
| Silence errors with `@ts-nocheck`, `any`, skipped scenarios, or larger budgets | Fix the defect or report the exact blocker. |
| Reset/delete user data because pre-launch | Migrate with backup and explicit per-record validation. |
| Disable sandbox/context isolation/hardware acceleration for performance tests | Test the real security/rendering architecture. |
| Rewrite AI providers, collaboration, or native styling incidentally | Keep those systems; change only the required lifecycle integration. |

If the current checkout materially differs from the baseline, update the file/symbol map and record the difference. Preserve the invariants and architecture unless the new source already implements part of them. Do not reimplement a completed capability just to reproduce the proposed filenames.

If an installed API lacks a method named in current documentation, use its supported equivalent demonstrated by local types/tests. Do not perform an unplanned major dependency upgrade. A required missing capability is an explicit integration finding with a bounded alternative, not an excuse to fake a completed lifecycle.

**Final acceptance:** real route navigation selects validated existing state; retained UI remains correctly scoped and quiet while hidden; running work survives navigation; persistence is off hot paths and safe; stale completions cannot take over; and the implementation is verified with real Electron interactions.

---

## Appendix A. Repository evidence and primary technical references

Repository links below are pinned to the inspected commit. They support baseline observations; the new files and contracts prescribed above are implementation proposals. Read the current local counterparts before editing.

**[R01]** [AGENTS.md](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/AGENTS.md).

**[R02]** [apps/desktop/src/features/projects/layouts/ProjectLayout.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/layouts/ProjectLayout.tsx); [apps/desktop/src/contexts/project/ProjectRouteContext.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/contexts/project/ProjectRouteContext.tsx).

**[R03]** [apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx).

**[R04]** [apps/desktop/src/features/workbench/workbenchKeepAlive.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/workbenchKeepAlive.ts).

**[R05]** [apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/pages/ProjectWorkbenchSurface.tsx); [apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx).

**[R06]** [apps/desktop/src/features/workbench/WorkbenchActivity.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/WorkbenchActivity.tsx).

**[R07]** [apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx); [apps/desktop/src/features/workbench/WorkbenchDockviewCanvas.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/WorkbenchDockviewCanvas.tsx).

**[R08]** [apps/desktop/src/features/workspace/useProjectWorkspaceResolution.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workspace/useProjectWorkspaceResolution.ts).

**[R09]** [apps/desktop/src/features/workbench/hooks/useProjectLaneState.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/hooks/useProjectLaneState.ts).

**[R10]** [apps/desktop/src/features/projects/lib/projectSwitchPrefetch.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/lib/projectSwitchPrefetch.ts).

**[R11]** [apps/desktop/src/features/projects/ui/ProjectSidebar.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/ui/ProjectSidebar.tsx); [apps/desktop/src/features/projects/ui/sidebar/ProjectSidebarTreeItem.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/projects/ui/sidebar/ProjectSidebarTreeItem.tsx).

**[R12]** [apps/desktop/src/app/model/queryCache.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/app/model/queryCache.ts); [apps/desktop/src/lib/scheduler.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/scheduler.ts).

**[R13]** [apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts).

**[R14]** [apps/desktop/src/lib/workbenchStore.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/workbenchStore.ts).

**[R15]** [apps/desktop/electron/services/WorkbenchSessionManager.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/electron/services/WorkbenchSessionManager.ts); [apps/desktop/electron/ipc/registerWorkbenchSessionHandlers.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/electron/ipc/registerWorkbenchSessionHandlers.ts).

**[R16]** [apps/desktop/src/features/workbench/hooks/useWorkbenchSessionLifecycle.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/hooks/useWorkbenchSessionLifecycle.ts).

**[R17]** [apps/desktop/src/lib/workspaceRuntimeStore.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/workspaceRuntimeStore.ts).

**[R18]** [apps/desktop/src/features/workspace/WorkspaceRuntimeHosts.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workspace/WorkspaceRuntimeHosts.tsx); [apps/desktop/src/features/workspace/WorkspaceRuntimeHostsGate.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workspace/WorkspaceRuntimeHostsGate.tsx).

**[R19]** [apps/desktop/src/contexts/project/ProjectSyncContext.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/contexts/project/ProjectSyncContext.tsx).

**[R20]** [apps/desktop/src/features/workspace/workspaceRuntimePolicy.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workspace/workspaceRuntimePolicy.ts).

**[R21]** [apps/desktop/src/router/routes.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/router/routes.tsx); [apps/desktop/src/lib/router.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/router.tsx).

**[R22]** [scripts/perf/interactions.mjs](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/scripts/perf/interactions.mjs).

**[R23]** [apps/desktop/src/lib/performance/localNavigation.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/performance/localNavigation.tsx); [apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx).

**[R24]** [apps/desktop/src/features/workspace/useWorkspaceCatalogSnapshot.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/features/workspace/useWorkspaceCatalogSnapshot.ts).

**[R25]** [apps/desktop/src/contexts/project/useAccessibleProject.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/contexts/project/useAccessibleProject.ts); [apps/desktop/src/contexts/project/useActiveWorkbenchScope.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/contexts/project/useActiveWorkbenchScope.ts).

**[R26]** [apps/desktop/src/lib/workbenchScopeKey.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/workbenchScopeKey.ts).

**[R27]** [apps/desktop/src/main.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/main.tsx); [apps/desktop/src/app/bootstrap/desktopBootstrap.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/app/bootstrap/desktopBootstrap.ts); [apps/desktop/src/App.tsx](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/App.tsx); [apps/desktop/src/lib/navigationWarmup.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/apps/desktop/src/lib/navigationWarmup.ts).

**[R28]** [vitest.config.ts](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/vitest.config.ts); [package.json](https://github.com/Cozea/electron-app/blob/073df5230d2400684434ea6b7db27b0aafc72ddc/package.json).

### Primary external references

**[E01]** [React Activity: visibility and effect cleanup](https://react.dev/reference/react/Activity). Checked September 8, 2026; verify the locally installed API before implementation.

**[E02]** [React useSyncExternalStore: stable snapshots and transitions](https://react.dev/reference/react/useSyncExternalStore). Checked September 8, 2026; verify the locally installed API before implementation.

**[E03]** [TanStack Router lifecycle events](https://tanstack.com/router/latest/docs/guide/router-events). Checked September 8, 2026; verify the locally installed API before implementation.

**[E04]** [Zustand persist source: JSON serialization precedes StateStorage.setItem](https://github.com/pmndrs/zustand/blob/main/src/middleware/persist.ts). Checked September 8, 2026; verify the locally installed API before implementation.

**[E05]** [Dockview sizing: manual layout and disableAutoResizing](https://dockview.dev/docs/core/sizing/). Checked September 8, 2026; verify the locally installed API before implementation.

**[E06]** [MDN requestAnimationFrame: callback before repaint](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame). Checked September 8, 2026; verify the locally installed API before implementation.

**[E07]** [Node filesystem: asynchronous operations require explicit ordering](https://nodejs.org/api/fs.html). Checked September 8, 2026; verify the locally installed API before implementation.

**[E08]** [Playwright Electron automation and launch constraints](https://playwright.dev/docs/api/class-electron). Checked September 8, 2026; verify the locally installed API before implementation.

**[E09]** [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance). Checked September 8, 2026; verify the locally installed API before implementation.

Technical references explain API behavior, not measured Cozea performance. The architectural targets, defaults, test thresholds, and new contracts in this specification are proposed engineering decisions.
