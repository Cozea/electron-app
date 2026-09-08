# D31 — Cross-system decisions, reconciliation and implementation traps

**Revision:** 1.1. **Status:** normative design reconciliation; no runtime qualification is implied. This completes the expanded set without replacing the 27 preserved subsystem documents. Read [MASTER](MASTER.md), [D02](02-contracts-sdk.md), [D28](28-implementation-roadmap.md), [D30](30-qualification-gates.md) and [contracts](contracts/README.md).

## 1. Authority of documents

The product invariants in MASTER remain authoritative. D31 settles the cross-subsystem ambiguities listed below. D02 and the versioned contract artifacts own spelling, scalar domains and schemas. Individual subsystem documents own algorithms and implementation responsibilities. D28 owns work-package dependencies; D30 owns qualification procedures. Historical product/reference/platform-opportunity notes explain rationale but cannot override these implementation contracts.

An implementation agent finding an actual contradiction must write an ADR describing the conflicting clauses, evidence, selected resolution and affected artifacts. Do not silently choose the easier path, invent a compatibility alias or remove a test. A design requirement is not a claim that its platform experiment passed.

## 2. Decision ledger

| Decision | Fixed interpretation | Reason |
|---|---|---|
| R01 | Named ES-module cells with explicit exports, not implicit global notebook variables | Persistence must have implementable language semantics. |
| R02 | A workspace is memory; a control episode is authority | Pure functions may persist after recording/input stops. |
| R03 | A model checkpoint can outlive one provider response but not the logical control lease | Provider transport completion is not always task completion. |
| R04 | A suspended program resumes a single-use live Promise; never replay its prefix | GUI effects are not transactional. |
| R05 | Capability/owner/runtime/epoch checks happen in trusted host/native code | Opaque IDs and JS proxies are not credentials. |
| R06 | One explicit physical-input permit per seat covers pointer and keyboard together | Focus, modifiers and buttons are shared resources. |
| R07 | An action's relevant dependencies govern validity | A status counter must not veto an unrelated valid button. |
| R08 | Capture owners and temporary frame borrowers have different lifetimes | Screenshot inactivity does not mean the task ended. |
| R09 | Image capture, encoding, retention and provider export are separately authorized/accounted | Warm local capture is not continuous model video. |
| R10 | Receipt submission/evidence/outcome are independent | Event posting is not application success. |
| R11 | Fast-visible pacing is allowed; the actual tip still arrives before contact | The cursor is causal feedback, not a fixed 1.4-second tax. |
| R12 | A native timeline controls held gestures; no inference wait while input is held | Accuracy, cancellation and truthful visibility need one schedule. |
| R13 | The primary physical route is verified foreground input; semantic AX and optional Sky are explicit routes | Consistent capability matters more than private-backend enthusiasm. |
| R14 | Source/IDL/schema/SDK/discovery share one canonical contract | The current source-versus-patched-T3-table split must not reproduce drift. |
| R15 | Published protocol/engine features are adopted only for a pinned, qualified adapter/profile | A technology note is not a dependency lock or conformance test. |

## 3. Canonical names and wire domains

Application/SDK fields use camelCase. Protocol-defined MCP fields keep their own spelling only at the adapter boundary. The six exposed tool names are `computer_open`, `computer_exec`, `computer_inspect`, `computer_respond`, `computer_close` and `computer_describe`. The conceptual `computer.*` namespace in older prose is not another tool catalogue.

`workspaceId`, `controlId`, `executionId`, `operationId`, `checkpointId`, `observationId`, `artifactId`, `runtimeInstanceId`, `seatId` and resource IDs are distinct owner-bound opaque identifiers. `controlEpoch`, journal sequence and large monotonic counters are decimal strings on the wire and integer/bigint values internally. Finite geometry/durations are bounded JSON numbers. No native pointer, arbitrary path, peer secret or model-chosen principal crosses into the guest.

Receipt vocabulary is frozen as:

- submission: `not_submitted`, `submitted`, `submission_uncertain`;
- evidence: `change_observed`, `no_change_observed`, `not_checked`;
- outcome: `verified`, `unverified`, `failed`.

`canRetryAutomatically` cannot become true merely because `no_change_observed` occurred. A successful system-post call gives submission evidence, not a complete task predicate. `Receipt.after` is an operation barrier reference; it does not assert that all application effects finished.

Execution states are `queued`, `running`, `waiting-for-condition`, `waiting-for-model`, `waiting-for-user`, `paused`, `cancelling`, `completed`, `failed`, `cancelled`, and `interrupted-after-possible-effect`. These values are separate from control state (`active`, `revoking`, `quiescent`, `expired`) and from a transport task state. The adapter translates rather than conflating them.

## 4. Persistent modules and authority-bearing closures

A cell gets a unique execution module URI and frozen imports. The same idempotency key with identical input attaches to the existing execution; a new key creates a deliberate new evaluation. Only a successfully completed cell publishes a new namespace under `workspace:/cellName`. Non-exported variables remain module-private; exported closures can retain them while the worker lives.

Publication is not heap rollback. A cell may mutate a previously imported object before failing. It may also already have performed a desktop effect. Both facts survive in the resulting state/journal even though the new namespace is not published. There is no automatic effect replay to rebuild a lost heap.

The imported `aid` facade resolves the current trusted execution context at call time. Saving a helper that calls `aid.apps.prepare` is different from saving a live `Window` proxy. The helper can reacquire a target under new authority; the old proxy remains expired. No getter, Proxy trap or user function is executed by workspace inspection merely to produce a summary.

Approved pure modules must be initialized without desktop capability. Marking source `pure-init` is not a security proof by string: the host supplies a no-effect initialization scope and rejects effects. Arbitrary package installation or remote imports remain outside the guest contract.

## 5. Checkpoints and logical task completion

A same-model checkpoint is a live suspended execution, not a second hidden model or a fresh invocation from line one. The host constructs an evidence packet, delivers requested image content, waits for a schema-valid answer and resolves the corresponding Promise once. No button/key is held during the wait.

A provider may report that its current response finished while the AID program waits for the next model decision. The host must therefore maintain an explicit logical task/control record. It may keep capture warm while that task is legitimately live. It must not interpret every provider `ready` transition as either unconditional teardown or permission for indefinite activity.

The trusted host heartbeat and checkpoint/control expiry policy are authoritative. Guest output cannot renew control. A lost HTTP response is recoverable by inspect. Host loss, user cancel, permission revoke or completed logical task revokes control independently of the guest. Persistent pure workspace memory is a separate policy.

Human approval has a different checkpoint kind. `computer_respond` from the model can answer only a same-model checkpoint under its authenticated invocation. Human approvals enter through a trusted UI event that is bound to effect description, target dependencies and epoch. A field claiming `approvedBy: human` is never accepted from generated code.

## 6. End-to-end adversarial walkthrough: paused drawing

Consider a cell that draws three strokes, releases the button, asks the model which region to add detail to, then plans more strokes.

1. The first three native timelines have operation IDs and receipts. They are not part of an atomic rollback transaction.
2. Before `decide`, the driver confirms the execution has no held input. The host stores the live continuation, evidence IDs, response schema and surface dependency fingerprint.
3. If the user moves the window or takes over, native control is revoked or the relevant surface becomes invalid. Existing pure JS locals can remain resident; their capability proxies do not remain authorized.
4. When an answer arrives, the host first verifies its owner, checkpoint kind, single-use state, epoch, expiry and dependency fingerprint. It must not resume an effectful continuation under the old grant just because the returned region is valid JSON.
5. A duplicate identical answer returns the recorded checkpoint resolution/status. A conflicting answer fails. Neither causes another suffix execution.
6. If the worker dies, the live continuation is lost. The host returns `WORKSPACE_LOST` or the corresponding expired-execution result with the last receipts. It does not rerun the first three strokes to recreate JS state.
7. A new execution may read the current drawing and deliberately plan recovery under new control. That is new judgment, not automatic replay.

The acceptance oracle asserts exactly three old strokes, no extra stroke from duplicate response, released held state, stale surface rejection and a truthful lost-continuation receipt. D06/D11/D16 and G02/G04/G06/G03 collectively own these checks.

## 7. Native linearization and the stop contract

The input permit is an explicit resource, not a Swift actor method that can interleave after `await`. Admission checks owner/epoch and selects a route before effects. The runtime may release the permit during a safe observation wait, but never while input state is implicitly assumed exclusive.

Immediately before a discrete activating event, recheck authority/focus/target dependencies. During a timeline, use the native schedule and the urgent revoke fence. No new activating submission begins after the fence is acknowledged. Cleanup releases are a separate permitted class because a revoked action still needs its button-up.

An OS event already posted may still be delivered later. AX calls can also block or return uncertain delivery. Therefore neither cancellation nor `quiescent` means the external application was rolled back or that no previously submitted effect can finish. Quiescence means the driver has no remaining admitted activating work and has completed or explicitly reported its release attempts.

A driver-crash supervisor can attempt conservative release according to its known ledger, but cannot universally reconstruct every OS/device state. Qualify that case separately. Do not guarantee a 50 ms system-wide outcome merely because the internal urgent queue was serviced quickly.

## 8. Journal write ordering and retry semantics

Record durable intent and a conservative possible-submission phase before beginning an effectful native operation. One prepared timeline may contain many samples; it does not need a durable write for every pixel. Its receipt records exact known phase/progress, with uncertainty if the process stops before acknowledgement.

A crash before the possible-submission record can be distinguished from one after it. Once possible submission exists, automatic replay is forbidden without a stronger independently observed postcondition and explicit policy. Absence of an app notification is not such a postcondition.

An idempotency record binds owner, method/code, frozen imports and canonical arguments. The same key with changed content fails. A completed execution result or bounded tombstone can be retrieved after a response loss. Image artifact retention can expire separately; retrying an execution does not secretly recapture or rerun effects to reproduce expired output.

Canonical JSON hashing uses the documented supported scalar domain. Reject non-finite values and unsafe numeric counters before hashing. Include API/contract version in the hash input. Trace IDs and human-readable source names are not the idempotency authority.

## 9. Coordinates and target evidence

A point is defined by a frame: display/desktop logical coordinates, window-local points, image pixels or normalized surface coordinates. The contract must not accept an untagged pair except inside a surface method whose frame is already explicit. A crop retains its parent transform and frame ID.

The native driver builds a topology snapshot from authoritative display/window metadata. It records units, origins, scale, orientation and generation. Use calibrated transforms and platform conversion APIs; do not scatter independent Retina multipliers or Y-axis flips through the SDK, glyph and event backend. Test negative display origins, mixed scales, display rotation and topology changes.

A semantic target depends on identity/meaning/enabled state and relevant geometry. An observed pixel point depends on its frame and target-relevant scene evidence. A keyboard target depends on intended foreground/focus lineage, not screenshot input-version equality. A drawing surface permits expected content changes while its spatial/tool/document contract holds.

Dirty notifications identify possible change; they do not guarantee complete coverage. A raw pixel canvas with unknown zoom/document signals has a weaker qualified profile, shorter reconciliation horizon or explicit checkpoints. Never turn uncertainty into a fake stable identity, and never restore a universal unrelated-status veto.

## 10. Capture owner/borrower state machine

Each stream entry has an immutable source generation, a set of control owners, a count/set of outstanding borrowers and a lifecycle state. Owners express the right and need to keep capture live. Borrowers express a temporary read/encode using that generation. These are not one reference count.

Normal acquisition requires a live owner and a compatible source generation. A screenshot finishing releases its borrower, not its owner. An owned stream remains warm through JS calculation, typing and model thinking. Ordinary idle expiry applies only after ownership is gone.

When the last owner leaves, mark closing and reject new borrowing. Cancel or drain existing borrowers under their deadlines, then stop the stream. If another authorized owner legitimately joins before closure is committed, the serialized lifecycle transition must either retain the existing generation or mint a new one; it cannot revive a stopped stream implicitly.

Permission revocation/reset makes old-generation publication invalid immediately, even when an encode completes later. Late callbacks are ignored. A geometry/source change creates an explicit replacement transition. The old borrower can return an expired/error outcome but must not label its pixels as the new source.

Capacity policy accounts active streams, pending start/stop, retained frames and encodes. It cannot evict an active pinned source simply because two entries exist. The host requests an explicit unpin/lower-detail decision or reports capacity. Failure/revocation may stop a stream with owners, but the reason and invalidation are surfaced.

## 11. Freshness without inventing frames

Capture time, callback receipt time, encode completion and provider emission are different clocks/events. A frame must carry actual capture provenance and any clock-conversion uncertainty. An action barrier orders Cozea submission, not necessarily completion of all application work.

A static screen can remain unchanged; requiring a changed image for every post-action request can cause unnecessary one-shot capture. Use documented complete/idle metadata and validated frame evidence to distinguish unchanged-but-current observation from a genuinely stale buffer. If that evidence is absent, report the uncertainty or obtain a bounded fresh capture rather than relabelling timestamps.

Image caching is safe only when source frame, crop, scale, format and redaction identity match. Encoding/transmission stays explicit. Keeping a stream warm does not continuously send video to a model. Debug clips and demonstrations have separate consent/retention scopes.

## 12. Window preparation and foreground ownership

Read-only discovery does not secretly launch apps. Explicit `apps.prepare` can launch/unhide/reopen/select/foreground within the grant before a screenshot exists. App-wide menu or known keyboard commands need an authorized application target, not necessarily a content screenshot. No universal `AXCreateNewWindow` is assumed.

Compare viable AX and WindowServer candidates before selecting the intended content window. Preserve explicit window identity across calls. Known sharing/agent overlays are excluded using specific metadata and ownership; legitimate menus, popovers and small dialogs remain part of the scene. An ambiguous match returns candidates rather than choosing the first.

Foreground-first does not mean repeatedly stealing focus back from the user. Deliberate preparation at an operation boundary is allowed; unexpected focus takeover invalidates authority/dependencies. Activation calls are attempts; verify the resulting app/window state before input.

Backend route selection happens before effects. AX may be preferred for an unambiguous semantic action; physical canvas/keyboard paths use qualified foreground event delivery. Private SkyLight remains optional. A generic unavailable error must distinguish configuration, missing symbols, OS profile, ineligibility and runtime failure.

## 13. Observation-directed attention and local predicates

The scene service exposes frozen observation queries and explicitly live window queries. A heuristic relevance filter never permanently removes raw evidence access. A diff names its exact base and reports missing history. Pixel/AX/model-inferred labels retain separate provenance.

Recognized SDK queries can subscribe to known dependencies. Arbitrary JavaScript predicates execute in read-only guest scopes with time/memory/job bounds; the native host does not evaluate user predicates or trust a guest-supplied purity bit. A watch becoming true may resume a previously authorized program, but the eventual effect is independently validated.

Perception/planning may overlap deterministic execution, but it cannot create a second writer or act on model output that has not arrived. Providers that cannot accept live observations mid-inference use explicit checkpoints. Continuous capture is not continuous model vision.

## 14. Physical fidelity and human feedback

The visible Cozea cursor stays mandatory. Its true tip is the transform origin. Approach pacing can be fast-visible or presentation-oriented; a held gesture follows the supplied path and timeline faithfully. A mouse cannot claim pen pressure, tilt or multitouch it does not support.

The real pointer may move in foreground mode. Cursor-hiding tricks are optional and must be qualified; if unreliable, keep an honest aligned marker. On takeover, release control and restore ordinary presentation without warping the user's pointer back.

Fast visible feedback is not enough reaction time for every sensitive effect. Required approvals occur before the action, bound to its current target and scope. A decorative cursor over Finder while files are copied through a shell is prohibited in visible mode. Explicit clipboard paste into the actual UI is a distinct capability and must be recorded as such.

## 15. Current technology adoption boundary

Do not require a particular newer MCP revision, WASI version, Swift annotation, beta capture method or App Intent feature merely because it appeared in a research note. The source register identifies primary documentation and limits. Pin the adopted dependency and verify exact semantics before enabling the relevant adapter.

The local design is valid with explicit state handles even when MCP's wire lifecycle is stateful. Preserve initialization/session behavior required by the actual negotiated protocol. Async tasks, user input and cancellation map onto the same native records only after conformance. A task update must resume a single checkpoint, not rerun `exec`.

A Promise-based guest bridge does not require native async Wasm component support. Engine selection must prove resident modules, interruption and host imports. Generated Swift C declarations can improve a bridge, but the versioned ABI/IPC contract and signing proof remain required.

## 16. Design review versus implementation evidence

The completed handoff must mechanically check internal paths/anchors, numbered source/work/gate references, acyclic dependencies, typechecked examples, schemas, positive/negative contract vectors and state-model counterexamples. It must read back actual exported bytes and compare them with committed content.

Those checks do not prove the signed-app experiments in D30. The qualification status starts `not-run`. Runtime implementation follows D28. A future agent should need to implement contracts and execute prescribed experiments, not invent a different system or assume that this documentation exercise already passed platform tests.
