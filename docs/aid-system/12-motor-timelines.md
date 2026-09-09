# D12 — Native motor kernel, pointer primitives and coordinated timelines

**Purpose:** execute arbitrary relevant gestures with native timing, faithful visual feedback and independent cancellation. **Sources:** public Core Graphics posting/event sources [S17](29-research-register.md#s17), [S18](29-research-register.md#s18); display scheduling [S20](29-research-register.md#s20). These APIs do not establish universal hardware-equivalent event acceptance.

## 1. API and ownership

Expose pointer move/hover/click/down/up, relative motion, paths, drag/drop and scroll. High-level click/stroke helpers compile to the same native kernel as low-level primitives. The model can generate geometry in JavaScript; it never has to send each pixel through MCP. Relative motion is anchored to a verified current pointer/surface state and cannot escape the grant's allowed region.

One seat permit covers pointer, keyboard, modifiers and scroll phases. An operation holds that permit only while its native sequence requires it. A timeline expresses intentional overlap of channels; `Promise.all` over unrelated device calls is ordered, not a second physical mouse. The driver chooses and validates one qualified route before effects begin.

## 2. Timeline representation

A timeline contains operation ID, owner/control epoch, target/surface references, monotonic relative event times, channel descriptors, geometry artifact, interpolation mode, presentation profile, tolerances, deadline and expected held-state balance. Supported nodes are sequence, simultaneous independent channels, hold scope, path segment, wait-until-native-condition, and release. General arbitrary JS remains in the worker, not inside a native callback.

Points are stored in a bounded Float64 buffer or validated polyline artifact, with explicit coordinate frame and digest. A million points must not become a million JSON objects crossing every layer. Initial admission limit is 100,000 points/8 MiB per geometry artifact and 60 seconds per prepared timeline; longer work uses owned chunks under renewed host budget. These are resource profiles, not limitations on what the agent can draw.

Validate finite coordinates, containment, ordered nonnegative times, supported channels, balanced transitions and no impossible simultaneous same-channel states. Preserve explicit corners and endpoints. Interpolation is selected (`polyline` default, or a documented spline with its own overshoot constraints); never replace the specified curve with the cursor approach spring.

## 3. Execution algorithm

1. Authenticate/authorize, deduplicate operation identity, validate targets and compile a schedule off the main thread.
2. Acquire seat permit and re-read epoch, focus, target geometry and backend capability.
3. Record durable intent/possible-dispatch boundary through D16 before any side effect. Journal one timeline operation, not every sample with a disk fsync.
4. Visibly approach the starting hotspot under D14. Revalidate at arrival before the first contact.
5. Submit down/modifier transitions and drive path samples from a monotonic clock. Cursor position and event coordinates derive from the same scheduled sample stream.
6. At every admission tick check cancellation/epoch and any critical native invalidation flags; no blocking AX traversal inside the tick.
7. Emit required final endpoints and up transitions. Drain outstanding deliveries, reconcile held state and return the phase-aware receipt.
8. On interruption, stop future admission and send only tracked cleanup releases. Report the completed time/sample boundary and possible partial effects.

## 4. Scheduling and backpressure

Use a dedicated native input queue with bounded lookahead. AppKit layer updates occur on the main actor. Never run guest code or enumerate WindowServer from display callbacks. Scheduling cannot be hard real-time on a general desktop; receipts include planned and actual sample timing.

Discrete button/key edges and required corners cannot be dropped. Redundant intermediate movement may be coalesced within caller-declared spatial/time tolerance. If the UI thread/display lags behind input beyond the qualified skew bound, pause/stretch within tolerance or abort; do not knowingly send actions far ahead of what the person can see.

Initial profiles use display-aware movement sampling, with denser events only when the selected device/application benefits and visual alignment remains measured. A 120 Hz event schedule on a 60 Hz display cannot claim every event was individually visible. The relevant invariant is faithful path/contact ordering and bounded observed skew, not one displayed frame per raw event.

## 5. Held-state scopes

The SDK offers `withButtonDown` and `withKeys` helpers that clean up on exceptions. Raw down/up is also available within a live execution, but the native ledger owns actual held state. Guest `finally` is not the only cleanup mechanism: infinite loops, worker loss and host cancellation trigger native release independently.

A completed cell, model checkpoint, human approval wait or lost liveness may not retain live held state. During one streamed native gesture, a button can remain held across local chunks only with a valid lookahead deadline and live control. A missing next chunk releases the button and reports a partial gesture. Cleanup never fabricates a second down or activating click.

Track physical user input separately where the platform permits. Do not release every key globally or warp the mouse back after takeover. A conflict between actual hardware and automation-held modifiers is a fault to qualify, not an excuse to block human input.

## 6. Scroll, hover and drag/drop

Scroll exposes units (`pixels`/`lines`), axes, phase, momentum profile and optional modifiers. Advertise which phase semantics the qualified backend supports. Do not call repeated wheel deltas “trackpad pinch” or “inertial touch” unless actually supported.

Hover may require real pointer movement to trigger UI, not simply moving a decorative overlay. Runtime events and the overlay remain aligned. A tooltip or revealed menu may change the scene and require a new target selection. Drag/drop can include a dwell at the destination and application-specific acceptance verification requested by code; crossing arbitrary foreign windows is not permitted by a single-window surface grant.

For cross-window dragging, the program must acquire a multiwindow route with explicit allowed corridor/targets. The native scheduler validates destination/focus/occlusion and reports partial movement if the OS changes window ordering. Do not fake a file copy through the filesystem when drag/drop fails in visible mode.

## 7. Backends and uncertainty

Foreground public input is the first route to qualify. Semantic AX is used by higher-level semantic operations; it is not a provider for arbitrary drawn paths. SkyLight may support eligible compatibility actions behind D15's profile; no automatic retry after potentially delivered input. Richer HID providers are D26, not invented properties on public mouse events.

A returned submission receipt proves only the driver attempted the selected route. Live fixtures record both received input and resulting pixels/state. No-app-effect with no detectable receipt remains unverified, not necessarily a native dispatch error.

## 8. Implementation and tests

Extract `MotorScheduler`, `TimelineCompiler`, `InputOwnershipLedger`, `PointerBackend`, `NativeConditionBarrier`, `PresentationCoordinator` and pure timeline validation into the existing Swift package. Retire PID-only `DragSequence` after the same fixture coverage passes on the new kernel.

**MOTOR-01:** exactly one down, faithful timed samples and one up for a stroke. **MOTOR-02:** modifiers overlap the declared path interval only. **MOTOR-03:** cancellation at every event boundary stops admission and releases owned state. **MOTOR-04:** infinite guest loop cannot prevent cleanup. **MOTOR-05:** backpressure preserves endpoints/corners or reports failure. **MOTOR-06:** frame/event skew is measured, not inferred from callback order. **MOTOR-07:** gesture geometry is not replaced by approach easing. **MOTOR-08:** invalid/out-of-scope paths cause zero effects. **MOTOR-09:** streamed chunk starvation yields one cleanup release. **MOTOR-10:** same-seat competing calls cannot interleave. G04/G05 use live AppKit/WebKit/Electron and drawing applications; Notes remains a separately reported result.
