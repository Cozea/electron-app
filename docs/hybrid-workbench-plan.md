# Hybrid Workbench Plan

> **Historical plan.** The `react-grid-layout` and `WebContentsView` decisions below were replaced
> by Dockview plus the renderer-wide T3 `<webview>` host. Current implementation guidance lives in
> [`docs/workbench-overlay-architecture.md`](./workbench-overlay-architecture.md) and
> [`docs/integrated-browser-architecture.md`](./integrated-browser-architecture.md). Do not use this
> plan to recreate the deleted native browser, geometry IPC, or occlusion adaptations.

## Summary

This plan replaces the current project `Previews` surface with a real `Workbench`.

The current project surface is still centered around a preview-specific architecture:

- `ProjectPagesPage.tsx`
- `FocusedProjectPreview.tsx`
- `ProjectPreviewToolbar.tsx`
- preview bridge injection and compatibility fallback logic
- route scanning and preview-specific state

That stack is too specialized, too coupled, and too far from the product we actually want.

The target is a hybrid workbench:

- one project page: `Workbench`
- tile-based layout
- draggable and resizable snapped panels
- browser tiles
- terminal tiles
- one dev-server controller tile per project
- changes as a tile
- selected task cards as contextual side surfaces
- future AI chat that can create and manage tiles
- future supervisor agent that can observe and operate the workbench through one MCP surface

This document is the persistent execution reference for that migration.

## Problem Statement

Today the project layout is effectively dominated by one surface:

- preview / pages

That surface still assumes:

- route scanning is central
- iframe preview is central
- bridge injection is central
- preview compatibility fallbacks are central
- visual editor integration is part of the normal browsing path

Those assumptions are wrong for the desired product.

The desired product is not “a preview page with extras.”

It is:

- a local-first project workbench
- multiple concurrent tools on screen
- browser-like interaction
- terminals and dev-server controls as peers
- future AI-controlled orchestration of tiles

## Non-Negotiable Requirements

These are the explicit product requirements that drive this plan:

1. Remove the dedicated preview-first UI as the primary project surface.
2. Replace it with a workbench.
3. Use a real layout foundation instead of writing a tile system from scratch.
4. Do not require route scanning for normal browsing.
5. Dev server should primarily run a command, not own the whole preview architecture.
6. Browser panels must still be manually openable.
7. The workbench should support:
   - browser tiles
   - terminal tiles
   - contextual task cards
   - a left-side changes overlay
   - one dev-server controller tile per project
8. Tiles must be movable, resizable, snapped to a constrained set of sizes, and closeable.
9. Future AI chat should be able to create and manage tiles.
10. Future supervisor-agent / MCP integration must be first-class, not bolted on.

## Decision Record

### Decision 1: Replace `Previews` with `Workbench`

The project surface should no longer be named or architected around previewing.

`ProjectPagesPage.tsx` should be retired as the primary project experience and replaced with a new workbench page.

The workbench becomes the single project operating surface.

### Decision 2: Use A Hybrid Panel Isolation Model

We are **not** choosing “every tile is its own isolated process” as the first architecture.

We are choosing a hybrid model:

- browser tiles are process-isolated
- dev-server browser-coupled views can use the same isolated browser infrastructure
- changes and most app-native tiles stay host-rendered at first
- selected task cards stay host-rendered and live beside the grid instead of inside it
- terminal processes stay real OS processes via `node-pty`, while the panel UI remains host-owned

This is the best tradeoff because it:

- gives browser tiles strong isolation where it matters most
- keeps workbench orchestration centralized
- makes future MCP/supervisor integration dramatically easier
- avoids turning every internal tool into a separate mini-app too early

### Decision 3: Use `react-grid-layout` For The Tile System

The workbench should be based on `react-grid-layout`.

Why:

- it matches a tiled, draggable, resizable, snap-based workbench better than dock/tab-first systems
- it works naturally with React state and persistence
- it gives us a strong starting point instead of custom layout code

Reference:

- `react-grid-layout`: https://github.com/react-grid-layout/react-grid-layout

### Decision 4: Use Electron `WebContentsView` For Real Browser Tiles

Browser tiles should move away from iframe preview architecture and use Electron’s proper embedded browser surface.

Why:

- better isolation
- better fit for true browser behavior
- avoids the long-term preview-bridge/iframe fragility

References:

- `WebContentsView`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron embed guidance: https://www.electronjs.org/docs/latest/tutorial/web-embeds

### Decision 5: Route Scan Is Optional Metadata, Not Core Runtime

Route scanning should not be required for browsing.

If route scan survives at all, it should only be:

- optional metadata
- a helper for navigation suggestions
- never a prerequisite for rendering the browser surface

### Decision 6: Dev Server Is A Tool, Not The Center Of The Product

The dev server should become:

- one controller tile per project
- one command runner
- one source of logs / status / restart actions

It should be able to:

- start
- stop
- restart
- expose port / URL
- open a browser tile manually

It should not be responsible for owning the entire preview UI model.

### Decision 7: Future AI And MCP Must Target A Central Tile Registry

Future AI chat and future supervisor-agent integrations should not talk directly to raw React components or per-panel hacks.

They should target:

- one workbench registry
- one tile model
- one command bus
- one event stream

That is easier in a hybrid architecture than in a “fully isolated everything” architecture.

## Why Not Other Foundations

### Dockview

Dockview is strong, but it is more dock/tab/pane-oriented than grid-tile-oriented.

It is a useful reference for interaction quality, but not the primary layout engine for this plan.

Reference:

- https://dockview.dev/docs/overview/introduction

### Gridstack

Gridstack is viable, but `react-grid-layout` is the better fit for the current React state architecture and component model.

Reference:

- https://gridstackjs.com/

### Writing A Custom Tile Layout

Rejected.

The workbench is too foundational to hand-roll initially. We need a battle-tested grid/tile foundation.

## Current Architecture To Be Replaced

The current preview-centric surface is mainly composed of:

- orchestration page:
  - `src/features/projects/pages/ProjectPagesPage.tsx`
- web preview surface:
  - `src/features/projects/components/previews/FocusedProjectPreview.tsx`
- native preview surface:
  - `src/features/projects/components/previews/IosSimulatorViewport.tsx`
- preview header controls:
  - `src/features/projects/components/previews/ProjectPreviewToolbar.tsx`
- preview bridge:
  - `src/utils/previewBridge.ts`
- route scanning:
  - `src/features/projects/hooks/useProjectRouteScan.ts`
- visual editor sidebar:
  - `src/components/visual-editor/VisualEditorSidebar.tsx`
- bottom terminal:
  - `src/features/projects/components/TerminalPanel.tsx`

This stack should be treated as migration input, not as the final shape.

## Target Architecture

## Top-Level Model

The project layout should move to:

- one project route/page: `ProjectWorkbenchPage`
- one workbench layout store
- one tile registry
- one panel command/event layer
- one main-process browser/tile manager

The workbench becomes the primary canvas.

## Tile Taxonomy

### Host Tiles

These render inside the main React app renderer:

- `tasks`
- `changes`
- `devServer`
- `terminal`
- future `assistantChat`

These are still first-class tiles, but not separate Chromium renderer surfaces initially.

### Isolated Browser Tiles

These are backed by Electron `WebContentsView`:

- `browser`
- future browser-derived variants such as:
  - docs browser
  - app browser
  - auth flow browser

These are the “real browser” tiles.

### Process-Backed Tools

These are not `WebContentsView` panels, but they still map to real processes/sessions:

- `terminal` tiles map to real PTY sessions
- `devServer` tile maps to one project-scoped server process supervisor

The UI is host-rendered first, but the underlying runtime is still process-backed.

## Core Workbench Data Model

Introduce a persistent per-project workbench model:

```ts
interface WorkbenchLayoutState {
  projectId: string
  version: number
  tiles: WorkbenchTile[]
  layouts: Record<Breakpoint, WorkbenchGridLayout[]>
  activeTileId: string | null
}

type WorkbenchTileType =
  | "browser"
  | "terminal"
  | "devServer"
  | "tasks"
  | "changes"
  | "assistantChat"

interface WorkbenchTile {
  id: string
  type: WorkbenchTileType
  title: string
  sessionId?: string
  browserSessionId?: string
  devServerSessionId?: string
  terminalSessionId?: string
  coupledTileId?: string
  props: Record<string, unknown>
}
```

Layout entries should be constrained to approved grid sizes, not arbitrary freeform placement.

## Size System

Tiles should snap to a fixed size vocabulary.

Example:

- `square-sm`
- `square-md`
- `square-lg`
- `rect-wide-sm`
- `rect-wide-md`
- `rect-tall-sm`
- `rect-tall-md`
- `full-width-short`
- `full-width-tall`

Internally these map to grid width/height units.

This prevents chaotic layouts and keeps resize behavior intentional.

## Workbench Shell Composition

The workbench page should be composed of:

1. project header
2. workbench toolbar / tile launcher
3. grid canvas
4. tile chrome per panel
5. optional bottom global status strip if needed

Each tile should have standardized chrome:

- title
- icon
- focus state
- close
- resize handle
- tile-specific actions

Optional:

- maximize
- pin
- “open in new tile”

## Browser Tile Architecture

Browser tiles should be URL-first, not route-scan-first.

Each browser tile should support:

- URL bar
- back
- forward
- reload
- open externally
- current loading/error state
- session persistence

Normal browser mode should not:

- depend on bridge injection
- depend on route scan
- depend on preview-specific handshake state

### Inspect / Edit Mode

Visual editing and DOM inspection should become an explicit mode of a browser tile, not the default browser architecture.

When entered:

- attach bridge/instrumentation to that browser tile
- mount the visual editor sidebar
- enable element selection / style editing

When not entered:

- it behaves like a normal browser tile

## Dev Server Tile Architecture

There should be exactly one dev-server controller tile per project.

Responsibilities:

- run the project command
- show status
- show logs
- stop / restart
- expose detected URL / port
- open browser tile manually
- optionally spawn a coupled browser tile preset

It should not assume ownership of:

- route scan
- preview embed fallback
- inspector
- browser rendering

### Coupled Browser Behavior

The dev-server tile can be “paired” with a browser tile.

That pairing should mean:

- the browser tile follows the server URL
- the user can switch the paired surface between:
  - browser view
  - terminal/log view

But the browser should still remain manually openable independently.

## Terminal Tile Architecture

Terminal tiles should:

- map to real PTY sessions
- be independently spawnable
- preserve output and cwd
- be focusable and closable like any other tile

Future:

- allow tile splitting / clone session
- allow AI chat to spawn or target a terminal tile

## Task Card Architecture

The current tasks modal/page should remain a dedicated selection surface.

What belongs in the workbench is not the full task board. It is the selected task context:

- compact task cards
- checklist state
- file/page context
- quick dismissal
- side-by-side visibility while browsing and editing

The full task manager can stay modal. The workbench only needs the active task context cards.

## Changes Tile Architecture

The current changes modal/page should become a tile surface.

The tile should support:

- feed list
- diff viewer
- comments
- selection state

The tile should be embeddable and resizable without assuming it owns the whole page.

## Future AI Chat Tile

We plan to add an AI chat tile similar in spirit to the T3 Code chat experience.

That future tile should be designed into the workbench model from the start.

The chat tile should be able to:

- create tiles
- focus tiles
- close tiles
- open browser tiles to a URL
- open tasks / changes tiles
- spawn terminals
- attach a browser tile to the dev server

This implies the workbench must expose a stable tile command API rather than component-local hacks.

## Future Supervisor Agent And MCP

The future supervisor agent should operate the workbench through one MCP server.

That MCP server should sit above a centralized workbench registry.

### Required Host-Owned Interfaces

The host app should own:

- tile registry
- tile metadata
- active tile tracking
- tile bounds/layout
- tile lifecycle
- command routing
- event stream

### MCP-Friendly Capability Model

Each tile should expose a typed capability adapter.

Examples:

- `browser.navigate`
- `browser.goBack`
- `browser.reload`
- `terminal.runCommand`
- `terminal.readOutput`
- `devServer.start`
- `devServer.stop`
- `devServer.openBrowser`
- `changes.selectEntry`
- `tasks.selectTask`

The MCP layer should talk to the adapter layer, not to raw components.

### Why Hybrid Is Better For MCP

A fully isolated “every tile is its own separate app/process surface” architecture would make supervisor orchestration harder because:

- more bridging is required
- more state has to be mirrored across process boundaries
- cross-tile actions become less coherent

The hybrid model keeps orchestration centralized while still isolating browser surfaces where needed.

## Migration Principles

1. Do not build a custom layout engine.
2. Do not preserve preview-specific architecture as the center of the new workbench.
3. Do not require route scan for normal browser behavior.
4. Keep orchestration host-owned even when some tiles are isolated.
5. Prefer adapters and registries over component-local imperative hacks.
6. Make the AI/MCP future easier now, not harder later.

## Implementation Plan

## Phase 0: Foundation And Feature Freeze

Goals:

- stop adding new preview-specific features
- treat current preview stack as migration input
- define the workbench state model

Deliverables:

- `docs/hybrid-workbench-plan.md`
- final library choice
- workbench state/types draft

For our own reference:

- chosen layout engine: `react-grid-layout`
- chosen browser isolation primitive: `WebContentsView`
- chosen architecture: hybrid, not full per-tile isolation

## Phase 1: Workbench Shell

Goals:

- create `ProjectWorkbenchPage`
- create `useProjectWorkbenchStore`
- mount a grid canvas with static prototype tiles

Deliverables:

- new project route/page
- tile chrome
- persisted local layout
- tile launcher

No browser or preview migration yet beyond static shell validation.

For our own reference:

- prove drag/resize/snap behavior first
- prove per-project layout persistence
- prove tile focus/close controls

## Phase 2: Browser Tile + Main Process View Manager

Goals:

- implement a browser tile backed by `WebContentsView`
- create main-process tile/view manager
- support URL-first browsing

Deliverables:

- tile creation IPC
- bounds syncing IPC
- browser navigation controls
- focus and destruction lifecycle

This phase establishes the deepest architectural part of the workbench.

For our own reference:

- browser tile must not depend on route scan
- bridge injection stays out of the default browsing path
- browser tile is the first isolated panel type

## Phase 3: Dev Server Tile

Goals:

- replace preview-owned dev-server assumptions with one dev-server tile
- support command-based start/stop/restart
- support manual browser launch

Deliverables:

- one project-scoped dev-server session
- logs/status tile
- “open in browser tile” action
- optional coupled browser preset

For our own reference:

- dev server is a tool, not a page
- dev server does not own the browser architecture
- manual opening must remain possible

## Phase 4: Terminal Tiles

Goals:

- make terminal panels first-class workbench tiles
- preserve current PTY/session behavior

Deliverables:

- spawn terminal tile
- tile-targeted PTY session mapping
- focus/close/reopen behavior

For our own reference:

- terminal runtime is already process-backed
- the tile UI can stay host-rendered first

## Phase 5: Move Changes Into Tiles And Restore Task Context Cards

Goals:

- render changes as a workbench-native tile
- keep tasks as a modal route for selection and management
- restore selected tasks as contextual cards beside the workbench grid

Deliverables:

- changes tile
- task side-dock / side-shelf cards
- task-to-workbench navigation with card handoff

For our own reference:

- these do not need process isolation first
- they need clean host-owned panel adapters

## Phase 6: Retire Preview-Centric Architecture

Goals:

- remove `ProjectPagesPage` as the primary project experience
- remove route-scan dependency from normal browsing
- remove preview-specific iframe fallback architecture

Deliverables:

- old preview page retired or reduced to compatibility shim
- route scan moved to optional metadata service or deleted
- preview bridge only used for explicit inspect mode

For our own reference:

- preview-specific compatibility logic should not remain on the critical path

## Phase 7: Browser Inspect / Visual Edit Mode

Goals:

- reintroduce visual editing as an opt-in browser tile capability
- keep normal browsing clean

Deliverables:

- attach bridge only when inspect mode is enabled
- mount visual editor sidebar against selected browser tile
- explicit enter/exit inspect mode

For our own reference:

- inspect mode is a tool mode
- not the default browser runtime

## Phase 8: AI Chat Tile And Tile Automation

Goals:

- add future AI chat tile
- allow chat to create and control tiles through the workbench command layer

Deliverables:

- `assistantChat` tile type
- tile creation commands
- tile targeting commands

For our own reference:

- AI should never mutate layout by poking components directly
- it should use the same tile registry/command layer as MCP

## Phase 9: Supervisor MCP Layer

Goals:

- expose workbench operations through MCP
- support cross-tile orchestration

Deliverables:

- workbench MCP server
- tile listing/focus/control tools
- event subscriptions or polling endpoints

For our own reference:

- centralized adapters are the prerequisite
- this is why hybrid architecture is the correct base

## Files Likely To Be Touched

### Renderer

- `src/features/projects/pages/ProjectPagesPage.tsx`
- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/features/projects/components/ProjectSidebar.tsx`
- `src/features/projects/components/TerminalPanel.tsx`
- `src/features/projects/pages/TasksPage.tsx`
- `src/features/projects/pages/ChangesPage.tsx`
- new `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- new `src/features/projects/components/workbench/**`
- new `src/stores/useProjectWorkbenchStore.ts`

### Electron Main / IPC

- `electron/main.ts`
- new workbench tile IPC handlers
- new browser tile manager using `WebContentsView`
- possible reuse/reshaping of preview handler infrastructure

### Shared Contracts

- new tile command contracts
- new workbench session contracts
- future MCP-facing contracts

## Risk Areas

### Main Process Complexity

`WebContentsView` introduces real Electron lifecycle complexity:

- bounds sync
- focus
- destruction
- session ownership
- hidden view behavior

This is acceptable, but it should be contained in one manager.

### Over-Migrating Internal Tiles Too Early

If we attempt to process-isolate tasks, changes, terminals, and browser tiles all at once, the migration risk rises sharply.

That is why the hybrid path is preferred.

### Keeping Old Preview Logic Alive Too Long

If we keep route scan, iframe preview fallback, and bridge-first preview logic alive as parallel first-class systems for too long, the workbench will become another layer of drift rather than a true replacement.

## Success Criteria

The migration is successful when:

1. The project layout no longer feels like “a preview page.”
2. The main project surface is a tile workbench.
3. Browser tiles behave like real browsers.
4. Route scan is no longer required for normal browsing.
5. Dev server is a command tool, not the center of the UI.
6. Tasks and Changes can live as tiles.
7. Tile orchestration is centralized.
8. Future AI chat can create and control tiles through the official tile command layer.
9. Future MCP supervisor can operate the entire workbench from one host-owned registry.

## References

- React Grid Layout:
  - https://github.com/react-grid-layout/react-grid-layout
- Electron `WebContentsView`:
  - https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron web embeds guidance:
  - https://www.electronjs.org/docs/latest/tutorial/web-embeds
- Dockview:
  - https://dockview.dev/docs/overview/introduction
- Gridstack:
  - https://gridstackjs.com/

## Execution Log

### Initial Draft

Completed:

- established the workbench as the replacement for the preview-first surface
- chose hybrid panel isolation
- chose `react-grid-layout` as the workbench foundation
- chose `WebContentsView` for true browser tiles
- designed for future AI chat tile creation and supervisor/MCP integration

For our own reference:

- do not center the new architecture on route scan or preview bridge
- keep orchestration host-owned
- isolate browsers first, not every tile at once

### Execution Sweep: Shell + Routing

Completed:

- installed `react-grid-layout` as the workbench grid foundation
- added `useProjectWorkbenchStore.ts` with per-project persistent tile state, default layouts, singleton tile handling, and snapped grid rect persistence
- added `ProjectWorkbenchPage.tsx` with a real workbench canvas, add-tile launcher, reset-layout control, and default browser / terminal / dev-server tiles
- added host tile chrome plus first-pass browser, terminal, and dev-server tile components
- rerouted the project surface from `Previews` to `Workbench` in `routes.tsx`
- changed project sidebar navigation from `Previews` / `Tasks` page links to a single `Workbench` entry
- updated `ProjectLayout.tsx` so workbench is treated as the primary full-bleed surface
- repointed the global header `Changes` button to open changes inside the workbench instead of navigating to a standalone changes page

For our own reference:

- the workbench is now the primary route target, but the browser tile still needs the native `WebContentsView` manager behind it
- changes are intended to render as a left overlay inside the workbench, while tasks remain route-level modal/context cards
- compatibility redirects from `/pages` and `/changes` target the workbench, while `/tasks` remains a first-class modal destination

### Execution Sweep: Browser Manager + Tile Runtime

Completed:

- added `WorkbenchBrowserService.ts` to manage per-tile `WebContentsView` instances in the Electron main process
- added `registerWorkbenchBrowserHandlers.ts` plus preload/shared API contracts so browser tiles can create, navigate, resize, hide, destroy, and observe browser state
- wired the workbench browser service into `electron/main.ts` lifecycle and disposal paths
- implemented `WorkbenchBrowserTile.tsx` as a URL-first, true browser tile with back / forward / reload / external-open controls and host-to-main bounds syncing
- completed the first hybrid workbench set with process-backed browser tiles plus host-rendered terminal, dev-server, and changes surfaces
- kept browser tiles manually openable and preserved the dev-server-to-browser pairing behavior through the workbench store

For our own reference:

- browser tiles no longer depend on route scan or iframe preview plumbing
- the browser is now the first genuinely isolated tile type, which matches the hybrid architecture choice
- changes and task context stay host-owned for now, which is better for future MCP/supervisor orchestration

### Execution Sweep: Stabilization + Warm Path Cleanup

Completed:

- aligned `ProjectWorkbenchPage.tsx` with the installed `react-grid-layout` API and switched the grid to explicit config objects instead of the older prop shape
- snapped tile resize persistence to approved preset sizes in `useProjectWorkbenchStore.ts` so workbench panels stay within the constrained size vocabulary
- cleaned the remaining GitHub-only type drift in repository management, source-control hooks, team/settings flows, and project integration helpers
- fixed the helper typing regressions in `billingErrors.ts` and `retryHints.ts`
- moved app/project warmup imports from `ProjectPagesPage` to `ProjectWorkbenchPage` so the old preview page is no longer on the main preload path
- updated workbench-era copy and presence semantics so `/workbench` is treated as the primary active project surface
- refined `TasksPage.tsx` and `ChangesPage.tsx` so the first hybrid workbench flow could be exercised end to end

For our own reference:

- the workbench is now the compiled, verified, warmed project surface instead of a side path
- tile size snapping is now aligned with the product requirement for a constrained set of workbench sizes
- old preview code still exists as migration residue, but it is no longer on the primary route or preload path

### Execution Sweep: Correction Pass For Task Surfaces And Workbench Chrome

Completed:

- removed the full tasks board from the default workbench layout and from saved workbench state hydration
- restored `/tasks` as its own modal route instead of redirecting it into the grid
- changed task context navigation so selected tasks hand off directly to `/workbench`
- restored selected task cards as contextual side surfaces beside the workbench grid
- removed the `tasks` launcher path from the workbench tile menu
- stopped force-stacking new tiles manually in the store and handed more placement responsibility back to the grid engine
- removed the explicit `noCompactor` override from the workbench page
- flattened the workbench chrome away from the overly rounded, shadow-heavy treatment and back toward the app’s existing surface language

For our own reference:

- the task manager is not a tile
- selected task context belongs beside the workbench, not inside the grid
- changes remains the one review-oriented workbench tile in this slice

### Execution Sweep: Hidden Tile Chrome

Completed:

- collapsed Dockview's native tab/notch strip to zero-height so it no longer acts as the visible tile header
- added a shared `WorkbenchTileChrome` surface with top-edge reveal behavior, close, and maximize/restore controls
- moved browser controls into the hover bar, including navigation buttons, URL input, and external-open action
- moved dev-server controls into the hover bar so logs can occupy the body without a permanent top command row
- moved terminal panels onto the same shared tile chrome and kept the body free of fixed header scaffolding
- reserved a thin top trigger strip so the browser tile's native `WebContentsView` cannot swallow the hover target

For our own reference:

- keep Dockview for layout, but not for visible panel chrome
- tile controls should live in the host-owned hover bar, not in Dockview tabs
- browser tiles need a small always-present top inset because native views can sit above normal DOM layering

### Execution Sweep: Edge Tile Insertion

Completed:

- removed the header `Add Tile` dropdown so tile creation no longer depends on a detached menu
- added a real `selection` tile type to the workbench model and made the empty-state/reset workbench default to a single persistent selection tile
- added `WorkbenchSelectionTile.tsx` as the real tile body for tile picking, with a 2x2 icon-and-label grid and an intentionally empty fourth square
- replaced the old edge overlay launcher with `WorkbenchEdgeInsertion.tsx` edge sensors that create temporary selection tiles in Dockview itself
- wired selection-tile resolution so the chosen tile is inserted within the selection tile's slot and the selection tile closes afterwards
- added automatic retraction for temporary edge-preview selection tiles when no choice is made, while keeping the persistent empty-state selection tile in place when it is the only tile on screen
- kept the right-edge insertion sensor suppressed while the changes drawer is open so the drawer and insertion affordance do not fight for the same edge
- gated edge insertion so it only arms after pointer movement through the interior of the workbench canvas, instead of activating when the cursor enters directly from outside onto an edge
- added a visible edge-confirmation strip with a centered plus icon, so armed edge zones now signal tile insertion before the selection tile appears

For our own reference:

- edge insertion is now the primary tile creation path
- this pass only covers outer content edges; in-between tile insertion is still the next layer to design
- the selection tile is now a real panel in the layout, not an overlay helper
- the reserved fourth cell is intentionally an empty square for the future AI/agent tile
- the edge strip should stay a full-opacity overlay band, narrower than the edge sensor itself

### Execution Sweep: Tile Insertion Motion

Completed:

- added a workbench insertion animation path around panel creation instead of letting new tiles snap into place
- applied temporary split-container transitions during `addPanel(...)` so surrounding tiles ease into their new bounds
- added a short enter animation for newly created tile groups so the inserted tile reveals instead of appearing abruptly
- updated the enter motion so edge-added tiles slide in from their actual insertion side instead of using a generic reveal
- kept initial workbench hydration on the non-animated path so only user-driven insertions get motion

For our own reference:

- Dockview does not provide native panel-insertion animation, only tab animation and continuous layout during resizing
- the right compromise here is to keep Dockview in control of layout while layering motion onto the workbench add-panel path
- the selection-tile flow and any singleton tile opened later now share the same insertion animation path
- edge insertions should feel directional, while in-place replacements can stay centered/subtle
