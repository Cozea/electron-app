# Cozea AID Environment: programmable perception and control

Date: 2026-09-08
Branch: `feat/programmable-aids-runtime`
Status: proposed reference architecture; not an implementation or measured performance claim.

## Document authority and evidence

Read this design together with [the product definition](computer-use-programmable-aids.md) and [the platform research notes](computer-use-current-platform-opportunities-2026-09.md). [Computer Use v2](computer-use-v2.md) describes the shipped baseline, not restrictions we must preserve.

This document develops the product definition into a coherent architecture. Where earlier notes are ambiguous, the explicit decisions here take precedence for this branch. In particular: persistent JavaScript workspace memory is distinct from active desktop authority; turn completion releases control/capture but need not destroy opted-in pure workspace data; a visible cursor is mandatory but a fixed 1.4-second movement is not; MCP Tasks cancellation acknowledgement is not proof that physical input has stopped; continuation replies must not replay a program prefix.

Evidence categories used throughout:

- **Source-confirmed baseline:** properties visible in the merged v2 source at `8e65b729e47c0c1bdfdd8555f55f0338cc95223f`, including coordinate-version equality, screenshot-request-based 15-second stream eviction, PID-only drag/keyboard, and explicit image/text observations.
- **User-reported observations:** the supplied 2026-09-08 Notes, Safari/YouTube, Finder and cursor tests. The report's proposed PencilKit/WebKit internals and exact latency percentages are not established facts.
- **Transcript description:** the supplied Codex conversation describes a persistent programmable JavaScript interface, but omits actual tool calls/results. It is not proof of Codex's native implementation. It also reports unsuccessful Notes drawing.
- **External documentation:** the primary sources at the end of this document. Their capabilities do not demonstrate integration in Cozea.
- **Design decisions and experiments:** everything proposed below. Numerical budgets are initial qualification targets, never benchmark results.

## 1. Product definition and objective

Cozea AIDs are general-purpose agent interface devices for perceiving and operating a real computer through visible interfaces. The model invents procedures; JavaScript expresses procedures; native devices provide reliable timing and delivery; observations provide evidence; the person watches the actual application and can intervene.

This is not a catalogue of tasks, a terminal agent with a decorative cursor, or a single-click API with a JavaScript facade. It is an agent operating environment, not a replacement for macOS.

The objective is to minimize three avoidable gaps:

1. **Expression gap:** the model knows what interaction it wants, but cannot express its geometry, timing, state or control flow.
2. **Observation gap:** useful evidence exists on the desktop but is inaccessible, delayed, needlessly truncated, detached from coordinates or buried in context noise.
3. **Execution gap:** a known procedure must repeatedly return to the model or restart a native subsystem before progressing.

The strongest honest target is: for an authorized task and a qualified environment, make infrastructure overhead small enough that judgment, grounding and planning dominate the remaining agent-specific limitations. OS restrictions, application responsiveness, network loading, display scheduling and deliberate human supervision remain real limits. Do not claim that engineering eliminates those limits.

Optimize verified task completion, not tool calls per second. Treat execution as a dependency graph: total time is the critical path, not the sum of overlapping stage durations. Report model inference, native execution, application waiting, presentation and approvals separately.

## 2. Non-negotiable invariants

- The user sees real application interaction. No shell/file/API operation may be disguised by unrelated cursor animation.
- Pointer arrival precedes activation at the destination. A held gesture follows its actual programmed path.
- JavaScript permits ordinary computation, functions, loops, closures, conditionals and reusable modules; it is not a whitelist of task macros.
- Desktop effects pass through a typed, authorized device boundary. Generated code never runs inside Electron main or receives ambient native privileges.
- Capture and observations are separate from transmission to the model. Warm sensors do not imply streaming all screen data to a provider.
- Handles carry identity and provenance; they do not make stale targets permanently valid.
- One login seat has one physical-input owner at a time, including keyboard focus, modifiers, pointer buttons and scroll gestures. Parallel observers do not imply parallel foreground writers.
- User takeover, permission revocation and control expiry stop admission of new input independently of the model and JavaScript event loop.
- A transport acknowledgement, input submission, visible change and verified task outcome are different facts.
- Once delivery may have occurred, never automatically replay a non-idempotent prefix.
- Preserve access to raw evidence and supported primitive operations beneath convenience APIs. An uncertain semantic adapter must not become an unavoidable bottleneck.

## 3. Architecture: three execution rates, five subsystems

```text
MODEL / HOST
  judgment, visual interpretation, strategy, permission scope
       | executable program; decisions at explicit checkpoints
       v
PROGRAM WORKSPACE
  resident JavaScript realm; helpers; data; observation references
       | typed asynchronous device calls and subscribed conditions
       v
NATIVE CONTROL KERNEL
  authority; window/target validation; input schedule; cursor; cancellation
       | actual AX or physical input
       v
REAL DESKTOP <---------------------- HUMAN
       | pixels; AX; focus/window/input events
       v
EVIDENCE SERVICE
  bounded capture; scene records; timestamps; provenance; local queries
       | selected text/images/events/receipts
       +------------------------------> MODEL / PROGRAM

EXECUTION JOURNAL + SUPERVISOR span all subsystems.
```

The model runs at decision speed. The program runs at local event/condition speed. The motor kernel runs at input/presentation speed. Do not send a pointer sample or a known-condition check through inference.

### 3.1 Process and trust boundaries

Target architecture:

- **Host/orchestrator:** T3/provider integration, task permissions, model checkpoints, user-facing control UI and protocol adapters. Electron may remain the product shell; neither Electron nor MCP owns device timing.
- **JavaScript worker:** a separately terminable, restricted process, with one resident realm per workspace. It owns no Accessibility/Screen Recording permissions, raw filesystem, process execution, arbitrary networking or Electron bindings by default.
- **Native driver:** a signed macOS GUI-capable Swift runtime responsible for AppKit presentation, AX, ScreenCaptureKit and public input. A dedicated bundled driver process is the target fault boundary; verify TCC attribution and signed distribution explicitly before adopting that topology. Do not assume permissions granted to Electron automatically transfer to a helper.
- **Native watchdog/supervisor:** independent of guest progress, maintaining authority expiry and input-state cleanup. At minimum it must remain responsive when generated JavaScript hangs. Driver-crash cleanup is a separate tested failure case, not a claimed guarantee.

Use authenticated local typed IPC for host/worker/driver boundaries. Peer identity, session ownership and capability validation are mandatory. Large frame artifacts use bounded out-of-band handles; do not copy PNG/base64 through every internal message. Pixels remain in the trusted capture service until explicitly requested or supplied to an authorized local image-processing operation.

Do not perform another whole-product rewrite. Existing proven Swift components may be retained behind the new contracts. Remove architectural restrictions rather than changing languages for appearance.

## 4. Explicit lifetime model

The word `session` must not stand for five different things.

| Identity | Owns | Ends when |
| --- | --- | --- |
| `workspace_id` | Resident JS realm, functions, pure data, optional approved saved helpers | Workspace closes, expires, resets, or worker is lost |
| `control_id` + `control_epoch` | Authorized live interaction episode, allowed targets/capabilities, capture ownership | Task/turn completion, explicit release, takeover, revocation or host-liveness expiry |
| `execution_id` | One program invocation, journal, pending continuations and outstanding effects | Complete, failed, cancelled or explicitly expired |
| `operation_id` | One native effect and its delivery/verification receipt | Terminal operation status retained within retention policy |
| `observation_id` | Immutable evidence bundle and coordinate/provenance metadata | Retention expiry; never silently rewritten |
| `window_handle` | Process launch identity, CGWindowID, generation and current target metadata | Identity changes or handle is explicitly released |
| `surface_handle` | Spatial frame, anchors, relevant transform and interaction contract | Contract invalidates or controlling epoch ends |
| MCP request/task ID | Wire correlation or asynchronous protocol task | Protocol-specific lifetime |

A public `aid_session_id` may be an envelope locating a workspace and an active control episode, but implementations must preserve these separate concepts internally. Every handle is bound to principal, machine, runtime instance and ownership. Knowledge of an ID alone is not authorization.

Across model/tool exchanges within an active task: workspace, capture ownership and control may remain alive. Across human turns: pure memory may remain by explicit workspace policy, but prior foreground authority, held input, watches with effects and spatial authorizations do not. Cached screenshots are retained only under explicit privacy/retention policy, not because a variable references them forever.

Closing HTTP must not destroy pure workspace memory. It also must not grant permission for abandoned physical automation to continue. The trusted local host owns liveness of active tasks. Host loss pauses/cancels control under a documented deadline. An individual network response loss is recovered by execution lookup, not by rerunning code.

A restart can preserve journals and explicitly serialized data, not live AX objects, native ownership or arbitrary JavaScript continuations. On worker/runtime loss return `WORKSPACE_LOST`/`CONTROL_EXPIRED` and the available journal. Reacquire the world; do not replay old effects to reconstruct the heap.

## 5. Agent-facing programming environment

### 5.1 API shape

Use a small model-facing entry surface:

```text
computer.open      establish workspace and authorized control scope
computer.exec      execute JavaScript with explicit execution/idempotency identity
computer.inspect   retrieve state, receipts, errors and pending checkpoints
computer.respond   supply a checkpoint decision without rerunning its prefix
computer.close     end control and optionally the workspace
```

These are proposed tool names, not MCP-reserved methods. MCP Tasks can carry asynchronous status/cancellation where negotiated. Do not force all hosts into one streaming provider API.

Within the program:

```javascript
aid.apps
aid.windows
aid.pointer
aid.keyboard
aid.observe
aid.events
aid.clipboard       // only when granted
aid.execution
aid.workspace
aid.describe
```

Generate type declarations, reference docs, schema, stubs and test vectors from one versioned IDL. Use progressive disclosure: a compact capability index first; precise method/handle descriptions on demand. Always expose which operations the current machine/app supports and the limitations of each route.

### 5.2 Real JavaScript semantics

Support async functions, Promises, closures, loops, exceptions, typed arrays, modules and normal math/data operations. Permit vetted pure libraries for geometry, parsing and image analysis. No arbitrary native npm addons or implicit package-install/network escape.

Use documented notebook/module semantics: top-level bindings can persist within a workspace with explicit rebinding rules and inspection. Do not wrap every call in an isolated async function and claim its locals persist. Durable source modules and serializable values are distinct from a live in-memory realm. Partial execution can leave pure bindings mutated; report that rather than claiming rollback.

Source maps and cell/line IDs connect JavaScript exceptions to native operations and receipts. An invalid program gets a precise error before any reachable effect that depends on the invalid instruction; optional preflight/typechecking catches errors but cannot prove arbitrary program behavior.

One mutating execution per workspace/control owner at a time. Concurrent sensor queries and pure computation are allowed. Device calls use a deterministic FIFO queue; `Promise.all` does not create simultaneous independent keyboard/pointer ownership. Intentional overlap is expressed as a native timeline.

All child work belongs to an execution task group. A program returning with a held key/button or detached effect is not successful: drain or cancel owned work, perform cleanup and return a structured error. Retaining an inert helper function is allowed; retaining a live pressed button across completed cells is not.

### 5.3 Yield judgment without discarding the procedure

Introduce a host-mediated same-agent checkpoint:

```javascript
const evidence = await view.observe({ accessibility: true, image: 'overview' });
const choice = await aid.execution.decide({
  question: 'Which visible result matches the user request?',
  observation: evidence,
  choices: candidates.map(x => ({ id: x.id, label: x.label })),
  responseSchema: { type: 'string', enum: candidates.map(x => x.id) }
});
// The same live program resumes here; earlier effects are not rerun.
await aid.pointer.click(candidates.find(x => x.id === choice));
```

`decide` requests judgment from the controlling model via the host; it is not an undocumented vision call, a hidden weaker sub-agent, or a new native task command. The host pauses the execution, sends chosen evidence as real image/text content, and resumes its single-use continuation with a validated answer. A normal return-and-next-exec path must also work.

No button/modifier remains held during inference or human approval. The native program may wait on a local condition while the model performs explicitly scheduled read-only planning, but there is still one authority-bearing effect stream. Continuing program actions must never depend on model output that has not actually arrived.

If provider protocols cannot interleave observations during inference, deliver them at explicit checkpoints. Do not pretend the model sees live frames just because capture is running.

## 6. General AID capabilities, without task macros

### Pointer

Provide move, hover/dwell, button down/up, click/double-click/right-click, relative and absolute motion, spatial paths, scroll deltas and phases, wheel/trackpad profiles where supported, held modifiers, drag/drop and timed trajectories. Low-level operations and high-level gesture helpers use the same event kernel.

### Keyboard

Distinguish Unicode text insertion, logical shortcut keys and physical scan/key codes. Support repeat, key down/up, chords, timed holds and modifier state. Preserve caret/selection. Test IME/composition, Unicode and non-US layouts separately. Never claim Unicode injection reproduces every physical keyboard or IME behavior.

### Clipboard

Optional clipboard read/write/paste is a general device capability. Bulk text placed on the real clipboard and pasted into the real foreground UI can be legitimate visible interaction; it is not a shell shortcut. It must be explicit, preserve privacy and avoid overwriting unrelated clipboard changes during restoration. Strict physical-key validation mode excludes this helper.

### Windows and application preparation

List running and installed eligible apps, open/reopen when explicitly requested, unhide, activate, choose a real window, resize/move where supported, enumerate menus/sheets/popovers, and report focused app/window/control. Preparation works before a content screenshot exists. It does not fabricate a universal `AXCreateNewWindow`: app launch/reopen, discovered menu actions and a verified foreground keyboard command are separate, observable strategies.

### Sensors

Expose raw capture, scoped AX reads/actions, focus/window geometry, pointer/input state, observation history and optional separately authorized audio. Unknown AX roles/actions remain inspectable rather than discarded by a simplified vocabulary. OS-private fields remain implementation details, not arbitrary model-writable memory.

### Capability boundaries

`visible-ui` permits actual pointer/keyboard and declared semantic UI actions. `physical-ui` requires event-driven interaction for validation. `hybrid` explicitly enables filesystem, terminal, application APIs or other integrations. The agent may change procedure freely inside its grant; it must not quietly change the execution mode.

Some hardware affordances require other devices. A mouse event cannot honestly claim pressure, tilt, multitouch or haptics. Publish unsupported capabilities and qualify additional providers rather than silently approximating them as fully supported.

## 7. Evidence service: scene records, not an omniscient world model

Maintain a lazily populated, incrementally updated scene:

```text
seat -> displays -> applications -> windows -> surfaces/elements
                                  |          |
                                  |          -> pixel regions and transforms
                                  -> sheets, menus, popovers and occlusion
```

Each record includes provenance, generation, observation interval, last validation time, visibility/occlusion, supported actions and uncertainty. Distinguish platform-reported facts, pixel measurements, model annotations and hypotheses. Do not silently treat a model-inferred label as an AX identity.

The cache is not universally complete. Third-party apps expose uneven AX and notification coverage. A cache hit does not prove current action safety. Full raw expansion remains available with explicit pagination, time/character/node budgets and truncation causes.

The intended observation contract:

```text
observation_id
window/process/runtime identities
frame_id and capture timestamp
AX collection start/end and per-field freshness
coordinate frames + transform generations
region of interest and coverage/truncation
structured elements and changes since a named base
optional overview/crops/raw artifacts
input barrier relationship
known uncertainty and target-relevant changes
```

Do not claim atomic pixel/AX consistency across an application that continues updating. Return collection intervals and provenance; revalidate action dependencies later. An inconsistent unrelated status counter is not a universal prohibition.

### 7.1 Agent-directed attention

Let programs request an overview, a lossless detail crop, selected roles, a named subtree, only focus state, or a diff. A crop carries its own coordinate mapping; normalized region points are not global pixels. Delta consumers must have the exact base; lost bases trigger an explicit full representation, not unreadable patches.

Example:

```javascript
const frame = await aid.observe.window(view, {
  image: { mode: 'overview+detail', detailRegions: [canvas] },
  accessibility: { scope: view, roles: ['button', 'textField', 'link'] },
  since: previousObservation
});
```

The default first observation is enough to orient the model; subsequent observations follow explicit attention. Never permanently hide controls because a heuristic thinks they are irrelevant. Cheap thumbnails plus selected high-resolution crops are preferable to blindly increasing one full-window image size.

Cache source frames and encodings separately. Reuse an encoding only when frame identity, crop, format, scale and redaction policy match. Keep binary data out of JS/JSON unless the program explicitly requests pixels. Provide host-side crop/measure/compare operations without a network round trip.

AX optimizations include per-object timeouts, cancellation-aware budgets, bulk attributes for a node, bounded child-array pages, focus-first inspection and event-driven invalidation plus reconciliation. Batch attributes where supported; never assume it makes all AX access cheap or complete.

### 7.2 Temporal evidence and audio

Optionally return before/after frames, a short timestamped filmstrip or a permissioned bounded clip when temporal behavior matters. Raw video is not the default provider payload. If the provider does not support video, supply selected frames as images with timestamps. Audio requires independent consent and is useful for tasks where visual controls cannot establish audible output.

Local change/flow/template tools can help locate movement, but they are evidence sources, not infallible interpreters. OCR is optional for applications with inadequate semantics; do not add expensive OCR to every frame when AX or direct model vision suffices.

## 8. Agent-defined sensors and local reactive programs

The model should be able to define what it is waiting for:

```javascript
const skip = await aid.events.until(async () => {
  const matches = await player.query({ role: 'button', name: /^Skip( ad)?$/ });
  return matches.length === 1 && matches[0].enabled ? matches[0] : null;
}, { deadlineMs: 30000, scope: player });

await aid.pointer.click(skip);
```

All methods in examples are proposed. The condition is code the model supplied, not a hidden `skipAds` native macro. It reacts to actual current evidence and revalidates before clicking. It must stop at its deadline or if the player/control scope changes.

Known SDK queries can expose dependencies for event-driven updates. Arbitrary JavaScript predicates run in the isolated worker with a bounded evaluation budget and reconciliation policy; do not claim arbitrary JS can always be automatically converted into a perfect incremental dependency graph.

Watches may prepare evidence while the model reasons. A watch may cause an action only if that action/condition was explicitly programmed and authorized. Unexpected UI changes should preempt pending dependent actions and package useful evidence, not repeatedly cancel every harmless computation.

A useful advanced feature is a local visual servo: follow a previously grounded target with an explicitly selected tracking algorithm and a measurable uncertainty bound. Stop when its bound, identity evidence or spatial contract fails. Never equate visual similarity with guaranteed semantic identity.

## 9. Target validity: typed references and dependency contracts

Replace the blanket `observed_version == current_version && input_version == current_input_version` rule with typed target validation.

### 9.1 Target types

- **Semantic handle:** identifies a retained element or a uniquely re-resolved selector under a named scope. Validation checks launch/window identity, label/role/action, enabled state, relevant geometry and blocking UI. Selectors fail on ambiguity; no silent first-match substitution.
- **Observed pixel point:** a point bound to an immutable frame, crop/scale mapping, window identity and relevant scene conditions. It does not inherit a semantic identity merely because it overlaps an AX box.
- **Spatial frame/surface:** a coordinate system with anchors, transform generation, region boundary, allowed interaction intent, control epoch and expiry policy.
- **Foreground keyboard target:** verified app/window/focus lineage appropriate to a shortcut or text operation. A keyboard shortcut need not inherit a screenshot's pixel freshness.

### 9.2 Separate change dimensions

Track at least process launch, window generation, display transform, window geometry, focus, modal/occlusion, surface layout/scroll/zoom, semantic target identity and content evidence. An event is a dirty signal; classification is not automatically ground truth.

A button's relevant label changing can invalidate its semantics even if its frame is unchanged. A coordinate transform changing invalidates spatial operations even if the application's title is unchanged. A document byte counter can change without invalidating either target.

### 9.3 Bounded surface contracts

A surface lease means: while this spatial frame and control ownership remain established, these kinds of gestures may continue across expected local content changes. It does not mean all pixels in the region are trusted forever.

Creation requires a current observation and explicit anchors/region. AX, geometry, read-only browser layout instrumentation where authorized, image landmarks or a combination can provide evidence. If a canvas exposes no reliable signal for scroll/zoom, report that limitation and use shorter sessions/checkpoints rather than inventing a proof.

During a drawing contract:

- ink appearing inside the canvas is expected;
- geometry, scroll, zoom, navigation, tool-mode change, blocking dialog or user takeover may invalidate the contract;
- self-generated input is recorded but does not by itself invalidate all subsequent strokes;
- known external changes stop new gesture admission;
- cheap local sensors continue between model screenshots;
- periodic verification is configurable by uncertainty and task risk, not required after every mouse-up;
- final evidence verifies the result, not merely delivery.

Checking known dependencies cannot perfectly classify all possible UI changes. Expose confidence/coverage and allow the model to request stronger evidence. Do not replace today's overly conservative policy with a false claim of universal safe reuse.

## 10. Motor kernel and native timelines

Generated JavaScript expresses trajectories and timing; a native scheduler executes them. An ordinary `for` loop sending a remote tool call for each pixel is not the intended path.

Support a timeline algebra: sequence, simultaneous channels, held-state scopes, timestamped samples, easing, path interpolation, condition barriers and cancellation. Validate event balance, finite coordinates, supported channels, resource bounds and path containment before admission. A native timeline is interruptible, not a database transaction with rollback.

Example:

```javascript
const points = makeCurve(); // agent-created geometry
await canvas.pointer.stroke(points, {
  durationMs: 650,
  interpolation: 'polyline',
  approach: 'visible-fast'
});
```

Internally: acquire input ownership; revalidate surface; visibly approach the first point; confirm arrival; button-down; sample requested path on a monotonic schedule; deliver matching drag events; button-up; return a receipt. For richer gestures allow modifiers to overlap specified path segments without another model exchange.

Use a single monotonic timeline for native events and cursor rendering. Coalesce redundant samples under load without dropping endpoints, corners, button transitions or required timing bounds. If backpressure makes the path inaccurate, slow according to declared tolerance or abort and report; do not silently drift. High-density geometry may be sent as a typed buffer or path artifact rather than thousands of JSON objects.

The ordinary arrival barrier uses platform presentation callbacks and revalidation. A display-link callback is not proof of photons reaching the user; instrument actual presentation lag and test cursor/event alignment. Do not send input several frames ahead of the visible cursor and call the experience causal.

Frame callbacks must not synchronously query AX, enumerate windows or execute generated code. Cache presentation geometry, use event-driven invalidation, and confine AppKit work to its correct executor. The input gate is an explicit transaction permit, not an assumption that Swift actors cannot reenter across `await`.

## 11. Cursor: mandatory, truthful, adaptively paced

The cursor is a live instrument, not a fixed-duration ceremony.

Correct the current contour/orientation/hotspot mismatch with repo-owned geometry whose actual tip is the transform origin. Rotate/scale/pulse around the hotspot. Calibrate logical size independently from backing pixels; a compact 16-point body is an initial visual target, not a universal requirement.

Modes:

- **Fast-visible (default target):** short journeys for nearby controls, somewhat longer journeys for major spatial moves, preserved visible arrival. Initial calibration band 60-250 ms for approaches; qualify empirically.
- **Presentation:** slower choreography when a person wants to follow individual operations.
- **Direct gesture:** while a button is held, follow the programmed spatial path and timing without decorative deviation.

A constant 1.4-second approach would impose 28 seconds on twenty approaches. That is arithmetic, not a benchmark. Preserving a visible cursor does not require preserving that limit.

Typing need not be artificially emitted at human speed: real text can appear in chunks or through an explicitly permitted clipboard path. Show target, operation progress and live effects. Fast-visible mode gives immediate feedback; it cannot promise the user enough reaction time to veto every fast destructive action. Required approval is obtained before that effect.

For foreground physical input, the real pointer may move; that constraint was explicitly relaxed. Prefer the Cozea glyph as the primary pointer presentation during ownership. If hiding the system pointer is unreliable in a supported environment, keep the Cozea marker truthfully aligned rather than applying risky global hiding tricks. Restore normal presentation on release; do not warp the user's pointer back after takeover.

## 12. Input routes and window control

Foreground-first physical input is the normal route to qualify for pointer, keyboard, scroll and drag. Use public macOS event posting; it is synthetic input, not a guarantee of hardware-equivalent acceptance. Semantic AX remains appropriate when a control exposes the intended UI action. Expose the chosen route in receipts.

Choose the route before side effects. A pre-dispatch unsupported route may fall back. An ambiguous post-dispatch result requires observation, not automatic duplication through another route. Backend calibration is versioned by OS/build, architecture, app/version, focus state and device operation, with measured evidence and an explicit unknown category.

Keep SkyLight isolated, optional and diagnostically precise. Do not make private symbol availability the product's performance strategy. Unsupported background actions report unsupported; they do not silently steal foreground authority.

Window preparation acquires the intended app, unminimizes/selects a specific window where supported, then verifies frontmost app and focused window. Revalidate immediately before input. If the user changes focus, stop rather than repeatedly raising the app again.

The window resolver evaluates viable AX/WindowServer candidates before selecting. Pin explicit window identities across actions. Recognize known sharing/agent overlays from multiple specific properties and ownership; do not discard every small/titlebar-less window or every window containing a string. Legitimate menus, sheets and popovers are part of the scene. In ambiguous cases expose candidates instead of guessing.

App-wide menu bar and windowless application operations must remain expressible with an authorized application handle. Desktop and another app's overlay must not be mistaken for the application's content window.

## 13. Capture: ownership, attention and evidence

Capture is leased to active control/observation scopes, not to individual screenshot RPCs. An owned stream stays warm through model inference, keyboard work and JS computation. Turn/control end releases live authority and stream ownership even if pure workspace memory remains.

Separate frame production, frame retention, image encoding and provider emission. Retain bounded latest-frame buffers by default. Encode only an explicit observation or an explicitly authorized checkpoint artifact. Debug clips/history require separate retention policy and visible consent; they are not an excuse to record indefinitely.

Use identity-bound streams. Prioritize the active surface and explicitly watched windows under a memory/GPU budget. Do not silently evict an owned active stream merely because two entries already exist. Return capacity information or explicitly release/unpin lower-priority observation scopes. No unconditional full-rate capture of every app on the desktop.

Frame rate and resolution are attention-dependent: low-rate context for inactive watched regions, display-appropriate active tracking for interaction, and high-detail crops on request. Rates are negotiated within measured resource envelopes. A static screen need not produce a newly changed frame on every query; idle/complete frame metadata and input barriers must distinguish fresh unchanged evidence from a genuinely stale buffer.

A post-action observation must be associated with capture-time evidence and known preceding input. Cross-clock conversions are calibrated and documented. Native frame age, emitted image age and model decision age are different metrics.

Capture of a desktop scene may include other visible apps and private material. Scope/redact explicitly. Exclude Cozea's overlay from model scene comparisons so cursor motion does not masquerade as application change. Keep the human-visible desktop truthful; do not erase actual application effects.

New ScreenCaptureKit screenshot APIs are optional availability-gated providers. Benchmark them against warm frames; never require a newer one-shot API just to use a stream already holding valid pixels. Beta clip buffering is an optional diagnostics provider, not a correctness dependency.

## 14. Feedback and recoverable execution

Each action returns a compact receipt:

```json
{
  "operation_id": "op_42",
  "target": { "window": "win_7", "generation": 3 },
  "route": "foreground-event",
  "submission": "submitted",
  "evidence": "not_checked",
  "outcome": "unverified",
  "execution_position": { "cell": 8, "operation": 12 },
  "can_retry_automatically": false
}
```

These fields are proposed. Verification references specific predicates and evidence IDs, not a universal `ok`. A button count increment, expected dialog, selected row, new file outline or canvas pixel change can establish a local effect. It does not necessarily prove the whole user objective.

Errors carry phase, last completed operation, dispatch certainty, relevant invalidation reason and useful available evidence. Raw AX errors are retained where applicable without logging sensitive arguments. Recover reads automatically when safe; recover effects only with explicit evidence/policy.

Execution states: queued, running, waiting-for-condition, waiting-for-model, waiting-for-user, paused, completed, failed, cancelled, interrupted-after-possible-effect. Terminal failure and cancellation do not undo external changes.

Use execution IDs bound to code hash, principal and workspace. Repeated delivery of the same invocation attaches to its result/status; the same ID with different code is rejected. Journal admitted and possibly dispatched operations. A crash between submitting an event and recording acknowledgement creates uncertainty; no architecture can atomically commit arbitrary GUI effects and its own database. Prefer at-most-once admission plus explicit uncertainty to a false exactly-once guarantee.

An observation-only debug replay runs the program against recorded fixture evidence and intercepts effects. Replaying a journal onto a real desktop is a separately authorized operation with fresh targets, not automatic recovery.

## 15. Stateless MCP, stateful workspaces and continuations

MCP 2026-07-28's stateless core and explicit application handles fit the design [S1]. They do not make an in-memory JS realm or a physical Mac stateless. Routing must still reach the correct runtime instance/machine; a load balancer cannot arbitrarily move live desktop state between hosts.

Use negotiated MCP Tasks for long executions [S2]. The native execution record is authoritative; task status is a projection. Distinguish ordinary MRTR before a task is returned from input requests delivered through `tasks/get` and answered through `tasks/update` during a task. A continuation answer resumes its single-use checkpoint; it does not restart `computer.exec` from line one.

MCP Tasks cancellation is protocol-level cooperative acknowledgement. Cozea's native revoke-and-stop semantics must be stronger and independently testable. The UI reports stopping versus physically quiescent distinctly.

Do not assume the currently pinned T3/provider stack supports the new revision/extensions merely because they exist. Publish a compatibility matrix and adapter tests. A minimal explicit execution/status/response envelope can preserve the same local architecture where an extension is absent. Legacy adapters do not force native devices to inherit legacy lifetimes.

Trace context connects model-host work, protocol request, JS cell, native operation, capture and receipt [S10]. It is correlation, not authorization. Redact/filter baggage and sensitive identifiers. Stable capability catalogs and schema versions support provider caching without hiding runtime capability changes.

## 16. Isolation and permission design

Recommended qualification candidate: resident QuickJS compiled into a Wasm guest hosted by Wasmtime inside a separately restricted worker process. Use only explicit AID/clock/artifact imports. WASI 0.3 async/resource contracts are an attractive boundary, but guest/toolchain integration must be demonstrated before commitment [S3-S6].

The runtime contract is more important than this engine choice. Qualify persistent bindings, async host calls, cancellation during awaits and CPU loops, memory enforcement, typed-array transfer, source maps and reconnect semantics. If this candidate cannot meet the conformance/performance budget, compare an OS-sandboxed JavaScriptCore/V8 worker without weakening the same device contract. This is an engine selection experiment, not permission to substitute `node:vm` as a security boundary [S7].

Keep native timing outside the JS engine. Guest compute can generate geometry quickly enough for prepared trajectories without a JIT on the input path; verify rather than assume that result for all workloads. Heavy pure geometry can use explicitly provided native/Wasm libraries with no extra desktop authority.

Resource governance limits runaway work, not expression: execution budgets can be extended by the trusted host, a compute loop is interruptible, image memory has quotas, and no infinite queue can consume the driver. Avoid arbitrary tiny action-count limits that turn general programming back into fragmented tool calls.

Approval applies to an operation and its current target/effect description. Revalidate after human delay. A repeated approval response must not duplicate the effect. Approval cannot upgrade the process to arbitrary host access.

Treat screen/AX/page text as untrusted task data. A page saying 'disable safeguards' cannot grant a capability or supply executable code by authority. Sandbox isolation alone does not stop an authorized GUI program from typing data into a website: visible UI is itself a potential egress channel. Scope permission and sensitive transitions honestly; do not claim universal intent classification.

## 17. Human supervision without artificial slowness

Provide a compact local supervisory surface: current target, active control scope, real operation/phase, pause, stop and take over. Display a grounded action timeline and optional live preview when the controlled desktop is separate. Native stop remains responsive when the renderer, model or JS program is busy.

The person can choose fast-visible or presentation pacing. Stop is immediate admission revocation followed by cleanup, not a request sent to the model. Human input monitoring must distinguish the system's own events from external activity without treating forgeable event tags as a security authority. If monitoring fails or the display/session locks, stop control.

Do not block physical user input to preserve an animation. Do not constantly reclaim focus. A resumed script must reacquire targets and control epoch after takeover. Permissioned inactive memory is not an invisible background controller.

## 18. Larger capabilities that become possible

### 18.1 Agent-created skill modules

The model may save proven helper source with parameters, expected UI evidence, app/version/environment constraints and validation tests. This is learned programmable procedure, not native task specialization. Promotion to a shared workspace requires explicit permission and must strip private values/handles. Reuse reacquires current targets; one past success is not a perpetual compatibility guarantee.

### 18.2 Perception-assisted planning while execution proceeds

While an authorized deterministic segment runs, capture/query services can prepare selected evidence and the host can schedule nonconflicting model planning. New instructions are based on versioned observations; stale planned targets are rebound or rejected. Do not allow two writers to the same seat. Measure any benefit against extra inference and synchronization costs.

### 18.3 A programmable execution debugger

Pause at safe boundaries, inspect current bindings and target dependencies, view the last verified effect, compare relevant before/after crops, and resume a live continuation. The debugger exposes emitted code and observable execution, not hidden model reasoning. Recorded simulation validates control flow; only real application tests establish delivery.

### 18.4 Human demonstration as data

With consent, record a short demonstration's visible input and observations, then let the model synthesize a reusable program. Record uncertainty, environment and selection rationale supplied by the person. Do not store passwords/clipboard contents by default. Verify the resulting program on a fixture before reuse.

### 18.5 Separate agent seats

For simultaneous human work and agent work, use a genuinely separate logged-in machine/session or qualified VM, with the real agent desktop streamed to the human. A macOS Space or virtual display alone is not independent keyboard/focus ownership. One writer per seat remains the rule; multiple seats can execute independently. Validate application/account/file availability and virtualization/licensing before treating it as interchangeable with the user's current desktop.

### 18.6 Extended hardware devices

For applications needing pen pressure, tilt or true multitouch, qualify real or properly supported virtual device providers. An external HID appliance plus capture is a possible research direction for otherwise unsupported workflows, with authentication, a physical stop mechanism and a separate visible device identity. It is not a claim that private injection can reproduce every hardware path or bypass OS protection.

These are extensions of the device/evidence abstraction. None is required to conceal failures in the initial Finder/Safari/drawing tests.

## 19. Empirical evaluation: prove model-limited behavior

### 19.1 Build a measurement harness first

Use known AppKit, WKWebView and Electron fixtures that expose event-receipt counters and independently observable UI effects. Fixture instrumentation is test-only: the agent still acts through AIDs, not a hidden direct command bridge. Correlate host inference, execution, presentation and app-received events with one trace.

Also run the three real scenarios on the signed app with genuine permissions: Safari/YouTube, drawing, Finder. A Notes failure must stay a recorded failure even if another drawing app succeeds. A text-art fallback is a different result.

### 19.2 Three comparison modes

A. Scripted best-known valid procedure executed directly against the qualified native driver.
B. The same procedure through the JS AID environment, with the same cursor pacing and evidence requirements.
C. The model plans and executes through AIDs under the same starting conditions.

B versus A measures infrastructure tax. C versus B exposes planning/grounding/orchestration differences; it is not a universal causal estimate of intelligence because procedures and failure paths can differ. Repeat with controlled sequences, identical observation requirements, same hardware/app/provider versions and interleaved trials.

### 19.3 Initial engineering targets, not results

- Known new-tab/type/Return/observation procedure: one model-facing invocation, unless genuine interpretation is needed.
- Twenty-stroke qualified canvas: one model-written program and initial/final requested screenshots, not one image per stroke; local validation may continue.
- Fifty queued clicks produce no automatic screenshot encoding or whole-tree traversal.
- Active capture remains the same stream across a 60-second gap containing model thinking/keyboard work; source changes/revocation are recorded exceptions.
- Warm local JS-to-driver bridge overhead: target p95 below 5 ms, measured separately from AX/OS waits.
- Additional idle/presentation delay after target arrival: no mandatory fixed sleep; event timing is justified by measured app requirements.
- Cursor/event alignment: target within one display interval for discrete contact, with measured p95/p99 and no knowingly leading invisible action; do not describe a display callback alone as visual proof.
- Native stop admission: target within one input tick; total automation-owned release cleanup p95 below 50 ms on qualified fixtures, separately reporting failures/OS delays.
- For fixed known procedures, target less than 10% infrastructure-only critical-path overhead versus direct driver execution once active device timing is matched. Publish absolute timing too, so large application waits do not hide overhead.
- No wrong-window effects, duplicated effects or stuck automation-owned input in the prescribed fault matrix. Zero observed failures is not proof of impossibility; record sample counts and confidence, not '100% reliable'.

Budgets are calibrated, versioned and revisited with real traces. A failed target drives an architectural experiment; it is not made green by removing its measurement.

### 19.4 Fault and adversarial matrix

Test focus takeover at every event boundary; app/window restart and ID reuse; live status counter updates; new sheets/menus; sharing indicators; move/resize/scroll/zoom during gestures; mixed display scale; full screen/Spaces; app hangs; incomplete AX; secure/password fields; denied/revoked permissions; locked screens; JS infinite loops/OOM; worker/driver/host loss; network retries and dropped responses; duplicate approvals; cancellation before admission, after down and before up; capture capacity pressure; lost delta bases; stale inference decisions; non-US keyboard/IME; and multiple agents competing for one seat.

Every effect test asserts both the intended result and absence of extra effects. Every reported success links to outcome evidence. CPU/GPU/memory and screenshot/privacy costs are measured alongside speed.

## 20. Implementation sequence and decisive deliverables

1. Build trace/fixture infrastructure and reproduce baseline failures without the model. Record signed-host permission identity and capture lifecycle.
2. Correct cursor geometry/hotspot/presentation and create the foreground input kernel, complete gestures, focus takeover and native stop tests.
3. Implement explicit identities/lifetimes, application/window preparation, capacity-aware owned capture and phase-aware receipts.
4. Add structured/scoped observations, target contracts, spatial frames and local conditional waits. Demonstrate changing Finder status without global lockout and repeated drawing without per-stroke capture.
5. In parallel with device qualification, qualify isolated persistent JS engines against one IDL. Do not wait until the end to discover async/continuation incompatibility. Ship no engine as production-ready before native devices pass.
6. Integrate workspaces, same-agent checkpoints, source maps, execution journals, protocol Tasks/MRTR adapters and provider image delivery tests. Test retry/cancellation semantics end to end.
7. Run the three real scenarios and held-out unfamiliar UI tasks. Compare direct-native/scripted/model modes; publish the measured limits.
8. Add attention/temporal/debugger/skill optimizations only with unchanged safety and outcome evidence; then pursue separate seats and richer hardware providers.

Definition of done is not 'the project compiles' or 'the tool returned ok'. It is a qualified device/evidence contract through which an agent can express arbitrary relevant procedures, see the evidence it needs, execute without avoidable per-step inference, and remain visibly correct and interruptible.

## 21. Primary source register and qualifications

Sources checked 2026-09-08; pin exact SDK/spec versions when implementing. These links support platform facts, not Cozea performance.

- **S1 MCP 2026-07-28 release:** https://blog.modelcontextprotocol.io/posts/2026-07-28/ — stateless core, explicit state handles, MRTR and extensions. Runtime/provider compatibility still needs testing.
- **S2 Tasks extension (currently served under draft):** https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks — asynchronous task results, capability negotiation, task input and cooperative cancellation. Pin the adopted extension revision.
- **S3 WASI 0.3:** https://bytecodealliance.org/articles/WASI-0.3 — ratified async component primitives; runtime/toolchain support must be qualified.
- **S4 WIT contracts:** https://component-model.bytecodealliance.org/design/wit.html — typed resources, streams, futures and async contracts.
- **S5 Wasmtime security:** https://docs.wasmtime.dev/security.html — sandbox/isolation model; host imports are part of the security boundary.
- **S6 Wasmtime interruption:** https://docs.wasmtime.dev/examples-interrupting-wasm.html and QuickJS engine: https://bellard.org/quickjs/quickjs.html — execution limits/embedding. The proposed combined engine remains an integration experiment.
- **S7 Node VM:** https://nodejs.org/api/vm.html — node:vm is not a security mechanism.
- **S8 ScreenCaptureKit:** https://developer.apple.com/documentation/screencapturekit/scstreamoutput and https://developer.apple.com/documentation/screencapturekit/scstream — frame callbacks/metadata and persistent capture. New/beta methods require availability gating.
- **S9 Core Graphics input:** https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:) and https://developer.apple.com/documentation/coregraphics/cgeventsource — synthetic posting and event source state, not universal hardware equivalence.
- **S10 W3C tracing:** https://www.w3.org/TR/trace-context/ — trace propagation/correlation; not permissions or proof of causality.
- **S11 AX bulk reads:** https://developer.apple.com/documentation/applicationservices/1462051-axuielementcopymultipleattribute and https://developer.apple.com/documentation/applicationservices/1462060-axuielementcopyattributevalues — bulk node attributes and bounded array pages, not a complete incremental desktop model.
- **S12 Code execution pattern:** https://www.anthropic.com/engineering/code-execution-with-mcp — programmable orchestration, selective results and reusable helpers; its example savings are not predictions for Cozea.
- **S13 Swift C interop:** https://www.swift.org/blog/swift-6.3-released/ — generated C declarations through @c; useful implementation option, not a reason to change a qualified ABI gratuitously.
- **S14 Optional capture diagnostics:** https://developer.apple.com/documentation/screencapturekit/scstream/addclipbufferingoutput(_:) — beta rolling clip buffering. It is not a required release dependency.

The supplied private conversation/screenshots are not republished in this public repository. Their reported observations are summarized with the evidence limitations above.
