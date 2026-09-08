# D23 — Execution debugger, safe inspection and recorded simulation

**Purpose:** make agent procedures inspectable and repairable without replaying prior effects or claiming rollback of the desktop. **Sources:** standardized source maps [S29](29-research-register.md#s29), engine embedding/interruption [S03–S05](29-research-register.md#s03), journal D16.

## 1. Debugger scope

Expose emitted source cells, module revisions, execution states, pending device calls, source-mapped errors, target dependency records, receipts and explicitly retained evidence. This is execution debugging, not access to hidden model reasoning. The debugger must remain useful with a minimal engine that has no full browser-style inspector protocol.

Support pause at safe SDK boundaries, resume, cancel, inspect exports/bindings, inspect pending checkpoint, and compare authorized before/after regions. Arbitrary CPU instruction stepping is optional engine-specific capability; do not advertise it just because source maps exist.

## 2. Safe pause

A pause request stops admission of new effects and waits for a safe boundary. During an ongoing gesture, finish/release or interrupt according to the motor policy; never leave a button held while a human reads variables. State becomes paused only after quiescence is confirmed. A breakpoint before a device call occurs before that effect's dispatch; a breakpoint after it shows its actual receipt.

On resume, acquire fresh control/epoch if authority was released or the user took over. Revalidate pending targets and refresh changed dependencies. A pause is not permission to reuse old screenshot coordinates indefinitely.

## 3. Inspection semantics

Inspect only safe own data descriptors, bounded primitive values and resource proxy metadata. Do not invoke arbitrary getters, `toJSON`, custom iterators or Proxy traps merely to pretty-print an object. Engine APIs must enforce size/depth/time budgets and represent inaccessible values without evaluation.

Resource inspection returns identity, generation, expiry, source and last validation evidence—not raw AX pointers, native tokens or secret payloads. Code/source may contain private values, so exporting a debug bundle requires separate consent and redaction. Default operational logs remain metadata-only.

## 4. Editing after failure or pause

A live closure's already-executed code cannot be safely replaced arbitrarily. The selected initial editing model is **suffix replacement at an explicit checkpoint**: cancel the remaining pending continuation, retain journal and approved pure exports, then start a new execution cell with a fresh ID/control binding that imports those exports and reacquires targets.

The UI labels this as replacement execution, not resuming the original stack. An optional future engine-supported live edit must preserve the same no-prefix-replay guarantee and pass additional tests. Do not implement arbitrary text splice into a suspended async stack and hope it works.

## 5. Recorded simulation

An offline replay package contains approved source, contract version, sanitized initial pure data, ordered observations, operation expectations and receipt/fault script. The simulator implements the SDK through recorded responses and intercepts **all** effects. It cannot open the native driver or request real desktop grants.

Replaying recorded evidence can validate parsing, decisions, control flow, module state and error recovery. It cannot prove a synthetic event was accepted by a real app. The report distinguishes simulation, fixture-native and real-app runs. A changed program issuing an unrecorded effect gets an explicit divergence rather than silently executing it.

Nondeterminism is controlled through injected clock/random sources and recorded environment/capability profiles. External websites, OS state and arbitrary model decisions are not reproducible merely by seeding Math.random. Model checkpoints can use recorded typed answers for simulation or request a new answer under an explicit test mode.

## 6. Artifact and timeline UI

Show a timeline linking source lines -> operation IDs -> native phases -> observation/evidence. Collapse high-rate gesture samples into one gesture node with optional detail. Display submission uncertainty and cleanup failures distinctly. A snapshot slider is historical observation, not a button that restores the application to that state.

Cozea integration uses the existing assistant Artifacts view and a bounded inspector component with shared overlay rules. Avoid a second native webview or process that bypasses host permissions. The same authenticated artifact broker serves images to the UI and model with different explicit export grants.

## 7. Implementation and tests

Add host `DebugCoordinator`, `SafeInspector`, `ReplayProvider` and a renderer timeline/inspector. Worker engine adapter supplies bounded descriptor inspection and cell/source-map metadata. The portable replay SDK shares contract codecs with the real SDK but has no physical provider implementation linked by default.

**DBG-01:** inspecting a getter cannot cause effects. **DBG-02:** pause while held releases or explicitly interrupts before inspection. **DBG-03:** resume rejects stale target/epoch. **DBG-04:** suffix replacement does not rerun prefix. **DBG-05:** offline replay cannot connect to a driver. **DBG-06:** divergence is reported, not silently filled from live state. **DBG-07:** source maps point to the correct original cell revision. **DBG-08:** debug export requires consent and strips credentials. **DBG-09:** history navigation does not imply rollback. **DBG-10:** recording-disabled operation still yields useful metadata debugging.
