# D14 — Truthful pointer presentation, hotspot geometry and pacing

**Purpose:** retain the visible Cozea pointer while eliminating the inherited inverted glyph/hotspot mismatch and fixed ceremonial delay. **Baseline:** `CursorController` positions artwork using `tipAnchor`; the port forces `referenceImage = nil` and uses the procedural contour. The user observed a large inverted pointer. **Sources:** AppKit coordinates/HiDPI [S19](29-research-register.md#s19), display links [S20](29-research-register.md#s20).

## 1. Geometry is the authority

Create a repo-owned vector glyph with its visible tip at local `(0,0)`. All scale, rotation, pulse and body effects apply around that origin. The glyph's raster bounds may include a halo/shadow, but bounds center is never treated as the hotspot. Derive hit/anchor transforms from the vector, not from a reference bitmap's remembered crop constants.

Initial design target is a 16-point pointer body and a smaller independent halo. Logical body size stays constant across 1×/2× backing scale. Backing buffers change resolution; input coordinates do not. Preserve the existing artwork's useful style only if it passes visual calibration. Do not redistribute extracted proprietary cursor binaries or assets; draw and own the new vector.

The invariant is `glyphHotspotInDesktop == scheduledInputPoint`, with stated numeric/presentation tolerance. Test every rotation, pulse extreme and supported display transform. Merely rendering the right neutral arrow is insufficient if rotation moves its tip away from the click.

## 2. Surface topology

Retain nonactivating, transparent, mouse-ignoring per-display AppKit panels with layer-backed views. Panels are owned by the native driver, not the renderer or guest. Recompute display mappings on configuration changes; revoke a gesture whose active transform becomes invalid. Gaps/negative origins are explicit, not clamped into the wrong display.

Order presentation relative to the active target at operation boundaries and relevant focus/Space events. Do not enumerate WindowServer or reorder the panel on every animation tick. Never let the overlay become key/main or steal the input it is depicting. Known own overlay window IDs are published to capture/window filtering.

## 3. Three pacing profiles

`fast-visible` is the normal design target. Use a distance-based approach duration such as `clamp(60 ms + 0.20 ms/point * distance, 60 ms, 250 ms)` as an initial calibration profile. Exact constants are adjustable only through a versioned profile after measurement. Tiny movements may retain a minimal arrival presentation rather than a long spring settling tail.

`presentation` permits slower choreography so a person can follow discrete steps. It changes pacing, not target validation or outcome claims. `direct-gesture` maps the cursor to the native held-path timeline without decorative overshoot or lagging springs. A drawing path must not be rounded into a pleasing approach curve.

Do not change pacing automatically based on task sensitivity as a substitute for approval. A fast visible destructive action may occur too quickly for human reaction; approval must be obtained before dispatch when required. The UI should clearly state pacing/control mode.

## 4. Arrival and contact

The motor kernel supplies a prepared approach path and target hotspot. Rendering uses display-synchronized callbacks, but a callback is not proof the frame has reached the user's eyes. At final position, record presentation submission and require the qualified arrival barrier before discrete contact. Measure actual visible contact skew in the fixture/video harness; do not claim causal correctness only because a continuation resumed after a callback.

The initial implementation uses final-layer-position submission followed by a subsequent display opportunity and target revalidation. If measured skew is excessive, adjust scheduling in the profile. Do not block AppKit with a nested run-loop pump or synchronous animation loop. The calling async operation suspends while the main thread remains responsive.

The click pulse starts at actual contact admission, not while merely preparing a click that may later fail. Pulse rendering must not delay unrelated observation work, and its completion should not impose a mandatory serial post-click delay. The pulse may finish while explicitly requested outcome verification runs.

## 5. Real pointer relationship

Foreground input may move the real macOS pointer; the prior preserve-user-pointer constraint is relaxed. The Cozea marker depicts that actual interaction. If system-pointer hiding is supported and reliably scoped, qualify it separately; never use fragile global hiding as a correctness dependency. A visible double pointer is a presentation limitation to solve/test, not justification for showing a false cursor position.

On normal release, restore any presentation state Cozea changed. On user takeover, do not warp the pointer back to a saved origin, do not fight movement and do not reactivate the previous application. Cursor state retained in pure workspace memory is only a historical value; it cannot make the driver move on resume without a fresh control grant.

## 6. Motion, effects and performance

Approach geometry may reuse the existing curved motion planner, adjusted to the new duration profile and true hotspot. Body sway/fog are secondary effects and cannot displace the authoritative tip. Precompute expensive path candidates off main. Frame callbacks update a bounded number of layer properties and never query AX or run JavaScript.

Idle motion is optional while a live control episode remains active; hide the marker at episode end. Reduce Motion/system accessibility preferences should map to a direct compact approach without removing causal feedback. Avoid 30 seconds of unexplained post-task pointer animation after control has already ended.

Budget frame work separately from total movement. Target p95 below 2 ms driver-owned main-thread work per frame on qualified hardware, with no deliberate blocking spans. This is a design target; profile with Instruments and measure dropped frames at 60/120 Hz.

## 7. Tests and assets

Create pure vector/hotspot raster tests at angles in 15-degree increments, scales1×/2× and pulse0/0.5/1. Use deterministic neutral render fixtures and an image mask to locate the actual tip. Add integration fixtures that mark the target and record received mouse coordinates. Test mixed displays and moving between them, full-screen, Spaces, display unplug, minimized targets and cancellation during approach.

**CUR-01:** vector tip is origin under all transforms. **CUR-02:** logical size is consistent across backing scales. **CUR-03:** input never precedes qualified visible arrival. **CUR-04:** held path and event path share samples. **CUR-05:** main-run-loop timer remains responsive. **CUR-06:** overlay cannot acquire focus or receive mouse input. **CUR-07:** takeover does not warp/reclaim. **CUR-08:** reduced-motion and presentation modes preserve correctness. **CUR-09:** glyph/halo size and orientation are reviewed in actual signed app at both scales. **CUR-10:** no proprietary reference asset is required at runtime.

Files: native `CursorGlyph`, `CursorSurface`, `CursorPacingProfile`, `CursorPresentationCoordinator`, pure `HotspotTransform`, and golden assets under test resources. Remove the forced-nil reference-image branch and inherited hard-coded anchor only after the new tests establish replacement behavior.
