# Programmable Agent Interface Devices (AIDs) for macOS

## Status

This document defines the **target Computer Use system** for the `feat/programmable-aids-runtime` branch.

It is intentionally empirical. It separates:

- **Observed behavior**: reproduced in Cozea testing, visible in current source, or explicitly described by the supplied Codex conversation transcript.
- **Current implementation**: behavior present in merged Computer Use v2 on `main`.
- **Target behavior**: what this branch is intended to implement and prove.

This is not a claim about undocumented Codex internals. The supplied Codex transcript omits tool calls/results and only establishes the interface behavior described in that conversation.

`docs/computer-use-v2.md` remains the implementation baseline. This document supersedes it only as the **product/runtime target** for future Computer Use work on this branch.

---

# 1. System definition

Cozea Computer Use is a **programmable set of Agent Interface Devices (AIDs)** that lets an agent perceive and operate a macOS computer through the same visible interfaces a human uses.

The system is not a catalogue of task-specific automations such as `draw_dog`, `copy_folder`, `open_youtube_video`, or `fill_form`.

The system provides general-purpose devices:

1. **Pointer AID**
   - move a visible agent cursor;
   - click;
   - press/hold/release buttons;
   - follow arbitrary paths;
   - drag;
   - scroll;
   - combine pointer input with modifiers.

2. **Keyboard AID**
   - type Unicode text;
   - press shortcuts;
   - press/hold/release individual keys and modifiers;
   - compose deterministic input sequences.

3. **Observation AID**
   - inspect accessibility state;
   - capture a window/screen/region image;
   - request text only, image only, or both;
   - observe relevant state changes without automatically returning heavyweight images after every input.

4. **Application/window AID**
   - discover applications;
   - launch or unhide an application when explicitly requested;
   - foreground and activate the target application;
   - select and focus the intended window;
   - expose stable window identity;
   - detect focus loss, replacement, resize, movement, closure, and user takeover.

5. **Programmable execution AID**
   - execute free-form JavaScript against the defined AID API;
   - support variables, functions, loops, conditions, geometry, data transforms, and reusable helpers;
   - preserve useful session state across calls where safe;
   - allow several predictable UI actions and a final observation in one model-facing tool invocation.

The agent creates the procedure. The AIDs provide reliable perception and physical interaction primitives.

---

# 2. Why visible Computer Use exists

Terminal, filesystem, browser, application APIs, and other specialized integrations can often complete a task faster than GUI automation.

That is not the sole objective of Computer Use.

For the default visible interaction mode:

- the human should be able to see what the agent is doing;
- the visible interaction should correspond to the action actually being performed;
- application state should change through the visible interface when the task is being demonstrated through that interface;
- the human should be able to understand progress and intervene;
- the agent should be able to operate interfaces that have no equivalent terminal/API workflow.

Therefore:

> **The visible cursor and the actual UI interaction must describe the same action, at the same location, in the same order.**

It is not acceptable to animate a cursor over Finder while secretly copying the file through a shell command and present that as a successful Finder interaction.

Hybrid execution is allowed only as an explicit capability/mode. It must not masquerade as visible Computer Use.

---

# 3. Empirical basis

## 3.1 Cozea findings observed in the current v2 runtime

The merged v2 architecture already established useful foundations:

- action replies are compact acknowledgements;
- actions do not automatically capture screenshots or rebuild the full accessibility tree;
- observations can request text and image independently;
- tree and image acquisition run concurrently;
- the native runtime is persistent and in-process;
- the software cursor is display-linked rather than a synchronous main-thread animation loop;
- pointer input waits for visible cursor arrival before dispatch;
- AX, public Core Graphics event delivery, and SkyLight click delivery exist as separate backends;
- ScreenCaptureKit retains the latest frame from a warm stream.

The following failures were observed during actual use and source review.

### A. Too many model/tool locksteps

A Safari/YouTube task was reported as requiring 14 sequential Computer Use exchanges and about four minutes. The exact percentage breakdown in the test report is an estimate, not instrumented proof, but the excessive exchange count is sufficient evidence that individual primitive calls impose too much orchestration overhead for predictable sequences.

### B. Coordinate leases are invalidated too broadly

Current coordinate validation requires both the observation revision and the input revision to match the screenshot lease. One Cozea input invalidates that screenshot for another coordinate action.

This makes repeated drawing approximately:

```text
observe → one stroke → observe → one stroke → observe ...
```

A JavaScript wrapper alone cannot remove that restriction; the native lease model must change.

### C. Observation consistency is too coarse

Current observations can be marked incoherent when subscribed UI state changes during collection, and incoherent observations cannot authorize input.

The Finder test encountered repeated `observation_consistent: false` while Finder was actively updating. The exact AX notification responsible for every invalidation was not independently instrumented, so the target system must fix the coarse policy without depending on an unproven single-node root cause.

### D. Window recovery can deadlock

Finder with no usable visible window produced a state where observation failed, while action tools required a successful prior observation. This created a bootstrap loop: no observable window, but no authorized way to create/foreground a usable window through Computer Use.

### E. ScreenCaptureKit-related window selection can choose the wrong window

The Finder test returned tiny `WindowSharingSessionButton` captures rather than the intended Finder content window. Current window selection chooses a focused/first AX window before completing full AX/WindowServer candidate ranking, so ephemeral overlay selection is a real class of bug that must be prevented.

### F. Drag and keyboard recovery are weaker than click recovery

Click supports several routing strategies. Drag is currently PID-targeted, and keyboard typing/shortcuts are PID-targeted. If an application ignores that delivery path, the agent has no equivalent general foreground/system-event fallback for those device classes.

### G. Capture lifetime is tied to screenshot requests rather than the active turn

Current capture entries start a 15-second idle eviction timer when the active screenshot-request user count reaches zero. Session ownership is tracked separately but is not consulted by idle expiry.

Therefore an agent can still be actively working while its warm `SCStream` is stopped. The next image request must recreate capture.

### H. The current procedural cursor rendering is wrong

The current Cozea renderer forces `referenceImage = nil`, uses the procedural contour, and combines it with inherited orientation/hotspot constants. Real testing showed the cursor rendered too large and visually inverted. Source geometry also shows the declared hotspot and the visible procedural tip are not the same point.

This is both a visual defect and a legibility defect: the human-visible tip must correspond to the runtime interaction point.

### I. `observed_change` is not application success

A short AX-notification wait can produce `observed_change: false` even when visible application behavior eventually changes. Conversely, an unrelated notification would not prove the intended operation succeeded.

The system must represent submission evidence separately from outcome verification.

---

## 3.2 Interface properties established by the supplied Codex transcript

The transcript establishes that, in that Codex session:

- Computer Use was exposed through one MCP JavaScript tool;
- the tool accepted free-form JavaScript over a defined Computer Use API;
- JavaScript could use variables, loops, conditions, and multiple supported actions;
- predictable keyboard/type sequences could be grouped in one invocation;
- screenshots were explicitly requested rather than automatically returned by clicks/typing;
- an action and an observation could occur in the same JavaScript invocation;
- the interface still depended on the expressiveness of its underlying commands;
- its Notes freehand drawing attempt also failed.

The transcript does **not** prove how Codex implements native input internally, how long it keeps ScreenCaptureKit streams alive, or that its backend is universally more reliable.

The target Cozea system adopts the **programmability property**, not an assumed undocumented implementation.

---

# 4. Core product invariants

## 4.1 Programmability over task catalogues

Do not add task-specific native tools merely because a model might want to perform a creative task.

The native/API layer should expose general device operations. JavaScript should let the model synthesize task-specific behavior.

Examples:

- draw an ellipse by computing points and following them;
- drag several items based on geometry discovered at runtime;
- iterate through a table;
- create a task-specific Finder navigation helper;
- retry an observation condition with a bounded loop;
- build a geometric path from model-generated coordinates.

## 4.2 Visible cursor remains mandatory for pointer interaction

For pointer actions:

```text
resolve target
→ visibly move Cozea cursor
→ cursor arrives at the real interaction point
→ revalidate target
→ dispatch actual input
```

No hidden click may occur before the visible cursor arrives.

## 4.3 Visible execution must correspond to real execution

During a drag or drawing stroke, event geometry must follow the same path the human sees.

The expressive cursor approach trajectory may remain curved/spring-like before button-down.

Once a button is held for a gesture, the actual gesture path must follow the program-specified geometry faithfully rather than substituting decorative cursor motion.

## 4.4 Foreground-first is the default physical interaction mode

Ordinary physical input should target a verified foreground application/window.

The runtime should:

1. prepare/launch/unhide the requested app when explicitly requested;
2. bring the target app forward;
3. select/raise the intended window;
4. verify foreground application and focused window;
5. then perform pointer/keyboard input.

Background delivery remains a compatibility/advanced capability, not the normal execution mode.

## 4.5 Semantic AX remains preferred when semantics are unambiguous

Buttons, menu items, checkboxes, radio buttons, links, and other controls exposing a reliable semantic AX action may use that action directly.

Canvas, spatial, gesture, and controls without a meaningful AX action should use physical input.

If delivery becomes uncertain after dispatch, the runtime must observe before attempting another potentially duplicate route.

## 4.6 User takeover cancels control

If the user unexpectedly changes foreground application/window, moves a controlled target, or otherwise takes over during a bounded interaction session, the runtime must stop rather than fight to regain focus repeatedly.

Cancellation must release automation-owned mouse buttons and keyboard modifiers.

---

# 5. JavaScript execution model

The target agent-facing interface is a persistent, bounded JavaScript execution environment over a typed Computer AID SDK.

Illustrative API shape:

```javascript
const safari = await aid.apps.get("com.apple.Safari", {
  launch: true,
  foreground: true,
});

await safari.keyboard.press("super+t");
await safari.keyboard.type("https://www.youtube.com/");
await safari.keyboard.press("Return");

const state = await safari.observe({
  accessibility: true,
  screenshot: false,
});

return state;
```

For a drawing surface:

```javascript
const app = await aid.apps.get("Example Drawing App", {
  foreground: true,
});

const state = await app.observe({
  accessibility: true,
  screenshot: true,
});

const surface = await state.region({
  rect: [300, 200, 700, 600],
  stableFor: "gesture-session",
});

function ellipse(cx, cy, rx, ry, segments = 72) {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

await surface.pointer.stroke(
  ellipse(0.5, 0.5, 0.25, 0.3),
  { durationMs: 800 }
);

return await surface.observe({ screenshot: true });
```

These examples define the intended **expressiveness**, not final public method names.

## 5.1 JavaScript must be free to compute

Allow:

- variables;
- functions;
- arrays/objects;
- loops;
- conditionals;
- geometry/math;
- transformations;
- bounded waits;
- helper functions created by the model;
- reusable session-local state.

Do not reduce JavaScript to a JSON batch in disguise.

## 5.2 Device side effects remain capability-gated

JavaScript is expressive, but every desktop effect still goes through the native runtime's authorization and validity checks.

The JavaScript context is not permission to access arbitrary Electron/Node internals.

The final implementation must use a restricted execution boundary. `node:vm` alone is not considered a security sandbox.

## 5.3 Batch duration and cancellation are first-class

A JavaScript invocation may intentionally contain multiple cursor journeys, waits, and observations.

The host timeout model must distinguish:

- stalled/hung execution;
- expected long-running UI work;
- user cancellation;
- policy revocation;
- turn/session termination.

The runtime must report the last completed operation when execution stops.

---

# 6. State and validity model

The current global-style snapshot validity rule is replaced by **dependency-specific validity**.

## 6.1 Semantic element handles

An element-based action depends on:

- same application launch identity;
- same intended window identity;
- retained/live AX element identity where available;
- compatible role/action semantics;
- relevant geometry when pointer placement depends on it;
- no blocking window/dialog/focus transition that makes the action ambiguous.

An unrelated status update elsewhere in the window should not automatically invalidate a still-valid semantic target.

## 6.2 Coordinate and spatial interaction handles

Coordinate validity depends on the spatial frame that gives the coordinates meaning.

A bounded spatial/gesture session may continue across expected self-generated visual changes if:

- target window identity is unchanged;
- window geometry is unchanged;
- target region geometry/transform is unchanged;
- zoom/scroll/layout transform relevant to the region is unchanged;
- no blocking modal/focus takeover occurred;
- no external user input invalidated control ownership;
- the session remains within its age/action/time bounds.

Expected ink appearing in a stable canvas is not, by itself, a reason to invalidate the coordinate transform.

The following must interrupt/revalidate:

- window move/resize/close/replacement;
- target region move/reflow/scroll/zoom;
- navigation changing the coordinate frame;
- new blocking dialog/sheet/menu when relevant;
- foreground/focus loss;
- user takeover;
- permission or policy revocation.

## 6.3 Observation consistency is evidence, not a universal action lock

Observation collection should report consistency metadata, but a changed observation should not automatically forbid every subsequent action.

The executor determines whether the **specific requested action's dependencies** remain valid.

---

# 7. Capture lifecycle

Capture lifetime is **turn/session-scoped**, not screenshot-request-scoped.

Target lifecycle:

```text
active agent turn
→ first screenshot observation opens/reuses SCStream
→ stream remains warm while the session owns the target window
→ actions/JavaScript/model thinking may occur without image requests
→ future screenshot uses latest valid frame
→ turn end/cancel/reset/revocation releases the stream
```

Keeping capture warm does not imply continuously sending video to the model.

The stream retains only bounded latest-frame state. Image encoding/return occurs only on explicit observation.

## 7.1 Ownership rule

If a valid active session owns a capture entry, the ordinary 15-second screenshot-idle timer must not evict it.

Idle expiry is appropriate only for unowned streams.

An independent longer abandoned-session watchdog may clean up leaked sessions.

## 7.2 Deterministic teardown

On:

- normal turn end;
- user cancellation;
- model request cancellation;
- Computer Use disable;
- permission revocation;
- runtime reset;
- process shutdown;

perform deterministic cleanup:

- release automation-owned mouse buttons;
- release keyboard modifiers;
- hide/release software cursor state;
- stop session-owned SCStreams;
- release observation/spatial handles;
- drop foreground-control ownership;
- clear session-local JavaScript state.

---

# 8. Application/window preparation and targeting

## 8.1 Preparation must work before observation

The system needs a mutation capability that can prepare a requested application before a normal observation exists.

Examples:

- launch an app;
- unhide it;
- activate it;
- request/raise a usable window;
- select a specific existing window.

This removes the windowless deadlock observed with Finder.

## 8.2 Window identity must be explicit and stable

Observation results should expose stable window identity so JavaScript can retain a handle and ask the runtime to revalidate it.

Window selection must evaluate viable AX/WindowServer candidates before choosing a primary content window.

Known ScreenCaptureKit/system sharing UI must not silently replace the intended application content window.

Do not implement a generic rule such as “reject every window under 100 px” because legitimate dialogs, popovers, menus, and utility windows may be small. Exclusions must be specific enough not to destroy valid UI interaction.

---

# 9. Physical input backends

Foreground physical input should have a consistent backend strategy across device classes.

## 9.1 Pointer

Support:

- click;
- double click;
- right click;
- down;
- move while held;
- up;
- arbitrary timed path;
- scroll.

Use system event-stream delivery as the primary foreground physical path to validate.

## 9.2 Keyboard

Support foreground system-level:

- text input;
- shortcuts;
- individual key down/up;
- modifier down/up.

PID-targeted keyboard delivery may remain as an optional compatibility path, but it must not be the only recovery strategy.

## 9.3 Gesture/stroke

Expose a complete gesture primitive rather than forcing the model to synthesize high-frequency pointer samples through model/tool round trips.

A gesture consists of:

```text
approach start visibly
→ mouseDown
→ timed path samples matching visible pointer
→ mouseUp
```

The approach motion may be expressive. The held-button path must be faithful to the programmed geometry.

## 9.4 SkyLight

Keep SkyLight isolated and optional.

Diagnostics must distinguish:

- disabled by environment;
- unsupported/untested OS range;
- missing symbol(s);
- operation ineligible;
- runtime delivery failure.

A generic `BACKEND_UNAVAILABLE` must not imply a macOS permission restriction when the cause is actually Cozea's own compatibility guard.

---

# 10. Cursor target behavior

The software cursor remains part of the product.

The next implementation must establish one explicit cursor coordinate model with this invariant:

> **The rendered glyph hotspot equals the native input point at rest and throughout rotation, motion and click pulse.**

The procedural/current inherited constants must not be trusted without visual calibration.

Required proof:

- correct orientation;
- compact body size;
- hotspot alignment at 1x and 2x backing scale;
- hotspot alignment on mixed-scale multiple displays;
- hotspot alignment while rotating;
- hotspot alignment during click pulse;
- no input dispatch before arrival;
- held-button gesture path visually matches dispatched path.

A 16-point pointer body is an initial design target for evaluation, not a fixed requirement until visual validation is complete.

---

# 11. Result semantics

Action results must separate three concepts.

## 11.1 Submission

```text
not_submitted
submitted
submission_uncertain
```

## 11.2 Observed evidence

```text
change_observed
no_change_observed
not_checked
```

## 11.3 Outcome verification

```text
verified
unverified
failed
```

A short AX notification timeout is evidence only. It is not sufficient to claim application success or failure.

If an action may already have been delivered, the runtime must not blindly retry another backend.

JavaScript may explicitly request the appropriate verification observation within the same invocation.

---

# 12. Empirical acceptance scenarios

The branch is successful only when it improves the real tasks that exposed the problems.

Measurements must be taken on the same Mac/model/task where comparative claims are made. Report model waiting separately from native execution.

## Scenario A: Safari/YouTube

Task class:

```text
foreground Safari
→ navigate/search
→ choose a visible/semantic result
→ handle player/ad UI
→ verify playback
```

Required behavior:

- new-tab + typing + Return + observation can execute in one JavaScript invocation;
- deterministic steps do not require one MCP exchange per primitive;
- screenshot is explicit, not automatic after input;
- semantic AX controls remain usable even when unrelated UI updates occur;
- physical foreground click exists when coordinate input is required;
- action outcome can be verified within the same JavaScript invocation when appropriate;
- instrumentation records total model/tool exchanges and native durations.

Target proof metric:

- materially fewer model-facing exchanges than the observed 14-exchange run;
- no claimed speed multiplier until measured.

## Scenario B: drawing application / Notes-like canvas

Required behavior:

- foreground activation occurs before physical drawing;
- one tested stroke can be sent through a complete system-level gesture path;
- if the stroke is visually successful, multiple strokes can execute from the same stable spatial session without re-observing after every stroke;
- visible cursor follows the exact held-button stroke geometry;
- the final screenshot verifies visible marks;
- if the target app rejects synthetic system events, result is reported as unverified/failed rather than `ok` being interpreted as drawing success.

The supplied Codex transcript also failed freehand Notes drawing, so this scenario must be validated empirically rather than assumed solved by adopting JavaScript.

## Scenario C: Finder copy/navigation

Required behavior:

- Finder can be prepared/foregrounded before a standard content observation exists;
- a sharing/capture indicator cannot replace the intended Finder content window;
- unrelated Finder status/progress updates do not globally lock out a still-valid target;
- foreground keyboard shortcuts have a system-event route;
- source selection, navigation, copy, destination navigation, paste, and verification can be composed into sensible JavaScript batches separated by actual decision points;
- visible GUI actions correspond to the file operation when running in visible Computer Use mode.

---

# 13. Performance measurement model

Do not optimize only primitive latency.

Measure the whole task as:

```text
model planning/wait
+ JavaScript/tool round trips
+ native target resolution
+ intentional cursor travel
+ input dispatch
+ state wait/verification
+ capture/encode
+ result transport
```

Record at minimum:

- number of model-facing Computer Use invocations;
- number of observations;
- number of screenshots encoded;
- number of full AX traversals;
- number of capture stream starts/stops;
- model/tool wall-clock time;
- native execution p50/p95/p99 by stage;
- failed/uncertain actions;
- fallback backend counts;
- user takeover/cancellation events.

A fast native click is not sufficient if a task still requires repeated model round trips and re-observations.

---

# 14. Non-goals

This branch does **not** define success as:

- cloning undocumented Codex internals;
- eliminating the visible Cozea cursor;
- using terminal/filesystem APIs invisibly for every task;
- implementing a library of task-specific “cool actions”;
- making every stale screenshot valid forever;
- treating AX notifications as proof of application outcome;
- assuming private SkyLight APIs are universally available;
- claiming all macOS applications accept synthetic events;
- claiming measured Codex speed parity without measurement.

---

# 15. Implementation ordering implied by this definition

This document is a system definition, not a detailed implementation plan, but dependencies impose the following order:

1. correct cursor orientation, size, and true hotspot geometry;
2. establish foreground app/window preparation and verified focus ownership;
3. make capture lifetime session/turn-scoped;
4. fix primary-window resolution and explicit window handles;
5. replace global snapshot invalidation with dependency-specific validity;
6. provide consistent foreground physical pointer, gesture, scroll, and keyboard devices;
7. add bounded spatial/gesture sessions for repeated coordinate work;
8. add the persistent restricted JavaScript execution environment over those AIDs;
9. validate the three empirical scenarios and measure whole-task performance.

JavaScript should not be shipped over unreliable devices and then expected to program around native lifecycle/input bugs.

---

# 16. Definition of done

The target system is demonstrated when an agent can, through a programmable JavaScript AID interface:

- freely compose general-purpose pointer, keyboard, observation, and window operations;
- keep a target app visibly foregrounded while it acts;
- let a human watch the real interaction as it occurs;
- use semantic AX when appropriate and physical UI input when semantics are insufficient;
- execute deterministic multi-step sequences without one model round trip per primitive;
- retain a stable spatial interaction session for appropriate repeated gestures;
- keep capture warm for the active turn without continuously transmitting images;
- survive unrelated UI updates without globally invalidating valid targets;
- stop safely when the target becomes uncertain or the human takes over;
- report submission, evidence, and verified outcome separately;
- pass the Safari/YouTube, drawing-canvas, and Finder scenarios with instrumented evidence.

That is the system this branch is intended to build.
