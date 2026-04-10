# Workbench Session Lifecycle And Performance Plan

## Summary

This document defines how the workbench should behave before browser and dev-server tiles are rebuilt.

The most important decision is simple:

- switching workbenches must not mean closing them
- leaving a route must not mean killing its terminals
- hiding UI must happen before tearing down processes
- browser, terminal, dev server, assistant, and native simulator behavior must be coordinated by a real session model

This document is the execution reference for:

- multi-project performance
- multi-lane performance
- seamless workbench open/close/reopen behavior
- backgrounding and freezing policy
- resource limits and eviction
- browser/dev-server tile rebuild direction

It also records what we learned from studying the local `t3code` app so that reasoning is not lost later.

## Current Status

At the time of writing:

- the workbench now has a real Electron-side session lifecycle keyed by `projectId::laneId`
- browser and dev-server tiles have been reintroduced on top of that session model
- the browser implementation has been reshaped around the same core pattern as VS Code's newer `browserView` workbench feature
- the dev-server tile now uses the browser surface for web previews and the native simulator surface for iOS/native previews
- native simulator code was intentionally preserved

Relevant current files:

- `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- `src/stores/useProjectWorkbenchStore.ts`
- `electron/services/WorkbenchBrowserService.ts`
- `electron/services/WorkbenchSessionManager.ts`
- `electron/ipc/registerWorkbenchSessionHandlers.ts`
- `src/features/projects/browser/browserTileModel.ts`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`
- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`
- `electron/ipc/registerDevServerHandlers.ts`
- `electron/services/TerminalService.ts`
- `src/features/projects/layouts/ProjectLayout.tsx`

This is no longer a "remove first, rebuild later" branch.

The session foundation and the first rebuilt browser/dev-server surfaces now exist together on the same branch, so this document must describe both:

- the target lifecycle model
- the code that now implements that model

## Implemented Sweep

This section records the concrete implementation delivered in this sweep so the document reflects the actual codebase rather than only the target design.

### Delivered

#### 1. Electron Session Manager

Added:

- `electron/services/WorkbenchSessionManager.ts`
- `electron/ipc/registerWorkbenchSessionHandlers.ts`

What it now does:

- creates a real session identity keyed by `projectId::laneId`
- persists session metadata in Electron user data
- tracks session lifecycle as:
  - `active`
  - `backgroundWarm`
  - `backgroundFrozen`
  - `closed`
- exposes:
  - ensure
  - activate
  - background
  - close
  - list
  - pin/unpin
- stores session-owned terminal bindings by workbench tile id
- includes dev-server status in session snapshots
- emits state changes back to the renderer over a dedicated IPC event

Important scope note:

- session metadata is persisted
- live terminal ids are not treated as durable across app restarts
- that means a restarted app restores the session model, but terminal PTYs are recreated when needed

#### 2. Shared Contract + Preload Bridge

Updated:

- `shared/electronApiTypes.ts`
- `electron/preload.ts`

What changed:

- added `WorkbenchSessionSnapshot`
- added `WorkbenchSessionLifecycle`
- added `workbenchSession` methods on `window.electronAPI`
- added terminal snapshot retrieval through `terminal.getSnapshot`

This gives the renderer a formal session API instead of relying on route cleanup side effects.

#### 3. Workbench Route Lifecycle

Added:

- `src/features/projects/hooks/useWorkbenchSessionLifecycle.ts`

Updated:

- `src/features/projects/pages/ProjectWorkbenchPage.tsx`

What changed:

- opening a workbench now ensures and activates a real session
- leaving the workbench backgrounds the session instead of closing it
- the page root now exposes session identity and lifecycle as data attributes for easier debugging

This is the renderer entrypoint for the new lifecycle model.

#### 4. Route-Unmount Teardown Removed

Updated:

- `src/features/projects/layouts/ProjectLayout.tsx`

Removed behavior:

- stop dev server on project-shell unmount
- list project terminals on unmount
- kill all project terminals on unmount
- clear renderer terminal state on unmount

This is the single biggest behavioral correction in the sweep.

The app no longer equates:

- route disappearance

with:

- runtime teardown

#### 5. Terminal Tiles Are Now Session-Owned

Updated:

- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- `src/features/projects/components/workbench/WorkbenchTerminalTile.tsx`

What changed:

- each terminal tile now binds to a session-owned terminal id using:
  - `projectId`
  - `laneId`
  - `tileId`
- the tile first tries to reattach to an existing bound terminal
- if no live terminal exists, it creates one and binds it to the session
- unmounting the tile no longer kills the PTY

This means:

- switching away from a workbench preserves the terminal process
- reopening the same workbench and tile reattaches to the same terminal
- multiple terminal tiles can still map to distinct PTYs because bindings are stored per tile id, not just per session

#### 6. Terminal Rehydration + Reduced Hidden Work

Updated:

- `src/stores/useTerminalStore.ts`
- `src/features/projects/components/TerminalEventBridge.tsx`

What changed:

- terminals now track `uiAttached`
- hidden or detached terminal UIs stop appending every output chunk into visible renderer buffers
- terminal output is rehydrated from a main-process terminal snapshot when the tile reattaches

This matters because a kept-alive PTY is only useful if the user gets their context back when returning.

The new behavior is:

- PTY keeps running
- hidden terminal UI stops doing heavy visible work
- the latest terminal transcript is restored when the tile comes back

#### 7. Explicit Terminal Panel Removal Cleans Up

Updated:

- `src/features/projects/hooks/useWorkbenchDockviewRuntime.ts`

What changed:

- explicit terminal panel removal now releases the session terminal binding
- explicit panel close also kills the bound PTY for that tile
- route/dock disposal is guarded so workbench destruction does not get mistaken for intentional terminal close

This distinction is critical:

- route switch should background
- explicit terminal close should close

#### 8. Terminal Service Improvements

Updated:

- `electron/services/TerminalService.ts`

What changed:

- added public terminal existence checks
- added public terminal kill helper
- added public project terminal listing helper
- exposed terminal snapshots over IPC
- centralized terminal kill logic
- made kill paths clear activity poll timers correctly

These changes support the new session manager and rehydration behavior.

#### 9. Dev-Server State Exposure

Updated:

- `electron/services/DevServerService.ts`

What changed:

- added a lightweight runtime state accessor

This lets session snapshots report:

- whether a dev server is running
- current port
- run id

This runtime state is now consumed by the rebuilt dev-server tile rather than existing only as hidden plumbing.

#### 10. Browser And Dev-Server Tiles Reintroduced

Updated:

- `src/stores/useProjectWorkbenchStore.ts`
- `src/features/projects/lib/workbenchDockview.ts`
- `src/features/projects/components/workbench/WorkbenchSelectionTile.tsx`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- `src/features/projects/hooks/useWorkbenchDockviewRuntime.ts`

What changed:

- `browser` and `devServer` tile types are back in the workbench store
- the tile picker can create browser and dev-server tiles again
- Dockview can resolve and render those panels again
- dev-server is reopened as a singleton workbench surface
- browser/dev-server panels now participate in the same session-aware attach/detach behavior as terminals

Important lifecycle behavior:

- route switches background the session instead of destroying these tiles
- explicit panel removal still performs explicit cleanup
- persisted layouts can bring these tiles back cleanly

#### 11. Browser Runtime Now Follows The VS Code `browserView` Pattern

Added or restored:

- `src/features/projects/browser/browserTileModel.ts`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`

Updated:

- `electron/services/WorkbenchBrowserService.ts`
- `shared/electronApiTypes.ts`
- `electron/preload.ts`

What changed:

- the browser surface is now model-based instead of directly treating the React component as the owner of the `WebContentsView`
- each browser tile has a stable id and a long-lived model
- the model proxies all browser actions to the Electron main process
- the React hook is just the host/controller that:
  - attaches to the persistent model
  - syncs bounds and visibility
  - renders omnibar/find/devtools chrome
  - opens additional pages as new workbench browser tiles
- browser state is preserved in the main process even when the workbench UI detaches

This mirrors the most useful parts of VS Code's newer browser stack:

- `browserView/common/browserView.ts`
  - model contract over a main-process browser service
- `browserView/electron-browser/browserViewWorkbenchService.ts`
  - cached workbench-level model registry
- `browserView/common/browserEditorInput.ts`
  - stable browser identity with UI state derived from model state
- `browserView/electron-browser/browserEditor.ts`
  - editor chrome as a shell over the browser model

What we copied conceptually, not mechanically:

- stable browser/page identity
- model and service separation
- workbench-side cached model reuse
- main-process browser ownership
- UI chrome as a separate layer from browser state ownership
- support for workspace/global/ephemeral storage semantics

What we intentionally did not copy:

- VS Code editor-group/editor-input abstractions
- VS Code menu/action contribution system
- all CDP/automation hooks

We translated the pattern into Cozea's workbench/tile architecture instead.

#### 11a. Browser URL Submission Blank-Page Regression Fixed

Updated:

- `src/features/projects/browser/browserTileModel.ts`

What was happening:

- typing a URL into the browser omnibar could update persisted workbench tile state without actually navigating the live `WebContentsView`
- the visible result was a blank browser surface until a later refresh or full reopen
- this was especially confusing because the workbench tile would already show the new URL and sometimes even the new title after persistence/hydration, while the backing browser service still reported the old or empty page state

Root cause:

- `BrowserTileModel.initialize(...)` was treating `options.initialUrl` as if it had already been requested whenever the model was already initialized
- that advanced `lastRequestedUrl` before `loadURL(...)` had a chance to call `workbenchBrowser:navigate`
- once `loadURL(...)` saw the same `lastRequestedUrl`, it incorrectly skipped the real navigation call

What changed:

- the model now rehydrates `lastRequestedUrl` from the actual browser service state when reattaching to an existing tile
- `loadURL(...)` now only skips navigation when both of these are already true:
  - the last requested URL matches
  - the current browser state URL matches and there is no load error

Why this matters:

- persisted tile state can no longer get ahead of the actual `WebContentsView`
- changing the URL on an already-open browser tile now navigates immediately
- browser reattachment remains cheap, but it no longer suppresses required first navigations after session reuse or renderer reload

Live verification after the fix:

- changing an already-open browser tile from `https://www.google.com/` to `example.com` updated:
  - persisted workbench tile URL
  - browser service state URL
  - browser title
  - visible browser content
- no manual refresh was required

#### 12. Dev-Server Tile Is Now A Browser-Or-Native Surface

Added or restored:

- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`

Updated:

- `src/hooks/useDevServerManager.ts`
- `src/features/projects/hooks/useIosNativePreview.ts`
- `src/stores/useNativePreviewStore.ts`

What changed:

- the dev-server tile now treats preview as a destination surface, not a single hardcoded view
- for web projects, the tile embeds a browser surface using the same `useWorkbenchBrowserView` host pattern as the standalone browser tile
- for native/mobile flows, the tile can use the iOS simulator viewport instead of the embedded browser
- logs remain part of the dev-server tile and can be toggled beside preview
- dev-server state can resume from a session snapshot instead of assuming a cold start on every remount

This gives the dev-server tile the right shape:

- it is derived from the browser surface for web previews
- it is allowed to switch to native simulator presentation when the project/framework requires it
- it keeps dev-server runtime alive across workbench switching

#### 12a. Dev-Server Runtime Now Uses The Same PTY Terminal Stack

Updated:

- `electron/services/DevServerService.ts`
- `electron/services/TerminalService.ts`
- `src/hooks/useDevServerManager.ts`
- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`
- `src/features/projects/hooks/useWorkbenchDockviewRuntime.ts`
- `electron/ipc/registerDevServerHandlers.ts`
- `shared/electronApiTypes.ts`

What changed:

- the dev-server runner no longer spawns a separate `execa` process path with a plain-text log buffer as its primary UI
- each dev-server tile now binds to a real session-owned PTY terminal using the same workbench terminal infrastructure as the standalone terminal tile
- the dev-server tile `Code` tab now renders `TerminalInstance` instead of a `<pre>` log view
- stopping the dev server now sends `Ctrl+C` into that PTY-backed shell instead of treating the dev server as a separate detached process
- explicitly removing the dev-server tile now releases:
  - its browser surface
  - its native preview session
  - its bound PTY terminal

Why this matters:

- there is no longer a second-class dev-server terminal implementation
- the user sees exactly the real shell session that started the dev server
- terminal history, PTY behavior, key handling, link detection, GPU-backed xterm rendering, and session reattachment now all come from the same terminal stack
- the dev-server tile no longer has to maintain a fake "logs" surface that diverges from the real terminal

#### 12b. Dev-Server Readiness Is Now Main-Process-Owned

Updated:

- `electron/services/DevServerService.ts`
- `src/hooks/useDevServerManager.ts`

What changed:

- the main process now owns dev-server readiness detection
- the renderer no longer starts a second URL probe loop after `devServer:start` resolves
- successful `devServer:start` now means:
  - the command was sent to the PTY shell
  - candidate localhost ports were observed
  - the chosen preview port responded as ready

Root problem before this change:

- the main process considered the dev server "started" based on one set of checks
- the renderer then ran a second readiness/probe pipeline
- session snapshots could also seed a third "already ready" interpretation

That split responsibility created status drift and odd cycles:

- starting but not really ready
- ready in one layer and unhealthy in another
- preview state lagging behind the actual shell session

The new contract is simpler:

- main process owns start, stop, port discovery, and readiness
- renderer reflects that state and renders the PTY + preview surfaces

This is a much better fit for a local Electron app because the runtime authority stays close to the actual process and socket state.

#### 13. Native Preview Is Now Session-Aware Instead Of Globally Ephemeral

Updated:

- `src/stores/useNativePreviewStore.ts`
- `src/features/projects/hooks/useIosNativePreview.ts`
- `electron/services/WorkbenchSessionManager.ts`

What changed:

- native preview state is now scoped by session key instead of being one global singleton bucket
- the session manager can remember which native preview session belongs to which workbench session
- hiding the workbench no longer implies that the native preview runtime must die
- explicit session close can still stop the native preview session

#### 14. Terminal And Dev-Server Output Is Now Batched Before It Hits The Renderer

Added:

- `electron/lib/ipcOutputBatcher.ts`

Updated:

- `electron/services/TerminalService.ts`
- `electron/ipc/registerDevServerHandlers.ts`
- `src/features/projects/components/TerminalEventBridge.tsx`
- `src/hooks/useDevServerManager.ts`

What changed:

- terminal output is no longer sent as one tiny IPC event per PTY chunk
- dev-server output is no longer sent as one tiny IPC event per process chunk
- both streams are now coalesced per destination and logical stream key before being sent to the renderer
- terminal store updates now run inside `startTransition`
- dev-server output state is now kept as one capped transcript string instead of an ever-growing array of chunks
- dev-server output timeline entries are now throttled instead of emitting one activity item for every flush

Why this matters:

- fewer IPC events
- fewer React/store updates
- lower renderer churn under chatty output
- much better behavior when multiple warm sessions are alive

#### 15. Session Manager Now Enforces Idle And Memory-Pressure Policy

Updated:

- `electron/services/WorkbenchSessionManager.ts`

What changed:

- a periodic policy sweep now runs in the Electron main process
- unpinned `backgroundWarm` sessions now age into `backgroundFrozen`
- frozen sessions can now trim ephemeral browser surfaces automatically
- unpinned frozen sessions can now stop background dev servers after long idle time
- low-memory conditions now accelerate freezing and trimming behavior

This is the first real resource policy in the workbench.

It means the app is no longer relying only on implicit route behavior or manual close actions to control background cost.

#### 16. Hidden Panels Now Actually Reduce Work

Added:

- `src/features/projects/components/workbench/useWorkbenchPanelActivityMode.ts`

Updated:

- `src/features/projects/components/workbench/WorkbenchTerminalTile.tsx`
- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`
- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`

What changed:

- panel activity is now tracked per workbench tile
- terminals now detach their UI when their panel is inactive instead of behaving like a fully live foreground surface
- browser surfaces now receive an explicit `visible` signal based on panel activity, not only on URL state
- hidden browser panels now stop overlay and bounds observers instead of continuing background renderer bookkeeping
- dev-server preview and log surfaces now use React `Activity` boundaries to suspend hidden panel work
- dev-server log rendering now uses deferred transcript consumption instead of eagerly re-rendering every output flush

This is the key renderer-side half of the optimization story:

- keep runtime alive
- stop hidden UI work

### Verification

Completed in this sweep:

- `bun run typecheck`
- `bun run lint`
- `bun run build`

Observed:

- typecheck passed
- lint passed with warnings only
- build passed end-to-end

Build notes:

- the renderer build still emits the pre-existing warning in `src/hooks/useLocalStorage.ts` about `parseJson` from `effect/Schema`
- the full build also emits existing Vite chunk-splitting warnings for some route/settings modules
- those warnings predate the session-lifecycle sweep and are not introduced by this work

### Important Behavioral Changes After This Sweep

The workbench now behaves differently in several important ways:

- leaving the workbench no longer kills project terminals
- leaving the workbench no longer stops the project dev server automatically
- terminal lifetime is now tied to workbench session + tile identity
- hidden terminal UIs do less renderer work
- reopening a workbench tile restores the terminal transcript from the main process

### Remaining Gaps After This Sweep

This is no longer missing the browser and dev-server surfaces.

What remains is narrower and mostly performance-hardening:

- message-port transport as a future escalation if batched IPC still proves insufficient under very heavy stream load
- optional `utilityProcess` offloading for future CPU-heavy background work that does not exist on a hot path today
- deeper browser pooling/warm-snapshot policy if many long-lived non-ephemeral browser tabs are opened at once

In other words:

- session lifecycle is now real
- browser/dev-server surfaces are back
- stream transport is batched
- idle and pressure policy is real
- hidden panels now actually back off
- the next phase is refinement, not first implementation

## The Core Problem

Today the app still treats route unmount as runtime teardown.

The clearest example is in:

- `src/features/projects/layouts/ProjectLayout.tsx`

That layout currently does all of this when the project shell unmounts:

- stops the dev server for the project path
- lists all terminals for the project path
- kills them all
- clears renderer terminal state for the project path

That behavior is simple, but it is wrong for the product we now want.

It causes:

- cold restarts when switching back to a project
- broken multitasking across projects
- unnecessary terminal churn
- dev-server churn
- avoidable renderer work
- a general feeling that the app is "heavy" when navigating

In other words:

- route lifetime and session lifetime are still coupled

They need to be separated.

## What We Learned From `t3code`

We studied `/Users/admin/Downloads/t3code` as a local reference implementation for session behavior.

Important takeaways:

### 1. It Keeps Route-Level UI Warm Across Switches

`apps/web/src/routes/_chat.$threadId.tsx` explicitly notes that the route stays warm across thread switches unless remount behavior is configured otherwise.

That is a strong signal that route changes should not automatically destroy the underlying session.

### 2. Terminal UI State Is Persistent And Keyed By Session Identity

`apps/web/src/terminalStateStore.ts` stores terminal UI state by `threadId`, including:

- whether the terminal is open
- active terminal id
- active terminal group
- running terminal ids
- layout state

That means the terminal is treated as part of a long-lived session model, not as a disposable route child.

### 3. Runtime Sessions Are Owned By A Manager, Not React

`apps/server/src/codexAppServerManager.ts` keeps a session map keyed by `ThreadId`.

That means:

- runtime ownership lives in a service layer
- React attaches to it
- React does not define its lifecycle

### 4. Terminal Lifecycle Is Explicit

`apps/server/src/terminal/Services/Manager.ts` defines terminal `open`, `write`, `resize`, `restart`, and `close`.

Its contract makes reuse explicit:

- `open` can attach to an existing session
- `close` is a deliberate action

That is much closer to the model we want.

## What We Learned From VS Code `browserView`

We also studied `/Users/admin/Downloads/vscode`, specifically the newer `browserView` workbench implementation rather than the older simple-browser extension.

Important reference files:

- `src/vs/workbench/contrib/browserView/common/browserView.ts`
- `src/vs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService.ts`
- `src/vs/workbench/contrib/browserView/common/browserEditorInput.ts`
- `src/vs/workbench/contrib/browserView/electron-browser/browserEditor.ts`

Important takeaways:

### 1. Stable Browser Identity Matters

VS Code does not treat the browser as "whatever DOM node is mounted right now."

It gives each browser page a stable id and lets the UI reconnect to the same underlying browser state through that id.

That is exactly the right model for our workbench tiles.

### 2. The Browser Model Should Proxy To Main Process Ownership

VS Code's workbench-side browser model is not the browser itself.

It is a model/controller that proxies to the main-process browser service.

That matches Electron reality better:

- `WebContentsView` lives in the main process
- React should drive layout, focus, and chrome
- React should not pretend to own the browser process lifecycle

### 3. UI Chrome And Browser Lifetime Should Be Separate

VS Code keeps URL bar/find/actions/editor chrome separate from browser state ownership.

That is useful because it lets the browser view remain durable while the presentation shell changes or temporarily disappears.

This is also what we want for:

- background workbench sessions
- route switches
- future browser tile redesigns
- dev-server previews that reuse the same browser host pattern

### 4. Storage Scope Should Be Explicit

VS Code treats browser session storage as an explicit decision.

That is a good fit for us too:

- workspace-scoped browser state for project/workbench browsing
- global-scoped browser state when a shared global session makes sense
- ephemeral browser state for transient preview surfaces such as dev-server embeds

### 5. The Dev-Server Surface Should Reuse Browser Infrastructure

The best lesson is not "make a separate dev-server iframe system."

It is:

- build one browser surface correctly
- let the dev-server preview consume that surface when preview mode is web
- swap to native simulator presentation only when preview mode is native

That is the exact direction implemented in this branch.

## Decision Record

### Decision 1: Workbench Lifecycle Must Be Session-Based

The canonical runtime identity must become:

- `projectId + laneId`

The workbench route must attach to a session, not create or destroy the session by itself.

### Decision 2: Switching Workbenches Must Not Kill All Terminals

We should not kill all terminals on switch.

More specifically:

- switching from one project workbench to another should normally keep terminals alive
- switching from one lane to another should normally keep terminals alive
- hiding a terminal UI should not kill the PTY
- an explicit close action should kill the PTY

### Decision 3: Dev Servers Follow The Same Rule As Terminals

Switching away from a workbench should not stop its dev server by default.

The dev server should be owned by the session and be background-capable.

### Decision 4: UI Freezes Before Processes Die

When backgrounding a session, the order should be:

1. detach or hide heavy UI
2. reduce subscriptions and rendering
3. reduce event fanout
4. only kill processes when policy says the session is closed or evicted

### Decision 5: Native Simulator Code Stays

Native simulator and native preview support are not part of this cleanup and must remain supported.

The simulator viewport may detach when a session is hidden, but the runtime should remain session-aware.

### Decision 6: Browser And Dev-Server Tiles Must Be Rebuilt On Top Of The Session Model

The next browser/dev-server implementation should be a thin view layer over a session manager, not the owner of runtime lifecycle.

## Goals

- make workbench switching feel instant or near-instant
- support multiple recently-used workbenches without app-wide chugging
- preserve terminals across switches
- preserve dev servers across switches
- keep browser tiles isolated without making the window heavy
- preserve native simulator workflows
- allow background sessions to exist without fully rendering them
- avoid global renderer jank from streaming output or hidden views
- make explicit close different from simple navigation

## Non-Goals

- rewriting the router
- removing the lane model
- removing native preview or simulator support
- making every tile its own fully independent app
- keeping every session fully live forever regardless of resource cost

## Current Architecture Inventory

### Renderer-Side Session-Like State

Current useful pieces:

- `src/stores/useProjectWorkbenchStore.ts`
  - persists workbench tiles and serialized Dockview layout
  - scopes state by `projectId::laneId`
- `src/features/projects/hooks/useProjectLaneState.ts`
  - already caches lane state by `projectId::collabBranch`
- `src/features/projects/hooks/useWorkbenchDockviewRuntime.ts`
  - owns the Dockview shell and panel resolution

What this means:

- the renderer already has the beginnings of a lane-scoped workbench identity
- but runtime lifecycle is still not owned there in a coherent way

### Main-Process Lane Metadata

Current useful piece:

- `electron/projectLaneRegistry.ts`

What it does today:

- tracks lanes for a project
- tracks active lane id
- stores lane descriptors and project paths

What it does not do:

- own process lifecycle
- track warm vs frozen state
- control resource policy

### Shared Assistant Runtime

Current useful pieces:

- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`
- `src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts`

What this means:

- the assistant side is already much closer to the desired architecture
- the runtime exists independently of a single workbench mount
- the UI is already more of an attach/detach subscriber

### Terminal Ownership

Current useful pieces:

- `electron/services/TerminalService.ts`
- `src/stores/useTerminalStore.ts`

What they do today:

- `TerminalService` owns PTY processes and project-to-terminal mappings
- `useTerminalStore` owns renderer-side terminal panel state and output buffers

Main issue:

- route unmount currently triggers project-wide teardown from the layout layer

### Dev Server Ownership

Current useful pieces:

- `electron/ipc/registerDevServerHandlers.ts`
- `electron/services/DevServerService.ts`

What they do today:

- own per-project-path dev server start/stop
- stream output to the renderer

Main issue:

- they are still treated as something that should die when the project shell disappears

### Browser Infrastructure

Current useful pieces:

- `electron/services/WorkbenchBrowserService.ts`
- `electron/ipc/registerWorkbenchBrowserHandlers.ts`
- `src/features/projects/browser/browserTileModel.ts`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`
- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`

What this means:

- the browser runtime foundation exists and is now back on the active workbench path
- it uses `WebContentsView`
- it has a stable model layer in the renderer
- it now follows a VS Code-like service/model split
- the dev-server preview can reuse the same browser surface instead of maintaining a totally separate browser stack

Main issue:

- it still has room for further resource policy and output-streaming optimization, but it is now session-aware rather than route-owned

## Architecture Principles

### Principle 1: Session Lifetime Is Not Route Lifetime

Routes render views.

Sessions own runtime.

### Principle 2: Hidden Does Not Mean Closed

The product needs at least three distinct concepts:

- visible and active
- hidden but resumable
- closed and torn down

### Principle 3: Preserve Expensive Runtime, Drop Expensive UI

The expensive things to cold-start repeatedly are:

- PTYs
- dev servers
- browser processes and authenticated sessions
- native simulator state

The expensive things to keep painting unnecessarily are:

- xterm instances
- hidden web contents
- heavy timelines
- background subscriptions

We should preserve the first set and aggressively reduce the second set.

### Principle 4: Resource Policy Must Be Explicit

If the app is slow, it should be because we chose the wrong policy, not because lifecycle is implicit and accidental.

### Principle 5: Rebuild New Tiles On A Stable Runtime Contract

Browser and dev-server tiles should become views over session state, not private systems with their own hidden lifecycle assumptions.

## Proposed Session Model

Each workbench session is keyed by:

- `sessionKey = projectId::laneId`

Each session also has:

- current resolved project path
- creation timestamp
- last-focused timestamp
- optional pinned flag
- lifecycle state
- runtime ownership handles

## Lifecycle States

We should define four states.

### 1. `active`

The session currently has visible UI and user focus.

Expected behavior:

- workbench UI visible
- terminal UI mounted
- browser view visible
- dev server available
- assistant subscriptions active
- presence active
- current route/file reporting active
- native simulator viewport attached if in use

### 2. `backgroundWarm`

The session is not the focused workbench, but it remains quickly resumable.

Expected behavior:

- layout and internal state preserved
- terminals keep running
- dev server keeps running
- browser session may remain loaded but not visible
- assistant jobs continue
- presence is off
- heavy UI rendering is detached or hidden
- event fanout is reduced

### 3. `backgroundFrozen`

The session is preserved, but its UI and hot runtime integrations are mostly detached.

Expected behavior:

- no mounted workbench UI subtree
- terminal PTYs may remain alive
- terminal output is buffered, not fully streamed to visible UI
- dev server may remain alive if pinned or recently active
- browser views are detached, snapshotted, or pooled
- assistant jobs may continue
- presence is off
- native simulator UI detached, runtime preserved if needed

### 4. `closed`

The session is intentionally torn down.

Expected behavior:

- terminals killed
- dev server stopped
- browser view disposed or returned to pool
- session-specific subscriptions removed
- only persisted metadata remains

## State Matrix

| Subsystem | active | backgroundWarm | backgroundFrozen | closed |
| --- | --- | --- | --- | --- |
| PTY process | running | running | running or policy-paused | killed |
| xterm instance | mounted | hidden or detached | unmounted | none |
| terminal output stream to renderer | live | batched | buffered only | none |
| dev server process | running | running | running if pinned/recent | stopped |
| dev server log UI | live | detached | detached | none |
| browser `WebContentsView` | visible | hidden or pooled | detached/snapshotted | disposed |
| browser session/cookies | available | available | available | available if partition persisted |
| assistant orchestration | live | live | live if needed | ended only when explicit |
| assistant UI subscriptions | live | reduced | detached | none |
| collaboration presence | live | off | off | off |
| native simulator runtime | live | live if launched | preserved if policy says so | stopped |
| Dockview layout state | live | preserved | preserved | persisted only |

## Terminal Policy

This section answers the direct product question.

### We Should Not Kill All Terminals On Switch

That would be the wrong default.

The correct default is:

- keep terminals alive across switches
- freeze terminal UI before killing terminal processes
- only kill terminals on explicit close or resource eviction

### Recommended Terminal Rules

#### When switching between workbenches

- keep PTYs alive
- keep terminal ids stable
- detach or hide `xterm` DOM
- stop expensive reflow/repaint work
- batch output while hidden

#### When switching between lanes

- keep the previous lane session warm unless evicted
- do not clear output or history
- allow immediate reattach if the user returns

#### When the user explicitly closes a workbench session

- kill session-owned PTYs
- clear transient terminal UI state
- keep only persisted history if we decide to expose that

#### When the app is under memory or CPU pressure

- demote old sessions from `backgroundWarm` to `backgroundFrozen`
- only kill terminals as a last step
- prefer evicting unpinned sessions first

### Why This Matters

Terminal cold start cost is not just process creation.

It also includes:

- restoring cwd
- restoring the user’s mental context
- losing long-running scripts
- losing server logs
- breaking flow

That cost is much higher than the cost of keeping a quiet PTY alive in the background.

## Dev Server Policy

Dev servers should follow almost the same rules as terminals.

### Default Behavior

- do not stop the dev server on route switch
- keep it tied to the session
- surface its status in the session shell even when the tile is closed

### Warm Behavior

In `backgroundWarm`:

- keep the process running
- keep the current port and URL
- keep logs available
- stop rendering the heavy log UI if not visible

### Frozen Behavior

In `backgroundFrozen`:

- keep the process alive if the session is pinned or recently active
- otherwise allow policy-based stop after an idle timeout
- preserve last-known status and URL

### Close Behavior

In `closed`:

- stop the process
- clear active log stream bindings

## Browser Tile Rebuild Direction

The browser tile was removed from the renderer workbench path, but the Electron service remains.

That is good.

It means the rebuild can be cleaner.

### Core Browser Direction

Rebuild browser panels as session-owned views on top of:

- `electron/services/WorkbenchBrowserService.ts`

But change the runtime contract so that:

- the session manager decides whether a browser surface is visible, warm, frozen, or closed
- the tile becomes a renderer adapter over session-controlled browser records

### Browser Pooling

We should not assume one permanently-live browser view per potential tab.

Recommended approach:

- one visible `WebContentsView` per visible browser tile
- optionally one hidden warm view per active session
- snapshot or placeholder for non-visible browser surfaces
- pooled reuse for views that are reopened frequently

### Browser Session Persistence

Current `WorkbenchBrowserService` already supports partitions for:

- global
- workspace
- ephemeral

That is useful and should remain.

### Important Electron Rule

Do not disable `backgroundThrottling` for hidden browser contents in the main window.

Electron documents that if one displayed `webContents` in a window disables background throttling, the whole window can keep drawing and swapping frames.

That is exactly the kind of invisible cost that makes an app feel heavy.

### Browser Close Rule

Closing a browser tile should not necessarily close the whole session.

It should:

- close the tile view
- optionally release its `WebContentsView`
- preserve session-owned browser context if policy says so

## Native Simulator Policy

Native simulator-related code stays in scope for the future workbench.

Relevant preserved areas include:

- `src/features/projects/hooks/useIosNativePreview.ts`
- `src/features/projects/components/previews/IosSimulatorViewport.tsx`
- `electron/ipc/registerNativePreviewHandlers.ts`
- `electron/services/nativePreview/NativePreviewManager.ts`

### Native Simulator Direction

The simulator should behave like a session-owned surface.

That means:

- if the user explicitly launched a simulator for a session, we should prefer preserving it when backgrounding
- the viewport can detach when not visible
- simulator runtime should only be stopped on explicit close or policy eviction

## Assistant Policy

The assistant side already points in the right direction.

Relevant files:

- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`
- `src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts`

### Decision

Do not regress assistant runtime ownership back toward route-local lifecycle.

Instead:

- keep orchestration shared and long-lived
- let workbench sessions attach and detach UI subscriptions
- reduce hidden UI work rather than killing the runtime

## Collaboration Presence Policy

Presence should be tied to foreground activity, not mere session existence.

### Active Session

- active file and route reporting on
- presence visible to collaborators

### Warm Or Frozen Background Session

- presence off
- no active file or route reporting
- no need to pretend the user is "present" in multiple workbenches at once

## Recommended Technologies

These are the technologies that best fit this app and this problem.

### 1. React `<Activity>`

Use React 19 `Activity` boundaries to hide background workbench UI while preserving state and cleaning up effects.

Why it fits:

- preserves internal React state
- hides DOM
- tears down effects while hidden
- lets us keep session runtime alive without keeping UI subscriptions hot

Best use cases:

- inactive workbench panels
- inactive sidebars
- hidden but likely-to-return assistant subtrees

### 2. `startTransition` And `useDeferredValue`

Use these for:

- workbench switches
- lane switches
- heavy filters
- layout restoration
- large changes feeds

Why:

- keeps shell interactions responsive
- defers heavy visual updates

### 3. Virtualization

We already ship:

- `@tanstack/react-virtual`
- `react-virtuoso`

Use them aggressively for:

- changes feeds
- tasks lists
- logs
- command lists
- search results
- any rebuilt browser history or tab history lists

### 4. `MessageChannelMain` / Message Ports

Terminal and dev-server streaming should move away from lots of tiny ordinary IPC events where possible.

Right now output goes through:

- `terminal:output`
- `devServer:output`

That is workable, but it is not ideal for very chatty streams.

Message ports would let us:

- isolate stream channels
- reduce renderer overhead
- batch more intentionally

Current branch status:

- we implemented batched IPC transport first because it is lower risk and immediately effective
- message ports remain available as the next escalation step rather than a mandatory first step

### 5. `utilityProcess`

Good use cases:

- diff summarization
- log parsing
- preview capture prep
- artifact indexing
- metadata scans
- expensive session snapshot preparation

This keeps heavy work out of:

- the renderer
- the Electron main process

Current branch status:

- this branch does not add a utility process yet
- that was intentional, because after batching stream transport and hiding inactive surfaces there is no current hot CPU path that justifies the additional process complexity
- the right trigger for utility-process work should be a measured heavy task, not adding another process purely on principle

### 6. `WebContentsView` Pooling

We should continue using `WebContentsView` for the rebuilt browser tile.

But we should use it with:

- pooling
- visibility-aware attachment
- strict lifecycle rules

Not as a permanently-live surface for every possible browser tile.

### 7. xterm Lifecycle Optimization

Current terminal UI in `src/features/projects/components/TerminalInstance.tsx` is already set up for a decent terminal surface.

The next improvement is lifecycle policy:

- do not mount hidden xterms unnecessarily
- keep PTYs alive
- restore and fit only when visible
- prefer buffered output over background reflow

## Proposed Main-Process Architecture

We should add:

- `electron/services/WorkbenchSessionManager.ts`

This should become the canonical owner of workbench runtime lifecycle.

### Responsibilities

- create or attach to a session
- activate a session
- background a session
- freeze a session
- close a session
- enforce resource policy
- own session metadata
- coordinate terminal, dev server, browser, and native simulator runtime state

### Suggested Core Shape

```ts
interface WorkbenchSessionKey {
  projectId: string
  laneId: string
}

type WorkbenchSessionLifecycle =
  | "active"
  | "backgroundWarm"
  | "backgroundFrozen"
  | "closed"

interface WorkbenchSessionSnapshot {
  key: string
  projectId: string
  laneId: string
  projectPath: string | null
  lifecycle: WorkbenchSessionLifecycle
  pinned: boolean
  lastFocusedAt: number
  openedAt: number
  terminalIds: string[]
  devServerRunning: boolean
  devServerUrl: string | null
  hasBrowserSurface: boolean
  hasNativePreview: boolean
}
```

### Suggested Commands

```ts
interface WorkbenchSessionManagerShape {
  ensureSession(input: { projectId: string; laneId: string; projectPath?: string | null }): Promise<WorkbenchSessionSnapshot>
  activateSession(input: { projectId: string; laneId: string }): Promise<WorkbenchSessionSnapshot>
  backgroundSession(input: { projectId: string; laneId: string; mode?: "warm" | "frozen" }): Promise<WorkbenchSessionSnapshot>
  closeSession(input: { projectId: string; laneId: string }): Promise<void>
  setPinned(input: { projectId: string; laneId: string; pinned: boolean }): Promise<void>
  listSessions(): Promise<WorkbenchSessionSnapshot[]>
}
```

## Ownership Boundaries

### Session Manager Owns

- lifecycle transitions
- session metadata
- resource policy
- terminal attachment policy
- dev-server retention policy
- browser visibility/attachment policy
- simulator retention policy

### Terminal Service Owns

- PTY spawn
- PTY kill
- PTY input/output
- terminal history

But:

- it should become session-aware instead of only project-path-aware

### Dev Server Service Owns

- process start/stop
- current port/url
- output stream

But:

- it should become session-aware instead of only route-aware

### Browser Service Owns

- `WebContentsView` creation
- navigation
- browser state
- session partitioning

But:

- the session manager should decide visibility and retention

### Renderer Owns

- layout
- visible panels
- focus state
- attachment to session streams
- UI restoration

But:

- renderer should not be the authority that destroys the runtime

## Renderer Changes

### Remove Route-Unmount Teardown

The current unmount cleanup in `src/features/projects/layouts/ProjectLayout.tsx` should be removed or reduced to session detach behavior.

It should no longer:

- stop the dev server directly
- kill all terminals for the project path
- clear terminal state as if the runtime died

### Introduce A Session Hook

Add something like:

- `src/features/projects/hooks/useWorkbenchSession.ts`

Responsibilities:

- ensure the session exists
- activate when the workbench is focused
- background when leaving the workbench
- subscribe to a lightweight session snapshot

### Keep Workbench Store Focused On UI

`src/stores/useProjectWorkbenchStore.ts` should remain focused on:

- tile metadata
- layout
- active tile
- assistant tile metadata

It should not become the owner of process lifecycle.

## Persistence Model

We should persist two different things separately.

### 1. UI Persistence

Current place:

- `src/stores/useProjectWorkbenchStore.ts`

Keep persisting:

- Dockview layout
- tile list
- active tile id
- assistant tile metadata

### 2. Runtime Session Persistence

New location:

- session manager persistence in Electron

Persist:

- pinned flag
- last-focused timestamp
- last-known lifecycle
- last-known project path
- maybe last-known dev-server url

Do not persist:

- raw PTY handles
- live browser view objects
- ephemeral event subscriptions

## Resource Policy

We need explicit limits.

### Recommended Default Policy

- 1 active session
- up to 2 backgroundWarm sessions
- older sessions become backgroundFrozen
- unpinned frozen sessions become eligible for eviction after idle timeout

### Recommended Idle Policy

- warm session stays warm for a short recent-use window
- frozen unpinned session may stop dev server after longer idle window
- terminals are killed only on explicit close or hard eviction

### Pinning

Pinned sessions should:

- resist eviction
- keep dev server alive
- keep browser context available
- be the default for sessions with long-running work

## Streaming And Backpressure

One of the easiest ways to make an Electron app feel sluggish is to stream too much output too eagerly into the renderer.

That risk exists today for:

- terminals
- dev-server logs
- diagnostics

### Recommended Policy

#### Active session

- stream live
- render live

#### Warm session

- stream batched
- avoid per-line expensive UI work if the terminal is hidden

#### Frozen session

- keep buffering in main process or compact session buffer
- do not push every chunk into invisible React trees

## Browser/Preview Snapshot Strategy

We already have a useful pattern in:

- `electron/services/PreviewSnapshotService.ts`

Even though it is not the future browser tile, it proves a useful idea:

- background visual capture can happen in an offscreen worker window
- previewed state can be represented without keeping a visible live surface mounted all the time

We should use the same general idea for rebuilt browser/session UX:

- visible sessions get a live surface
- hidden sessions can fall back to cached visual state

## Failure And Recovery

### Session Recovery

If the renderer reloads:

- sessions should still exist in Electron
- renderer should reattach to them
- visible workbench state should restore without cold-starting everything

### Crash Recovery

If a terminal or dev server exits unexpectedly:

- session remains alive
- tile shows exited state
- user can restart without rebuilding the whole workbench session

### Path Changes

If a lane worktree path changes:

- session manager should update the path binding
- session key should remain `projectId::laneId`
- runtime restarts should happen only if the new path requires them

## Telemetry And Diagnostics

We should measure whether this architecture is actually better.

Track at minimum:

- session activation time
- session reattach time
- number of warm sessions
- number of frozen sessions
- terminal output throughput
- dev-server log throughput
- browser surface count
- renderer frame drops during switches
- memory usage before and after session backgrounding

## Implementation Plan

### Phase 1: Session Foundations

- add `WorkbenchSessionManager` in Electron
- define session snapshot types
- define session IPC surface
- add minimal persistence for session metadata

### Phase 2: Stop Treating Unmount As Close

- remove route-based teardown in `ProjectLayout.tsx`
- replace it with session `activate` and `background` transitions
- keep current UI otherwise unchanged

### Phase 3: Make Terminal And Dev Server Session-Aware

- scope terminal ownership to session identity
- scope dev server ownership to session identity
- keep existing process layers where possible
- update stores so they attach to session runtime rather than assuming local ownership

### Phase 4: Reduce Hidden UI Cost

- add `Activity` boundaries
- batch background log streams
- keep hidden xterms detached
- trim background subscriptions

### Phase 5: Rebuild Dev-Server Tile

- rebuild the tile as a session viewer/controller
- make its log surface visibility-aware
- expose status even when the tile is closed

### Phase 6: Rebuild Browser Tile

- rebuild on top of `WorkbenchBrowserService`
- add view pooling
- add snapshot/placeholder behavior
- integrate with session visibility rules

### Phase 7: Native Simulator Session Integration

- connect native preview lifecycle to session state
- preserve launched simulator runtime across backgrounding
- detach viewport when hidden

## Explicit Changes We Should Make First

If we want the biggest payoff with the lowest initial risk, the first exact steps should be:

1. Add `electron/services/WorkbenchSessionManager.ts`.
2. Add a new IPC surface for session lifecycle operations.
3. Remove project-wide terminal/dev-server teardown from `src/features/projects/layouts/ProjectLayout.tsx`.
4. Move terminal/dev-server lifecycle to session transitions.
5. Add a lightweight renderer hook that attaches a workbench route to an existing session.

## GPU Policy

The workbench should use GPU acceleration deliberately, not accidentally.

### Current policy

- keep Electron hardware acceleration enabled
- do not force risky Chromium switches like `ignore-gpu-blocklist`
- keep `backgroundThrottling` enabled for the main renderer window and workbench-attached browser views
- only the dedicated offscreen snapshot worker is allowed to disable background throttling
- use xterm's WebGL renderer when the terminal panel is actually active and visible
- release the xterm WebGL renderer when the terminal panel is hidden so background workbenches do not keep unnecessary GPU state alive
- treat dockview panel visibility and activity together when deciding whether a surface should behave as visible

### Why this matters

There are two different failure modes we want to avoid:

- leaving GPU acceleration underused, which makes browser and terminal surfaces feel heavier than they need to
- over-forcing GPU work, which can make the entire window redraw more often and can increase memory pressure on multi-project sessions

The browser tile and dev-server preview already get Chromium rendering through `WebContentsView`.

The terminal surface benefits from GPU acceleration only when the user is looking at it, so it should not keep its WebGL renderer attached while backgrounded.

### Runtime verification

The app now exposes GPU diagnostics through the Electron bridge so the renderer can make informed choices about whether WebGL-backed terminal rendering should be used.

That diagnostic contract is intentionally lightweight:

- whether hardware acceleration is enabled
- Chromium GPU feature status
- focused signals for:
  - GPU compositing
  - WebGL
  - WebGL2
  - rasterization
  - video decode

This is meant for runtime policy and debugging, not for user-facing settings copy.

## Open Questions

These are real implementation questions, but none of them change the main direction.

### 1. Should frozen sessions keep all PTYs alive forever?

Recommended default:

- no
- keep them alive while recent or pinned
- allow eviction later

### 2. Should browser views survive in memory when frozen?

Recommended default:

- only for a very small number of recent sessions
- otherwise snapshot and detach

### 3. Should background dev servers stop automatically?

Recommended default:

- only for unpinned frozen sessions after idle timeout

### 4. Should session state live in `projectLaneRegistry.ts`?

Recommended default:

- no
- keep lane metadata and runtime lifecycle separate

## Final Direction

The workbench should behave like an IDE, not like a disposable page.

That means:

- switching is backgrounding
- reopening is reattaching
- explicit close is teardown
- hidden UI is not the same as dead runtime

If we implement this correctly:

- browser and dev-server tiles can come back on a much cleaner base
- multi-project use will feel dramatically lighter
- terminals will stop getting destroyed just because the user navigated
- the app will have a real performance policy instead of accidental lifecycle behavior

## References

Internal code references:

- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/hooks/useProjectLaneState.ts`
- `src/stores/useProjectWorkbenchStore.ts`
- `src/stores/useTerminalStore.ts`
- `electron/projectLaneRegistry.ts`
- `electron/services/TerminalService.ts`
- `electron/ipc/registerDevServerHandlers.ts`
- `electron/services/WorkbenchBrowserService.ts`
- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`
- `src/features/projects/components/previews/IosSimulatorViewport.tsx`
- `electron/services/nativePreview/NativePreviewManager.ts`

External references:

- Electron performance: https://www.electronjs.org/docs/latest/tutorial/performance
- Electron `WebContentsView`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron `utilityProcess`: https://www.electronjs.org/docs/latest/api/utility-process
- Electron `MessageChannelMain`: https://www.electronjs.org/docs/latest/api/message-channel-main
- React `Activity`: https://react.dev/reference/react/Activity
- React `startTransition`: https://react.dev/reference/react/startTransition
- React `useDeferredValue`: https://react.dev/reference/react/useDeferredValue
- TanStack Virtual: https://tanstack.com/virtual/latest/docs/introduction
- xterm.js addons: https://xtermjs.org/docs/guides/using-addons/
