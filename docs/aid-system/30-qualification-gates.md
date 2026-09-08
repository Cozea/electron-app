# D30 — Qualification gates and evidence contracts

**Revision:** 1.1. **Status:** prescribed experiments, not passed experiments. **Applies to:** the programmable AID environment, not merely a compiling SDK. Read [D20](20-evaluation.md), [D28](28-implementation-roadmap.md), [D31](31-cross-system-review.md), and the [contract artifacts](contracts/README.md).

This document completes a missing deliverable from the recovered corpus. It does not claim to recover its previous wording. Its purpose is to prevent an implementation agent from inventing what counts as success, treating private/API availability as functional proof, or silently weakening a failed experiment.

## 1. Four different kinds of completion

1. **Design conformance:** documents, declarations, schemas, examples, dependency graph and executable state-model tests agree. This is what the documentation handoff can prove now.
2. **Portable implementation conformance:** codecs, state machines, guest semantics and simulated faults pass against actual implementation.
3. **Platform qualification:** the signed native process, permissions, events, capture and display behavior pass on a named Mac/OS/app profile.
4. **Task qualification:** the real provider/model completes a task through visible application interaction, with outcome evidence and absence-of-extra-effect checks.

A lower level is not a substitute for a higher one. A passing JSON schema is not a working mouse. A returned `submitted` receipt is not proof that an app accepted a stroke. A successful helper app is not proof of correct permission attribution in the packaged Cozea bundle.

## 2. Qualification profile and evidence record

Start with a reproducible **macOS 26 / Apple silicon** profile. This is a selected first profile, not an assertion about the latest available OS or a guarantee that every point release works. Record exact OS build, hardware, architecture, display identities/scales/refresh rates, login-seat generation, Xcode/Swift/engine versions, signing identity and app versions. Intel, other OS versions, remote seats and additional input devices are separate profiles.

Every run produces a machine-readable manifest with: gate ID/revision; start/end timestamps; implementation commit and IDL/source/artifact hashes; profile; commands/procedure; prerequisite reports; each test's expected and actual result; sample count; failures/skips; redacted artifact digests; and final `passed`, `failed` or `blocked`. `not-run` is the only initial state. A stale report does not qualify a new binary.

Evidence artifacts remain local/access-controlled by default. Public repository documents contain redacted summaries and digests, never private screen captures, typed secrets or clipboard contents. An audit log must distinguish automatic assertions from a human's visual adjudication and from model-generated judgments.

The same operation may appear in several gates because its cross-layer behavior matters. For example, a checkpoint belongs to guest semantics, authority lifetime, provider delivery and replay protection. D31 owns shared interpretations; passing one checkpoint unit test does not waive the other gates.

## 3. Gate G01 — Signed topology, IPC and permission attribution

**Owners:** D04, D27. **Packages:** W04, W32. **Prerequisites:** canonical identity/channel contracts, no real model-generated input yet.

### Question

Can the selected bundled driver and worker run with the intended security/GUI properties in the actual signed application, without assuming that Electron's permission identity transfers automatically to helpers?

### Procedure

Build the minimum driver `.app`, worker `.xpc` and launcher. Before porting all native code, open the signed/relocated bundle in a clean test account. Record signatures, designated requirements, entitlements, sandbox state and resource hashes. Test first launch, permission denied, permission granted, permission revoked, app update and relocation. Use System Settings normally; do not edit the TCC database or disable system protection.

Show a harmless test overlay from the driver. Capture a selected disposable fixture window only after permission. Perform a single explicitly authorized counted fixture action only after AX authority. Verify which binary appears in prompts/settings and which binary owns capture/input. The worker must fail attempts to use those APIs directly.

Establish authenticated IPC. Test unrelated processes, a different user/login seat, another app signed by the same team where relevant, stale endpoints, process termination/PID reuse and malformed messages. An opaque endpoint reduces exposure but does not eliminate authorization checks. Verify the exact public peer-identity API supported by the selected SDK rather than inventing an unavailable audit-token property.

### Pass criteria

The intended signed topology works after relocation; unauthorized peers and stale runtime generations fail before effect admission; the guest has no ambient AX/capture/filesystem/process/network access; the urgent stop channel remains available while guest/UI threads hang. Actual permissions and entitlements are recorded, not inferred.

### Failure response

Fix the topology, code requirements or minimal entitlements and repeat. A documented alternate secure topology may be selected by ADR with the same tests. Do not ship an unsandboxed child, trust a PID alone, or add broad entitlements without identifying the required behavior. An in-process v2 comparison run remains labelled comparison evidence only.

## 4. Gate G02 — Resident JavaScript semantics and isolation

**Owners:** D03, D04. **Packages:** W05, W21, W22. **Prerequisites:** portable SDK contract; use fake effects until G01/G04 qualify.

### Question

Does the chosen engine implement the actual named-module workspace and async host boundary—not just parse JavaScript—while remaining interruptible and contained?

### Required trials

Export a stateful closure, import it in two later cells, and verify that its original module is not evaluated again. Run another revision with the same cell name and a new idempotency key; freeze imports of a suspended execution to its admitted revisions. Reuse identical idempotency keys and then reuse one with different code. Throw before export publication, after mutating an imported object and after a fake effect; verify publication and partial-effect history separately.

Exercise top-level await, rejected host calls, source maps, typed arrays, cycles in export summaries, descriptor/getter inspection and standard-library discovery. Non-exported variables are private module scope, not implicit notebook globals. An imported facade uses current host context; an old native handle captured in a closure remains expired.

Attempt an infinite synchronous loop, an infinite microtask chain, excessive pending Promises, OOM, a stalled host import, worker death and hostile module imports. Deny filesystem/URL/native-addon/Node/Electron access. CPU limits do not substitute for native-call deadlines. Export inspection must not execute getters.

### Pass criteria

JS-01–JS-10 and negative import/capability tests pass. The host independently stops the worker. Pending effects cannot survive loss of authority, even if JavaScript catches every cancellation error. Resource-limit outcomes identify which state remains recoverable. No arbitrary live continuation is promised across process death.

### Failure response

First qualify QuickJS in Wasm hosted by Wasmtime. If a documented engine/toolchain/signing limitation blocks the contract, test the separately OS-sandboxed native QuickJS profile under the identical suite and record the selection. No transparent insecure fallback or substitution of `node:vm` is permitted. WASI 0.3 async support is not a prerequisite for a bounded request/Promise bridge.

## 5. Gate G03 — T3, provider, MCP and image/checkpoint delivery

**Owners:** D06, D17, D27. **Packages:** W24–W26. **Prerequisites:** G01/G02 and portable host/execution contracts.

### Question

Do the actual enabled provider stack and built T3 bundle expose the intended programmable interface and return real observations without corrupting task lifetimes or replaying a prefix?

### Procedure

Record the exact T3 gitlink, generated six-tool table, effective source patch and bundled-server hash. Exercise every enabled provider separately; a model name in a dropdown is not proof of protocol support. Test `computer_open`, `computer_exec`, `computer_inspect`, `computer_respond`, `computer_close` and `computer_describe` against the same fixtures.

Run a cell that performs one counted action, asks the same controlling model for a typed decision with an actual screenshot, resumes and performs a second counted action. Inspect provider messages to prove that the image was transmitted as image content, not a text file path. The checkpoint answer must be schema-checked and single-use.

Drop a response and retry with the same key; inspect status instead of resubmitting. Duplicate a model answer, send a conflicting answer, answer a human checkpoint through the model channel, cancel while waiting, and end an individual provider response while the logical AID task remains live. Test final task completion separately from checkpoint waiting.

Negotiate the exact supported MCP revision and extensions. A host without asynchronous Tasks or MRTR must use the explicit execution/status/response envelope if qualified. Do not delete initialization/session handling because of an unverified newer-protocol claim.

### Pass criteria

Source and built catalogue agree. Each advertised provider delivers real images and resumes the same live execution once. Human approval cannot be spoofed by model input. A cooperative protocol cancellation reply is not shown as native quiescence. Legacy and new tools cannot become independent writers.

### Failure response

Disable the unsupported extension or provider capability, with an explicit diagnostic. The transport-independent local contract remains unchanged. If the required fallback itself cannot deliver images/checkpoints, that provider profile is blocked rather than silently converted to text-only or repeated-cell execution.

## 6. Gate G04 — Authority, input ownership, liveness and stop

**Owners:** D05, D12, D18, D19. **Packages:** W06–W07, W27–W28.

### Question

Does native authority remain correct when the model, guest, UI, transport and target all change independently?

### Procedure

Run two competing same-seat writers and several observers. Revoke a queued writer, a writer during cursor approach, one after button-down and one immediately before button-up. Force user takeover, focus change, target movement, screen lock/sleep, permission revocation, settings disable and scheduled-task denial.

Hang the guest and renderer. Lose the trusted host heartbeat. Separately lose only one HTTP response. Delay a model checkpoint beyond an ordinary RPC timeout with valid host task liveness. Attempt to extend authority using guest logs, an old control ID, a stale epoch and another thread's handle.

Record the native admission fence, already submitted events, cancelled samples and cleanup attempts. Test cleanup when the original target has disappeared. Release automation-owned keys/buttons only; do not blindly clear the user's unrelated state. Include a driver crash as a distinct case with explicitly stated supervisor coverage.

### Pass criteria

One writer owns the seat. No new activating submission begins after the acknowledged native revocation fence. Stop is independent of the model/guest/UI event loops. Pure workspace memory can survive without live capture/input authority. Held input never crosses a model/human checkpoint. `stopping` and `quiescent` are distinguished honestly, including cleanup errors and already queued OS input.

### Failure response

Keep real input disabled for the failing profile. Do not solve takeover by blocking the human, repeatedly reclaiming focus or renewing control from guest activity. Fix the authority/cleanup state machine and add the fault as a regression case.

## 7. Gate G05 — Devices, coordinated timelines and cursor causality

**Owners:** D12–D15. **Packages:** W09–W13. **Prerequisites:** G01/G04.

### Question

Does the qualified native path perform what the program expressed, with the same visible geometry, appropriate keyboard semantics and no duplicate routing?

### Procedure

Use independent AppKit/WKWebView/Electron input oracles and visible contact markers. Test click counts/buttons, hover, context menus, drag/drop, straight and curved paths, sharp corners, scroll phases and modifiers overlapping selected timeline segments. Capture actual received event count and final state, not just a successful tool return.

Repeat on 1x/2x/mixed displays, negative desktop origins, different refresh rates and display removal. Inject CPU/GPU load, AX stalls, window movement and cancellation. Verify that endpoint/button transitions survive coalescing, that backpressure obeys declared tolerance and that no high-frequency sample crosses MCP/model inference.

Test Unicode, combining marks, emoji, selection/caret edits, non-US layouts, IME, physical key codes, repeats and cancelled chords. Optional clipboard paste must be explicit and compare-and-swap restoration must preserve later user changes.

### Pass criteria

The actual visible hotspot is the interaction point at rest, rotation and pulse. Events do not knowingly lead the visible cursor. The initial target is within one display interval for discrete contact, with measured p95/p99; display callbacks alone are not visual proof. Approach animation and held-gesture geometry are distinct. A chosen route is not automatically retried after possible delivery. Unsupported pressure/touch/IME behavior is reported, not simulated as qualified.

### Failure response

Fix presentation/motor/backend code or narrow the named capability profile. Do not flip application coordinates to conceal artwork inversion, inject through hidden app APIs, or substitute imported artwork/text art for an input test.

## 8. Gate G06 — Dependency-specific targets and spatial contracts

**Owners:** D07, D08, D10, D11. **Packages:** W16–W20.

### Question

Can the program continue through harmless changes while stopping on changes that make its particular target wrong?

### Procedure

For semantic input, repeatedly change a distant status counter while preserving the target's identity, label, role, action, enabled state and relevant geometry. Then change each relevant dependency independently: label from Save to Send, action list, disabled state, replaced AX object, document/window launch identity or blocking modal.

For spatial input, execute twenty strokes while expected ink appears. Separately inject canvas zoom/scroll, tool-mode change, document replacement, region reflow, window move/resize, occluding dialog and human takeover. Include changes during approach and during a held stroke.

Test weak AX/notification coverage and raw-pixel surfaces. Local pixel/anchor tracking may supply bounded evidence, but visual similarity cannot prove semantic identity. Verify disclosed coverage, bounded age/action/uncertainty policy and explicit re-observation at genuine ambiguity.

### Pass criteria

Harmless unrelated changes do not create global lockout. Relevant changes stop/revalidate before the next unsafe effect. A selector with several matches never chooses the first silently. Old screenshot pixels and current surface coordinates remain distinguishable. Repeated drawing does not require a provider screenshot per mouse-up, but local validation still runs.

### Failure response

Improve scoped sensing or narrow/shorten the weak profile with explicit limits. Do not restore blanket version equality, remove all invalidation, or claim perfect classification of arbitrary GUI changes.

## 9. Gate G07 — Capture ownership, provenance and artifact races

**Owners:** D07, D09. **Packages:** W14–W17.

### Question

Can capture remain warm and fresh without leaking privacy authority or mixing window/frame generations?

### Procedure

Open one authorized stream, return a screenshot and wait 60 seconds without another image request while the host remains alive and performs keyboard work. Request another screenshot and verify the same stream identity unless a recorded replacement/failure legitimately occurred.

Race borrower acquisition, encoding and image emission with last-owner release, another owner joining, reset, window replacement, geometry change, permission revocation and a late callback from an old stream. Attempt capacity pressure with more pinned targets than the profile supports. It must require explicit unpin/downgrade or report a limit rather than silently evict the active target.

Test static frames, idle/complete metadata, post-input freshness, missing timestamps, cross-clock conversion bounds and cached encodings. Crop transforms must remain attached to the original frame. Test artifact chunk corruption, cross-owner reads, expiration, repeated emission and cancellation while a large transfer is in progress.

### Pass criteria

Owned streams do not expire due to screenshot inactivity. Owner and borrower counts have separate, race-safe meanings. Old generations cannot publish evidence into new records. No cached frame is relabelled with encode/receipt time to masquerade as post-action evidence. Images and model export remain explicit and bounded. Urgent stop is not blocked by artifact transfer.

### Failure response

Return explicit unavailable/uncertain evidence while repairing the ownership/freshness path. Do not remove freshness checks or silently restart/evict streams without diagnostics. Optional newer capture APIs require their own availability/performance proof and are not substitutes for correct ownership.

## 10. Gate G08 — Privacy, permission and adversarial boundary review

**Owners:** D16, D18, D19. **Packages:** W08, W15, W24, W28.

### Procedure

Try forged/cross-owner IDs, stale generations, malformed JSON/binary framing, unsupported methods, excessive nesting, floods and signed-artifact substitution. Attempt imports of filesystem/process/network/native modules and construction of privileged host objects. Check all descriptor/handle-transfer routes.

Place hostile instructions in AX labels, web content, image annotations and clipboard text. They remain task data, not permission. Attempt a hidden switch from visible UI to terminal/filesystem/app APIs. Test secret-field observations, password-manager guards, explicit clipboard grants and artifact export to a different provider.

Approve one precise effect; delay the answer while changing the target, amount, document or control epoch. Replay the answer through a model tool and another host context. A human approval answer must come from the trusted human UI path; knowledge of a checkpoint ID is insufficient.

### Pass criteria

Every effect/export is native/host-authorized for the current scope. Default logs contain no screen text, code payloads, credentials, images or clipboard values. Retention and deletion are enforced. A sandbox with no network is not advertised as complete exfiltration prevention because the GUI itself can transmit information. Cross-system negative tests pass without removing language expressiveness.

### Failure response

Fix the boundary or disable the capability. No universal model intent classifier, keyword filter or successful tool schema validation may substitute for effect authority.

## 11. Gate G09 — Task outcomes and infrastructure-tax measurements

**Owner:** D20. **Packages:** W29–W34. **Prerequisites:** applicable G01–G08 correctness gates.

### Procedure

Execute matched native plan A and the same JS plan B with identical presentation, input and evidence requirements. Interleave trial order, reset state and record warm/cold conditions. Separately run actual model plan C. C-versus-B reflects more than intelligence because procedure choices and retries may differ.

Run deterministic fixtures and real Safari/YouTube, Notes/drawing and Finder cases, plus held-out unfamiliar interfaces. Report each named application outcome. A successful different canvas does not erase a Notes failure. A non-skippable ad is not a tool bug; an unobserved Skip button must not be invented.

Use at least 50 samples for exploratory timing and 1000 fixture action trials for tail exploration. Report sample counts, estimator/confidence bounds, maxima and failures. Zero observed failures is not proof of impossibility. Store actual task outcomes and checks for extra effects as well as durations.

### Targets, not present results

| Measure | Initial target |
|---|---|
| Warm local JS-to-driver bridge | p95 <5 ms, excluding ownership queue/AX/OS/app waits |
| Fixed-plan B versus A overhead | <10% infrastructure-only critical-path overhead; also report absolute milliseconds |
| Cursor callback work | p95 <2 ms on the named fixture/hardware |
| Native new-input revocation | within one scheduled input tick; report actual bound |
| Automation-owned release cleanup | p95 <50 ms on controlled fixtures, with failures/OS delay separate |
| Warm observation | p95 <450 ms for the named scope/resolution, not every application |
| Known navigation sequence | one model-facing execution for chord/text/Return/observation |
| Twenty qualified strokes | one program, initial/final requested images; local sensing allowed |
| Ordinary action payload | no automatic full AX walk or screenshot encoding |
| Capture continuity | one owned stream across a 60-second image-request gap |

### Pass and failure interpretation

Correctness is prerequisite. A profile meeting functional gates but missing a speed target is functional with a recorded performance failure, not falsely fast. Diagnose the critical path using correlated monotonic spans, not the sum of overlapping work. Record CPU/GPU/memory, retained image bytes, AX calls, encodes, model round trips and provider export costs. Do not change predicates, hide failed trials or inflate page-wait time to make overhead percentages pass.

## 12. Gate G10 — Optional memory, debugger, demonstrations and planning

**Owners:** D21–D24. **Packages:** X01–X04. **Prerequisite:** qualified core.

Save a helper with source revision, parameters, required capabilities, app/profile assumptions and tests. Strip private values and expired handles before shared promotion. Reuse must reacquire current targets. A prior success is not indefinite qualification.

Replay recorded observations with all real effects intercepted. Real desktop replay is a new execution with new authority and fresh targets. Debugger inspection invokes no getters. Suffix replacement occurs only at an explicit safe boundary; it cannot modify a suspended execution behind its back.

Record a consented demonstration with redaction, retention and cancellation. Synthesize a procedure, then verify it on fixtures and changed layouts. Demonstration data is not executable authority. Plan against versioned evidence while another deterministic segment runs; commit proposed targets only after fresh dependency checks.

**Pass:** no extension creates hidden authority, replays past effects or adds another same-seat writer. **Failure:** disable that extension without declaring the core incomplete or silently turning it into a fixed task catalogue.

## 13. Gate G11 — Separate seats

**Owner:** D25. **Package:** X05.

Qualify a remote physical Mac first. Bind commands, observations and preview to an authenticated destination seat/runtime/control. Test loss/reconnect, replay, supervisor death, high latency and cross-seat handles. Preview age must be visible; it must show the actual controlled desktop.

A macOS Space or another display is not treated as independent focus/keyboard ownership. A VM profile separately needs supported virtualization, guest permission, app/account/file availability and current licensing review. Those are explicit proof tasks, not assumptions inferred from a virtual display rendering.

**Pass:** independent seat ownership and bounded stop on link/liveness loss are demonstrated. **Failure:** leave that profile unsupported; never route commands to another desktop with matching titles.

## 14. Gate G12 — Extended input devices

**Owner:** D26. **Package:** X06.

For pen, touch or hardware-backed providers, document real ranges, units, sampling limits, contacts and pressure/tilt semantics. Verify samples in an independent receiving fixture and correlate their timing with visible capture. Test physical stop, unplug, malformed paths, device reset, missed release and authentication/replay boundaries.

The ordinary mouse provider must not advertise pressure or touch merely because it can draw a line. A hardware appliance is an optional legitimate device profile, not a route around system permission or protection.

**Pass:** advertised capability and cleanup behavior have measured evidence on the exact hardware/OS/app combination. **Failure:** mark unsupported/unqualified and preserve ordinary devices.

## 15. Gate relationships and release rule

Core release requires G01–G08 for the selected profile and the real-task correctness portion of G09. Performance claims additionally require the stated G09 measurements. G10–G12 apply only when the optional capability is advertised. A gate may be blocked by unavailable hardware, denied permission or an unsupported provider, but it must not be marked passed.

The implementation agent must attach evidence before changing a capability's `qualified` flag. `supported`, `qualified`, `granted` and `currentlyAvailable` remain independent. A public symbol or a successful build can establish none of the other flags by itself.

## 16. Documentation-stage validation

The documentation handoff validates declaration/schema syntax, positive and negative examples, reference resolution, work-package dependencies, authority/state-model vectors, requirement coverage and exported-file hashes. It does not run the signed macOS gates above. The accompanying `qualification-status.json` starts every platform gate at `not-run`, so no future agent can mistake the design review for platform evidence.
