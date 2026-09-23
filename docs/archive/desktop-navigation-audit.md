# Desktop navigation and loading audit

Audited 2026-09-05. Source baseline: local `4ef0c9ca`, plus the uncommitted Share visibility fix. No performance implementation changes in this audit.

## Scope and confidence

Reviewed the application shell, router, navigation wrapper, Settings drawer and sections, Store, Skills/Builds, project creation, workbench lifetime, local installation IPC, skill discovery, authentication startup, and shared caches. Searched the renderer for loading gates, lazy boundaries, timers, reloads, and state initialization, then followed relevant callers into Electron.

This is an inventory of confirmed design/code patterns and proposed remedies, not a timing profile or a claim that every delay has been found. Earlier live checks observed workbench loading and an initially blank assistant tile. This audit's attempted Computer Use inspection selected a separate “Cozea timeline stress QA” window, so no new navigation latency measurements are claimed. Cold development-module cost, packaged-app cost, local IPC duration, renderer work, and animation cost still need separate measurements.

Priority reflects likely user impact and breadth, not measured milliseconds. “Local” does not imply “free”: parsing modules, scanning directories, synchronous storage and recreating views all cost time. The defect is repeatedly making those costs prerequisites for showing already-known UI.

## Findings

### 1. Opening Builds requests the same skill inventory twice — high

`AgentSkillsPage.tsx:943` runs `agentSkills.list()` on mount and on `view` changes. At `:1118` it returns `SkillBuildsView`, whose own mount effect at `SkillBuildsView.tsx:334` independently calls the same API. The parent remains mounted, so entering Builds initiates both requests.

**Effect:** duplicate local discovery for one navigation. Switching library/build views triggers further refreshes rather than consuming one authoritative snapshot.

**Desktop behavior:** one application-owned skill snapshot, one in-flight refresh, and an event or revision after mutations. Both screens consume it. Preserve provider-native folders as execution authority; a cache is only a presentation snapshot.

### 2. Skill discovery blocks Electron's main process — high

`electron/services/AgentSkillService.ts:1931` handles `agentSkills:list` by directly calling synchronous `list()` at `:682`. That method enumerates the managed library and provider/catalog roots, reads Markdown/metadata, parses records, and checks file stats. Helpers use `readdirSync`, `readFileSync`, `lstatSync`, and `statSync` (`:196`, `:218`, `:339`). There is no scan snapshot cache in this entry point.

**Effect:** a page request performs filesystem work on the main event loop. It can delay other IPC and native app operations, not just Skills. The duplicate request in finding 1 compounds this. Actual duration depends on library size and storage and is unmeasured.

**Desktop behavior:** maintain an indexed snapshot, coalesce refreshes, and move expensive discovery off the main event loop. Retain existing ownership checks and mutation serialization. Do not simply make the handler `async` while leaving synchronous scans inside it.

### 3. Settings initially opens through a blank lazy boundary — high

`App.tsx:30` lazy-imports the drawer. `SettingsDrawerHost` at `:65` does not mount it until `isOpen`, then uses `Suspense fallback={null}`. The drawer statically imports Account, Appearance, DevAppSettings, Organizations and Tooling (`SettingsDrawer.tsx:7`).

**Effect:** first opening can look like an ignored click while the drawer's module graph becomes available. The route-level “Loading Settings” explanation does not describe this drawer path.

**Desktop behavior:** make the lightweight settings frame immediately available; warm likely sections and load expensive optional sections independently. Do not eagerly initialize every provider just to open Appearance.

### 4. Settings discards section state on close and section switch — high

`SettingsDrawerHost` returns `null` when closed. `SettingsDrawerBody` (`SettingsDrawer.tsx:29`) chooses a different component for each section. These lifetimes discard component-local state and restart mount effects. Examples include DevAppSettings search/filter state (`:88`), Tooling pagination/settings reads (`:117`, `:150`), and Appearance's local settings read (`:82`).

**Effect:** revisiting a local pane reconstructs it and reloads data. Data caching in Tooling mitigates some of the cost but does not preserve all section state.

**Desktop behavior:** retain selected view state and shared data outside section lifetime. Preserve drafts intentionally. Keeping an entire hidden tree running is not automatically the right solution.

### 5. Installed DevApps are reloaded separately by each consumer — high

`useOrgDevAppInstallations.ts:10` starts with `[]` and `loading=true`; each mount sends `listInstallations()` and creates its own event subscription. Consumers include Store (`AppStorePage.tsx:83`), DevAppSettings (`:93`) and each launcher (`WorkbenchSelectionTile.tsx:411`). The main handler (`registerOrgDevAppHandlers.ts:40`) already returns the device installation catalog and publishes change events.

**Effect:** visiting another screen throws away the previously displayed installation list and reconstructs it over IPC. Multiple consumers duplicate the initial requests.

**Desktop behavior:** one renderer-wide installation snapshot and subscription. Show the existing snapshot synchronously, then reconcile. Preserve exact installed release semantics; never make refreshing the catalog silently update installed artifacts.

### 6. Tooling has a serial health-check waterfall — medium

`Tooling.tsx:129` awaits runtime status and only then requests Git health at `:132`. Both share one loading flag. `prewarmToolingSettings` warms runtime status only, and a mount calls `loadRuntimeStatus` separately rather than joining the prewarm promise.

**Effect:** initial health loading can last for the sum of independent checks; opening during prewarm can repeat work. Cached health is already shown during later silent refreshes, so this is not a universal full-page blocking spinner.

**Desktop behavior:** coalesce prewarm and foreground refresh, run independent checks together, and update each result independently. Keep the existing stale-result display.

### 7. Basic local settings start with provisional values — medium

Appearance reads Electron settings in a mount effect (`Appearance.tsx:82`). Tooling initializes preview compatibility to `true` and the projects directory to `null`, then loads settings separately (`Tooling.tsx:111`, `:154`).

**Effect:** local configuration can briefly show defaults or “loading” before the saved value arrives. This also makes view mounting synonymous with reading settings again.

**Desktop behavior:** hydrate a shared local-settings snapshot once and subscribe to changes. If no snapshot exists, mark only the affected control unresolved instead of presenting a guessed value as settled.

### 8. Built-in pages use click-time module loading — medium

`router/routes.tsx:17` wraps route components in React.lazy/Suspense with `RouteLoading`. Store, Skills and standalone Settings routes use this wrapper. This is separate from the drawer behavior above.

**Effect:** the first visit to packaged local UI has a code-loading phase. Development Vite transformation can make it worse. React.lazy caches successful module loads, so this alone cannot explain repeated warm navigation delays.

**Desktop behavior:** keep the small navigation frame ready, warm common local destinations, and split genuinely expensive tools. Measure initial startup and memory before deciding which modules to preload. Removing all code splitting would trade one problem for another.

### 9. Warmup is delayed, incomplete and restarted by route changes — medium

`App.tsx:217` schedules New Project or the workbench page wrapper after 3.5 seconds plus idle scheduling. `:241` schedules Tooling after 6 seconds plus idle scheduling. Cleanup cancels pending callbacks whenever the pathname changes. Warming `ProjectWorkbenchPage` does not itself invoke the nested lazy Surface loader.

**Effect:** quick navigation can beat or repeatedly cancel intended warming. A loaded wrapper can leave the heavy destination cold. Idle timeouts are maximum scheduling waits, not fixed added delays on each navigation.

**Desktop behavior:** use a bounded, application-lifetime warmup queue and navigation intent. Warm the actual destination dependency where justified. Keep optional background tasks out of the immediate interaction path.

### 10. Global navigation captures screenshots for a page transition — medium, timing unmeasured

`lib/navigation.ts:20` wraps applicable navigation in `document.startViewTransition`, awaits the router and one timer turn, and has a 400ms watchdog. Project routes explicitly skip this path. The feature defaults on in `lib/featureFlags.ts:7`.

**Effect:** non-project navigation has screenshot/crossfade work in addition to rendering. Source comments already document stuck captures displaying old content. The watchdog is not a deliberate 400ms delay, and no claim is made that this is the largest bottleneck. The store-only Settings drawer switch does not necessarily use this wrapper.

**Desktop behavior:** compare with immediate navigation using identical cold/warm conditions. Prefer direct pane changes; retain motion only where it improves orientation without postponing usable content.

### 11. Local filtering is implemented as router navigation — medium, timing unmeasured

Store's search input calls `setParam` on each change (`AppStorePage.tsx:494`); `useSearchParams` (`lib/router.tsx:97`) invokes router navigation to write the query string. Filtering itself is already local and memoized.

**Effect:** typing into a local filter also updates the routing system and its subscribers. There is no evidence that this downloads the page or performs a full document reload.

**Desktop behavior:** maintain immediate input/filter state locally and synchronize restorable route state separately where useful. Verify render counts before changing behavior. Preserve shareable/deep-link state where it has a product purpose.

### 12. Loading and empty are conflated in Builds — medium

`SkillBuildsView.tsx:310` initializes its snapshot to `null`; `:375` derives builds as `[]`; the rendering branch at approximately `:535` shows `EmptyBuilds` whenever that array is empty without first distinguishing an unresolved snapshot.

**Effect:** existing data can initially look absent rather than loading. This is different from the Default-build seeding fix, which creates a build when appropriate after discovery.

**Desktop behavior:** retain the last snapshot; on genuine first discovery distinguish unknown from confirmed empty. Do not replace this with a perpetual full-page spinner.

### 13. Workbench retention ends at the route boundary — high for workbench returns

`ProjectWorkbenchSurface.tsx:450` owns `WorkbenchKeepAliveHost`, whose retained sessions live in component state (`WorkbenchKeepAliveHost.tsx:25`). Leaving the workbench route unmounts that cache. `ProjectLayout.tsx:648` gates project content on workspace resolution; Surface `:396` then requires project/workspace/lane readiness. Nested lazy boundaries load Surface and Dockview, including a null fallback (`WorkbenchDockviewSession.tsx:158`).

**Effect:** returns rebuild tile UI despite the “keep alive” name. Shared processes/runtime hosts may remain alive: this finding does not mean the backend process necessarily restarts.

**Desktop behavior:** give bounded view retention a shell-level owner and reuse resolved workspace/lane presentation data. Preserve authorization and repair checks. Existing `WorkbenchActivity` keeps hidden effects active; do not expand retention until background work, overlays and keyboard ownership are correctly gated.

### 14. Local app access is gated by a fresh cloud-backed session — high architectural issue

`AuthContext.tsx:37` waits for `getDeviceSession()` before establishing the user. `deviceSession.ts:40` gets the local identity, requests a network challenge, signs it, then completes the network exchange. Its cached session is module-memory only. `App.tsx:256` shows fullscreen loading during initialization and routes unauthenticated users to Login before local screens are mounted.

**Effect:** a new renderer session's access to local Settings/Skills is coupled to remote authentication. This is a startup/offline concern, not evidence of authentication on every navigation.

**Desktop behavior:** investigate a device-local shell identity and explicit cloud-session readiness as separate states. This requires an authentication/product design change; it must not bypass server authorization or trust persisted cloud roles.

### 15. Creating a local project awaits cloud provisioning — architectural tradeoff

`CreateProjectDialog.tsx:306` requires a Convex user. Fresh creation at `:336` awaits the project mutation before creating the local workspace, and at `:401` awaits status update before navigation.

**Effect:** the local create-folder flow depends on cloud availability and latency. Unlike several findings above, this reflects the current shared-project identity model, not merely an unnecessary effect.

**Desktop behavior:** decide whether local-only projects should open before cloud registration, then design idempotent reconciliation and ownership explicitly. Do not reorder these operations casually; the current catalog and project IDs depend on this sequence.

### 16. Shared cache persistence still writes on the renderer thread — measurement candidate

`app/model/queryCache.ts:108` persists the cache through JSON localStorage. It bounds entries and schedules writes as background tasks, which are useful protections, but those tasks still execute in the renderer. Workbench persistence debounces storage writes (`lib/workbenchStore.ts:52`); this does not prove serialization is free.

**Effect:** large cache updates may compete with interaction/rendering. No trace establishes that these writes caused the reported delay.

**Desktop behavior:** measure payload sizes and long tasks; batch snapshots or move costly persistence to an asynchronous device store if the trace warrants it. Do not replace every small local preference with IPC.

## Existing desktop-oriented behavior to preserve

- Workspace resolution already has a keyed cache and background revalidation; the project shell uses cached project data. The app does not universally fetch everything from scratch.
- Tooling already retains health snapshots; commands in the command palette are filtered locally and close the palette before execution.
- Store's built-in catalog comes from local code and is distinct from the cloud organization catalog. Cloud release metadata, publication, invitations and collaboration legitimately require remote calls.
- Installed artifacts, drafts and workspace ownership already have local authorities. Reuse those instead of introducing another cache with conflicting authority.
- Explicit retries, connection backoff, write debounces and provider-install waits are not automatically “websiteisms.” They were excluded unless they affect ordinary local navigation unnecessarily.
- Normal navigation uses the client router. The discovered full-document reloads are explicit error recovery and identity reset, not the ordinary Settings/Store path.
- The Share-everywhere defect is already fixed locally and is not an outstanding item in this audit.

## Recommended order

1. Add equivalent click-to-frame and click-to-usable measurements for Settings, Store and Skills; existing project-switch marks are insufficient for this complaint. Track IPC count/duration, renderer long tasks, module loading and main-process scan duration without logging private skill contents or paths.
2. Fix duplicate skill discovery and main-thread scans, then introduce shared skill/installation/settings snapshots. These changes have direct code evidence and improve multiple screens.
3. Make Settings frame immediate, preserve section state, and distinguish unknown/empty/refreshing. Remove serial health waits and coalesce prewarm.
4. Measure and simplify transitions and local-search routing; warm common destinations with a budget.
5. Address workbench retention separately, including hidden-effect and overlay ownership.
6. Treat offline startup and local project provisioning as explicit architecture work, preserving security and catalog guarantees.

## Verification matrix for implementation

Measure cold and warm runs separately in development and a packaged/release-like app. Record first visible frame and first usable controls separately. Suggested targets are a first response within 100ms and warm local panes usable within 150ms; these are proposed acceptance criteria, not measured results.

- Settings open/close/reopen and Account → Appearance → DevApps → Tooling → Appearance: no unnecessary blank surface, saved values do not flash defaults, per-section state is retained intentionally.
- Store ↔ Skills repeated ten times: no redundant inventory scans; previous local results remain visible while refreshing.
- Builds → library → Builds: one coalesced scan when needed, no false empty state; provider mutations still converge.
- Local list search: results respond without measurable router-wide stalls.
- Warm navigation with slow/unavailable cloud: local content stays usable; remote controls clearly express their own readiness.
- Project ↔ global pages: retained UI does not duplicate browser hosts, keyboard handlers or overlays; inactive views do not consume avoidable background work.
- A large skill library: discovery does not stall main-process IPC or native menus.

No production authentication, publication, permission or data changes were made. No source implementation changed for this audit, so build/test reruns were not necessary; the preceding Share fix's checks remain separate evidence.
