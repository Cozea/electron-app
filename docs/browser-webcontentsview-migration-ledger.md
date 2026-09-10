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
| `browser` | renderer-webview | legacy-baseline | legacy-baseline | legacy-baseline | `LEGACY_WEBVIEW` |
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
| 2 — repin, native session registry, view and host | complete | see below |

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
