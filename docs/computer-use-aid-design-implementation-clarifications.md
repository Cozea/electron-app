# AID implementation clarifications and cross-subsystem review

Date: 2026-09-08. Status: normative design clarification; no runtime behavior is implemented by this document.

Read with the [expanded design index](computer-use-aid-design-index.md) and [reference architecture](computer-use-aid-environment-design.md). This review resolves implementation traps that arise at subsystem boundaries. It does not replace the detailed subsystem algorithms, API definitions and work packages. Where an older proposal conflicts with a clarification below, use this clarification and record the changed requirement in the implementation traceability matrix.

## 1. Research evidence and adoption rules

A primary-source page, a protocol release, an SDK symbol, a working build and a demonstrated desktop interaction are different evidence levels. Every integration qualification record must contain: source URL and adopted revision; exact compiler/runtime/SDK versions; OS build and architecture; test procedure; observed result; and the capability enabled by that result. A source availability or keyword check is not a semantic review or a live compatibility result.

The product does not depend on a particular future MCP release, WASI revision, beta capture API, or generated Swift C annotation. Transport adapters and optional providers are enabled only after their own conformance gates pass. The baseline architectural decision is transport-independent application state, not a claim that every deployed MCP client is stateless. Do not remove initialization/session handling from an existing host until the negotiated protocol version requires that change.

Likewise, an asynchronous JS-to-native API does not require a newly ratified asynchronous Wasm component ABI. A bounded request/promise bridge with explicit job-queue pumping is a valid initial implementation. The selected engine must demonstrate the contract, not merely advertise an adjacent feature.

Primary documentation relevant to these decisions:

- MCP versioned specification: https://modelcontextprotocol.io/specification/
- MCP lifecycle/transport must be read for the exact negotiated revision, not inferred from an unversioned blog title.
- QuickJS embedding: https://bellard.org/quickjs/quickjs.html
- Wasmtime security: https://docs.wasmtime.dev/security.html
- Wasmtime interruption: https://docs.wasmtime.dev/examples-interrupting-wasm.html
- WebAssembly component contracts: https://component-model.bytecodealliance.org/design/wit.html
- Node VM limitations: https://nodejs.org/api/vm.html
- App Sandbox: https://developer.apple.com/documentation/security/app-sandbox
- ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Accessibility: https://developer.apple.com/documentation/applicationservices
- Core Graphics events: https://developer.apple.com/documentation/coregraphics/cgevent
- W3C Trace Context: https://www.w3.org/TR/trace-context/

These sources support platform primitives. All cross-subsystem algorithms below are Cozea design decisions to implement and test, not claimed behavior of those platforms.

## 2. Identity is not authority

### 2.1 Required identities

Keep `workspace_id`, `control_id`, `execution_id`, `operation_id`, `checkpoint_id`, `observation_id`, `artifact_id`, `window_handle` and `surface_handle` distinct. Each native handle also stores a runtime-instance generation. Use opaque random external identifiers; monotonic counters may be private journal sequence numbers. A monotonic counter crossing a JSON boundary is a decimal string rather than an imprecise JavaScript number.

The host obtains the real Cozea device identity and workbench/thread/provider invocation from its trusted invocation context. The model supplies a handle to reference a resource, not a principal to impersonate. A request that substitutes another thread, provider instance or machine must fail before lookup returns resource metadata.

### 2.2 Capability record

A capability is a server-side record bound to principal, runtime instance, workspace, current control epoch, permitted seat/targets, device classes, execution mode, expiry and revocation state. Handle lookup rechecks this record. Never place a privileged raw native pointer, process handle or bearer token in JavaScript.

A handle may survive in JS memory after its authority expires. Calling it returns a structured stale/expired-capability error; it cannot renew itself. Reacquisition can create a new handle with new authority, but must not silently rebind an old `window_handle` to a similarly titled replacement.

### 2.3 Required negative tests

Substitute each identity dimension independently; reuse a handle after control release, process restart and driver restart; replay an old policy revision; send a forged current epoch; invoke an artifact from a different workspace; alter code while retaining the same execution id. Every case must fail without desktop input and without disclosing another scope's evidence.

## 3. Control lifetime and workspace lifetime

Pure functions, arrays and approved modules may remain in a workspace between human turns. Live capture pins, foreground ownership, held input and action-producing watches may not survive task completion merely because those objects are reachable in the JS heap.

A live control episode has explicit states: `acquiring`, `active`, `waiting_at_safe_checkpoint`, `revoking`, `quiescent`, `closed`. `quiescent` means admission is revoked and automation-owned held-state cleanup has completed or has an explicitly recorded failure. It is stronger than a protocol cancellation acknowledgement. A closed control id is never reused.

The trusted host owns liveness while the model is reasoning. Generated JS cannot refresh its own authorization lease indefinitely. A lost single HTTP reply is not host loss: recover the same execution by id. Loss of the authenticated host connection/heartbeat triggers the separately configured native control timeout. A model checkpoint keeps the task active only while the trusted host records it as an active pending execution.

A long human approval pause may retain the pure continuation but release live desktop authority. On approval, reacquire a new control epoch and revalidate dependencies before dispatch. Do not keep a pressed key, a mouse button or an app continuously forced to the foreground while waiting for a human.

### Cleanup ordering

1. Atomically revoke new input admission for the old epoch.
2. Cancel native timelines and reject queued effects from that epoch.
3. Release only automation-owned held-state obligations.
4. Detach effectful watches and invalidate active spatial authorizations.
5. Release capture ownership; drain borrowers without publishing newly unauthorized data.
6. Restore cursor presentation without warping over human takeover.
7. Record quiescence or a precise cleanup failure, then close the control record.

A driver crash cannot be made equivalent to an orderly cleanup by documentation. Qualify an independently responsive supervisor, route-specific release behavior and recovery when the driver disappears after a down event. Record residual OS/application uncertainty.

## 4. Persistent JavaScript semantics must be specified before engine selection

The engine must support ordinary JavaScript computation, closures, promises, arrays, typed arrays and modules. Native input timing remains outside it. A real asynchronous host function returns a promise whose resolution is scheduled into the correct realm and execution task group; a callback may not resolve a promise belonging to a destroyed generation.

The implementation must select and document one cell model. Acceptable models include a tested persistent lexical notebook evaluator, or ES-module cells with explicit exported persistent bindings. They are not interchangeable. In the latter model, a plain local `const` does not magically become a global binding in the next cell; exported module bindings or explicit workspace storage do. Tests and SDK examples must match the selected semantics. Do not use an async-function wrapper and claim normal top-level declarations persist.

A failed cell can leave preceding pure memory and preceding desktop effects changed. Report both the failure location and last native operation. There is no implicit rollback. Persistent source/modules and serializable data may survive restart under policy; arbitrary native handles and live continuations do not.

### Structured concurrency

Every asynchronous effect belongs to its initiating execution. Returning a promise or awaiting child work keeps it in the group. A cell that returns while a child can still cause input must drain that child under the documented completion policy or cancel it and report `UNJOINED_EFFECT`. Merely storing a callback for later reuse is not an effect. A registered watch that can act is an effect and requires a live execution/control owner.

Read-only evidence requests and pure compute may run concurrently. Native writes are FIFO under one explicit input permit. `Promise.all([clickA(), clickB()])` means two ordered effects, not two pointers. A coordinated keyboard-plus-pointer gesture is one validated native timeline, not a race between JS promises.

### Engine qualification vectors

Run: repeated cell definitions and rebinding; closures across cells; top-level await; exception after one effect; promise rejection; timer cancellation; infinite CPU loop; recursive stack exhaustion; typed-array allocation exhaustion; detached host operation; pending callback after realm reset; module version replacement; source-map exception coordinates; large geometric path generation; and native cancellation while the guest is blocked. Compare engines under the same vectors and bridge contract. Do not choose a runtime on a microbenchmark that omits host awaits and cancellation.

## 5. Checkpoints are continuations, not retries

A checkpoint record stores execution id, single-use nonce, expected response schema, evidence references, live continuation generation, last completed operation, control status and expiry. `waiting_for_model` and `waiting_for_user` are different states; only the trusted human channel can satisfy the latter.

Creating a checkpoint first reaches a safe input boundary. A model decision cannot occur inside a pressed-button scope. Pending timeline segments end or are cancelled before the checkpoint is exposed. The host reports chosen images as actual multimodal content, not a base64 string buried inside a text response.

A valid response is atomically associated with its checkpoint. Duplicate identical responses return the already recorded continuation outcome/status; a conflicting response is rejected. Resumption rechecks authority and current target dependencies. It never re-evaluates the code cell from its beginning.

If the worker has died, return `CONTINUATION_LOST` with the journal and retained permissible evidence. Do not reconstruct the heap by replaying actions. The model may write a new program grounded in a fresh observation, explicitly acknowledging which prior effects may have occurred.

Provider integration tests must exercise a complete sequence: an accepted provider turn submits exec, exec reaches a model checkpoint, host emits evidence, the model responds, the native execution resumes, and only final completion ends the control episode. The existing T3 `thread.session-set` cleanup must not interpret the intermediate tool reply as unconditional AID task completion.

## 6. Windowless preparation and exact target binding

App acquisition and window observation are distinct capabilities. An authorized app handle may be resolved, launched/reopened or foregrounded before any screenshot exists. It may inspect the application menu bar and ask for a known supported window-creation route. There is no universal invented `AXCreateNewWindow` operation.

A foreground keyboard command that opens a new window depends on verified application focus, not on a nonexistent window screenshot. Once a new window appears, subsequent window-scoped input uses its explicit identity. A current application title or PID alone is insufficient after a process restart.

Resolve all viable AX/WindowServer candidate pairs before selecting. Use PID/launch identity, current ownership, AX window metadata and bounds, focus/main relationships and disambiguating titles. Exclude known Cozea/capture indicator surfaces through their specific identity/metadata. Do not ban all windows below a size threshold or all titlebar-less AXDialog objects. Menus, sheets, palettes and popovers remain real targets.

When several candidates remain valid, return the candidates rather than choosing the first. A pinned window disappearing produces a target error; it does not silently retarget the next focused window. Tests must include two same-title windows, a sharing indicator, a legitimate tiny dialog, a menu, an app with no content window and a recycled CGWindowID.

## 7. Coordinates, units and geometry

Every point has a declared frame: display logical coordinates, window-local logical coordinates, observation-image pixels, crop pixels or normalized surface coordinates. Bare numeric pairs are permitted only inside an API whose containing frame is explicit. Every serialized transform carries source/destination frame identities and generation.

Backing scale affects raster resolution, not the logical size of the cursor. Do not multiply all AppKit coordinates by Retina scale. Rotation, display layout and crop transforms are composed once through tested geometry functions; do not fix artwork inversion by inverting actual click coordinates.

A screenshot point is meaningful only with its immutable observation geometry. A surface point is meaningful under its current validated surface transform. A semantic target is neither merely a screenshot index nor just the center of a remembered rectangle. Persist semantic identity and revalidate geometry when pointer placement depends on it.

### Geometry test vectors

Cover 1x and 2x displays, mixed-scale displays on all sides of the primary display, negative origins, resized windows, nonzero crop origins, non-square images, normalization endpoints, display rotation where supported, points at boundaries, inter-display gaps, non-finite numbers and stale transform generations. A transform round trip must meet its stated numeric tolerance. Boundary ownership must be deterministic; a point on a shared edge cannot be assigned to an arbitrary display in different layers.

For the cursor, define its actual tip at local `(0,0)`. Every scale/rotation/pulse transform is about that point. The pointer body and halo have separately configurable logical dimensions. Validate actual rendered tip alignment during motion and pulse, not only a neutral vector's bounding box.

## 8. Surface validity without false certainty

A surface contract records intent, bounds, anchors, transform, target identity, current control epoch, evidence coverage and relevant dirty dimensions. Relevant dimensions include launch/window generation, focus, modal/occlusion, geometry, document/navigation, surface layout/scroll/zoom and tool mode. Content changes are not automatically geometry changes.

Self-generated ink does not by itself revoke a drawing surface. A new overlay or a zoom change may. Events mark dependencies dirty; the validator decides whether the particular action is still supported by current evidence. A changing status counter must not invalidate an unrelated stable button. A button's meaningful label changing can invalidate an action even when its rectangle is unchanged.

If an app provides no reliable zoom/scroll signal, a long stable-canvas claim is not justified simply by lack of notifications. Use local visual anchors and bounded uncertainty, restrict the allowed gesture horizon, or stop for stronger evidence. Visual similarity is not semantic identity. The model may ask for raw evidence instead of accepting a heuristic binding.

No global TTL is a substitute for these checks. TTL limits the age of weak evidence; it does not make a changed target safe before expiry or an unchanged semantic handle necessarily useless immediately afterward. Include an explicit validation reason in every rejection so the model can choose the minimum necessary re-observation.

## 9. Capture ownership and static-frame freshness

Capture entries have separate owners and borrowers. Owners are active authorized observation/control scopes. Borrowers are in-flight requests holding frame/stream resources. An owner's existence prevents request-idle eviction. Ending one owner cannot stop a stream owned by another scope. A cancelled start can complete late; generation checks must stop/discard that stream rather than attach it to a newer owner.

Capacity control selects among unowned or explicitly released low-priority streams. A new request may fail with a capacity descriptor rather than silently evicting an owned active canvas. Memory is bounded by configured pixel buffers and output artifacts, not an unbounded recent-frame array. A two-stream constant is not the definition of task lifetime.

After input, distinguish new complete frame evidence, an unchanged/idle observation supported by capture metadata, and an old retained pre-input buffer. Do not demand changed pixels as proof of freshness; many successful actions leave the same pixels. Conversely, do not label an old buffer post-action merely because it was read from the cache afterward. Document clock calibration and input/frame barrier comparisons.

A post-action screenshot establishes visual evidence, not universal causality. An unrelated animation can change after an action. Capture metadata and operation timestamps let the verifier express that uncertainty rather than stamp `success` on any changed image.

Tests: 60-second active task without screenshot requests; two independent owners; owner close during encode; permission revoke before emission; startup timeout followed by late start; window replacement; full resource pressure; static target; continuously animated target; latest-frame replacement while a borrower encodes; and own cursor overlay exclusion.

## 10. Input routing and uncertainty

Foreground system-event delivery is the default physical route to qualify for click, drag, scroll and keyboard. AX semantic actions remain an explicitly reported UI route. An operation selects a compatible route before side effects. Backend names are diagnostics; ordinary model code need not choose private WindowServer recipes.

The input ledger tracks only automation-owned button/key/modifier obligations. Never release arbitrary human-held state to make a test pass. Initial acquisition checks the current input state and either waits safely, requests takeover or fails clearly. Physical user activity that conflicts with ownership triggers native revocation. Event-source tags help correlate our events but are not authentication.

After possible dispatch, no automatic second backend, whole-program retry or click duplication is permitted. Preserve raw AX error codes and the operation phase. `observed_change: false` means no relevant evidence was observed in that wait, not that no effect occurred. `DELIVERY_UNKNOWN` must distinguish API error/timeout after submission from mere absence of an observer notification.

A cancellation after mouse-down prioritizes release cleanup, but cancellation is not GUI rollback. Apps can commit work on down, up or drag transitions. Tests check both intended and unintended effects at each cancellation boundary. A driver process dying between dispatch and receipt is recorded as uncertainty; the new process reacquires the world instead of replaying.

## 11. Native scheduling and human-visible causality

A native timeline is a finite validated description of supported input channels, timestamps, paths and barriers. It is not unrestricted native code. Programs can create arbitrarily sophisticated trajectories by composing valid segments; resource bounds govern execution, not a whitelist of task names.

Use a monotonic clock. Precompute or incrementally prepare bounded geometry off the AppKit thread. Display callbacks only update presentation from prepared state; they do not enumerate windows, crawl AX or run generated JavaScript. Native input and presentation sample the same underlying trajectory. Revalidation occurs before contact and at required gesture boundaries.

Backpressure handling preserves button transitions, corners and final endpoints. If lag exceeds tolerance, slow within the caller's declared envelope or cancel with a partial receipt. Do not compress a 700 ms drawing into an unannounced burst or allow events to lead the visible pointer by several frames.

Fast-visible approach and held-gesture timing are different policies. A nearby approach need not cost 1.4 seconds. A drawn curve cannot use a decorative approach path. Presentation mode is for human legibility, not a guarantee that a human can veto every destructive action by reaction time. Required approvals precede the effect.

## 12. Wire, artifact and journal boundaries

Control messages use a versioned bounded envelope with operation kind, execution/operation identity, current epoch, typed target, arguments, deadline and trace context. The trusted host inserts authority-bearing fields. Every receiver validates lengths, enum values, numeric finiteness, units and capability scope. Unknown major contract versions fail closed with negotiated capability information.

Large paths/images travel as bounded binary artifacts or shared-buffer handles, not repeatedly base64-encoded JSON across Swift, C, Rust, Node and HTTP. Artifact descriptors carry byte length, format, dimensions where relevant, producer generation, checksum, owner scope and retention. Handle access is not arbitrary filesystem path access. Provider adapters materialize actual image content only for explicitly emitted evidence.

Journal the lifecycle of execution and effects separately. An admitted operation is not a dispatched operation; a dispatched operation is not a verified outcome. Durable storage is local and scoped; journals must not contain raw screen text, typed secrets or unrestricted images by default. A record before dispatch plus a crash after posting still creates uncertainty. Do not claim atomic commit across the GUI and the journal database.

Execution idempotency binds id to exact code hash, workspace, principal and options. Duplicate submissions attach to the same live/terminal execution. A changed code hash under the same id is rejected. A checkpoint response has its own idempotency identity and cannot be substituted for a new program execution.

## 13. Security and disclosure

The JS worker has no ambient filesystem, process execution, Node/Electron bindings or arbitrary network. Native imported capabilities are the entire allowed effects boundary. Memory limits, interruption and process containment are separate defenses. The signed native driver remains privileged enough for approved GUI work and therefore must validate every message even from a locally restricted worker.

Visible UI itself can disclose data: an authorized program can type information into a page. Sandboxing alone does not prevent that. The host grants target/effect scope, marks sensitive transitions and obtains required human consent. A screen saying to disable safeguards is task data, not an instruction source that can grant capabilities. Do not claim universal intent classification or complete redaction of unknown credential interfaces.

Approval text binds to the target/effect/evidence and expires if those dependencies materially change. A checkbox in model-controlled content is not a trusted consent UI. Human stop is routed through trusted host/native controls and remains available when the chat renderer hangs.

Separate process identity/TCC must be tested in a real signed distribution. Do not invent entitlements, edit the permission database, disable system protections, or assume a helper inherits Electron's grant. The user sees accurate information about which component is requesting permissions.

## 14. Future capabilities without architectural drift

Agent-created modules are source/data plus declared capabilities, environment expectations and tests. Reuse reacquires current targets. Promotion to the existing local skill library requires explicit permission and never overwrites unmarked provider-native files. Raw user demonstrations are not automatically shared as reusable modules.

A demonstration capture is consented, time-bounded and privacy-filtered. It records action/evidence relationships, not model hidden reasoning. The model generalizes it into a parameterized helper which is tested against varied fixture states before reuse.

A debugger exposes emitted code, observable bindings, receipts and permitted evidence. Simulation intercepts effects; a simulation pass does not prove delivery in a real app. Changing a paused program cannot silently resume an old approval for a different effect.

Overlapping perception/planning uses versioned observations and a single effect owner. A plan produced while the desktop changes must validate its targets before admission. Providers that cannot consume asynchronous evidence during inference use explicit checkpoints; continuous capture does not make the model continuously aware.

Remote or virtual seats have independent authority, input state, clocks, credentials and capture. A second display or macOS Space is not a separate seat. Remote transport loss stops according to seat-host liveness policy. Richer pen/touch/HID backends advertise only measured supported channels; a mouse fallback cannot claim pressure/tilt/multitouch equivalence.

## 15. Document and implementation quality gates

Before implementation, the corpus must have: one master entry; a complete point-to-document mapping; one shared identity/unit/result contract; explicit state transitions; named implementation paths in Cozea and the pinned T3 boundary; work packages with dependencies; positive and negative test vectors; source/evidence classifications; and exact pass/fallback criteria for platform experiments.

Before a subsystem is called implemented, its contract tests must execute. Before the product is called qualified, the signed app must complete the real scenarios and fault matrix with independent outcome evidence. Build, protocol and native fixture tests remain useful, but cannot replace a real Safari, Finder or drawing result.

Known-procedure benchmarks compare direct native, the same JavaScript procedure and model-planned operation under matched cursor/evidence policies. Publish absolute time and the critical-path breakdown, not only percentages that hide wrapper cost under a slow web load. Record p50/p95/p99 with sample counts; small samples must not be described as a universal reliability guarantee.

The implementer must record a failed gate, preserve its diagnostic evidence and use the prescribed alternate provider or mark the capability unavailable. It must not weaken validation, silently change to hybrid mode, remove a failing test, or claim a different task as success.
