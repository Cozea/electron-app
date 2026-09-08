# D28 — Dependency-ordered implementation roadmap

**Status:** implementation instructions, not completed implementation. **Design revision:** 1.1. **Repository:** `Cozea/electron-app`. **Design branch:** `feat/programmable-aids-runtime`. **Recovered documentation checkpoint:** `bcb6a07061f5ed8f9c832dd99af6fe3bc4400e6f`.

This document is newly completed from the preserved subsystem specifications. It is not described as a recovered previous version. Read [MASTER](MASTER.md), [D01](01-baseline-decisions.md), [D02](02-contracts-sdk.md), [D05](05-lifecycle-authority.md), [D30](30-qualification-gates.md), and the contract artifacts before implementing a work package. [D31](31-cross-system-review.md) settles cross-subsystem interpretations; it does not silently discard the preserved designs.

## 1. Execution rules for an implementation agent

Work on the existing feature branch or a descendant implementation branch, never directly on main. Establish the current source commit and T3 gitlink before changes. The source-to-component mapping in D27 is a reviewed baseline, not permission to invent an existing path if the repository has moved. Record changed mappings explicitly.

Each work package has dependencies, concrete outputs, an ordered procedure and an exit condition. Complete its implementation and portable tests before advertising its capability. Platform gates remain separate: a compiler passing cannot qualify input delivery, permission attribution or a model receiving an actual image.

Create `docs/aid-system/implementation-progress.json` when implementation starts. For each package record `not-started`, `in-progress`, `implemented-awaiting-gate`, `qualified` or `blocked`, the implementation commit, executed tests, gate evidence and any approved ADR. A package cannot be marked qualified merely because its source files exist. Do not reuse a stale test report after changing the measured implementation.

All new package names below are selected paths to create, not claims that packages already exist. Use the repository's package manager and preserve separate root/vendor dependency trees. Do not add broad `any`, `@ts-nocheck`, silent method aliases or an insecure fallback to make integration compile. No Convex/account/authentication redesign is part of this project. Public npm or standalone MCP publication is deferred.

## 2. Dependency graph and parallel lanes

The machine-readable companion `contracts/work-packages.json` owns the acyclic dependency list. The table below supplies the human interpretation. A dependency permits code reuse and planning; it does not imply its live gate has passed.

| Lane | Main work |
|---|---|
| Contract and host foundation | W01–W03, W06, W08, W23 |
| Native topology and input | W04, W07, W09–W13 |
| Evidence and validity | W14–W20 |
| Guest execution | W05, W21–W22 |
| Agent/provider and human integration | W24–W28 |
| Qualification, packaging and cutover | W29–W35 |
| Optional post-core capabilities | X01–X06 |

W04 and W05 begin early in parallel. They are feasibility gates for signed process placement and resident asynchronous JavaScript, not optional polishing after all device code is written. Native input/evidence implementation may progress with test doubles, but no generated model code receives real desktop authority until both boundaries qualify.

The recommended first usable vertical slice is: open a workspace; acquire explicit control; prepare a fixture window; execute a named cell containing a visible click and one explicit observation; emit the image through the real provider adapter; close control; retain only opted-in pure exports. That slice must include cancellation and duplicate-request tests. Do not build a large catalogue of unintegrated primitives first.

## 3. Foundation work packages

### W01 — Preserve evidence and establish baseline fixtures

**Dependencies:** none. **Owns:** D01, D20.

Create the implementation-progress record, a source/architecture inventory and a reproducible fixture-launch manifest. Preserve the v2 implementation as a mutually exclusive comparison profile rather than copying it into a second native tree. Record Cozea commit, T3 gitlink, effective patched tool table, OS build, display topology and source/toolchain hashes.

Build or reuse AppKit, WKWebView and Electron fixtures. Their test-only oracle records event receipts and UI outcome counters; the model never receives the oracle's command channel. Reproduce the 15-second capture shutdown, windowless bootstrap, changing-status invalidation and cursor geometry issues without a model where possible. Record unsupported or unreproduced cases accurately.

**Exit:** a fixed procedure can be run and measured against v2; resets and oracles are separate from agent execution; baseline observations are stored with explicit evidence classification. Tests: EVAL-01, EVAL-03, EVAL-05, EVAL-06. This package does not declare the new system faster.

### W02 — Freeze contracts and resolve namespace decisions

**Dependencies:** W01. **Owns:** D02, D31, `contracts/aid-sdk.d.ts`, `contracts/aid-wire.schema.json`.

Create `packages/aid-contracts/idl/aid.idl.json`. Encode resource types, scalar domains, method inputs/results, effect class, required capabilities, cancellation semantics and documentation. Preserve the selected six outer methods and the named ES-module-cell model. Distinguish SDK public fields from trusted host context; no model-supplied principal or approval role.

Use camelCase application fields, decimal strings for unbounded counters and explicit coordinate frames. Define one result/error vocabulary and one set of execution/control states. Adopt the documentation declarations and examples as the API test oracle, resolving any change through an ADR and updating all affected tests before implementation proceeds.

**Exit:** every advertised operation has a complete contract and metadata; mixed-frame and cross-owner requests have negative fixtures; no producer/consumer uses a private independently invented field. Tests: API-01, API-03, API-04, API-05, API-06, API-08.

### W03 — Deterministic generation and portable contract checks

**Dependencies:** W02.

Generate TypeScript declarations/proxies, Swift Codable values/router signatures, worker request/response types, host discovery excerpts and provider tool envelopes from the same IDL. Put hashes and generator revision in outputs. Add `aid:generate` and read-only `aid:check`; the latter fails on drift without modifying files.

Build JSON/schema golden vectors and executable state-model tests. Validate both valid and invalid messages, deterministic canonicalization, duplicate idempotency conflicts, unsupported enums, size bounds and unknown-property rejection. Typecheck complete example programs, including intentional `@ts-expect-error` cases. A declarations-only compile is not adequate.

**Exit:** two clean environments produce the same outputs; check mode is read-only; negative vectors actually fail validation. Tests: API-02, API-03, API-05, API-06, INT-03, INT-04.

### W04 — Signed driver/worker topology and authenticated IPC experiment

**Dependencies:** W02. **Gate:** G01. **Owns:** D04, D27.

Create the minimum bundled GUI driver `.app`, restricted worker `.xpc` and launcher shim. Do not move all runtime code before proving first launch, correct TCC attribution, stable AppKit presentation and authenticated peer establishment in the actual signed bundle. Inspect public API availability against the selected SDK; do not invent audit-token APIs or entitlements.

Use separate urgent control, ordinary metadata and artifact-transfer channels. Bind connections to the verified host/runtime generation and test hostile clients, PID reuse, disconnect and relocation. A private anonymous endpoint is part of the channel design, not permission to ignore authenticated ownership. Maintain explicit permitted messages at both ends.

**Exit:** G01 evidence demonstrates the exact signed topology. A failed experiment blocks that profile or triggers the specified secure topology ADR. It cannot silently select an unsandboxed child process.

### W05 — Qualify the persistent JavaScript engine boundary

**Dependencies:** W02. **Gate:** G02. **Owns:** D03, D04.

Prototype the resident QuickJS/Wasm/Wasmtime candidate in the restricted worker. Exercise ES modules, top-level await, imported closures, pending native Promises, queue pumping, cancellation, memory ceilings and source locations. Verify Wasmtime compilation/loading requirements under hardened runtime. Never deserialize untrusted precompiled engine artifacts.

Measure the same conformance suite against the separately sandboxed native QuickJS fallback only if the candidate fails a documented integration/performance requirement. The fallback is a deliberate profile selection, not an automatic runtime downgrade. There is no `node:vm` security fallback.

**Exit:** engine selection ADR contains actual compiler/engine hashes, signed-process results, job-loop behavior and all JS-01–JS-10 outcomes. No guest-to-desktop authority is granted by this prototype.

## 4. Authority, recovery and native input

### W06 — Identity, grant and lifetime stores

**Dependencies:** W03. **Owns:** D05, D19.

Implement `WorkspaceStore`, `ControlStore`, `ExecutionStore` and owner-bound resource tables in `packages/aid-host`. Derive Cozea's device principal, project/thread and provider invocation from trusted host context. Allocate opaque runtime-generation-bound external IDs and monotonic internal sequences.

Specify ownership transitions for normal completion, model checkpoint, human approval, provider response completion, explicit close, host loss, worker loss and driver loss. Pure memory may persist; effectful watches, pressed input and capture authority may not survive a completed control episode. Host liveness is independent from guest logs.

**Exit:** portable state tests reject cross-owner lookup, stale epochs, forged renewal, resurrection after close and mismatched runtime instances. Grant revocation is synchronous with respect to new native admission; disposal may finish asynchronously. Gate G04 includes the later live proof.

### W07 — Native seat permit, revoke fence and stop supervisor

**Dependencies:** W04, W06. **Gate:** G04. **Owns:** D05, D12, D18.

Implement one explicit transaction permit per input seat. Actor isolation is not a lock across suspension. Serialize keyboard focus, pointer buttons, modifier state and scroll phases together; permit concurrent evidence reads. Check epoch at admission and immediately before each activating submission.

Add an urgent native stop path independent of the renderer and guest event loop. Track automation-owned held state. On revoke, reject new effects, discard unsubmitted samples and attempt necessary releases. Report `stopping` until native queues/cleanup are quiescent; acknowledge that already posted OS events cannot be recalled universally.

**Exit:** cancellation/focus takeover at every scheduled phase and a hung guest cannot produce later activating submissions. No human input is blocked to protect an animation. Native stop and cleanup bounds are measured, not inferred from a protocol acknowledgement.

### W08 — Operation journal, idempotency and uncertainty model

**Dependencies:** W03, W06. **Owns:** D16.

Implement intent and phase records keyed by owner, execution/operation ID and canonical payload hash. Persist the potentially-effectful boundary before the first event of an admitted operation/timeline; do not perform an fsync for every path sample. Separate durable intent, possible submission, acknowledgement and later outcome evidence.

Repeated identical execution keys attach to the existing execution/result. Different content conflicts. After crash, any operation crossing the possible-submission boundary without a terminal receipt stays uncertain. Do not reconstruct the JS heap by replaying GUI effects. Keep bounded tombstones long enough for the declared retry window.

**Exit:** disk-full, lost reply, duplicate ID, crash-before-submit and crash-after-submit fixtures produce the specified receipts without an extra effect. Schema/state-model tests pass before live integration.

### W09 — Application preparation and candidate-first windows

**Dependencies:** W04, W06. **Owns:** D15.

Refactor `AppDirectory` and `WindowRegistry` to evaluate viable AX/WindowServer candidates before selection. Preserve launch identity, window generation, modal ancestry, focus and transform metadata. Exclude known agent/sharing overlays using scoped evidence, not every small or titlebar-less window.

Implement explicit app launch, unhide/reopen and foreground preparation before screenshot-dependent state exists. Distinguish read-only get/list from mutation prepare. Expose ambiguous candidates. Windowless Finder bootstrap uses a supported launch/reopen, observed menu action or verified foreground shortcut, not an invented universal AX method.

**Exit:** no-window, multiple-window, sharing-indicator, PID/window-ID reuse and legitimate-small-dialog cases pass. A repeated explicit window handle never silently becomes another window with the same title.

### W10 — True-hotspot cursor and adaptive presentation

**Dependencies:** W04, W07, W09. **Owns:** D14.

Replace the mismatched procedural artwork transform with repo-owned geometry whose actual tip is the local origin. Separate logical point size from backing pixels. Rotate, scale and pulse around that origin. Use per-display presentation surfaces and a cached topology transform; no AX enumeration or window-list query in each display callback.

Implement fast-visible, presentation and direct-gesture modes. The initial 16-point body and 60–250 ms approach band are calibration candidates, not universal constants. Preserve visible arrival before contact, while removing a mandatory 1.4-second approach. During held gestures, use the exact motor path.

**Exit:** geometry tests cover rotation/pulse and mixed-scale displays; live visual-marker evidence establishes cursor/event alignment. Do not compensate for artwork inversion by flipping input coordinates.

### W11 — Consistent foreground pointer input

**Dependencies:** W07, W08, W09, W10. **Owns:** D12, D15.

Extract a shared physical-input provider for move, hover, button down/up and click counts using a qualified public foreground route. Verify the intended app/window before approach and immediately before contact. Route unambiguous semantic AX operations through the same authority/receipt discipline.

Choose the backend before effects. Only a definitely not-submitted unsupported route may fall back. Preserve raw AX error and dispatch certainty; a missing notification is not evidence that a click failed. Keep optional SkyLight isolated with explicit unavailable/ineligible/failure reasons.

**Exit:** fixture activation counts and absence of duplicate/wrong-window effects are asserted. No observation is implicitly encoded after an ordinary click. G05 supplies the signed-app qualification.

### W12 — Keyboard, text, shortcuts and explicit clipboard

**Dependencies:** W07, W08, W09. **Owns:** D13.

Implement Unicode text, logical chords and physical key events as distinct contracts. A root keyboard facade is bound only by an explicit successful target preparation; it does not follow arbitrary user focus. Preserve caret/selection and diagnose IME/secure-input limitations honestly.

Clipboard operations require their own grant and explicit mode. A restore is compare-and-swap against the change count/value written by Cozea; do not overwrite an intervening user clipboard change. Password/secure fields and clipboard reads have privacy-specific tests.

**Exit:** non-US layouts, emoji, combining characters, selection, repeats, cancel-between-down/up and changed focus pass qualified fixtures. Unsupported IME paths stay unqualified rather than silently appending text through AX.

### W13 — Native coordinated motor timelines

**Dependencies:** W10, W11, W12. **Owns:** D12.

Compile typed paths and key/modifier channels into a monotonic native schedule. Validate finite coordinates, frame compatibility, path containment, event balance, duration/tolerance and resource bounds before admission. One timeline owns its physical-input permit; arbitrary Promise concurrency does not emulate channel coordination.

Preserve endpoints, corners and button transitions during coalescing. Apply declared backpressure rules: slow within tolerance or abort, never silently distort the requested geometry. Record one operation intent and per-phase receipts without moving high-frequency samples through MCP or model inference.

**Exit:** straight/curved/multipart strokes and modifier-overlap fixtures match supplied geometry and visible rendering. Cancellation releases held state. No user/model checkpoint can occur while a native timeline retains a button.

## 5. Evidence and dependency-specific interaction

### W14 — Owner-scoped persistent capture

**Dependencies:** W04, W06, W09. **Owns:** D09. **Gate:** G07.

Refactor `CaptureRuntime` into explicit ownership and borrower accounting. Control/window scopes own a stream; individual screenshot requests borrow frames. No screenshot-idle timer can evict an actively owned stream. Last-owner release marks closing, cancels further borrowing and stops when borrowers have drained or been cancelled.

Guard start/stop/resize/replacement with source generations. Reject late callbacks. Account each pinned stream against a resource budget and require explicit unpin or a clear capacity error instead of silently evicting an active owner. Keep encoding separate from frame production.

**Exit:** the same stream survives a 60-second no-screenshot gap with valid host liveness; owner/borrower/late-callback race models and live tests pass. Permission revocation stops the affected capture scope.

### W15 — Artifact transfer, retention and provider-safe evidence

**Dependencies:** W03, W06, W08, W14. **Owns:** D09, D19.

Implement bounded owner-scoped read-only artifacts for images, source modules and typed paths. Metadata includes MIME type, byte length, digest, expiration and provenance. Use checked chunks/credit on the data channel; stop traffic is independent. IDs are not arbitrary URL/path fetch capabilities.

Keep source frames, encoded images and provider emissions separate. Encoding cache keys include frame/crop/scale/format/redaction identity. Recheck authority at emission after a long encode or checkpoint; capture permission does not automatically authorize export to every provider.

**Exit:** chunk corruption, expired/cross-owner artifacts, large transfers, revocation-during-encode and memory-pressure fixtures pass. A real image is emitted exactly where the provider contract expects it, not replaced by a textual path.

### W16 — Structured, bounded AX service

**Dependencies:** W04, W06, W09. **Owns:** D08.

Retain raw roles/actions/attributes while adding structured snapshots. Configure messaging timeouts on each exact AX object queried, including descendants. Use scoped/bulk reads and bounded children pages. Record per-field errors, collection intervals, truncation reason and supported notification coverage.

Observer callbacks enqueue minimal signals; they never traverse trees or call generated code. Maintain stable retained handles and invalidate on destroyed/recycled identity. Reconciliation covers incomplete notifications under a budget without claiming an atomic complete desktop snapshot.

**Exit:** deep trees, hung descendants, dynamic values, destruction, unsupported attributes and raw expansion pass tests. An unrelated status notification does not independently reject every semantic target.

### W17 — Evidence scene and directed observations

**Dependencies:** W14, W15, W16. **Owns:** D07.

Join app/window/element/surface records with frame provenance and coordinate maps. Expose overview/detail crops, named subtrees, focus-only reads, immutable observation queries and deltas with explicit base IDs. Report dropped/expired bases and coverage rather than silently returning an unusable diff.

Collect image and AX evidence concurrently but expose their distinct intervals. Never relabel an old image as current because JSON serialization just completed. Preserve raw expansion beneath heuristic relevance selection and keep model annotations separate from platform facts.

**Exit:** crop coordinates round-trip, delta bases are checked, partial observations remain usable with stated uncertainty, and selected evidence can be returned without encoding every intermediate screenshot.

### W18 — Typed target validation

**Dependencies:** W07, W09, W16, W17. **Owns:** D11.

Implement separate validators for semantic element, observed pixel point, foreground keyboard target and spatial surface. Define dependency fingerprints for launch/window generation, target role/label/action/enabled state, geometry, focus/modal ancestry and relevant transform.

A dirty signal requests scoped revalidation; it is not universal ground truth. Reject ambiguous selectors. Do not use the old observed/input counter equality as a universal veto, and do not make all old screenshots permanently valid instead.

**Exit:** paired positive/negative tests show unrelated status changes allowed while label replacement, document change, blocking modal and geometry changes stop the relevant effect. Test late invalidation during cursor approach.

### W19 — Stable spatial/gesture sessions

**Dependencies:** W13, W17, W18. **Owns:** D11.

Bind a surface to observed region/anchors, transform generation, allowed intent and current control epoch. Keep expected drawing content separate from spatial validity. Watch relevant zoom/scroll/layout/tool-mode changes and disclose weak coverage where the app provides insufficient signals.

Permit repeated qualified gestures under one bounded contract; local sensing remains active even when the model requests only initial/final screenshots. Reacquisition is explicit after invalidation; a matching rectangle/title alone does not transfer document identity.

**Exit:** twenty strokes execute without screenshot-per-stroke lockstep, while induced scroll/zoom/modal/takeover interrupts correctly. Notes and other real canvases are qualified independently.

### W20 — Event watches and bounded local conditions

**Dependencies:** W16, W17, W18, W19. **Owns:** D10.

Compile recognized declarative queries to scoped subscriptions. Run arbitrary JavaScript predicates in host-established read-only guest subscopes with compute/time bounds and reconciliation. A predicate cannot obtain write authority by catching a rejected call or forging context flags.

Watches may prepare evidence; effects require a separately admitted programmed continuation and active control. Optional visual servo uses a selected tracker, uncertainty limit and fresh spatial contract, not a claim that similarity guarantees identity.

**Exit:** no polling-induced model round trip is needed for a known condition; microtask loops and subscription floods are bounded; predicate attempts to click fail. Expired watch bases and unqualified trackers are explicit.

## 6. Programmable host and model integration

### W21 — Resident named module workspaces

**Dependencies:** W03, W05, W06. **Owns:** D03.

Implement per-workspace module registration, immutable successful export revisions and import freezing. A new execution URI prevents accidental module-cache suppression of an intentional new run. Loading a successful resident module does not rerun it. A failed cell may mutate prior imported objects; do not claim heap rollback.

Keep source/pure-data persistence distinct from live heap, pending Promises and native proxies. Inspect descriptors without invoking getters. After worker death return lost-workspace status and journal references, not silently reconstruct effects.

**Exit:** all JS semantic fixtures pass against the selected engine, including duplicate cell-local names, live exported closures, failed publication and forbidden imports.

### W22 — Generated asynchronous AID SDK and discovery

**Dependencies:** W03, W15, W16, W18, W19, W20, W21. **Owns:** D02, D03.

Wire generated proxies to owner-bound native handles and completion queues. Preserve SDK method names, explicit frame types and effect metadata. Make `describe` provide a compact static index plus a dated supported/qualified/granted/available overlay. Desktop strings never become SDK documentation or executable source by authority.

Add approved pure geometry/data modules without filesystem/process/network imports. Do not interpret full ECMAScript support as a promise of Node, browser DOM, Intl or arbitrary npm APIs.

**Exit:** complete typechecked programs call real proxies through the restricted worker; backend/coordinate/capability errors retain source locations and operation IDs.

### W23 — Execution orchestration and recoverable status

**Dependencies:** W08, W21, W22. **Owns:** D16.

Implement execution admission, idempotency attachment, child-scope lifetime, status cursors and bounded retention. Returning from a cell drains or cancels unawaited effects; it never detaches desktop authority. Existing execution IDs bind to exact code/import hashes and owner.

Separate durable journal state from live Promise state. `inspect` returns dropped/expired-history information and may-submitted phases. A network retry retrieves status/result rather than rerunning the cell.

**Exit:** duplicate/lost replies, detached Promise effects, worker death and partial failures preserve the documented state transitions and do not replay a prefix.

### W24 — Same-model decisions and human approvals

**Dependencies:** W15, W18, W23. **Owns:** D06.

Implement checkpoint IDs with kind, schema, execution position, owner/control epoch, dependency fingerprint and expiry. Before suspension require input quiescence. Package selected actual image/text evidence for the controlling model. Resume a pending Promise exactly once and revalidate dependencies before the next effect.

Human approval is a distinct trusted-host channel. The model-facing respond tool cannot assert that a person approved. Duplicate identical replies attach to the accepted outcome; conflicting replies fail. A lost worker expires its continuation; it does not rerun the program.

**Exit:** program-local variables survive a live checkpoint; duplicate answers create no extra effect; changed target and stale approval are rejected; provider response completion does not mistakenly destroy the logical waiting task.

### W25 — T3 source and effective catalogue integration

**Dependencies:** W03, W06, W23, W24. **Owns:** D17, D27.

Implement the six-tool host adapter in the real T3 fork or an exact reviewed development patch, not solely a replacement JSON table. Bind invocation context to the existing device/project/thread/provider scope. Update turn/task lifecycle forwarding to distinguish a model response from a complete control episode.

Keep root and vendor Effect packages independent. Test the actual built T3 bundle as well as source. `--check` never writes source or cached bundles. The legacy nine-tool path cannot remain as an unguarded second writer.

**Exit:** effective tool schemas, images, errors, status and logical task completion match the generated contract in source and packaged server.

### W26 — Protocol and provider capability adapters

**Dependencies:** W25. **Gate:** G03.

Pin the exact MCP revision/extensions actually implemented by each host. Do not remove initialization/session handling on a speculative version claim. The native application handles are transport-independent regardless of MCP lifecycle style.

Map supported asynchronous Tasks and input/continuation mechanisms onto native execution records. Where absent, use the explicit exec/inspect/respond envelopes. Test actual image content and same-model continuations on every enabled provider. Treat cooperative protocol cancellation separately from the urgent native stop acknowledgement.

**Exit:** a checked compatibility matrix identifies supported, unsupported and unqualified features per real provider version. No absent extension causes native state/lifetime corruption.

### W27 — Human supervisory UI and takeover

**Dependencies:** W07, W15, W23, W24, W25. **Owns:** D18.

Project current target, operation, control scope, waiting state, pause/stop/takeover and qualified capability information into the existing chat/workbench UI. Do not add a second browser host or unmount the controller when chat/artifact tabs switch.

Use the native urgent stop channel; renderer responsiveness is not the safety boundary. Distinguish stopping from quiescent and model judgment from human approval. Restore normal cursor presentation without warping the person's pointer back after takeover.

**Exit:** hidden tabs, renderer hang, blocked model and worker loop leave stop operational; shown progress corresponds to actual input/receipts rather than predicted success.

### W28 — Privacy, adversarial boundaries and security audit

**Dependencies:** W04, W06, W08, W15, W24, W27. **Gate:** G08.

Run the threat model against cross-owner handles, IPC peers, artifact export, sensitive fields, clipboard, malformed frames, prompt-injection strings, approval replay and silent visible/hybrid mode switching. Reject untrusted bytecode/compiled-engine artifacts and ambient worker imports.

Default telemetry records IDs/counters/timing, not screen text, code payloads, image bytes, secrets or clipboard contents. Demonstration/debug retention is opt-in. Explicitly recognize that GUI actions can transmit data even when the JS worker has no network access.

**Exit:** each threat has an executed test or named platform qualification; no claim of universal intent classification is used as a permission mechanism.

## 7. Qualification and cutover

### W29 — Signed end-to-end fixture qualification

**Dependencies:** W13, W19, W22, W24, W27, W28.

Run the signed app through the independent AppKit/WKWebView/Electron oracles. Exercise G01–G08 together so cross-layer races are tested rather than only mocked away. Record actual source/toolchain signatures, permission decisions and all skipped/failed cases.

**Exit:** one complete vertical slice and the fault matrix have evidence across real process boundaries. Compilation and cross-building remain lower-tier evidence.

### W30 — Real and held-out task qualification

**Dependencies:** W29.

Run Safari/YouTube, the previously failing Notes/drawing case and Finder bootstrap/copy. Pair live-site tests with deterministic fixture equivalents. Include unfamiliar forms, custom canvas tools and nested dialogs not used to tune the runtime. Preserve negative outcomes and forbid hidden file/API shortcuts in visible/physical mode.

**Exit:** outcome evidence, extra-effect checks and model-facing round-trip counts exist for each run. A text-art result is not a drawing-input success; an unskippable ad is not fabricated into a missing button failure.

### W31 — Failure-guided conformance hardening

**Dependencies:** W29, W30.

For every failure classify: unsupported platform capability, invalid design assumption, implementation bug, model error, application wait or approval delay. Reproduce device/host failures without a model when possible. Fix against a regression fixture and update a narrow capability profile instead of adding undocumented app-specific guesses.

**Exit:** no unresolved correctness failure is concealed by a larger timeout, unconditional backend retry or weaker test. Known platform limits are in the capability report.

### W32 — Reproducible preparation and packaged resources

**Dependencies:** W04, W05, W22, W25, W27. **Owns:** D27.

Implement `prepare:aids`, `prepare:aids:check` and read-only manifest verification. Record source/IDL/engine/driver hashes, architecture/deployment targets and selected qualification profile. Sign nested binaries inside-out with identified required entitlements; relocate and start the packaged bundle without source paths.

Keep optional newer capture APIs, private input and engine alternatives behind explicit qualified profiles. Documentation checks can run on Linux; AppKit/TCC validation cannot be replaced by that lane. No npm publishing or release tagging occurs here.

**Exit:** clean locked builds and relocated bundles pass INT-01–INT-10 as applicable, with legacy/target runtime mutual exclusion.

### W33 — Critical-path performance experiments

**Dependencies:** W31, W32. **Gate:** G09.

Compare native A and identical JS B procedures with the same input/evidence sequence and cursor pacing. Interleave trial order, record failures and confidence intervals, and separate overlapping spans instead of summing them. Also run actual model C tasks; do not call C-minus-B a pure intelligence metric.

Measure absolute local bridge/driver overhead, application waiting, model/tool exchanges, AX calls, capture starts, encodes and resource consumption. Test the target p95 <5 ms warm bridge and <10% matched infrastructure overhead without hiding overhead behind long page loads.

**Exit:** a reproducible report explains attained and failed targets. No Codex multiplier or universal reliability claim is inferred from these local measurements.

### W34 — Qualification review and default-switch candidate

**Dependencies:** W26, W28, W33.

Read gate evidence against the exact final implementation hashes. Confirm six-tool discovery, denial defaults, native stop, artifacts/continuations and provider image delivery. Stage the new runtime as the only writer in the selected pre-user build. Keep an explicit development comparison switch until the review passes, not an invisible user-facing fallback.

**Exit:** all core gates required by the selected profile are passed or the profile remains blocked. An exception requires an explicit product/design ADR and cannot waive a fundamental authority, wrong-window or duplicate-effect invariant.

### W35 — Remove legacy execution and freeze the handoff

**Dependencies:** W34.

Remove obsolete native entry points, nine-tool registration, duplicate policy/serialization paths and the temporary comparison switch. Preserve historical evidence and applicable tests. Update AGENTS/continuity and build/operator documentation with the qualified commands and limitations. Ensure no other workbench feature or provider home configuration was changed incidentally.

**Exit:** the same conformance/real-task suite passes with legacy code absent; branch contains a single authoritative device implementation and a source-matched qualification report. Merge/release remain separate user-authorized actions.

## 8. Optional extension work; not disguised core blockers

| Package | Dependencies | Outputs and acceptance |
|---|---|---|
| X01 — Procedural memory | W35; D21 | Save helper source, parameters, app/profile assumptions and fixtures; strip private values/handles. Reacquire targets on use. Gate G10. |
| X02 — Pipelined planning | W35; D22 | Dated evidence snapshots, speculative read-only plans and commit-time target checks. One writer per seat. Measure benefit versus extra inference. Gate G10. |
| X03 — Debugger/replay | W35; D23 | Safe-boundary inspection and offline intercepted-effect replay. Real desktop replay requires new authority. Gate G10. |
| X04 — Demonstrations | W35; D24 | Explicit recording consent, redaction/retention, event-to-program synthesis and fixture validation. No password capture by default. Gate G10. |
| X05 — Independent seats | W35; D25 | Authenticated remote physical Mac first; qualified VM separately. Real desktop preview with latency provenance. Gate G11. |
| X06 — Extended devices | W35; D26 | Explicit pen/touch/hardware provider contracts with measured contact/pressure behavior and physical stop. Gate G12. |

Money/time availability permits ambitious work, not pretending absent hardware or platform support exists. These extensions remain fully specified research/qualification lanes rather than shortcuts for hiding initial Notes/Finder failures.

## 9. Acceptance of this roadmap itself

Every package must name its predecessor packages, owned specification, output paths or responsibility and acceptance evidence. The generated dependency manifest must be acyclic. Every preserved subsystem must be covered by a core or extension package. Every core invariant must map to a contract/model test and a live gate where platform behavior matters.

Completing this documentation is not completing W01–W35. The implementation agent starts at W01 and records actual results. The design handoff removes avoidable design decisions while preserving the experiments that only a real signed application can settle.
