# Integrated Browser Implementation Checklist

> **Superseded (2026-08-31).** The native host described below has been removed, not refactored.
> Current browser-backed tiles render a shared unavailable surface while preserving tile metadata
> and Dev Server/DevApp runtimes. The only approved next browser implementation is the direct T3
> port, gated by `shared/browserPortParityLedger.ts`. The checklist below remains historical context.

This checklist is the execution companion to `docs/integrated-browser-architecture.md`.

It is intentionally Cozea-specific and maps directly onto the current `codex/preview-assistant-cleanup` workbench.

---

## Outcome we want

When this work is complete, browser tiles should:

- behave like first-class workbench tabs
- open and restore quickly
- not tank renderer performance when several tiles are open
- share one browser hosting system with dev-server preview tiles
- support screenshots, element capture, selected text, console logs, and future agent/browser tools
- keep keyboard behavior predictable inside pages and inside the host workbench

---

## Existing files to keep vs change

## Keep as the shell

These already form a good workbench shell and should remain the primary composition layer:

- `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- `src/stores/useProjectWorkbenchStore.ts`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`

## Replace or heavily refactor

These are the main browser-specific files that should change:

- `src/features/projects/components/workbench/WorkbenchBrowserTile.tsx`
- `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- parts of `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`

## Add

Suggested new files:

```text
src/features/projects/browser/
  browserTileModel.ts
  browserTileService.ts
  browserTileEvents.ts
  browserTileBounds.ts
  browserStoragePolicy.ts
  browserAgentBridge.ts

src/features/projects/components/workbench/
  WorkbenchBrowserToolbar.tsx
  WorkbenchBrowserErrorView.tsx
  WorkbenchBrowserEmptyState.tsx

src/electron/services/
  BrowserHostService.ts
  BrowserAutomationService.ts
  BrowserSessionService.ts

src/electron/preload/
  preload-browser-tile.ts

src/shared/
  browserHostTypes.ts
```

---

## Phase 0 — Baseline and safety rails

## Checklist

- [ ] Add a short doc comment at the top of `useWorkbenchBrowserView.ts` marking it as transitional
- [ ] Add temporary performance logging around browser tile layout/update frequency
- [ ] Count how many times `setBounds` is called per second per visible tile
- [ ] Count how many times `getBoundingClientRect()` is hit per second while idle
- [ ] Confirm whether hidden browser tiles still receive layout updates
- [ ] Confirm whether hidden browser tiles still consume input/paint resources

## Deliverable

A before-state measurement so improvements are obvious and regressions are easier to catch.

---

## Phase 1 — Create the browser host contract

Goal: define the clean boundary before moving code.

## Add `src/shared/browserHostTypes.ts`

Suggested contents:

```ts
export type BrowserStorageScope = 'global' | 'workspace' | 'ephemeral'

export interface BrowserHostBounds {
  windowId: number
  x: number
  y: number
  width: number
  height: number
  zoomFactor: number
  cornerRadius?: number
}

export interface BrowserLoadError {
  url: string
  code: number
  message: string
}

export interface BrowserState {
  tileId: string
  url: string
  title: string
  favicon?: string | null
  loading: boolean
  visible: boolean
  focused: boolean
  canGoBack: boolean
  canGoForward: boolean
  devToolsOpen: boolean
  storageScope: BrowserStorageScope
  error?: BrowserLoadError | null
}

export interface BrowserCreateOptions {
  initialUrl?: string
  storageScope: BrowserStorageScope
  workspaceId?: string | null
}

export interface BrowserElementData {
  tagName: string
  role?: string
  text?: string
  selector?: string
  url?: string
}
```

## Checklist

- [ ] Add shared browser host types
- [ ] Replace ad-hoc browser payload shapes with shared types where possible
- [ ] Make all renderer/main browser IPC use those shared types

## Deliverable

One typed browser contract shared across renderer and Electron host.

---

## Phase 2 — Introduce a renderer-side browser model

Goal: stop letting the tile component directly own browser host logic.

## Add `src/features/projects/browser/browserTileModel.ts`

Suggested shape:

```ts
import { Emitter } from '@/lib/events'
import type {
  BrowserCreateOptions,
  BrowserElementData,
  BrowserHostBounds,
  BrowserState,
} from '@/shared/browserHostTypes'

export class BrowserTileModel {
  constructor(readonly id: string) {}

  private _state: BrowserState | null = null
  private _onDidChange = new Emitter<BrowserState>()
  readonly onDidChange = this._onDidChange.event

  get state(): BrowserState | null {
    return this._state
  }

  async initialize(options: BrowserCreateOptions): Promise<void> {}
  async setVisible(visible: boolean): Promise<void> {}
  async layout(bounds: BrowserHostBounds): Promise<void> {}
  async loadURL(url: string): Promise<void> {}
  async goBack(): Promise<void> {}
  async goForward(): Promise<void> {}
  async reload(hard?: boolean): Promise<void> {}
  async toggleDevTools(): Promise<void> {}
  async captureScreenshot(): Promise<Uint8Array> {}
  async getSelectedText(): Promise<string> {}
  async getConsoleLogs(): Promise<string> {}
  async getElementData(): Promise<BrowserElementData | undefined> {}
  dispose(): void {}
}
```

## Add `src/features/projects/browser/browserTileService.ts`

Responsibilities:
- create one model per tile id
- cache/reuse models while tiles exist
- dispose models when tiles are removed

## Checklist

- [ ] Add `BrowserTileModel`
- [ ] Add `browserTileService` registry
- [ ] Move browser state subscriptions out of `WorkbenchBrowserTile.tsx`
- [ ] Ensure toolbar actions call model methods, not raw `window.electronAPI.*`

## Deliverable

React talks to a model. The model talks to the browser host.

---

## Phase 3 — Create the Electron browser host service

Goal: centralize ownership of browser instances in one place.

## Add `src/electron/services/BrowserHostService.ts`

Responsibilities:
- own a `Map<string, BrowserInstance>` keyed by tile id
- create browser instances lazily
- apply visibility and bounds
- send state updates back to renderer
- destroy instances on tile close

## Suggested internal API

```ts
class BrowserHostService {
  async getOrCreate(tileId: string, options: BrowserCreateOptions): Promise<BrowserState> {}
  async destroy(tileId: string): Promise<void> {}
  async getState(tileId: string): Promise<BrowserState> {}
  async layout(tileId: string, bounds: BrowserHostBounds): Promise<void> {}
  async setVisible(tileId: string, visible: boolean): Promise<void> {}
  async loadURL(tileId: string, url: string): Promise<void> {}
  async goBack(tileId: string): Promise<void> {}
  async goForward(tileId: string): Promise<void> {}
  async reload(tileId: string, hard?: boolean): Promise<void> {}
  async toggleDevTools(tileId: string): Promise<void> {}
  async captureScreenshot(tileId: string): Promise<Uint8Array> {}
  async getSelectedText(tileId: string): Promise<string> {}
  async getConsoleLogs(tileId: string): Promise<string> {}
  async getElementData(tileId: string): Promise<BrowserElementData | undefined> {}
}
```

## Checklist

- [ ] Add `BrowserHostService`
- [ ] Register it from `electron/main.ts`
- [ ] Keep one browser instance per tile id
- [ ] Add cleanup on tile destroy and app shutdown
- [ ] Add a typed event channel for state updates

## Deliverable

A single browser-owner in Electron, instead of browser ownership leaking into tile hooks.

---

## Phase 4 — Replace `useWorkbenchBrowserView` with a model hook

Goal: remove continuous browser ownership from the tile hook.

## Replace with something like `useBrowserTileModel.ts`

Responsibilities:
- resolve the model by tile id
- subscribe to model state
- expose a measured host element ref
- issue visibility/layout changes only when needed

## Checklist

- [ ] Stop calling browser IPC directly from `WorkbenchBrowserTile.tsx`
- [ ] Replace `useWorkbenchBrowserView` with a model hook
- [ ] Keep only lightweight UI state in the tile component
- [ ] Remove permanent RAF loop as the default mechanism

## Deliverable

A thin, model-backed browser tile.

---

## Phase 5 — Fix layout and visibility behavior

Goal: make layout updates event-driven first.

## Rules

Preferred triggers:
- Dockview panel ready
- Dockview panel resize
- Dockview active/inactive changes
- `ResizeObserver` on the tile host
- explicit host visibility changes

Avoid:
- unconditional permanent `requestAnimationFrame` loops for every browser tile

## Checklist

- [ ] Add a small helper in `browserTileBounds.ts`
- [ ] Use `ResizeObserver` for element-level resize
- [ ] Use panel activation/deactivation to toggle visibility
- [ ] Only perform sanity-sync when bounds are suspected stale
- [ ] Verify hidden tabs stop receiving live layout churn

## Deliverable

Renderer work scales with interaction, not with the number of open tiles sitting idle.

---

## Phase 6 — Refactor `WorkbenchBrowserTile.tsx`

Goal: keep only tile chrome in React.

## Responsibilities after refactor

- URL field and toolbar actions
- empty state
- loading/error overlays
- render host container element for browser bounds
- subscribe to model state

## Suggested split

- `WorkbenchBrowserTile.tsx`
- `WorkbenchBrowserToolbar.tsx`
- `WorkbenchBrowserErrorView.tsx`
- `WorkbenchBrowserEmptyState.tsx`

## Checklist

- [ ] Move toolbar rendering into its own component
- [ ] Keep title/favicon/loading derived from model state
- [ ] Keep URL draft handling local to UI
- [ ] Move all browser lifecycle ownership out of the component

## Deliverable

A presentational browser tile instead of a browser-owning component.

---

## Phase 7 — Unify dev-server preview and browser hosting

Goal: one browser system in the app.

Right now `WorkbenchDevServerTile.tsx` has its own preview behavior and also uses the browser hook path.

That should evolve into:
- dev-server tile manages the server process and preview destination
- browser tile manages embedded browsing
- dev-server can open/reuse a linked browser tile for the current preview URL

## Checklist

- [ ] Keep dev-server state and output in `WorkbenchDevServerTile.tsx`
- [ ] Remove separate embedded-browser ownership from dev-server tile
- [ ] Reuse browser tile host/model for embedded preview mode
- [ ] Preserve linked browser tile behavior in the workbench store

## Deliverable

One browser implementation path for both direct browser tabs and embedded previews.

---

## Phase 8 — Add session/storage policy

Goal: support durable or isolated browsing modes cleanly.

Suggested modes:
- `global`
- `workspace`
- `ephemeral`

## Add `src/features/projects/browser/browserStoragePolicy.ts`

Responsibilities:
- resolve desired storage scope
- decide session partition key strategy
- map workspace/project identity to partition naming

## Checklist

- [ ] Add browser storage policy resolver
- [ ] Support per-workspace/browser partitions
- [ ] Support fully ephemeral tiles/sessions
- [ ] Add clear-storage commands later

## Deliverable

A browser session model that can support both convenience and safety.

---

## Phase 9 — Add preload and input routing

Goal: stop browser-page shortcuts and workbench shortcuts from fighting.

## Add `src/electron/preload/preload-browser-tile.ts`

Rules to follow:
- page/browser gets first chance
- native editing shortcuts remain native
- only unhandled command-like shortcuts return to host workbench
- expose only tiny safe helpers through isolated context

Potential helpers:
- `getSelectedText()`
- maybe future DOM/inspection utilities

## Checklist

- [ ] Add dedicated browser tile preload
- [ ] Ensure `contextIsolation` assumptions are respected
- [ ] Route only unhandled workbench-style key commands
- [ ] Test editable fields inside embedded pages on macOS and Windows shortcuts

## Deliverable

Integrated browser input that feels native inside pages.

---

## Phase 10 — Add agent/browser capabilities

Goal: attach AI/browser tools to the live tile.

## Add `src/electron/services/BrowserAutomationService.ts`

Responsibilities:
- selected text
- screenshots
- console logs
- DOM element capture
- later: Playwright/CDP style actions

## Add `src/features/projects/browser/browserAgentBridge.ts`

Responsibilities:
- bridge browser tile to assistant workflows
- “share with agent” state
- attach current tile context to agent tools

## Checklist

- [ ] Add screenshot API to host/model
- [ ] Add selected text API to host/model
- [ ] Add console logs API to host/model
- [ ] Add element capture API to host/model
- [ ] Add future “share with agent” tile metadata

## Deliverable

Agent/browser tooling attached to the same live browser tab, not a second hidden browser.

---

## Phase 11 — Workbench store cleanup

Goal: keep the workbench store metadata-only.

## Checklist

- [ ] Confirm browser tile metadata stays small and serializable
- [ ] Do not persist raw browser runtime state in Zustand
- [ ] Do not persist host-only navigation internals/history stack in the workbench store
- [ ] Only persist what is needed to restore identity and tab intent

Suggested persisted fields:
- `id`
- `title`
- `url`
- `favicon`
- `linkedDevServerTileId`
- `storageScope`
- `sharedWithAgent`

## Deliverable

A durable but lightweight workbench restore story.

---

## First PR recommendation

The best first PR is not “finish integrated browser.”
It is:

## PR 1 — Introduce model boundary and stop renderer-owned browser control

Scope:
- add shared host types
- add `BrowserTileModel`
- add `browserTileService`
- refactor `WorkbenchBrowserTile.tsx` to use the model
- keep the old Electron browser backend temporarily if needed
- reduce the current hook’s responsibility dramatically

Success criteria:
- browser tile still works
- renderer component becomes thinner
- browser lifecycle is no longer owned directly by `useWorkbenchBrowserView`

## PR 2 — Introduce `BrowserHostService`

Scope:
- centralize browser instance ownership in Electron
- move browser create/destroy/navigation/layout logic into host service
- add typed event channel

## PR 3 — Event-driven layout/visibility

Scope:
- remove permanent RAF loop as default behavior
- hook into Dockview visibility/resize
- improve idle performance with multiple browser tiles open

---

## Code review guardrails

When reviewing this work, reject changes that:

- reintroduce browser ownership into React components
- route raw browser rendering lifecycle through Zustand
- keep hidden browser tabs fully active without a reason
- add more ad-hoc browser IPC methods without shared typing
- duplicate browser logic between dev-server and browser tiles

Prefer changes that:

- keep UI and host concerns separate
- make model/service boundaries clearer
- reduce render-loop work in the renderer
- increase testability of browser lifecycle and layout policy

---

## Done means

This migration is in a good state when all of the following are true:

- [ ] Browser tabs restore correctly from workbench state
- [ ] Several open browser tiles do not create obvious idle jank
- [ ] Hidden tiles are host-hidden cleanly
- [ ] Dev-server preview reuses the same browser system
- [ ] Keyboard behavior inside embedded pages feels normal
- [ ] Browser tile UI is thin and mostly presentational
- [ ] Browser host ownership is centralized in Electron
- [ ] Agent/browser hooks can be added without re-architecting the tile again

---

## Suggested next coding move

Start with:

1. `src/shared/browserHostTypes.ts`
2. `src/features/projects/browser/browserTileModel.ts`
3. `src/features/projects/browser/browserTileService.ts`
4. refactor `WorkbenchBrowserTile.tsx` to depend on the model

That is the smallest change that starts moving Cozea toward the VS Code integrated-browser shape without requiring the full host migration in one shot.
