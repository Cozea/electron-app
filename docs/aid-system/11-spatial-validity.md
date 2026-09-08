# D11 — Coordinate frames, target dependencies and stable surfaces

**Purpose:** remove v2's observe/stroke/observe lockstep without making stale screenshots universally authoritative. **Baseline:** `CoordinateLeaseGuard` requires equal observed and input versions; any input invalidates all subsequent screenshot coordinates. **Source substrate:** [S11–S15](29-research-register.md#s11), coordinate conversion [S19](29-research-register.md#s19). The dependency system itself is a Cozea design.

## 1. Typed coordinate spaces

Define `ImagePixelPoint`, `WindowPoint`, `DesktopQuartzPoint`, `DisplayAppKitPoint`, and `SurfaceNormalizedPoint` as distinct contract variants. Every point names its frame ID/generation; plain `{x,y}` without a frame is not a public physical target. Numbers must be finite, bounded and serialized consistently.

A screenshot point maps through crop offset and scale to its source window/display frame, then through the current validated window-to-desktop transform. Overlay presentation uses a separate desktop-to-AppKit transform. Preserve an explicit affine transform and inverse for each relation; reject singular transforms and out-of-domain points. Never apply a global `y = height - y` without identifying which display/window frame the height belongs to.

Geometry is in logical points for AppKit/input and backing pixels for image data. Display layouts can contain negative origins, different scale factors and gaps. Use per-display mappings and platform conversion APIs; a Retina screenshot does not justify dividing every coordinate by two. Coordinate math tests cover all corners, edges, gaps, multiple displays and roundtrips.

## 2. Target types and required dependencies

| Target | Dependencies before dispatch |
| --- | --- |
| Semantic element | launch/window identity, retained or unique scope match, role/action/meaning, enabled state, relevant bounds, blocking UI |
| Observed image point | source frame/window generation, image transform, relevant layout/focus/modal state, age/coverage |
| Surface point/path | established surface identity/anchors, transform generation, intent, bounds, control epoch and relevant mode/scroll/zoom |
| Keyboard target | intended foreground app/window/focus lineage and operation semantics; not screenshot pixel age |
| Application bootstrap | eligible installed/running app identity, launch target and grant; no content observation required |

The native validator returns `valid`, `refresh-needed`, `ambiguous`, or `invalid` plus dependency reasons. It does not silently reassign a stale target. An explicit reacquisition policy can rerun a selector and return a new handle with replacement evidence; callers decide whether that is still their intent.

## 3. Separate revision dimensions

Maintain independent revisions for runtime/launch, window identity, display transform, window geometry, foreground/focus, blocking UI/occlusion, semantic identity/meaning, surface transform/layout, and content evidence. Input revision remains an audit sequence, not a blanket veto. AX events dirty dimensions; they do not by themselves prove a particular dimensional change.

A value update outside the target scope may need no invalidation. A label change from Save draft to Send changes semantic meaning even with fixed geometry. A selected drawing tool changing can invalidate gesture intent while canvas geometry remains identical. Document navigation can replace a surface even when the window title and dimensions are unchanged.

The system must not classify every event occurring after our action as self-generated. Expected-change allowances are narrow and declared by an interaction contract. Unexpected modal/focus/geometry signals remain blocking regardless of temporal proximity to input.

## 4. Surface acquisition

`Observation.bindSurface({region, anchors, intent, verification})` takes an actually observed region, not invented future pixels. Bind the region to exact source identities and transforms. Anchors may include a retained AX container, stable application geometry, authorized read-only layout instrumentation, or qualified visual landmarks. Record which evidence sources are available and their uncertainty/notification coverage.

A `surfaceId` is scoped to a live control epoch. Default age limit is 30 seconds and 20 completed gestures before a **local contract revalidation**, not necessarily a new image export or model turn. The trusted host can renew limits after revalidation; callers can request stronger initial profiles for longer work. Do not make twenty gestures an arbitrary permanent product restriction.

For weak canvases without reliable scroll/zoom/mode evidence, use local image/anchor checks and smaller lookahead. If ambiguity remains, stop and emit a decision packet. This is a genuine sensing limitation, not permission to declare safety by setting a longer TTL.

## 5. Drawing contract

A drawing contract permits content changes within the observed canvas consistent with programmed ink. It does not permit geometry changes, arbitrary new overlays, tool-mode switches, document replacement or user interference. Before each stroke validate foreground/window identity, surface bounds/anchors, selected tool evidence where available and no blocking region. During the held path, native event/geometry signals can revoke remaining samples.

Between strokes, retain the original coordinate frame while validating relevant dimensions. No full AX tree or encoded screenshot is required just because input sequence increased. A final explicit observation verifies visible result. Local pixel evidence may verify that a stroke had an effect, but cannot independently determine artistic correctness.

Window movement during a held gesture aborts and releases. For a not-yet-started gesture, the caller may explicitly request rebasing to a freshly validated moved surface; that returns a new transform generation. Do not silently follow a moving target midstroke without a qualified servo contract.

## 6. Occlusion and focus

Physical input requires the target point to belong to the intended visible interaction surface, not merely lie inside the app's original bounding box. Verify frontmost app/window, relevant sheets/menus/popovers and known occluders. Where available use a scoped AX hit test or WindowServer evidence; do not mistake either for an infallible pixel ownership oracle.

An app-owned sheet may be a legitimate new interaction target but is not automatically the old document surface. Require explicit selection/reacquisition. Cozea-owned overlays are excluded from scene matching while remaining visible and noninteractive where appropriate. Other windows are not globally filtered because they are small or titlebar-less.

## 7. Validation algorithm

At preparation, resolve dependencies and prepare a `ValidationToken` containing their observed generations, expiry and target digest. At seat admission and after cursor arrival, compare/re-read the critical dimensions. Any dirty relevant dimension triggers bounded native reconciliation. If unchanged, renew the token; if meaning/geometry differs, return a typed failure before contact.

A token is not durable authorization. Revocation epoch is checked at every event admission, independent of cached target validity. A race remains between OS validation and actual event receipt; measure and minimize that interval. No claim of an atomic desktop transaction is permitted.

## 8. Tests and code map

Create pure `CoordinateFrames`, `AffineTransform`, `TargetDependencies`, `SurfaceContract` and `ValidationDecision` in the portable core; native `TargetValidator` performs OS reads. Replace `CoordinateLeaseGuard` only after behavior tests exist, preserving old guard tests as baseline regression descriptions rather than deleting safety coverage.

**SPACE-01:** image/crop/window/display mappings roundtrip at 1×/2× and mixed negative-origin layouts. **SPACE-02:** own ink allows repeated strokes without image export. **SPACE-03:** unrelated status tick does not block a stable semantic target. **SPACE-04:** Save-to-Send label change blocks old intent. **SPACE-05:** scroll/zoom/move/document replacement invalidates the correct frame. **SPACE-06:** modal/occlusion/takeover stops a held gesture. **SPACE-07:** weak coverage is surfaced and cannot be upgraded by an ID alone. **SPACE-08:** out-of-bounds/nonfinite/singular transforms fail before input. **SPACE-09:** expired epoch cannot renew a surface. **SPACE-10:** explicit reacquisition creates a new handle and never silently remaps an index.
