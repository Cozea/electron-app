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
| 0 — reverse obsolete guards, establish measurements | complete | see branch `feat/browser-wcv-modernization` |

## T3 pin

| | Commit |
| --- | --- |
| Planning baseline | `be4668f7b439499f39a659055d0f6ec34ac666b2` |
| Current pin | `be4668f7b439499f39a659055d0f6ec34ac666b2` |

Phase 1 generalizes the T3 `PreviewManager` registration boundary and Phase 2
repins through the repository's existing pin scripts. A `t3code` commit
(`97ed6a3e`, branch `fix/computer-use-effect-v4`) exists ahead of the pin but is
unrelated to this migration and is not yet pinned.

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
