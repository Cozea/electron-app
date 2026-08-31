# Dockview Workbench Migration

> **Historical migration log.** Statements below that retain `WebContentsView` describe the
> superseded implementation. The active workbench uses one renderer-wide T3 `<webview>` host and
> the semantic overlay contract in
> [`docs/workbench-overlay-architecture.md`](./workbench-overlay-architecture.md). Dockview owns
> layout; it does not own a second browser or overlay system.

## Summary

This document tracks the replacement of the current `react-grid-layout` workbench shell with a real IDE-style Dockview shell.

The current grid approach has two problems:

- it is the wrong abstraction for an IDE-like workbench
- too much layout and chrome behavior has been hand-authored around it

The goal is to replace that with Dockview while preserving the existing project/runtime behavior:

- browser panels stay backed by `WebContentsView`
- terminal panels stay host-rendered over real terminal processes
- dev server stays a host-owned controller surface
- changes stays a host-owned review surface
- selected task cards stay outside the dock as contextual side surfaces

## Why This Migration Exists

The grid implementation drifted into:

- manual panel geometry
- custom snapping rules
- dashboard-style widget assumptions
- custom tile chrome that does not match the app language

That is not what the product needs.

The product needs:

- an IDE-style workbench foundation
- library-owned panel movement and resizing
- serializable layout state
- clean panel adapters for future MCP/supervisor control

## Chosen Foundation

We are replacing the current grid shell with Dockview.

Direction:

- use `dockview-react` as the React workbench layer
- keep browser isolation in Electron via `WebContentsView`
- keep task cards outside the dock
- keep orchestration centralized in the host app

## Migration Phases

### Phase 1: Foundation

- add Dockview dependency
- add a dedicated Dockview execution record
- create shared panel content adapters
- create a Dockview-backed workbench state shape

For our own reference:

- do not recreate a manual grid on top of Dockview
- keep styling aligned with the existing app surface language

### Phase 2: Shell Replacement

- replace the `ProjectWorkbenchPage.tsx` grid shell with Dockview
- keep current browser, terminal, dev server, and changes content
- preserve add/open/close/reset behaviors

For our own reference:

- let Dockview own the panel layout mechanics
- keep task cards external to the dock

### Phase 3: Cleanup

- remove `react-grid-layout` usage from the workbench path
- remove unused grid CSS and store geometry debt
- keep only the state that still matters to the product

For our own reference:

- prefer serialized dock state over manual `x/y/w/h`
- remove old workbench abstractions once migration is verified

### Phase 4: Verification

- run `bun run typecheck`
- run `bun run dev`
- confirm workbench route boots and panels render

## Execution Log

### Sweep Start

Planned:

- add Dockview and inspect the current React integration API
- replace the grid shell in `ProjectWorkbenchPage.tsx`
- adapt persistence/state to panel-based layout
- keep contextual task cards outside the dock

For our own reference:

- browser/dev-server/terminal/changes stay
- task board does not come back into the dock

### Sweep Complete: Foundation + Shell Replacement

Completed:

- added `dockview` as the workbench foundation and removed `react-grid-layout`
- rewrote `useProjectWorkbenchStore.ts` so it now stores:
  - tile metadata
  - active tile
  - serialized Dockview layout
  - reset key for full layout rebuilds
- removed manual `x/y/w/h` geometry and snapped grid state from the workbench model
- added `WorkbenchDockPanels.tsx` so existing browser / terminal / dev server / changes surfaces could plug into Dockview as real workbench panels
- replaced `ProjectWorkbenchPage.tsx` with a Dockview shell that:
  - hydrates from serialized layout
  - rebuilds a default dock when reset
  - reconciles store tiles against live panels
  - persists Dockview layout snapshots
  - keeps selected task cards outside the dock
- replaced the old grid CSS with Dockview theme overrides aligned to the app tokens
- removed the dead `WorkbenchTileFrame.tsx` grid-era chrome component

For our own reference:

- Dockview owns panel mechanics now
- the store no longer pretends it owns workbench geometry
- task cards stay contextual and external to the dock
- browser isolation still lives in Electron, not in the layout library

### Verification

Completed:

- `bun run typecheck`
- `bun run dev`

Observed:

- Electron main, preload, and renderer booted cleanly after the Dockview swap
- the existing Pierre/Shiki unused-import warning still appears during dev boot, but it is unrelated to the workbench migration
