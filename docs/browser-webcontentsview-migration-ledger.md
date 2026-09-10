# Browser `WebContentsView` Migration Ledger

Tracks the migration from the renderer-wide T3 `<webview>` host to main-owned
`WebContentsView` browser surfaces.

The table below mirrors `shared/browserSurfaceMigrationLedger.ts`, which is the
enforced source of truth: `tests/architecture/legacyBrowserRemoval.test.ts`
asserts against that module, so a family cannot change backend without an
explicit, reviewable ledger edit. Update both together.

## Migration states

| State | Meaning |
| --- | --- |
| `LEGACY_WEBVIEW` | Renderer-wide T3 `<webview>` host owns the surface. |
| `NATIVE_SHADOW` | A native view exists for parity tests but is not product-visible. |
| `NATIVE_CANARY` | This family uses the native path while others remain legacy. |
| `NATIVE_REQUIRED` | Native path is mandatory; falling back to `<webview>` is a test failure. |

Both systems may coexist on the branch only while at least one family is
`LEGACY_WEBVIEW` and another is `NATIVE_CANARY`. Final state is every family at
`NATIVE_REQUIRED` with no renderer `<webview>` browser host remaining.

## Surface families

| Surface family | Active backend | Automation parity | Storage parity | Overlay parity | Status |
| --- | --- | --- | --- | --- | --- |
| `browser` | main-webcontentsview | native-pending | native-pending | native-pending | `NATIVE_CANARY` |
| `devServer` | renderer-webview | legacy-baseline | legacy-baseline | legacy-baseline | `LEGACY_WEBVIEW` |
| `projectDevApp` | renderer-webview | legacy-baseline | legacy-baseline | legacy-baseline | `LEGACY_WEBVIEW` |
| `orgDevApp` | renderer-webview | legacy-baseline | legacy-baseline | legacy-baseline | `LEGACY_WEBVIEW` |
| `devAppPreview` | renderer-webview | legacy-baseline | legacy-baseline | legacy-baseline | `LEGACY_WEBVIEW` |

`legacy-baseline` means the behavior was measured on the `<webview>` host and is
the target the native path must match. It is not evidence about native code.

## Phase log

| Phase | Outcome | Commit |
| --- | --- | --- |
| 0 — reverse obsolete guards, establish measurements | complete except the interactive performance scenarios | `eccbf98f` |
| 1 — T3 accepts trusted main-created browser contents | complete | `t3code` `113abb57` |
| 2 — repin, native session registry, view and host | complete | `cb48b18a` |
| 3 — Browser surface on the native backend | code complete; `browser` flipped to `NATIVE_CANARY` for interactive acceptance | see below |

## T3 pin

| | Commit |
| --- | --- |
| Planning baseline | `be4668f7b439499f39a659055d0f6ec34ac666b2` |
| Current pin | `113abb57e5977950c8c7204030dac77084d7b700` |

The current pin is one commit ahead of the planning baseline. That commit
(`717f4f14`, branch `cozea/computer-use-v2-contract`) vendors the generated
Computer Use v2 contract and is unrelated to this migration; it moves no browser
code.

Phase 2 repinned the parent to `113abb57`
(`cozea/preview-generic-browser-contents`), which generalizes the
`PreviewManager` registration boundary.

### T3 registration boundary after Phase 1

| Path | Ownership proof | Renderer-reachable |
| --- | --- | --- |
| `registerWebview` | guest reports webview type and hangs off the app window | yes, via existing IPC |
| `registerBrowserContents` | id vouched for in-process by the main service that created the view | no |

`trustNativeBrowserContents` is deliberately absent from the IPC methods, the
preload bridge and the web renderer, so a renderer cannot nominate an arbitrary
`WebContents`. Vouches are withdrawn on destroy or crash because Chromium
recycles `WebContents` ids.

## Native substrate (Phase 2)

Main-process code, none of it behind a product tile yet.

| File | Role |
| --- | --- |
| `BrowserSurfaceSessionRegistry.ts` | resolves a descriptor to its configured Electron session |
| `BrowserSurfaceWebPreferences.ts` | the security posture for a native surface, electron-free so it is testable |
| `BrowserSurfaceView.ts` | one main-owned `WebContentsView`, keyed by `runtimeTabId` |
| `BrowserSurfaceNativeHost.ts` | the map of live surfaces and the only thing that creates them |

The web preferences are deliberately not a copy of the `<webview>` posture. The
guest path runs `contextIsolation=false` so the annotation picker's preload can
read the page's React DevTools hook; a native surface is isolated by default and
a surface opts into `shared-world` explicitly. The OS sandbox stays on for every
posture, because that is what stops a shared-world preload from handing the page
`require`.

Native surfaces are reachable only through `probeNativeSurface`, which refuses
to run unless `COZEA_BROWSER_NATIVE_SHADOW=1`. The architecture test asserts
that is the sole creation site, so no production surface can acquire one before
its ledger row moves.

`bun run smoke:native-browser-surface` drives a real Electron
`WebContentsView` through create, hidden, layout, visible, navigate, hide, show
and destroy, and asserts the `WebContents` id handed to automation is the one
observing the loaded page, with no `<webview>` in the process.

## Native Browser path (Phase 3)

`browser` is now `NATIVE_CANARY`: the Browser tile renders through a main-owned
`WebContentsView`, and no `<webview>` is created for it. The other four families
are untouched and still on the renderer host, which is what `NATIVE_CANARY`
means -- one family migrated, the rest legacy.

`automationParity`, `storageParity` and `overlayParity` read `native-pending`
until the interactive checks below actually pass. They are not evidence.

| Piece | Role |
| --- | --- |
| `shared/browserSurfaceLayout.ts` | the bounds contract, and rounding that avoids a tile seam |
| `browserSurfaceLayoutScheduler.ts` | one measurement and at most one publish per frame per surface |
| `browserSurfaceModel.ts` | reference-counted models keyed by `runtimeTabId` |
| `NativeBrowserSurfaceSlot.tsx` | a measured `<div>`; the native view is not its child |
| `BrowserSurfaceBackendSlot.tsx` | picks the backend from this ledger, not from a prop |

Geometry never enters a store. It changes every frame during a drag, so routing
it through shared state would rerender unrelated components at animation
frequency to move a native view.

Main does not scale by the renderer's reported zoom. An isolated renderer cannot
read Electron's zoom factor, and renderer-supplied geometry should not decide
placement, so main reads `webContents.getZoomFactor()` on the window it owns.

### Interactive acceptance still owed

These need a running workbench and are not covered by the suite. Until they
pass, the parity columns above stay `native-pending`.

With the move verified, the defining invariant now holds for mount, unmount,
move, resize, hide and return. Float and popout remain unverified and are
expected to misbehave while D4 and D5 stand.

- PH3-A: open a tile, navigate, back/forward, reload, title, favicon,
  find-in-page, zoom, DevTools, close and reopen.
- PH3-B: drag a Dockview split for ten seconds and confirm the surface stays
  attached with no oscillation and no repeated React commits.
- PH3-C: the T3 automation matrix against a native Browser tile.
- PH3-D: cookie sharing and isolation across two live tiles.
- PH3-E: a tile restored from a persisted layout, not one opened by hand, and a
  round trip to another top-level route and back. Both are currently broken by
  D1 and were never covered by the original PH3-A pass.
- ~~Drag a tile between groups and confirm `webContentsId` is unchanged~~
  **PASSED 2026-09-10.** A browser tile moved to another group kept
  `webContentsId` 8, never stopped drawing (`was: true` straight through), and
  re-laid-out from 492px to 991px wide in one step. Unsubmitted text in the page
  survived, which a rebuilt browser could not have preserved. Driven by hand:
  synthetic mouse events cannot trigger HTML5 drag-and-drop.

`bun run smoke:native-browser-surface` already covers navigation, history,
reload, title, zoom, DevTools and the storage-parity half of PH3-D against real
Electron. find-in-page is not asserted there: a `WebContentsView` in that harness
reports `document.visibilityState` as hidden and never runs
`requestAnimationFrame`, so a search is timing-dependent rather than a real
signal.

## Open defects

Found by driving a running workbench on 2026-09-10. Ordered by severity. None
of these is covered by the suite, which is the point: every one of them was
invisible to 2843 passing tests because the failure path is a silent drop
rather than an exception.

### D1 - Leaving the workbench destroys the browser and returns a blank tile

Navigating to another top-level route (Inbox, DevApps Store, ...) and back does
not hide the surface, it releases it. The deferred release exists to survive a
Dockview remount, but a route change keeps the tile unmounted long enough for
the macrotask to fire, so the surface is destroyed and a fresh Chromium is built
on return -- `webContentsId` observed going 2 -> 4. The page is gone, not merely
unpainted, which breaks the migration's defining invariant.

The rebuilt surface then never draws. The renderer computes every term of
`surfaceVisible` as true while main holds `wantsVisibility: false`, so
`setNativeSurfaceVisible(true)` is lost somewhere on the rebuild path. This is
the same class as the creation race fixed in `5447b99e` -- desired state stated
before main can accept it -- except the one-shot flush on `ensure()` does not
cover a slot that unmounts again before creation resolves.

Two surfaces also churn per one visible browser tile, with the tile's identity
inputs (`tileId`, `projectId`, `laneId`, `workspaceId`, session key) all stable
across renders. The second surface's origin is not established; a hidden
keep-alive workbench session mounting its own copy is a hypothesis, not a
finding.

Severity: highest open defect. It breaks surface lifetime, not presentation.

### D2 - Native surfaces paint above all application UI

A `WebContentsView` is a native layer composited above the window's web
contents, so every piece of DOM that is meant to sit over a browser tile --
dropdowns, popovers, modals, drawers, toasts, drag overlays -- is covered by the
page instead. CSS `z-index` cannot address this (INV-011), and the plan's answer
is INV-009: an overlapping overlay must take the surface off screen rather than
try to draw over it.

The mechanism for that exists and is wired end to end -- `setOccluded` through
the model, preload, IPC and `BrowserSurfaceView` -- and has no caller anywhere
in the application. Nothing computes overlap, so nothing is ever occluded.

Native menus are unaffected: they are separate OS windows and correctly render
above the surface.

Deliberately not fixed yet. Doing it properly means deciding what counts as an
overlapping overlay and who owns that computation, which is Phase 4 work.

### D3 - The surface trails the tile through any continuous resize

Any gesture that resizes a browser tile continuously leaves the native view
behind the pane edge for the duration of the drag: a black gap on the growing
side, page painted past the tile boundary on the shrinking side. It settles
correctly on release. Confirmed for the splitter between two tiles, and for
dragging the OS window edge; the sidebar splitter is the same path.

Moving a panel between groups is *not* affected, which is the tell: that gesture
has no continuous phase, so the surface relands once at its new rectangle.

This is latency, not layering, and it is not the same root cause as D2. The DOM
pane resizes synchronously in the renderer while the surface's new rectangle has
to be measured, coalesced to a frame, and carried across an IPC boundary before
main can call `setBounds`. The native layer is therefore always at least one
round trip behind a continuously moving edge, and at drag frequency that reads
as tearing.

Occluding during the drag would hide the symptom but also hide the page exactly
while the user is sizing it to fit, which is the wrong trade for this gesture --
unlike an overlay, where hiding is the correct answer. The real options are to
shorten the path geometry travels, or to accept the trail and make it less
visible. Neither is decided.

That the OS window resize reproduces it too rules out anything Dockview-specific
and confirms the shape of the problem: it is not about which widget is being
dragged, only about the rectangle changing every frame.

### D4 - Floating group order is computed and then ignored

`nativeOrder` is derived from Dockview's `aria-level` and shipped to main inside
the bounds payload, but `BrowserSurfaceView` never reads it. Real ordering
happens only through `bringToFront()`, reached via `setSurfaceOrder`, which has
no caller. Two overlapping native surfaces therefore sit in creation order
rather than float order.

### D5 - A popped-out group leaves its surface in the main window

`moveToWindow` exists and is covered by a test, and has no caller. Dockview's
`addPopoutGroup` opens a real second `BrowserWindow`, so a popped-out browser
tile keeps drawing in the window it came from.

### D6 - Workbench layout is lost on a keyboard hard reload

Pre-existing and outside this migration: `useWorkbenchDockviewRuntime.ts` and
`workbenchLayoutPersistence.ts` are untouched by this branch. Recorded here
because it was found while testing it, and because it destroys evidence.

Reproduces with a non-default layout, the pointer over the sidebar, and a real
Shift+Cmd+R. The same command from the View menu does not reproduce it. On a
failed restore the catch calls `clearPersistedWorkbenchLayout`, so the saved
layout is deleted: the next reload looks innocent and the layout is
unrecoverable.

Partially diagnosed. The stored record was present at boot with a matching
`layoutResetKey` and `bindingRevision` and not deleted, yet the peek returned
nothing because the stored `layout` field failed `isLayout` (needs `grid` and
`panels`). That points at a degenerate layout being written, not a read-side
rejection. A hydration race was ruled out: the effect is guarded on
`!input.isLayoutPersistenceReady`.

### Coverage gap this exposed

PH3-A was driven only against tiles opened by hand in a session that was never
navigated away from. Tiles restored from a persisted layout, and route
round-trips, were never exercised -- and both D1 and the intermittent
blank-on-boot live exactly there. Restored tiles and route changes belong in the
acceptance list in their own right.

## Performance baseline (Phase 0)

Baseline is captured on the legacy `<webview>` host at parent commit `6f13aa8c`,
so Phase 10 can repeat the same scenarios against the native path.

Scenarios required before cutover comparison:

| # | Scenario | Baseline |
| --- | --- | --- |
| 1 | One Browser tile resize | see `Static baseline` below |
| 2 | Two Browser tiles side-by-side, resizing the split | not yet captured |
| 3 | One Browser + one Dev Server, resizing | not yet captured |
| 4 | Floating Browser tile movement | not yet captured |
| 5 | Device viewport resize | not yet captured |
| 6 | Hidden/inactive browser CPU behavior | not yet captured |
| 7 | Browser memory with 1, 3, and 5 live surfaces | not yet captured |

Scenarios 2-7 require an interactive Electron session with live browser tiles and
are captured as part of the Phase 10 comparison run, against this same build, so
both halves of the comparison come from one measurement method.

### Static baseline

The layout path's cost is dominated by how often the renderer measures a tile and
publishes bounds. That is measurable without a running app and is recorded here
because Phase 3 changes exactly this code:

- Geometry publication in `apps/desktop/src/features/browser/BrowserSurfaceSlot.tsx`
  is coalesced to at most one measurement and one publish per animation frame per
  surface, and identical rectangles are suppressed before they propagate.
- Triggers that can mark a surface dirty: `ResizeObserver` on the slot element,
  `window resize`, capture-phase `window scroll`, and Dockview position changes.

The plan requires the native path to hold the same bound: at most one
measurement/send per animation frame per surface, with unchanged bounds suppressed
before IPC.
