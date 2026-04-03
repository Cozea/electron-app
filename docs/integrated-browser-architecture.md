# Integrated Browser Architecture

This document outlines how the new VS Code Integrated Browser appears to work from the open-source codebase, and how to port the same overall shape into Cozea's Electron workbench.

It is written for the current `ProjectWorkbenchPage` / Dockview tile architecture on the `codex/preview-assistant-cleanup` branch.

---

## Goal

Build browser tiles that behave like first-class workbench tabs instead of iframe widgets:

- native-feeling navigation and keyboard behavior
- multiple simultaneous browser tabs
- strong performance under docking / tab switching / resize
- clean integration with agents and browser automation
- persistence across app restarts
- support for screenshots, DOM element capture, logs, and devtools

The key idea from VS Code is:

> The browser is **not** owned by the React tile.
>
> The tile owns **identity, chrome, layout, and commands**.
>
> A dedicated browser host owns **navigation, rendering, session state, input routing, devtools, and automation**.

---

## VS Code source map

These are the most relevant source files we found in the VS Code repo:

### Legacy browser (not what we want)

- `extensions/simple-browser/src/simpleBrowserView.ts`
- `extensions/simple-browser/src/extension.ts`

This is the old `Simple Browser`. It is extension-based and uses a webview panel + iframe.

### New integrated browser

#### Editor identity / serialization
- `src/vs/workbench/contrib/browserView/common/browserEditorInput.ts`

Defines the browser tab as a real editor input with:
- stable id
- URL / title / favicon snapshot
- serialization and deserialization
- re-open behavior
- copy-to-new-window behavior

#### Workbench browser model / service
- `src/vs/workbench/contrib/browserView/common/browserView.ts`

Defines:
- `IBrowserViewWorkbenchService`
- `IBrowserViewModel`
- workbench-side policy and state sync

#### Commands and workbench features
- `src/vs/workbench/contrib/browserView/electron-browser/features/browserTabManagementFeatures.ts`

Defines:
- `workbench.action.browser.open`
- quick open browser tabs
- tab reuse
- titlebar browser button
- localhost-link opener
- browser editor context keys

#### Platform service contract
- `src/vs/platform/browserView/common/browserView.ts`

Defines the browser host API:
- create / destroy browser view by id
- layout
- set visible
- navigate / reload / devtools / focus
- screenshots
- selected text
- element inspection
- find in page
- storage scopes
- console logs
- cancellation for in-flight inspection tasks

#### Electron preload / keyboard routing
- `src/vs/platform/browserView/electron-browser/preload-browserView.ts`

Defines:
- isolated-world preload for integrated browser pages
- key event forwarding from page to workbench only when needed
- preservation of native editing/browser shortcuts
- a tiny isolated API surface for the embedded page world

#### Agent / automation layer
- `src/vs/platform/browserView/node/playwrightTab.ts`

Defines:
- Playwright wrapper around a tracked browser page
- logs, dialogs, downloads, snapshots
- safe page actions for agent use

---

## High-level architecture

VS Code’s browser system can be understood as 4 layers.

```text
Command / titlebar / localhost opener
    -> BrowserEditorInput
    -> BrowserViewModel (renderer-side model)
    -> BrowserViewService (platform / host boundary)
    -> Electron browser host + preload
    -> Optional Playwright / agent tooling
```

### 1. Workbench editor identity

Every browser tab is represented as a durable workbench object.

Responsibilities:
- stable browser id
- initial URL, title, favicon snapshot
- serialization and restoration
- equality / matching logic
- workbench tab title and icon

Why it matters:
- browser tabs participate in the editor system like files or diffs
- tab restore is built into the editor lifecycle
- browser tabs can be reopened after restart without React rebuilding everything from scratch

### 2. Renderer-side browser model

The editor input resolves to a model object.

Responsibilities:
- expose current browser state to the renderer
- proxy commands to the browser host service
- sync title / favicon / loading / focus / navigation events
- enforce storage policy and zoom policy
- bridge browser sharing with agent tools

Why it matters:
- React tiles only need to talk to a model
- the model can survive pane churn better than UI components
- policy stays out of presentation code

### 3. Platform browser host service

This is the real browser owner.

Responsibilities:
- create browser instances by id
- destroy them when tabs close
- keep per-browser sessions / storage scopes
- load URLs and manage history
- toggle devtools
- capture screenshots
- inspect DOM elements
- return selected text and console logs
- manage bounds and visibility

Why it matters:
- expensive browser machinery stays out of the workbench renderer
- the workbench only describes **where** the browser should appear, not **how** the browser is rendered internally

### 4. Electron preload and automation

The embedded browser gets its own preload.

Responsibilities:
- route command-like shortcuts back to the workbench
- keep normal browser/page editing shortcuts native
- expose small safe APIs from isolated world
- attach Playwright/CDP-style automation and inspection when needed

Why it matters:
- this is a major part of why the integrated browser feels native instead of awkward
- the agent uses the same browser, not a separate headless copy

---

## Core design principles to copy into Cozea

## 1. Browser tiles should be first-class workbench entities

Today, Cozea’s workbench already has persisted tiles and Dockview layout snapshots.

That part is good.

The browser tile should keep only lightweight, durable state in the workbench store:
- `id`
- `type: browser`
- `title`
- `url`
- `favicon`
- `storageScope`
- maybe `sharedWithAgent`
- maybe `linkedDevServerTileId`

What should **not** live in the workbench store:
- raw rendering state
- DOM / element state
- browser process internals
- history stack
- devtools state if it can be derived from host
- per-frame layout loops

## 2. The tile component should be thin

The React tile should be mostly:
- toolbar
- URL input
- loading/error overlays
- a layout host container
- model wiring

It should **not** directly own the browser.

## 3. Browser layout must be host-driven, not DOM-driven

VS Code’s host API is explicit about browser bounds:
- `windowId`
- `x`
- `y`
- `width`
- `height`
- `zoomFactor`
- `cornerRadius`

That means the browser is laid out as an embedded native surface, not a normal React subtree.

For Cozea, the equivalent is:
- compute the tile’s visible rectangle inside the window
- send bounds updates to a dedicated browser host service
- let the host position the browser surface accordingly

## 4. Browser input routing needs a preload

The integrated browser preload is one of the most important parts of the design.

Without it, workbench keyboard shortcuts and in-page browser shortcuts fight each other.

The rules to copy:
- page/browser gets first chance
- native editing shortcuts stay native
- only unhandled command-like shortcuts route back to the host workbench
- the preload should be minimal and isolated

## 5. Agent tooling should attach to the live browser

The VS Code shape strongly suggests:
- browser screenshots
- DOM element extraction
- selected text
- console logs
- Playwright/CDP automation

all attach to the same live browser tab.

That is better than launching a second hidden browser for AI actions.

---

## Proposed Cozea architecture

Below is a port-oriented design that fits the current Dockview workbench.

## A. Store layer

Add a browser-focused record to the persisted workbench store.

```ts
export interface WorkbenchBrowserTile {
  id: string
  type: 'browser'
  title: string
  createdAt: number
  url: string
  favicon?: string | null
  linkedDevServerTileId?: string | null
  storageScope?: 'global' | 'workspace' | 'ephemeral'
  sharedWithAgent?: boolean
}
```

This store should remain mostly metadata-only.

## B. Renderer model layer

Create a browser tile model/service in the renderer process, similar to VS Code’s `IBrowserViewModel`.

Example shape:

```ts
export interface BrowserTileModel {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly favicon?: string
  readonly loading: boolean
  readonly visible: boolean
  readonly focused: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error?: BrowserLoadError
  readonly sharedWithAgent: boolean

  initialize(create: boolean): Promise<void>
  layout(bounds: BrowserHostBounds): Promise<void>
  setVisible(visible: boolean): Promise<void>
  loadURL(url: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(hard?: boolean): Promise<void>
  toggleDevTools(): Promise<void>
  captureScreenshot(): Promise<Uint8Array>
  getSelectedText(): Promise<string>
  getElementData(): Promise<ElementData | undefined>
  setSharedWithAgent(shared: boolean): Promise<void>
}
```

Responsibilities:
- subscribe to host events
- keep observable browser state
- apply zoom and storage policy
- expose a clean API to `WorkbenchBrowserTile.tsx`

## C. Main-process browser host service

Create a dedicated browser host service in Electron main.

Responsibilities:
- create browser instances by tile id
- keep an id -> browser instance map
- own per-tile session partition / storage scope
- receive layout updates
- receive visibility updates
- expose navigation, reload, devtools, screenshot, selection, logs, and inspection

Suggested interface:

```ts
interface BrowserHostService {
  getOrCreate(tileId: string, options: BrowserCreateOptions): Promise<BrowserState>
  destroy(tileId: string): Promise<void>
  getState(tileId: string): Promise<BrowserState>
  layout(tileId: string, bounds: BrowserHostBounds): Promise<void>
  setVisible(tileId: string, visible: boolean): Promise<void>
  loadURL(tileId: string, url: string): Promise<void>
  goBack(tileId: string): Promise<void>
  goForward(tileId: string): Promise<void>
  reload(tileId: string, hard?: boolean): Promise<void>
  toggleDevTools(tileId: string): Promise<void>
  captureScreenshot(tileId: string, options?: ScreenshotOptions): Promise<Uint8Array>
  getSelectedText(tileId: string): Promise<string>
  getConsoleLogs(tileId: string): Promise<string>
  getElementData(tileId: string): Promise<ElementData | undefined>
}
```

## D. Browser surface implementation

The actual browser should be hosted as a real Electron browser surface.

Suggested direction:
- one browser surface per tile id
- keep inactive tiles hidden, not necessarily destroyed immediately
- keep destroyed only when the tile closes or memory policy requires it

This should map much more closely to VS Code’s `browserView` system than to iframe embedding.

## E. React tile wrapper

`WorkbenchBrowserTile.tsx` should become a thin shell over the model.

Responsibilities:
- display URL input and controls
- send toolbar actions to model methods
- own a host DOM element for measuring bounds
- call model layout updates only when required
- show fallback UI for empty/error/loading states

It should **not** manage a browser loop itself.

---

## Suggested lifecycle for a Cozea browser tile

## Open tab

1. User opens a browser tile.
2. Workbench store creates tile metadata.
3. Browser model resolves by tile id.
4. Model asks main process host to `getOrCreate` the browser instance.
5. Tile mounts and reports bounds.
6. Host positions and shows the browser surface.

## Switch tab / hide tile

1. Dockview changes active panel.
2. Tile model receives visibility update.
3. Hidden browser surface is set invisible.
4. Host can optionally keep session + history alive.

## Navigate

1. User submits URL.
2. Tile calls `model.loadURL(url)`.
3. Host navigates real browser.
4. Title/favicon/loading/navigation events stream back to model.
5. Model updates lightweight tile metadata in store where needed.

## Close tab

1. Tile/editor closes.
2. Model is disposed.
3. Host destroys the browser instance and session handles if required.
4. Workbench store removes tile metadata.

---

## How this maps to current Cozea files

## Current workbench shell

- `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- `src/stores/useProjectWorkbenchStore.ts`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`

These are already a solid shell for a VS Code-like browser tab system.

## Current browser tile path

- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`

This is the area that should change the most.

### Current strengths
- browser tile is already first-class in the workbench store
- tile chrome is separate from tab management
- browser tile state is at least partly metadata-oriented

### Current problem
`useWorkbenchBrowserView.ts` currently performs continuous bounds syncing from the renderer side using:
- `requestAnimationFrame`
- `ResizeObserver`
- window resize listener
- capture-phase scroll listener
- `getBoundingClientRect()` every loop

That is likely much more expensive than necessary when several browser-like tiles exist.

### What to replace it with
Move toward a model + host approach:
- `useWorkbenchBrowserView` becomes a model hook, not a browser owner
- bounds updates are event-driven first
- visibility changes are explicit
- browser host owns the actual embedded browser

## Current dev server tile

- `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`

This should eventually use the same browser tile model/host for preview display when preview is embedded in Cozea.

That would let `devServer` act as a browser launcher/controller rather than a second browser implementation.

---

## Recommended folder structure for Cozea

```text
src/
  features/projects/components/workbench/
    WorkbenchBrowserTile.tsx         # thin React shell
    WorkbenchDevServerTile.tsx       # can open/reuse browser tiles
    WorkbenchBrowserToolbar.tsx      # optional split for controls

  features/projects/browser/
    browserTileModel.ts              # renderer-side model class
    browserTileService.ts            # renderer registry of models
    browserTileEvents.ts             # typed event definitions
    browserTileBounds.ts             # visibility + layout helpers
    browserStoragePolicy.ts          # global/workspace/ephemeral rules
    browserAgentBridge.ts            # agent share / inspect / screenshot helpers

  electron/services/
    BrowserHostService.ts            # main-process owner of browser surfaces
    BrowserAutomationService.ts      # optional Playwright/CDP wrapper

  electron/preload/
    preload-browser-tile.ts          # isolated bridge for integrated browser pages

  shared/
    browserHostTypes.ts
```

---

## Suggested IPC contract

Use typed events and requests.

### Requests from renderer to host
- `browser:getOrCreate`
- `browser:getState`
- `browser:destroy`
- `browser:layout`
- `browser:setVisible`
- `browser:loadURL`
- `browser:goBack`
- `browser:goForward`
- `browser:reload`
- `browser:toggleDevTools`
- `browser:captureScreenshot`
- `browser:getSelectedText`
- `browser:getConsoleLogs`
- `browser:getElementData`
- `browser:setSharedWithAgent`

### Events from host to renderer
- `browser:navigate`
- `browser:loadingState`
- `browser:titleChanged`
- `browser:faviconChanged`
- `browser:focusChanged`
- `browser:visibilityChanged`
- `browser:devToolsChanged`
- `browser:closed`
- `browser:keyCommand`
- `browser:newPageRequested`
- `browser:findResult`

---

## Performance rules worth enforcing

## 1. No permanent RAF layout loop for all browser tiles

Prefer:
- `ResizeObserver`
- Dockview panel resize/visibility events
- explicit activation/deactivation
- occasional sanity-sync only if needed

## 2. Hidden tabs should be invisible at the host level

Do not leave hidden browser surfaces fully active if they are not visible.

## 3. React should not be in the navigation/rendering hot path

React should only update for:
- title
- favicon
- loading/error UI
- active controls state

It should not process raw browser rendering activity.

## 4. Agent tooling should reuse the live tab

Screenshots, selected text, element capture, and logs should come from the same browser tile instance.

## 5. Storage scope should be a browser policy, not a tile concern

The tile can display scope, but host/model should own:
- global session
- workspace session
- ephemeral session

---

## Proposed implementation phases

## Phase 1 — Introduce the model boundary

Goal:
- keep current user-facing browser tile behavior
- stop the tile from directly owning host logic

Tasks:
- add `browserTileModel.ts`
- move all current browser state and IPC interactions behind the model
- keep `WorkbenchBrowserTile.tsx` thin

## Phase 2 — Replace renderer-owned layout loop

Goal:
- reduce layout churn and repeated bounds computations

Tasks:
- make bounds sync event-driven
- use Dockview visibility/resize hooks as primary trigger
- reserve periodic sanity correction only if necessary

## Phase 3 — Unify browser and dev-server preview hosting

Goal:
- one browser host path in the app

Tasks:
- dev-server tile opens or reuses a browser tile
- embedded dev-server preview uses the same browser host machinery as normal browser tabs

## Phase 4 — Add agent/browser integration

Goal:
- support element capture, screenshots, console logs, and page automation

Tasks:
- add automation service
- add `shareWithAgent` flow
- expose selected text / inspect element / screenshot APIs

## Phase 5 — Add robust session/storage policy

Goal:
- support global/workspace/ephemeral browser data modes cleanly

Tasks:
- add partition/session strategy in host
- add settings and user controls
- add clear-storage commands

---

## What not to copy literally from VS Code

VS Code’s architecture is the right shape, but not every detail should be copied 1:1.

Avoid blindly porting:
- VS Code-specific DI and contribution registration style
- editor service abstractions that only exist because VS Code is a general-purpose editor platform
- telemetry and settings registry details that do not fit Cozea

What **is** worth copying almost directly:
- browser tab identity as a first-class workbench object
- model/service split
- host-level browser ownership
- preload-based input routing
- live-tab automation attachment
- session/storage isolation concept

---

## Main conclusion

If Cozea wants VS Code-style browser tiles, the correct design is:

- **store** persists browser tab identity and layout
- **model** proxies browser state and commands
- **host service** owns the actual browser instances
- **preload** handles input routing safely
- **automation** attaches to the live browser tab

The browser should not be implemented as a heavy React surface or a DOM iframe living inside the workbench renderer.

That is the main lesson from VS Code’s new integrated browser architecture.

---

## Immediate next step for Cozea

The most useful next implementation move is:

1. introduce `BrowserTileModel`
2. move `useWorkbenchBrowserView` logic behind that model
3. stop treating the browser tile as renderer-owned
4. make `WorkbenchDevServerTile` reuse the same browser-host path

That will move Cozea much closer to the integrated-browser shape that VS Code is using today.
