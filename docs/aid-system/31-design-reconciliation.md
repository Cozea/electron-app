# D31 — Final cross-subsystem decisions and consistency resolutions

Revision 1.1. This document records explicit reconciliation decisions made while completing the recovered design. It is newly authored completion work. It does not claim to restore the exact wording of files that were never verified as saved.

Read [MASTER](MASTER.md), [D02](02-contracts-sdk.md), [D28](28-implementation-roadmap.md), [D29](29-research-register.md), [D30](30-qualification-gates.md) and [contract artifacts](contracts/README.md). Normative precedence is: revision-1.1 contract/state/semantic rules here and in `contracts/`; owning subsystem algorithms; master overview; earlier reference/product/research notes. An earlier illustrative method spelling is not a competing API. When changing a decision, update both the owner prose and executable contract vectors.

## R01 — Design acceptance versus implementation qualification

The documentation task finishes when the files, references, selected contracts, state transitions, test vectors, work dependencies and evidence boundaries agree. Native input, process isolation, TCC, provider delivery and performance still require G01–G12 in the implementation phase. A qualification gate is not an unresolved invitation to redesign: D30 supplies the experiment, passing evidence and failure decision.

The original 27 subsystem files and master are preserved as the working foundation. Missing roadmap/register/gates/contracts are completed from them. The recovery/publication report remains historical evidence; a new handoff-validation report describes the completed set. Do not overwrite that historical report with invented passing runtime results.

## R02 — One revisioned vocabulary

SDK/application JSON uses camelCase. Actual MCP-defined fields retain the spelling of the negotiated protocol. Outer host methods are `open`, `exec`, `inspect`, `respond`, `close`, `describe`; MCP adapter names are the corresponding `computer_` names. The application contract revision is `1.1`, not an MCP version.

`exec` uses `source:{kind:"text",text}` or `source:{kind:"artifact",artifactId,sha256}`; it does not accept competing `code`, `script`, `argumentsJson` or arbitrary file-path fields. A module cell has `cellName`, explicit exported namespace and frozen `workspace:/name` imports. `aid.apps.prepare({app,launch,unhide,reopen,foreground})` is the mutation; `apps.get(selector)` and `list` never launch. Preparation returns `{app,window?,receipt}`. A missing content window is an explicit state, not a fake window proxy.

`keyboard.typeText`, `keyboard.chord`, `keyDown`, `keyUp`, `pointer.moveTo`, `pointer.followPath`, `Surface.pointer.stroke`, `Window.observe`, `Window.query`, `Observation.query`, and `Observation.bindSurface` are the selected spellings. Older example names such as `getAXState`, `type`, `press`, `region`, `getScreenshot` and `computer.exec({code})` describe intent only and must not be copied into the production SDK.

`QueryResult.items` is an immutable list; `.one()` rejects zero/multiple results and insufficient coverage. Live `Window.query` returns a promise; historical `Observation.query` is local and never silently refreshes. A guest `RegExp` is serialized only as a bounded source/flags description when required, or evaluated in the interruptible guest over scoped candidates. Do not execute arbitrary unbounded regex on the native input thread. Truncation must not make `.one()` falsely claim uniqueness.

## R03 — Identity is not authority

The trusted host derives Cozea device `identityKey`, workbench/project/thread and provider context from authenticated invocation. IDs supplied by a model locate resources but do not choose the principal. Every lookup checks principal, scope, runtime generation and current grant before returning sensitive metadata.

Separate workspace, control/epoch, execution, operation, observation, checkpoint, artifact, seat, window and surface identities. Pure function memory may outlive a control; retained target proxies cannot renew their own epochs. The imported `aid` facade obtains the current execution context at call time; a captured `Window` still expires with its minted identity/authority.

Use opaque random IDs, not native addresses or credentials. Unsigned revision/sequence/time counters use canonical decimal strings on the wire; production code validates UInt64 range in addition to schema shape. Hash inputs use the declared canonical-JSON domain. IDs do not authorize reads merely because their strings are syntactically valid.

## R04 — Explicit lifetimes and control heartbeat

The following ownership rules are required:

| Object | May survive a model/tool response? | May survive logical control completion? |
|---|---|---|
| Pure resident workspace exports | yes | only under workspace retention policy |
| Active execution/checkpoint | yes, when explicitly pending | no hidden effect authority |
| Foreground/input grant | yes within active logical task | no |
| Capture owner pin | yes within active observation/control scope | no |
| Immutable retained artifact | yes | only under separate retention/export policy |
| Held keys/buttons | only inside a bounded active native/guest scope | never; also never across model/user checkpoints |

Initial implementation profile: trusted host heartbeat every 1 second, native liveness lease 5 seconds, measured with native monotonic time. The host may renew while it has a real active task, including model reasoning. Generated code, logs and an open socket are not independent proof of host liveness. These defaults are qualification inputs and may be revised by measured scheduling evidence with an ADR.

A dropped HTTP response is not automatically control loss. The local host remains authoritative and returns the existing execution on retry. Loss of the supervising host stops new effect admission when the native lease expires. A provider's individual response ending is not always logical task completion: pending same-model checkpoints must be represented explicitly in the host orchestration state. They cannot be inferred from arbitrary guest activity.

Normal task/control end revokes and drains input, stops owned capture and live watches, and invalidates spatial/target authority. Workspace pure memory is not unconditionally cleared. Explicit workspace close destroys it. Any previous document saying all JavaScript state is cleared at every turn is superseded by this separation.

## R05 — Execution and operation state machines

The canonical machine-readable graph is `contracts/state-machines.json`. Execution states are `queued`, `running`, `waiting-for-condition`, `waiting-for-model`, `waiting-for-user`, `paused`, `stopping`, `completed`, `failed`, `cancelled`, `lost`, and `interrupted-after-possible-effect`.

Control states are `pending`, `active`, `revoking`, `quiescent`, `expired`, and `closed`. State and physical quiescence are distinct: an expired grant forbids new admission even if cleanup is still unconfirmed. The supervisor must not display `quiescent:true` merely because an HTTP cancellation returned.

Operation phase is separate from both state machines. Receipts distinguish submission (`not_submitted`, `submitted`, `submission_uncertain`), evidence (`not_checked`, `change_observed`, `no_change_observed`, `inconclusive`) and outcome (`unverified`, `verified`, `failed`). A terminal successful program may contain unverified submissions; it must not relabel them as a verified user objective.

The extra error codes `WORKSPACE_BUSY`, `WORKSPACE_LOST`, `DRIVER_LOST`, `BASE_EXPIRED` and `CLEANUP_FAILED` complete the earlier error-family list. They are not string aliases for unrelated permission failures.

## R06 — Native effect admission and uncertainty boundary

For every effect: validate authenticated context and typed arguments; bind operation ID to canonical arguments; resolve dependencies and route; obtain the seat permit; recheck epoch; prepare target; durably record intent; perform visible approach if required; revalidate at arrival; mark possible dispatch durably before OS submission; submit; record receipt; release owned transient resources.

The seat permit is an explicit non-reentrant effect transaction guard, not a Swift actor. Awaiting cursor/AX/capture does not admit a second foreground writer. Read-only evidence can proceed separately. Acquisition order is authority/seat before temporary target resources; do not acquire a second seat recursively from a helper.

Exactly-once external GUI effects cannot be promised. A crash between possible dispatch and durable acknowledgement returns uncertainty. No automatic second backend or prefix replay follows. A repeated ID with identical content attaches; a repeated ID with different content conflicts. Durable intent failures before submission reject the effect. Persistence failures after possible submission cannot be reported as `not_submitted`.

An OS-posted event cannot necessarily be withdrawn. Revocation prevents new submissions and requests owned releases; already queued OS effects remain in the journal uncertainty model. This race is tested rather than denied.

## R07 — Checkpoints are single-use resident continuations

`decide` is same-agent judgment, not human authorization. `requestApproval` is human confirmation through trusted host/UI identity. A guest cannot self-authorize by calling `respond` or returning `{approved:true}`.

Checkpoint creation drains/cancels conflicting child effects, verifies no held input, pauses effect admission for the execution, snapshots dependency/evidence identities, and publishes a schema-bound checkpoint. Pure inspection may continue. A second mutating cell cannot change a suspended program's realm behind its back.

Response handling: authenticate owner; check execution/checkpoint generation and deadline; validate schema; compare response idempotency digest; atomically accept at most one answer; revalidate the relevant control and dependencies; then settle the existing promise once. An exact duplicate returns the same recorded result. A conflicting duplicate rejects. If the target changed, reject the promise with `DEPENDENCY_CHANGED`; the program may explicitly observe/reacquire under still-valid authority, but the host never silently retargets it.

Worker loss invalidates the continuation. Retained journal/source/pure data does not authorize replaying a prefix to rebuild its heap. Responding to an expired checkpoint cannot create a fresh execution. Checkpoint timeout and a user denial are explicit outcomes, not generic transport failures.

## R08 — Real module semantics and structured asynchronous work

Named ES-module cells publish explicit exports only after successful completion. Imported module namespaces are evaluated once and frozen to a revision at admission. Failed cells may have mutated imported objects or caused effects; no heap or desktop rollback is claimed. New keys deliberately rerun; duplicate keys do not.

All device calls, timers and watches belong to an execution-owned child group. Terminal completion joins or cancels outstanding effectful children, then releases held state. A detached promise cannot become a background controller. A read-only watch may persist as inert workspace configuration but cannot keep capture/effects alive after control end. Future reactivation requires new scope.

Host responses are queued onto the engine thread, then jobs are pumped under a compute quantum. No XPC/frame callback enters the JS engine concurrently. Infinite CPU and infinite microtask loops require separate tested interruption. A cancelled guest catching an exception cannot regain revoked native authority.

Export inspection examines descriptors and safe values without invoking getters or functions. Pure-data persistence does not serialize promises, native handles or active grants. A saved source module with effectful initialization is executed only under ordinary explicit authorization, never automatic restore.

## R09 — Coordinate units and transforms

A point is a typed frame reference plus units and generation, not an unlabelled pair. The only bare pair accepted is `UnitPoint=[u,v]` inside an already-bound surface method; each component is finite and in [0,1] unless a separately declared extended region contract permits otherwise. No implicit clamping changes a requested path.

Use logical platform coordinates for native input and explicit image-pixel coordinates for captured artifacts. Store affine transforms between crop, image, window and display frames. Rotation/reflection belongs in the transform, not a guessed global Y inversion. The canonical matrix encoding is row-major `[a,c,tx,b,d,ty]` with `x'=a*x+c*y+tx`, `y'=b*x+d*y+ty`.

AppKit, capture and Core Graphics APIs may expose different coordinate conventions. Construct transforms from qualified display/window metadata and conversion APIs, and test them on negative origins and mixed scales. Do not multiply pointer body dimensions by a Retina scale and then apply backing conversion again. A moved/resized display changes transform generation; old points are rejected or explicitly rebound from fresh evidence.

Every screenshot crop retains its source frame, rectangle and transform generation. Reusing normalized geometry on a new surface is an explicit program operation, not a native assumption that the new document is the same target.

## R10 — Spatial and semantic validity are different contracts

A semantic handle depends on process/window/element identity, relevant label/role/action, enabled state, focus/modal and geometry needed for presentation. A keyboard shortcut depends on its explicitly established application/window target, not on screenshot pixel age. A coordinate depends on a spatial frame and its layout/scroll/zoom/tool/document context.

A changed progress counter does not inherently invalidate a button. A button changing from Save to Send can invalidate meaning without moving. New ink may be expected within a canvas contract; changing canvas zoom or tool is not automatically expected. Input revisions record our actions but do not universally invalidate all coordinates.

Where AX/vision cannot reliably detect transform/document/tool changes, report weaker coverage and use shorter/checkpointed contracts. Do not claim every visual change can be classified correctly. Raw supported input remains available only with an explicit grounded spatial target and authority; it is not a privileged bypass around target uncertainty.

## R11 — Capture owner/borrower races

Capture entry state is `starting`, `warm`, `retiring`, `stopped` or `failed`, identified by `(window identity, stream generation)`. Owner pins are active control/observation scopes. Borrowers are bounded operations currently using a frame/stream. They are not interchangeable counters.

Admission atomically validates authority, pins the owner and allocates a borrower. Await startup without holding a mutex; on completion recheck entry generation and authority before exposing pixels. Releasing an owner while startup is pending marks the entry retiring. A late start callback stops the orphan stream rather than resurrecting it.

The last owner prevents new borrows. Existing borrowers either drain or are cancelled under a bounded teardown. Stop completion removes only its own generation. A new owner cannot resurrect a retiring instance; it creates a new generation after capacity reservation. Replacements temporarily account for both old and new resources; they never relabel an old callback as a new target.

Evict only entries with no owners and no borrowers. Owned active capture does not disappear after 15 seconds or arbitrary LRU capacity pressure. Capacity failure is explicit. A bounded unowned grace cache is optional and never grants capture authority. Control end, revocation or host-liveness loss releases pins regardless of JS references.

Pixel buffers remain retained for their consumers; latest-frame replacement cannot invalidate a live reference. Cache encodings by immutable frame/crop/format/scale/redaction key. No image is automatically encoded or sent just because a pointer action occurred.

## R12 — Fresh evidence, not an invented atomic desktop

An observation records frame capture evidence time and AX collection interval. Monotonic nanoseconds are decimal strings; UI expiration timestamps are Unix milliseconds. Do not compare clocks without an explicit mapping/error bound.

`Receipt.after` is an input/admission barrier, not application completion. A post-action observation needs evidence compatible with that barrier. A static screen with supported idle metadata may be fresh unchanged evidence; a cached pre-action frame cannot be silently promoted. If the adapter cannot establish freshness, return uncertainty or use a bounded supported observation fallback.

Delta results name their exact base. Missing base yields `BASE_EXPIRED` or an explicit full replacement. Model annotations remain marked as such and cannot become authoritative AX identity. A time-consistent unrelated region is not required to validate every operation.

`verified` requires a named predicate and supporting evidence IDs. `no_change_observed` after a short wait is not sufficient to declare the intended task failed. `failed` describes a checked predicate's failure within its declared scope, not universal knowledge that no late effect can occur.

## R13 — Motor and presentation timing

All held gesture channels use one monotonic native timeline; JavaScript supplies geometry and conditions, not one callback per display sample. Timeline steps are ordered by time, with equal-time ties preserving declared sequence. Reject conflicting overlapping pointer paths or unbalanced held-state transitions before admission. Checkpoints are not allowed inside a held timeline.

Approach motion may be spring-like. During button hold the actual path must match program geometry. Sampling/backpressure preserves endpoints, corners and button/modifier transitions. Exceeding timing tolerance invokes the selected slow/abort policy and returns measured deviation; never silently distort.

The cursor's actual tip is the local transform origin. Fast-visible 60–250 ms and compact 16-point body are qualification/calibration targets, not required timings for all tasks or claims about Codex. Discrete contact waits for the selected presentation barrier and revalidation. A display callback is not proof of optical presentation; G05 measures alignment. No AX/window discovery/guest work occurs on the frame callback.

## R14 — Foreground routing and cleanup

Normal physical input uses the qualified foreground route consistently across pointer/drag/scroll/keyboard. App activation is attempted, then verified. Select a target window separately from app foregrounding. A windowless app may receive an explicitly authorized app-level menu/shortcut operation after preparation; it does not require a fabricated screenshot.

AX semantic operations remain explicit UI actions. Private SkyLight is isolated and optional; diagnostics distinguish environment disable, unsupported/untested profile, missing symbols, ineligible operation and delivery failure. A unavailable backend is not automatically a TCC denial. Never broadcast an activating click through multiple unqualified routes for luck.

Cleanup releases only automation-owned transient state and never sends a replacement activating click. Physical user input conflicts require a qualified policy; do not restore a saved pointer/clipboard value over a user's intervening change. After driver crash, report unconfirmed cleanup until an independently qualified supervisor/restarted driver establishes quiescence. No promise of universal cleanup follows merely from an orderly defer block.

## R15 — Protocol compatibility is outside native lifetimes

Stateless transport compatibility is a goal, not a requirement to adopt an unverified protocol release. Support the actual negotiated MCP lifecycle and extensions. The revisioned 2025-11-25 lifecycle/transport documents provide a concrete compatibility reference: initialization and optional transport sessions must be handled as specified for that profile. Newer profiles are adopted only from their own published spec and tested client/server negotiation.

The earlier statements that a July 2026 core universally removed initialization, that particular task methods exist in every client, or that a specific WASI/Swift feature is a mandatory dependency are not authoritative implementation instructions. D29 records primary references and adoption limits. The AID host's explicit workspace/control/execution/checkpoint records work independently of those optional protocol developments.

Native execution is authoritative. MCP task status is a projection. A protocol cancel acknowledgement does not mean input is quiescent. A protocol continuation must settle an existing checkpoint; it cannot restart `exec`. A client without Tasks uses explicit handles/status/respond rather than inheriting short HTTP timeouts as its program lifetime.

## R16 — Resource policy and security

Schema maxima are wire-domain limits, not grants. Requested budgets can be reduced by host policy. Initial guest/profile defaults remain 256 MiB memory, 10 ms compute quantum, 64 pending calls, 256 completions and 120 seconds execution wall time; independently supervised legitimate work may renew. Native action queues, metadata, image transfers and debug clips have separate budgets. Stop has priority and separate capacity.

Generated code has no ambient Node/Electron/filesystem/process/network/TCC access. Typed AID imports remain security-sensitive because visible UI itself can leak data or destroy files. Sandbox containment is not an intention classifier. Desktop/page/AX text is data; it cannot mint authority. Sensitive transitions use host-approved scope and checkpoints, not a regex pretending to understand every application.

No npm publication, API key creation, new human-account system or broad auth/schema migration is part of this work. The existing device identity and policy are preserved. Engine/TCC topology choices remain executable qualification gates, not silent fallback freedom.

## R17 — End-to-end review scenarios

### Drawing checkpoint, moved window, duplicate answer, worker crash

Prefix receipts are durable; all holds are up before publishing checkpoint. Window movement changes a dependency. First validly authenticated answer is consumed once, but dependency revalidation rejects resume with a structured reason. The same answer attaches to that rejection; a conflicting answer conflicts. A worker crash makes the live continuation lost. Its source and receipts remain, but no prefix is replayed. A new execution must observe/reacquire under a fresh valid control.

### Capture startup versus revoke and a replacement owner

Owner A starts stream generation 7. A is revoked before startup resolves. Generation 7 becomes retiring. Owner B cannot borrow it; it reserves generation 8 separately. The late generation-7 callback stops itself and cannot overwrite or stop generation 8. No old pixels authorize B. Resource accounting includes pending start/stop work until released.

### Unknown delivery and a retried HTTP response

A click intent is recorded; the OS call may have accepted it; response transport fails. The same execution key attaches to the same record. It does not run a different backend. New observation can provide outcome evidence. A new key is an explicit new attempted execution, not an automatic recovery policy.

### User takeover while guest CPU loops

The native control epoch is revoked independently of the guest. Further requests cannot acquire the seat. Pending timeline work stops and owned releases are attempted. The worker can be terminated without making it responsible for input cleanup. UI reports stopping/unconfirmed cleanup until evidence establishes quiescence. No automatic focus reclaim occurs on restart.

### Module retained across turns

A pure exported ellipse helper survives within retention policy. Its closed-over native surface does not survive authority expiry. A new cell imports the helper without replaying initialization effects, prepares the current target, observes/binds a new surface and uses fresh authority. Retained image references obey separate privacy expiry; workspace memory does not keep recording active.

These scenarios are encoded as design-model tests in the validation suite. They test consistency of the intended contract, not macOS behavior. Real implementation must reproduce them through G01–G10.
