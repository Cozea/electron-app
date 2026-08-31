# Workbench browser and overlay architecture

> **Canonical runtime contract (2026-08-31).** This document describes the active T3 `<webview>`
> host, Dockview integration, and application overlay model. Historical `WebContentsView` plans are
> not implementation guidance.

## One rendering and layering model

Cozea has one renderer-wide `ElectronBrowserHost`. Browser, Dev Server, compatibility Project
DevApp, and Org DevApp tiles publish renderer-local rectangles through `BrowserSurfaceSlot`; the
host keeps each living `<webview>` mounted and places it over that rectangle. There is no native
`WebContentsView`, bounds IPC, screenshot substitution, native-surface occlusion observer, or
fallback browser path.

Every element that can overlap a living guest follows the typed/CSS layer contract in
`apps/desktop/src/lib/appLayers.ts` and `apps/desktop/src/index.css`:

| Layer | Owner                   | Purpose                                             |
| ----- | ----------------------- | --------------------------------------------------- |
| 30    | browser host            | Docked living guests                                |
| 1000+ | Dockview + browser host | Same-window floating groups and their living guests |
| 8000  | Dockview                | Drag/drop targets                                   |
| 9000  | shared portal           | Dialogs and bounded custom overlays                 |
| 9100  | shared portal           | Menus and popovers                                  |
| 9200  | shared portal           | Tooltips                                            |
| 9300  | shared portal           | Toasts and update notices                           |

Dockview publishes floating order through its public `aria-level` value. The browser presentation
hook mirrors that order into the global host, leaving the guest and its owning float in the same
ordering band. Dockview menus and drag targets use the semantic application layers rather than the
float band's internal z-index.

The workbench keep-alive root deliberately creates no isolated stacking context. A route or project
may be kept mounted and CSS-hidden, but active workbench content, hosted guests, Dockview floats,
and body portals all participate in this one application-level contract.

## Overlay ownership

- Browser-owned presentation—the find bar, zoom indicator, agent cursor, controller badge, device
  toolbar, resize rails, and surface edge frame—renders inside `HostedBrowserWebview`, beside the
  living guest. Tile components do not render copies of those overlays.
- Shared dialogs, sheets, menus, popovers, tooltips, and toasts use their existing body portals and
  semantic layer tokens.
- Custom full-application UI such as image/task previews uses `AppOverlayPortal`.
- The keyboard split chooser is the sole bounded custom overlay. It uses
  `AnchoredAppOverlayPortal` to preserve the tile rectangle while rendering in the global dialog
  layer.
- Project settings and Org DevApp logs/configuration use the shared Dialog primitive. They are not
  absolute children of a Dockview panel.

Do not add raw application-level z-index values or a second portal root. Local z-index values are
valid only for internal ordering inside a host-owned surface or an already-portaled component.

## Shape and movement

`BrowserSurfaceSlot` publishes both stacking order and the exposed Dockview card corners. The
global wrapper clips the guest with per-corner radii and paints an inset edge frame, so page pixels
cannot cover the workbench card's rounded edge. Header-at-top, bottom, left, and right layouts are
all represented explicitly.

Rectangle measurement stays in the renderer and is updated by the slot's resize, window, and
capturing-scroll listeners. Same-window dock, split, resize, maximize, and float retain the same
guest. Browser-backed cross-window popout remains disabled because the single renderer host does
not cross `Window` ownership.

## Lifecycle

All browser-backed tiles use `useWorkbenchPanelActivityMode`. A hidden panel or hidden keep-alive
workbench stops presenting its guest without creating a second browser lifecycle. Warm sessions
retain their manager-owned guest; freeze/close follows the existing workbench session policy.

## Adding an overlay

1. Use an existing shared dialog/menu/popover/tooltip/toast primitive.
2. If the UI is custom and application-wide, use `AppOverlayPortal` and a semantic layer token.
3. If it must preserve a tile rectangle, use `AnchoredAppOverlayPortal`; do not add an observer or
   bounds channel outside that helper.
4. If it describes or controls the browser surface itself, render it in `HostedBrowserWebview`.
5. Add an invariant to `tests/workbench/appLayerContract.test.ts` when introducing a new ownership
   category.

The architecture guard must continue to reject `WebContentsView`, legacy browser services and IPC,
native-surface overlay markers, screenshot stand-ins, and bounds synchronization.

## Verification

Automated gates cover semantic layer ordering, Dockview floating-layer translation, per-corner
clipping, host ownership of browser presentation, shared portal use, and the absence of legacy
native-browser adaptations. Live Electron validation must include:

- a Dockview tab menu over a living guest;
- a living guest inside a same-window floating panel, followed by redocking;
- find input and browser controls above the page;
- project settings above the living page and restoration of that same page after close;
- bottom-corner clipping and normal input at the page edge.

Use macOS Computer Use for the real Electron shell; browser-only automation cannot attach to the
application window.
