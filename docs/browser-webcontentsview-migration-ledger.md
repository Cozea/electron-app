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
| 0 — reverse obsolete guards, establish measurements | architecture work complete; interactive performance baseline still incomplete | `eccbf98f` |
| 1 — T3 accepts trusted main-created browser contents | complete | `t3code` `113abb57` |
| 2 — repin, native session registry, view and host | complete | `cb48b18a` |
| 3 — Browser surface on the native backend | implementation landed; pre-Phase-4 lifecycle correction pass landed; interactive parity still pending | see below |
| 4 — native overlay, focus, clipping, floating order | not started; no longer code-blocked by D1, but PH3-C/D/E must be rerun first | — |

## T3 pin

| | Commit |
| --- | --- |
| Planning baseline | `be4668f7b439499f39a659055d0f6ec34ac666b2` |
| Current pin | `50977ab641d9b43547275421530dba0383de7941` |

Phase 2 repinned the parent to `113abb57`
(`cozea/preview-generic-browser-contents`), which generalizes the
`PreviewManager` registration boundary.

### T3 registration boundary after Phase 1

| Path | Ownership proof | Renderer-reachable |
| --- | --- | --- |
| `registerWebview` | guest reports webview type and hangs off the app window | yes, via existing IPC |
| `registerBrowserContents` | id vouched for in-process by the main service that created the view | no |

`trustNativeBrowserContents` remains absent from renderer IPC. The pre-Phase-4
correction pass also makes the vouch transactional: failed native registration
revokes the vouch, and normal native release revokes before Chromium closes the
`WebContents`, so a recycled id cannot inherit trust.

## Native substrate (Phase 2)

| File | Role |
| --- | --- |
| `BrowserSurfaceSessionRegistry.ts` | resolves a descriptor to its configured Electron session |
| `BrowserSurfaceWebPreferences.ts` | security posture for a native surface |
| `BrowserSurfaceView.ts` | one main-owned `WebContentsView`, keyed by `runtimeTabId` |
| `BrowserSurfaceNativeHost.ts` | map of live surfaces and sole native creator |

`bun run smoke:native-browser-surface` drives a real Electron
`WebContentsView` through create, hidden, layout, visible, navigate, hide, show
and destroy, and asserts the `WebContents` id handed to automation is the one
observing the loaded page, with no `<webview>` in the process.

## Native Browser path (Phase 3)

`browser` remains `NATIVE_CANARY`. The Browser tile renders through a main-owned
`WebContentsView`; the other four families remain on the legacy host.

`automationParity`, `storageParity` and `overlayParity` remain `native-pending`
until their interactive checks actually pass. Do not flip these from code
inspection alone.

| Piece | Role |
| --- | --- |
| `shared/browserSurfaceLayout.ts` | native bounds contract and edge rounding |
| `browserSurfaceLayoutScheduler.ts` | deduplication and frame-coalescing for noisy position signals |
| `browserSurfaceModel.ts` | renderer presentation proxies keyed by `runtimeTabId`; no longer browser lifetime owner |
| `NativeBrowserSurfaceSlot.tsx` | measured DOM stub; size changes flush immediately, noisy position changes remain frame-coalesced |
| `BrowserSurfaceBackendSlot.tsx` | selects migration backend from the machine ledger |

Geometry never enters a shared store. Main reads the host renderer zoom factor
it owns rather than trusting renderer-supplied zoom.

### Pre-Phase-4 correction pass — 2026-09-10

The canary audit found that the first implementation still let presentation
lifecycle control native browser lifetime. That contradicted the already-canonical
workbench session model (`active` / `backgroundWarm` / `backgroundFrozen` /
`closed`). The correction pass deliberately fixes the substrate before Phase 4
adds overlay and multi-window complexity.

Landed corrections:

- `cda964a2` — renderer model owners are presentation leases only. Last-owner
  release hides the WCV and evicts the renderer proxy; it does not close runtime.
- `e19aff6e` — actual Browser tile deletion explicitly closes the surface after
  verifying the persisted workbench tile is gone. Route/Dockview/StrictMode
  unmounts do not.
- `45ac20ca` — native trust is revoked before `WebContents.close`, failed attach
  revokes best-effort, native order is canonical back-to-front and deduplicated,
  full renderer invalidation delegates to the logical lifecycle owner.
- `cbd3a3f2` — corner radius is deduplicated independently from bounds so a
  radius-only transition is not dropped.
- `4d003071` — `ResizeObserver` and OS-window resize flush authoritative geometry
  immediately instead of waiting an extra animation frame; noisy Dockview
  position signals remain rAF-coalesced.
- `9c0eb01f` — replaces false-positive Symbol-owner tests with real owner identities
  and adds route-length proxy eviction + close/ensure race coverage.
- `79e89ff1` — `T3BrowserSurfaceService` now reuses already-prepared warm state
  without re-navigation, supplies the native picker preload, makes T3 trust
  registration transactional, tears logical and native state down together,
  and performs full cleanup on renderer document invalidation.
- `b9318e82` / `72b3b828` — D6 protection: invalid Dockview teardown snapshots
  are refused at the persistence boundary instead of overwriting the last valid
  layout; regression coverage added.
- `90a33c13` — focused native host regressions for radius-only updates,
  trust-before-close, attach-failure revocation, order dedupe and renderer
  invalidation delegation.

### Canonical lifetime after this correction

| Event | Native WCV | Logical T3 surface |
| --- | --- | --- |
| Dockview tab hidden | alive, hidden | alive |
| Tile moves/remounts | same WCV | same |
| Workbench route backgrounds while session is warm | alive, hidden | alive |
| Return to warm workbench | same WCV / same `webContentsId` expected | same |
| Actual Browser tile close | disposed | closed |
| Workbench session becomes `backgroundFrozen` and policy evicts surfaces | disposed | closed |
| Workbench session closes | disposed | closed |
| Full renderer document reload/crash | old WCV disposed | old descriptor/T3 state closed |

The route/background rule is not an unresolved product choice: the existing
session architecture already states that route lifetime is not runtime lifetime
and that `backgroundWarm` preserves expensive runtime while detaching heavy UI.

### Interactive acceptance still owed

Before Phase 4 implementation begins, rerun:

- ~~PH3-A: open/navigate/back/forward/reload/title/favicon/find/zoom/DevTools.~~
  **PASSED 2026-09-10.** Address-bar navigation, in-page link navigation, back,
  forward, reload, title and favicon tracking in tile and sidebar, per-page
  colour scheme. One surface created, none disposed, zero errors across the
  whole pass, so navigation operated a single browser rather than churning
  them. Reload, zoom and DevTools-on-native-contents are additionally covered by
  `bun run smoke:native-browser-surface` on this head. find-in-page remains the
  documented harness exception and stays manual.
- PH3-B: continuous Dockview split + OS-window resize after `4d003071`.
  **Measured 2026-09-10; see D3.** The transport is not the bottleneck, so
  one-way layout IPC is not the next step. Whether the trail still reads as
  visually wrong during a smooth gesture remains a human check.
- ~~PH3-C: full T3 automation matrix against the native Browser tile.~~
  **RUN 2026-09-10 — passes except recording (D7).** Driven by
  `bun run acceptance:native-browser-automation`, which runs the real
  `T3BrowserSurfaceService` -- real preview manager, Effect runtime and
  Playwright locators -- against a real main-owned `WebContentsView`, and checks
  every operation through the visible contents directly rather than through
  T3's own report. T3 state is bound to the visible `webContentsId`; a value
  written by T3 is read back from the visible page; click, type, press, scroll,
  waitFor, snapshot, screenshot, navigate, back/forward, refresh and
  picture-in-picture all land in the visible browser without creating a second
  one; an untrusted live WebContents is refused registration. Recording fails
  (D7). Pointer and keyboard operations dispatch real input through CDP and so
  need the harness window unoccluded; an observation row records page
  visibility, focus and animation frames immediately before them. Two runs
  made while the window sat on another Space timed out on click and press,
  and the same checks pass with it visible -- attributing those two runs to
  occlusion is inferred, since they predate the observation row.
  Isolated as manual, each with a stated reason: picker element selection
  and annotation submission (need a real pointer gesture; the picker opens and
  cancels on the native tab), find-in-page (harness visibility), recording frame
  production (blocked by D7).
  Harness note: the vendored runtime imports Playwright's injected script with
  Vite's `?raw`, so the build must load that file as text; bundling it as code
  executes Playwright inside main at load.
- ~~PH3-D: cookie/storage sharing and isolation across live Browser tiles.~~
  **PASSED 2026-09-10** via `bun run smoke:native-browser-surface` against real
  Electron sessions on this head: two surfaces in one workspace share storage,
  different workspaces do not, ephemeral surfaces are isolated from each other,
  and an ephemeral surface cannot write into workspace storage. Asserted at the
  session layer that backs the tiles rather than by opening two tiles by hand;
  the session is the isolation boundary, so this is the meaningful level.
- ~~PH3-E: persisted-layout restore and a route round trip.~~ **PASSED
  2026-09-10** — see D1. Persisted-layout restore brings back one surface with
  the layout intact; three route round trips preserved `runtimeTabId`,
  `webContentsId`, `live: 1` and scroll position.
- ~~Actual tile close~~ **PASSED 2026-09-10 (observable half).** Closing a
  Browser tile removed the tile, its sidebar entry and its inventory row
  together, the neighbouring tile reflowed, nothing was left painting over the
  workbench, and no errors were raised. Trust revocation before
  `WebContents.close` and descriptor/native teardown ordering are asserted
  directly by `browserSurfacePrePhase4Corrections` and the native-host
  regressions rather than inferred from the screen. The acceptance harness now
  also verifies the internal half through the real service: native view,
  logical T3 state and inventory entry removed and the contents destroyed
  together.
- ~~Session freeze/close~~ **PASSED 2026-09-10** through the production
  eviction path, `releaseSurfacesForWorkbenchSession`, which
  `WorkbenchSessionManager` calls when a session freezes or closes: every view,
  inventory entry and contents of the evicted session went, while a second
  session's surface was untouched and stayed automatable.
- ~~Full renderer reload~~ **PASSED 2026-09-10.** Run with a live browser
  surface present, not an empty workbench: after Force Reload the tile returned
  painting its page with the correct title, the layout was preserved, nothing
  from before the reload survived on screen, and no errors were raised. The
  first attempt was discarded as meaningless because the workbench had no live
  surface to orphan. The acceptance harness repeats it through the real service:
  a main-frame document replacement leaves no native, logical or inventory
  survivor, and the next surface receives only its own fresh identity.

The previously verified group move remains valid evidence: the tile retained the
same `webContentsId` and unsubmitted page state through the move.

## Defect status before Phase 4

### D1 — route change destroyed browser / returned blank

**Closed 2026-09-10. Identity-boundary correction landed and PH3-E verified
interactively.**

The pre-Phase-4 lifecycle correction was necessary but not sufficient. PH3-E
still failed against it, and the instrumented run showed why: the same tile
produced two browsers under two session keys.

| | `runtimeTabId` | wc | `workbenchSessionKey` |
| --- | --- | --- | --- |
| boot | `16ee7d1c…` | 2 | `…lws_6a2c8d77…::v1` |
| after route trip | `563f0ac8…` | 3 | `…lws_6a2c8d77…` |

Same `tileId`, `live: 2`, no dispose, tile blank. The second key is exactly the
`resolveBrowserWorkbenchSessionKey` fallback: `ProjectWorkbenchSurface` supplies
`workbenchSession?.sessionKey ?? null`, which is null while the session
lifecycle re-resolves on remount, so identity was minted from provisional
presentation state. A `runtimeTabId` that changes is a second Chromium browser
by definition, so this was INV-002 being undermined by a helper written for
scoping.

Correction: `browserSurfaceRuntimeTabId` now requires the canonical session key
and returns null otherwise; `canonicalBrowserWorkbenchSessionKey` reports
readiness without substituting anything.
`resolveBrowserWorkbenchSessionKey` is retained for scoping only and documented
as invalid input for runtime identity. Revision suffixes are untouched: `::v1`
and `::v2` remain distinct sessions. `WorkbenchBrowserTile` and
`BrowserNavigationControls` — which derives identity independently — both
withhold browser creation until identity is canonical, while still rendering
their UI. The tile also stopped writing the fallback key into the descriptor it
sends to main. Dev Server, project DevApp, DevApp Preview and Org DevApp were
audited: all four already gate descriptor creation on a non-null `runtimeTabId`,
so they withhold automatically and stay legacy.

PH3-E evidence, three round trips across two routes on one warm session:
same `tileId`, same canonical `…::v1` session key, same `runtimeTabId`
(`2e546de1…`), same `webContentsId` (2), `live` stayed 1, no surface created or
disposed after boot, scroll position preserved, page still painting, zero
errors.

The "two surfaces churn for one visible tile" observation the ledger asked to
recheck is explained by this same defect and no longer reproduces: boot creates
exactly one surface.

Regression coverage in `tests/browser/browserSurfaceIdentityBoundary.test.ts`
pins that a temporary null mints nothing, that `::v1 → null → ::v1` returns the
same identity, and that `::v1 → ::v2` deliberately does not. Three of those fail
against the previous behaviour.

Root cause was architectural, not merely a lost `setVisible(true)`: the renderer
model treated last presentation owner loss as permission to destroy native
runtime, and logical/native release were separate operations. A close could also
race an in-flight ensure. The corrected model makes presentation release
non-destructive, makes warm prepare idempotent (no second navigation), closes
logical+native state together, and closes again after an ensure that loses a
race with explicit close.

The earlier "two surfaces churn for one visible tile" observation should be
rechecked after this correction. Cozea intentionally retains up to three
workbench sessions with effects alive, so diagnostics must distinguish separate
retained session identities from an actual duplicate `runtimeTabId`.

### D2 — native surfaces paint above application DOM

**Open; Phase 4 deliverable.**

The `setOccluded` transport exists. Phase 4 must implement the one overlay
coordinator that inventories relevant Cozea overlays, computes rectangle overlap,
blocks interaction, provides screenshot/neutral placeholder state, and hides /
restores the native WCV. CSS z-index is not a solution.

### D3 — surface trails tile during continuous resize

**Mitigation landed; remeasured 2026-09-10. Transport exonerated; presentation
latency is the remaining candidate.**

48 sash-resize updates were instrumented end to end -- renderer publish, main
arrival, and the `setBounds` call itself -- and correlated by width:

| Stage | Result |
| --- | --- |
| publishes / arrivals / `setBounds` calls | 48 / 48 / 48 (no drops, no queueing) |
| renderer to main IPC | p50 0ms, p90 1ms, max 1ms |
| `WebContentsView.setBounds()` | 41x 0ms, 7x 1ms |

That eliminates two of the four candidates outright: renderer-to-main IPC
latency, and the cost of the compositor call. Every published rectangle arrived,
in order, within a millisecond.

The remaining candidate is Chromium **presentation** latency, which is distinct
from the call cost measured above: `setBounds` returns immediately, but the
native view's new geometry is committed on a later compositor frame, so it is
inherently out of step with the DOM painting the same frame in the renderer.
DOM-to-measurement latency is not excluded -- it was not separately stamped --
but cannot account for a trail on its own given the transport numbers.

Consequence for the plan: **one-way layout IPC should not be attempted as the
next optimisation.** It targets a transport that is already sub-millisecond and
lossless, so it cannot materially change the trail. Any further work should
target presentation synchronisation instead.

Measurement limitation to respect: the drags were driven as discrete gestures,
producing ~12 updates each, so this measures per-update pipeline latency rather
than reproducing a smooth 60Hz drag. Whether the residual trail is acceptable to
the eye is still a human judgement and is not claimed here.

Diagnosis remains cross-process presentation latency. The first implementation
added an avoidable extra rAF after `ResizeObserver` / OS-window resize. Those
signals now flush immediately while Dockview movement remains coalesced. If the
trail remains materially visible, measure before changing transport; the next
candidate is one-way renderer→main layout IPC because bounds publication has no
meaningful response value.

Do not call D3 cosmetic: performance during resizing is one of this migration's
primary success criteria.

### D4 — floating order computed but ignored

**Open; Phase 4 deliverable.**

The host now defines the order contract unambiguously as back-to-front and
suppresses identical orders. Phase 4 still needs the workbench coordinator that
publishes the complete ordered native surface set when Dockview floating order
changes.

### D5 — popout leaves native surface in the main window

**Open; Phase 4 subproject.**

`moveToWindow()` exists, but actual window identity/reparenting is not wired and
the current Dockview runtime still normalizes browser-backed popouts back into
the dock. Phase 4 must map popout presentation to the correct Electron
`BrowserWindow`, reparent the same WCV, then remove the old prohibition.

### D6 — keyboard hard reload could overwrite/delete layout

**Write-side protection landed; original reproduction should be retested on its
own workbench-persistence track.**

The persistence writer now runtime-validates `grid` and `panels` before queuing
a record. A degenerate teardown snapshot cannot replace the last valid in-memory
or durable record. The original Shift+Cmd+R reproduction is still worth running
to determine why Dockview emitted the degenerate shape, but that observation no
longer has permission to destroy the last valid layout.

### D7 — recording cannot start on a native Browser surface

**Open. Found by PH3-C on 2026-09-10; blocks recording parity.**

`startRecording` in the vendored `Manager.ts` takes `wc.hostWebContents` as the
display-media requester and fails with `PreviewMainWindowClosedError` when it is
null. `hostWebContents` is the embedder of a `<webview>` guest; a main-owned
`WebContentsView` has none by definition, so recording on a native surface fails
in production, unconditionally. The pipeline assumes the embedder renderer
issues `getDisplayMedia` and that main's display-media handler matches
`request.frame.frameTreeNodeId` against it before granting the guest's main
frame as the source.

The error text is misleading: the window is open. The other gate on that path,
`frameCaptureWindowOpen`, was true -- `setMainWindow` sets it and only the
window's `closed` event clears it -- so the embedder check is the sole cause.

Scope is recording only. Picture-in-picture shares frame capture but not the
embedder requirement, and passes on native.

Fix direction, not implemented: for native-owned contents the requester is the
Cozea main window's renderer, which the manager already holds in
`mainWindowRef`, rather than `wc.hostWebContents`. The manager already
distinguishes renderer-webview from native ownership, so this selects the
requester by ownership rather than redesigning recording. It is a vendored T3
change and must go through the gitlink/pin process. The acceptance harness's
recording check is the regression target.

### Development-only artifact worth knowing

Hot-module replacement of the browser module family silently blanks live tiles.
`browserSurfaceModels` is a module singleton, so an HMR swap leaves two
registries alive at once: the pre-swap slot's cleanup sends `setVisible(false)`
for the same `runtimeTabId` that the new model has just set to `true`, and the
stale write wins. Layout keeps arriving, so the surface is positioned but not
drawn.

This cannot occur in production -- one module instance, one registry -- and a
clean restart restores the tile. It is recorded because it looks exactly like a
migration regression and was mistaken for one during this acceptance pass. Do
not edit browser-surface sources under a running dev server while testing.

## Phase 4 entry rule

Do not migrate a second surface family yet.

Phase 4 may begin only after the corrected PH3-C, PH3-D and PH3-E checks are run
and the D1 route/lifetime regression is confirmed closed.

Status 2026-09-10: every machine-drivable Phase 3 check has now been run.
PH3-A, PH3-D and PH3-E pass, D1 is closed, PH3-B is measured, and the
tile-close, session-freeze and renderer-reload gates pass through the real
service. PH3-C passes except recording, which fails on native surfaces (D7).
The genuinely manual PH3-C checks are isolated above with reasons.

Phase 4 is held on one decision: fix D7 first, or accept recording as a known
gap in the Browser canary and carry it as a precondition for `NATIVE_REQUIRED`
instead. Running the manual checks does not change that decision. D2, D4 and D5 are not
prerequisites to Phase 4; implementing them is Phase 4.

## Performance baseline (Phase 0)

Baseline is still anchored to the legacy `<webview>` host at parent commit
`6f13aa8c`.

| # | Scenario | Baseline |
| --- | --- | --- |
| 1 | One Browser tile resize | static path recorded |
| 2 | Two Browser tiles side-by-side, resizing the split | not yet captured |
| 3 | One Browser + one Dev Server, resizing | not yet captured |
| 4 | Floating Browser tile movement | not yet captured |
| 5 | Device viewport resize | not yet captured |
| 6 | Hidden/inactive browser CPU behavior | not yet captured |
| 7 | Browser memory with 1, 3, and 5 live surfaces | not yet captured |

The native canary now intentionally differs from the original static scheduling
baseline: direct size changes are published without an extra rAF, while noisy
position-only sources remain coalesced. Duplicate rectangles are still suppressed
before IPC and again before native `setBounds`.
