# D29 — Primary research register and adoption boundaries

**Revision:** 1.1. **Research window:** 2026-09-08–2026-09-09. **Purpose:** connect platform-dependent design choices to primary documentation and identify what documentation does not prove. This is a newly completed register, not a claim that the missing earlier register was recovered byte-for-byte.

## 1. Evidence rules

A source URL, an HTTP response, an available SDK symbol, a compiling prototype and a successful signed desktop interaction are different evidence levels. Keep them separate. The mechanical source-check record stores URL, fetch time/status, final URL and body digest when available; it does not automatically certify the semantic truth of every nearby sentence.

The recovered subsystem documents contained numbered S references without their register. The entries below supply primary documentation for their platform domains. In an old reference whose short label and number disagree, use the named source/API and record the reconciliation rather than assuming that the missing register's exact numbering survived. The completed cross-reference audit must preserve that distinction. Design choices such as resource budgets, module publication rules, control epochs and particular package paths are Cozea decisions, not claims that Apple, MCP or QuickJS implements them.

Do not copy a moving `latest` SDK/specification into a runtime compatibility assertion. The implementation qualification report pins the adopted revision, compiler/runtime artifact and OS/app profile. A research source remaining unavailable blocks adoption of the corresponding unverified feature, not the transport-independent architecture.

## 2. Corrections to the earlier technology-opportunity notes

The design does **not** require the assertion that every MCP client is now stateless, that every July-2026 feature is deployed in T3, that every WASI guest toolchain supports a new async ABI, or that a newer Swift annotation eliminates ABI risk. Those were opportunities to investigate. The authoritative design is explicit application state plus capability-negotiated protocol adapters.

In particular:

- Read lifecycle and transport requirements for the exact negotiated MCP revision. Do not remove `initialize` or session handling from an existing adapter unless that revision actually requires it.
- A server may offer application handles regardless of whether its wire protocol maintains transport sessions. This separation is a Cozea architecture decision, not a migration that depends on one future release.
- An async JavaScript-to-native Promise bridge can be built with explicit request/completion queues. Native async Wasm component support is optional until its complete guest/host toolchain passes G02.
- New ScreenCaptureKit screenshot/clip APIs are availability-gated providers. Persistent owned streams remain the baseline; an optional beta method cannot be a correctness dependency.
- `supported`, `qualified`, `granted` and `currentlyAvailable` remain separate capability fields. Documentation or symbol resolution does not make an app accept synthetic input.

The public documents below are primary sources. The supplied private Cozea findings and Codex transcript are evidence for reported observations/interface descriptions only and are not republished here. Their exact backend explanations and latency percentages are not promoted to platform facts.

## 3. Protocol and programmable orchestration

<a id="s01"></a>
### S01 — MCP versioned specifications and lifecycle

Primary sources: <https://modelcontextprotocol.io/specification/>; <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle>; <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>. Published 2026-07-28 release note: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>.

**Use:** D17's adapter negotiation, application handles, request correlation and compatibility matrix. Read the actual selected revision rather than applying one lifecycle rule to all hosts. The host contract remains open/exec/inspect/respond/close/describe whether the protocol session is stateful or not.

**Not established:** that the pinned T3/Effect implementation implements a newer release, that a live JS realm can move between Macs, or that a transport reconnect preserves native authority automatically. G03 supplies the implementation proof. The 2026-07-28 release was reopened in this review: its core removes the initialization exchange and transport session header for that profile. This does not establish adoption in pinned T3.

<a id="s02"></a>
### S02 — Long-running tasks, input requests and cancellation

Primary sources: <https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks>; <https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation>; published extension profile: <https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks>.

**Use:** asynchronous operation status, capability negotiation and explicit task/continuation adapters. Native execution IDs remain authoritative and map to protocol task IDs rather than becoming identical concepts. If the adopted extension supplies task input/update methods, bind them to the same single-use checkpoint record.

**Not established:** physical input stopped when a protocol cancellation was acknowledged, task recovery after native process loss, or permission to rerun an effectful `exec`. Do not mix method names from different protocol revisions. The explicit application API is the tested fallback when an extension is absent.

<a id="s03"></a>
### S03 — QuickJS embedding, modules and resource control

Primary source: <https://bellard.org/quickjs/quickjs.html>.

**Use:** the candidate interpreter's module, Promise/job-queue and embedding/resource-control primitives. D03 adds the named module registry, frozen imports, publication rules, trusted request context and source-map association that a language engine does not supply as a product.

**Not established:** a browser/Node standard library, OS containment, safe arbitrary native bindings, persistent heap after a crash or an already working Wasm/Wasmtime integration. The `std` and `os` convenience modules must not be exposed as ambient guest capabilities. G02 tests actual selected-engine semantics, including top-level await and interrupted jobs.

<a id="s04"></a>
### S04 — Wasmtime security model

Primary source: <https://docs.wasmtime.dev/security.html>.

**Use:** guest memory isolation and the fact that host imports and embedding code are part of the trusted boundary. A guest granted an AID host import still needs per-call owner/epoch/capability checks. Wasm is one layer; the worker process and native driver remain separately supervised.

**Not established:** universal protection from bugs in privileged host functions, a guarantee that untrusted precompiled native artifacts are safe, or prevention of GUI-based exfiltration through legitimately authorized input. Do not deserialize an attacker-provided compiled engine image.

<a id="s05"></a>
### S05 — Wasmtime asynchronous host integration

Primary source: <https://docs.wasmtime.dev/examples-async.html>. The former `async.html` URL returned 404 during review; the maintained example is the applicable source.

**Use:** qualify host-side asynchronous scheduling and the worker's integration with pending device requests. The AID contract separates native device timing from guest execution, so a host implementation may use explicit request/completion queues even when a particular component-async toolchain is not ready.

**Not established:** automatic conversion of every QuickJS Promise to a Wasm future, safe re-entry from arbitrary callback threads, or cancellation of an unbounded native call merely by interrupting guest compute. G02 separately tests job pumping, queue bounds and native request deadlines.

<a id="s06"></a>
### S06 — Wasmtime interruption and execution accounting

Primary source: <https://docs.wasmtime.dev/examples-interrupting-wasm.html>.

**Use:** fuel/epoch-style interruption options and their embedding constraints. D03's compute quantum, memory ceiling and host-liveness policy are proposed measured settings, not values prescribed by Wasmtime.

**Not established:** a real-time guarantee, cancellation of arbitrary blocking host code, or quiescence of events already posted into an application. The native urgent stop channel remains independent and is tested by G04.

<a id="s07"></a>
### S07 — WebAssembly Interface Types and resources

Primary source: <https://component-model.bytecodealliance.org/design/wit.html>.

**Use:** typed resource/value interfaces as a candidate way to represent app/window/surface/artifact capabilities at the worker boundary. The current design's canonical IDL is repository-owned and can generate a WIT binding after qualification.

**Not established:** that a WIT resource ID is authorization, that external native handles survive driver restart, or that one generated binding supplies the entire SDK. All resources remain owner/runtime/epoch checked.

<a id="s08"></a>
### S08 — WASI revisions and component async work

Primary sources: <https://wasi.dev/>; <https://github.com/WebAssembly/WASI>; published launch announcement: <https://bytecodealliance.org/articles/WASI-0.3>.

**Use:** evaluate versioned async/resource capabilities and their actual guest/host support. Record the exact implemented interfaces and toolchain hashes rather than treating an announcement as deployment evidence.

**Not established:** that the selected QuickJS build can use every announced ABI, or that an async component feature is required to implement Cozea's Promise bridge. The design remains viable with a bounded queue-based adapter; unavailable optional features are explicitly unqualified.

## 4. macOS process, permission and application primitives

<a id="s09"></a>
### S09 — App Sandbox

Primary source: <https://developer.apple.com/documentation/security/app-sandbox>.

**Use:** the restricted worker's OS capability boundary and entitlement review. Put only explicitly required capabilities into the worker and test denied filesystem/network/device attempts in the signed bundle.

**Not established:** identical behavior between a development binary, an Electron child, a bundled XPC service and a notarized helper. No private entitlement or disabled protection is assumed. G01/G02 exercise the actual topology.

<a id="s10"></a>
### S10 — XPC service design and connection lifecycle

Primary sources: <https://developer.apple.com/documentation/xpc>; <https://developer.apple.com/documentation/foundation/nsxpcconnection>.

**Use:** service lifecycle, explicit interfaces, connection interruption/invalidation and authenticated peer establishment where supported by the selected SDK. The design requires a narrow checked interface and generation-bound ownership on every message.

**Not established:** that possession of an endpoint grants arbitrary desktop authority, that PID comparison alone resists reuse, or that a specific audit-token accessor exists in every deployment target. Compile and adversarial peer tests settle those details; do not invent API availability.

<a id="s11"></a>
### S11 — Application opening and activation

Primary sources: <https://developer.apple.com/documentation/appkit/nsworkspace>; <https://developer.apple.com/documentation/appkit/nsrunningapplication>.

**Use:** explicit prepare/launch/unhide/reopen/activate operations. Activate the intended target application, not Cozea's `NSApp`. Preparation can occur before a screenshot exists.

**Not established:** that an activation attempt means the intended window is now focused, that every app exposes a new-window action or that repeated activation after user takeover is appropriate. Verify focus/window state before input and preserve the application's actual limitations.

<a id="s12"></a>
### S12 — Accessibility element reads and actions

Primary sources: <https://developer.apple.com/documentation/applicationservices/axuielement>; <https://developer.apple.com/documentation/applicationservices/1462091-axuielementperformaction>; <https://developer.apple.com/documentation/applicationservices/1462051-axuielementcopymultipleattribute>.

**Use:** retained element identity, scoped attribute reads, supported actions and unambiguous semantic interaction. Bulk node reads can reduce repetitive crossings but do not make AX a local DOM.

**Not established:** complete trees, stable element identities forever, a universal semantic click strategy, or successful task outcome from a return code alone. Raw supported roles/actions stay accessible; app-specific gaps are evidence, not permission to guess.

<a id="s13"></a>
### S13 — AX observers, array pages and per-object timeouts

Primary sources: <https://developer.apple.com/documentation/applicationservices/1460133-axobservercreate>; <https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout>; <https://developer.apple.com/documentation/applicationservices/1462060-axuielementcopyattributevalues>.

**Use:** event-driven dirty signals, bounded children pagination and timeout application to the exact queried AX object. Descendant helpers must respect the traversal deadline and cancellation independently.

**Not established:** reliable notification delivery from every app, globally inherited per-element timeouts, an atomic scene snapshot or the specific cause of the reported Finder counter invalidation. A notification is a signal for scoped reconciliation, not proof of every implied change.

<a id="s14"></a>
### S14 — Persistent ScreenCaptureKit streams

Primary sources: <https://developer.apple.com/documentation/screencapturekit/scstream>; <https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos>.

**Use:** long-lived stream production with configurable filters/configuration. Cozea's owner/borrower lifecycle is an application contract built on these primitives, not an SDK-provided agent-session abstraction.

**Not established:** a guarantee of unchanged stream identity across every geometry/failure condition, permission persistence after revoke, or that window capture includes all desired popovers automatically. Source replacement and child-window behavior are profile-tested.

<a id="s15"></a>
### S15 — Frame callbacks and capture provenance

Primary sources: <https://developer.apple.com/documentation/screencapturekit/scstreamoutput>; <https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo>; <https://developer.apple.com/documentation/screencapturekit/scframestatus>.

**Use:** inspect documented frame status/metadata and retain bounded source buffers. Distinguish capture-time evidence from callback/encode/provider-emission timestamps.

**Not established:** that the latest retained changed frame is always valid after input, that callback time can replace capture time, or that a static desktop must generate different pixels. G07 qualifies complete/idle handling and input barriers under the actual SDK.

<a id="s16"></a>
### S16 — Explicit screenshot APIs and optional clip buffering

Primary sources: <https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager>; <https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration>; <https://developer.apple.com/documentation/screencapturekit/scclipbufferingoutput>.

**Use:** evaluate one-shot configuration, formats, regions and optional temporal diagnostics on OS/SDK profiles where present. A warm frame remains the default source when it already meets the observation contract.

**Not established:** backwards deployment of a newer API, beta availability on every host, or lower latency than a warm stream. Clip storage needs separate consent/retention. No release requirement depends on an unavailable beta method.

<a id="s17"></a>
### S17 — Core Graphics event posting

Primary sources: <https://developer.apple.com/documentation/coregraphics/cgevent>; <https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:)>.

**Use:** the foreground synthetic event route for pointer/keyboard/scroll/drag. The receiving application and actual result are tested separately from successful posting.

**Not established:** hardware-equivalent acceptance, reliable background targeting, PencilKit's internal rejection cause, or a requirement to forward Safari events to a WebContent child PID. Those earlier explanations were hypotheses, not verified platform contracts.

<a id="s18"></a>
### S18 — Event sources, state and Unicode keyboard data

Primary sources: <https://developer.apple.com/documentation/coregraphics/cgeventsource>; <https://developer.apple.com/documentation/coregraphics/cgevent/keyboardsetunicodestring(stringlength:unicodestring:)>.

**Use:** source state and explicit text/event construction. Distinguish logical chords, physical key codes, Unicode text and user/automation-owned held state.

**Not established:** that injected Unicode reproduces arbitrary IME composition or physical layout behavior, or that event tags are an unforgeable authorization mechanism. G05 covers actual keyboard profiles and G04 covers takeover/cleanup.

<a id="s19"></a>
### S19 — Event taps and input monitoring

Primary source: <https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>.

**Use:** qualified event monitoring for takeover/ownership evidence and native stop coordination, subject to permission and API behavior. Monitoring callbacks remain minimal and never run model code.

**Not established:** reliable monitoring after permissions/session state change, perfect distinction between every external synthetic event and the human, or permission to block the user's input. Monitoring failure invalidates the control profile rather than silently continuing.

## 5. Presentation, language, packaging and storage

<a id="s20"></a>
### S20 — Display-synchronized presentation

Primary sources: <https://developer.apple.com/documentation/quartzcore/cadisplaylink>; <https://developer.apple.com/documentation/appkit/nsview>.

**Use:** schedule small AppKit/layer updates appropriately for the selected macOS SDK/display. One motor timeline feeds both events and visible cursor position.

**Not established:** a callback proves photons reached the person, hard real-time scheduling or permission to run AX/window enumeration inside every frame callback. Live visual-marker evidence qualifies causal alignment.

<a id="s21"></a>
### S21 — Logical points, backing pixels and display conversion

Primary source: <https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/APIs/APIs.html>.

**Use:** preserve the distinction between logical geometry and backing resolution and use platform conversion facilities. Crop/window/display transforms carry explicit identity and generation.

**Not established:** one universal divide-by-two fix for cursor size, one global scale for mixed displays, or a reason to flip input coordinates to fix artwork. The chosen 16-point body is a design target, not an Apple/Codex measurement.

<a id="s22"></a>
### S22 — Swift language and C interoperability

Primary sources: <https://www.swift.org/documentation/>; candidate feature notes <https://www.swift.org/blog/swift-6.3-released/> and <https://www.swift.org/blog/swift-6.2-released/>.

**Use:** evaluate generated C declarations, strict concurrency and language features in the actual selected compiler. Retain explicit ABI/protocol versions and owned buffers regardless of syntax.

**Not established:** an unverified compiler feature on the deployment machine, backwards availability of unrelated OS APIs or a performance benefit from rewriting a working FFI boundary. Gate source hashes and packaged load tests matter more than an annotation name.

<a id="s23"></a>
### S23 — Hardened runtime and signing requirements

Primary sources: <https://developer.apple.com/documentation/security/hardened-runtime>; <https://developer.apple.com/documentation/security/code-signing-services>.

**Use:** minimal entitlements, signed resource verification and candidate-engine executable-memory qualification. Sign nested components correctly, not by treating `codesign --deep` as a design.

**Not established:** that notarization supplies sandbox isolation, that unsigned debug behavior matches distribution or that broad JIT/library exceptions are harmless. Each exception needs a named technical requirement and G01/G02 evidence.

<a id="s24"></a>
### S24 — Notarization and distribution

Primary source: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>.

**Use:** later package/release qualification and signed relocation checks. Documentation commits do not publish a release.

**Not established:** input/capture permission, task reliability or acceptance of every private SPI use. Do not conflate notarization, App Sandbox, hardened runtime and TCC.

<a id="s25"></a>
### S25 — Electron security boundary

Primary source: <https://www.electronjs.org/docs/latest/tutorial/security>.

**Use:** renderer isolation, sender validation, restricted bridges and preserving the native/host/guest separation. The AID program must not receive Electron main objects or a new unrestricted preload.

**Not established:** that a utility process alone is an OS security sandbox or that arbitrary generated JavaScript is safe in Electron main. Existing browser/portal architecture remains unchanged.

<a id="s26"></a>
### S26 — Electron native process and addon integration

Primary sources: <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>; <https://www.electronjs.org/docs/latest/api/utility-process>.

**Use:** inspect ABI/process integration and lifecycle during the comparison/cutover period. The target driver is selected by D04/D27 and its own signed qualification, not inferred from the existence of an Electron process API.

**Not established:** portable native binary compatibility, inherited permissions or correct cleanup across process loss. Packaged real-Electron smoke tests are mandatory but still lower-tier than live input tests.

<a id="s27"></a>
### S27 — SQLite durability and recovery boundaries

Primary sources: <https://www.sqlite.org/atomiccommit.html>; <https://www.sqlite.org/wal.html>.

**Use:** choose and test journal durability policy, ordered records and crash recovery. A native operation's possible-submission boundary must be recorded conservatively.

**Not established:** an atomic transaction spanning SQLite and an arbitrary external GUI effect. No database mode can eliminate the crash window after a click is posted but before acknowledgement is durable.

<a id="s28"></a>
### S28 — W3C Trace Context and OpenTelemetry

Primary sources: <https://www.w3.org/TR/trace-context/>; <https://opentelemetry.io/docs/specs/otel/trace/>.

**Use:** correlate model-host, protocol, JS, driver, capture and receipt spans. Record monotonic durations, critical-path overlap and bounded cross-clock uncertainty. Filter baggage and sensitive identifiers.

**Not established:** clock synchronization, proof of causal application outcome or authorization. A trace field cannot identify a principal or permit an action.

<a id="s29"></a>
### S29 — Source maps

Primary source: <https://tc39.es/ecma426/>.

**Use:** associate generated/transformed JS positions with named cell source and operation receipts. Preserve source URIs and version identity through errors and checkpoints.

**Not established:** persisted execution stacks, safe debugger mutation, or the model's hidden reasoning. The debugger shows emitted programs and observable execution only.

<a id="s30"></a>
### S30 — JSON canonicalization

Primary source: <https://www.rfc-editor.org/rfc/rfc8785>.

**Use:** the selected supported JSON domain for canonical method/argument/code-envelope hashes. Validate scalars/counters before canonicalization; include contract and import/source identity in an execution hash.

**Not established:** that arbitrary JavaScript objects, NaN, native handles or every Unicode representation can be hashed by ordinary `JSON.stringify` interchangeably. Cross-language golden vectors are required.

<a id="s31"></a>
### S31 — JSON Schema 2020-12

Primary source: <https://json-schema.org/draft/2020-12>.

**Use:** object/value contracts, exact discriminator branches and positive/negative validation fixtures. Schema describes wire values; method effects, authority and cancellation require explicit IDL metadata and native checks.

**Not established:** that each provider supports the full schema dialect, or that a schema-valid program is authorized/correct. Provider schemas can be adapted without weakening native validation.

## 6. Optional integrations and broader foundations

<a id="s32"></a>
### S32 — App Intents

Primary sources: <https://developer.apple.com/documentation/appintents>; <https://developer.apple.com/documentation/updates/appintents>.

**Use:** optional explicit hybrid/semantic providers for participating applications. Report their supported entities/actions separately from physical GUI devices.

**Not established:** universal app coverage, public invocation of every intent from any process, or equivalence to demonstrating the task through clicks. New yearly features require actual adopted SDK and application proof.

<a id="s33"></a>
### S33 — Safari extension/native messaging

Primary source: <https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension>.

**Use:** optional read-only layout/evidence or explicit hybrid capabilities, with extension installation and grants. Browser instrumentation can strengthen a surface contract where specifically enabled.

**Not established:** control of arbitrary Safari content without the extension or a reason to replace real visible actions secretly. Core AIDs must remain usable without participating browser APIs.

<a id="s34"></a>
### S34 — ECMAScript modules, jobs and language semantics

Primary source: <https://tc39.es/ecma262/>.

**Use:** distinguish lexical bindings, exported live state, modules, asynchronous jobs and ordinary JavaScript computation. The module-cell host registry is a Cozea layer built around these semantics.

**Not established:** Node/browser APIs, automatic notebook globals, safe host bindings or transparent state persistence after engine loss. D03/G02 define the product contract.

<a id="s35"></a>
### S35 — Capability-style component embedding

Primary sources: <https://component-model.bytecodealliance.org/reference/faq.html>; <https://component-model.bytecodealliance.org/running-components/wasmtime.html>.

**Use:** keep guest imports/resources explicit and qualify resource transfer/lifetime behavior. Cozea IDL types can map to component resources without exposing native pointers.

**Not established:** policy enforcement merely because a type is named Capability, or a secure boundary when a privileged host import accepts unchecked parameters.

<a id="s36"></a>
### S36 — Rust unsafe/FFI ownership

Primary source: <https://doc.rust-lang.org/nomicon/ffi.html>.

**Use:** buffer ownership, lifetime, thread-safety and error propagation in the worker/launcher shim. Keep engine/native unsafe operations narrow and covered by malformed-input/lifetime tests.

**Not established:** that Rust makes foreign Swift/AX objects automatically Sendable or prevents semantic authority leaks. A safe-language wrapper can still call an unsafe privileged API incorrectly.

<a id="s37"></a>
### S37 — Accessibility roles and application-specific coverage

Primary source: <https://developer.apple.com/documentation/applicationservices/axuielement>. The former aggregate `applicationservices/accessibility` URL returned 404; use the element API and S12/S13 method documentation.

**Use:** inspect actual roles/actions and retain raw access beneath convenience selectors. Record supported/unsupported attributes and notification coverage per app.

**Not established:** universal DOM equivalence, complete semantic meaning or that every label is trusted instruction. Unknown roles must be inspectable, not silently discarded.

<a id="s38"></a>
### S38 — Optional local visual tracking

Primary source: <https://developer.apple.com/documentation/vision/vntrackobjectrequest>.

**Use:** an optional explicitly selected tracker can help monitor a previously grounded region with measured uncertainty and stopping rules.

**Not established:** that visual similarity proves semantic identity, document identity or permission. Visual servo remains a qualified optional observation provider, not a universal target oracle.

<a id="s39"></a>
### S39 — Pixel buffers and shared image resources

Primary sources: <https://developer.apple.com/documentation/corevideo/cvpixelbuffer>; <https://developer.apple.com/documentation/iosurface>.

**Use:** bounded native frame ownership and optional efficient transfer within trusted capture/encoding components. Retain/release under a documented borrower lifetime; do not give the guest ambient native resource access.

**Not established:** zero-copy transfer across every process/engine or safe reuse after a source generation is revoked. G07 measures actual copy/memory behavior and race safety.

<a id="s40"></a>
### S40 — Swift structured concurrency and actor isolation

Primary source: <https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/>.

**Use:** task structure and actor/executor rules. Explicit native permits are still needed for transactions spanning awaits; generated guest code never executes on AppKit callbacks.

**Not established:** actor isolation eliminates reentrancy, guarantees real-time scheduling or automatically cancels external OS calls.

<a id="s41"></a>
### S41 — Code execution over tool interfaces

Primary source: <https://www.anthropic.com/engineering/code-execution-with-mcp>.

**Use:** the design pattern of local control flow, filtered intermediate data and reusable procedures over tool capabilities. Cozea adopts programmability while retaining real visible effects and native validation.

**Not established:** Cozea's latency/token savings, Codex's internal implementation or proof that a JavaScript wrapper alone fixes stale coordinates and weak input backends.

<a id="s42"></a>
### S42 — Apple virtualization

Primary source: <https://developer.apple.com/documentation/virtualization>.

**Use:** investigate a separately qualified VM seat with real guest permissions, account/app availability and current license terms. A remote physical Mac is the simpler initial independent-seat profile.

**Not established:** that a Space or virtual display is an independent login/input seat, or that every user's current desktop state is automatically available in a VM. Legal/distribution details require current authoritative terms during that extension's qualification.

<a id="s43"></a>
### S43 — HID device concepts and legitimate hardware providers

Primary source: <https://developer.apple.com/documentation/hiddriverkit>.

**Use:** optional supported hardware/provider integration for capabilities that ordinary mouse events cannot express. Record real device ranges, contact identity and release/stop behavior.

**Not established:** that third-party software can arbitrarily obtain all entitlements, that virtual pen input is universally supported, or that hardware is a route around consent/protection.

<a id="s44"></a>
### S44 — USB HID usage definitions

Primary source: <https://www.usb.org/document-library/hid-usage-tables-15>.

**Use:** ground optional hardware-provider descriptions in actual device usages and capabilities. Exact report format and receiving-app behavior remain implementation/profile tests.

**Not established:** that ordinary Core Graphics mouse input supports these richer usages. Do not advertise pressure, tilt, touch or haptics until G12 verifies the real device route.

<a id="s45"></a>
### S45 — Computer-use evaluation research

Primary sources: <https://os-world.github.io/>; <https://arxiv.org/abs/2404.07972>.

**Use:** motivation for outcome-based evaluation on real interactive environments and held-out tasks. Cozea's native-versus-JS-versus-model comparison is its own selected methodology with independent fixture oracles.

**Not established:** a published benchmark score for this system, a proof of macOS input support or a universal causal measure of model intelligence. Record local environment, failures and sample counts rather than importing someone else's speed/reliability claim.

## 7. Source-adoption record required during implementation

For each adopted platform dependency, record: source ID and canonical URL; exact spec/SDK/runtime revision; relevant API/behavior; a brief paraphrase of the relied-on contract; known limitations; implementation call site; qualification gate; tested profile; and evidence artifact digest. A fetch failure is `unavailable`, not `false`; an unverified claim is not promoted to a requirement merely to close a checklist.

Mechanical source checks must not republish whole copyrighted documentation pages. Store URL/status/digest and short own-language conclusions. If a current document contradicts the selected design, write an ADR and update the contract/example/test together. If it only lacks an optional newer feature, retain the already specified explicit queue/handle/protocol fallback rather than redesigning the whole system.

## 8. Claims deliberately not made

This register does not claim all macOS apps accept synthetic events, AX is complete, capture never changes source, a display callback proves visible presentation, a stateless protocol makes a Mac stateless, Wasm prevents every privileged-host mistake, or a compiled design prototype is ready for users. Those boundaries are part of the system's trustworthiness, not permission to omit implementation work.


## 9. Recovered citation topics requiring explicit additional entries

These are newly verified references, not claimed reconstructions of the lost register numbering. The per-document mapping is in [research-reference-map.json](contracts/research-reference-map.json).

<a id="s46"></a>
### S46 — Node VM is not a security boundary

Primary source: <https://nodejs.org/api/vm.html>.

The VM module documentation expressly disclaims use as a security mechanism. D04 therefore excludes Electron-main/node:vm execution of untrusted generated code. This is a boundary requirement, not proof that the selected alternative has passed G02.

<a id="s47"></a>
### S47 — Electron MessagePorts

Primary source: <https://electronjs.org/docs/latest/tutorial/message-ports>.

Electron documents channels between execution contexts and its MessagePort extensions. Use a narrowly exposed supervised transport with explicit ownership and bounds; a transferred port does not authenticate every request or create OS process isolation. D18/D27 retain native urgent stop separately.

<a id="s48"></a>
### S48 — OpenAI Responses function output and computer-use integration

Primary source: <https://developers.openai.com/api/docs/guides/function-calling>.

The Responses guide allows tool output as text or supported image/file content, correlated with the function call. Use the pinned SDK schema, actual image blocks and call identity. AID execution identity remains separate. No local integration or model task success was tested. Also see <https://developers.openai.com/api/docs/guides/tools-computer-use> for the public code-execution integration pattern; it is not evidence of this app’s private internals.

<a id="s49"></a>
### S49 — Anthropic client tool results and programmatic-tool limits

Primary source: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls>.

Client tool results match tool_use_id and can contain supported image blocks in the documented user-message structure. The separate <https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling> path restricts answers to programmatic calls to text. These pathways are not interchangeable. G03 must test the actual selected pathway and image delivery.

<a id="s50"></a>
### S50 — Gemini Interactions versus generateContent function results

Primary source: <https://ai.google.dev/gemini-api/docs/function-calling>.

The current Interactions guide describes multimodal blocks in a function_result result. The separate <https://ai.google.dev/gemini-api/docs/generate-content/function-calling> surface uses its own function-response parts. Choose by API/SDK and qualified model capability; do not translate by model marketing name or transplant JSON between the two APIs.

<a id="s51"></a>
### S51 — NSPasteboard change tracking

Primary source: <https://developer.apple.com/documentation/appkit/nspasteboard/changecount>.

The change count can reveal ownership changes between observations. It does not make a read-check-write restore atomic. The inference used in D13 is therefore conservative: no automatic restore by default; optional best-effort restore skips detected foreign changes and cannot promise race-free noninterference.

<a id="s52"></a>
### S52 — MCP Apps optional supervisory view

Primary source: <https://modelcontextprotocol.io/extensions/apps/overview>.

MCP Apps provides interactive HTML views rendered by supporting hosts. It can carry a supervisory interface after G03 qualification, but does not replace Cozea’s native stop path or confer desktop authority. Host support, sandbox permissions and trusted approval routing remain distinct.

<a id="s53"></a>
### S53 — Code as Policies research

Primary source: <https://arxiv.org/abs/2209.07753>.

Liang and colleagues describe model-generated programs that compose perception and control primitives, including logic and geometric computation. This supports investigating reusable procedural code; it does not prove reliable generalization from arbitrary human desktop demonstrations. D21/D24 require their own fixtures and G10 results.


## 10. Claim review and adoption decisions — 2026-09-09

This is a semantic review of the claims below. Source retrieval metadata is recorded separately in `contracts/research-retrieval.json`; an HTML shell, HTTP success or body hash alone is not counted as platform proof. Quoted wording is avoided; summaries describe only the relevant support. All signed/runtime qualification remains unrun.

| Claim reviewed | Primary evidence and decision | Implementation obligation |
|---|---|---|
| July 2026 MCP has a stateless core | S01's published release and versioned specification distinguish this profile from 2025-11-25 initialization/session handling. Corrected wording that suggested the release itself was unverified. | Negotiate profile; route explicit handles to their resident Mac; G03 |
| MRTR and Tasks input differ | S01 describes original-request retry with input responses; S02 describes task input through `tasks/update`. | Deduplicate to existing execution/continuation in both routes; never evaluate a prefix twice |
| Task cancellation may not stop work | S02 explicitly makes cancellation cooperative; even eventual cancelled status is not guaranteed by acknowledgement. | Independent native revoke; report quiescence only from cleanup evidence; G04 |
| QuickJS supplies language/embedding primitives | S03 supports modules, promises and resource controls; its manual does not implement Cozea cell publication or checkpoint persistence. | Pin engine/build; qualify jobs, top-level await, modules and interruption; G02 |
| Wasmtime isolation includes a trusted embedding boundary | S04/S06 document isolation and interruption facilities, not safety of arbitrary privileged imports or blocking host calls. | Typed queues plus App Sandbox worker and independent stop; G01/G02/G04 |
| WASI 0.3 exists, but not as automatic QuickJS glue | S08's launch announcement states release and distinguishes host support from guest-toolchain rollout. | Queue-based core-Wasm bridge remains selected; optional ABI adoption needs G02 |
| Node VM is unsuitable as the isolation boundary | S46 explicitly excludes that security use. | No node:vm fallback in Electron main |
| XPC offers public signing requirements | Apple's [connection API](https://developer.apple.com/documentation/foundation/nsxpcconnection/setcodesigningrequirement%28_%3A%29) and DocC metadata identify macOS 13 availability, one setup call before resume, and invalidation on mismatch. | Configure both peers using supported APIs; malformed requirements fail early; signed bundle/TCC attribution still G01 |
| AX can read multiple attributes and bounded array pages | S12/S13 and the corresponding Apple API pages identify bulk, indexed and timeout primitives. They do not freeze an application-wide tree or guarantee prompt cancellation. | Budget each read, page with lineage, isolate blocked lanes, disclose partial coverage; G06 |
| ScreenCaptureKit queue depth has a practical bound | Apple's [WWDC22 session](https://developer.apple.com/videos/play/wwdc2022/10155/) describes default three and upper guidance of eight; S14 supplies stream APIs. | Separate platform queue from owned retained frames; measure memory and freshness; G07 |
| Frame callback/idle data is not an invented recapture | S15 supplies frame metadata; D09 is Cozea's explicit provenance/freshness policy. | Validate timestamp units and clock mapping on the selected SDK; no relabelled stale frames |
| Core Graphics event posting exists | S17/S18 describe event submission and sources. Neither says every app accepts synthetic input or gives physical pen/touch equivalence. | Consistent foreground route, held-state ledger and per-app G05 tests |
| Clipboard change tracking is not atomic restore | S51 supports tracking ownership changes; atomicity is not supplied by the read/check/write sequence. | Default off; best-effort opt-in limitation propagated to W12 and G05 |
| Actor isolation alone is not a transaction across await | S40 and the [accepted actors proposal](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0306-actors.md) describe reentrancy. | Explicit native permit spans awaited effect phases; G04 |
| Logical points and image pixels need conversion | S21's platform conversion APIs are a substrate; the six-number frame graph is our design. | Mixed scale/negative-origin/rotation/crop round-trip fixture; G05/G06 |
| Provider image delivery is API-specific | S48/S49/S50 establish distinct result structures and programmatic-path limits. | Fixture must prove actual image content reaches the chosen model, with call ID and permission; G03 |
| Electron ports and renderer isolation have distinct roles | S25/S47 document IPC and isolation guidance. Ports alone do not validate principals or make native stop responsive. | Narrow preload, no arbitrary privileged renderer dispatch; G08 |
| SQLite durability cannot be atomic with desktop effects | S27 documents journal/synchronous modes; D16 conservatively records possible dispatch before external effects. | Fault injection around disk failure, dispatch and acknowledgement; G04/G08 |
| Schemas, canonical JSON, source maps and tracing are standards, not runtime guarantees | S28–S31 supply formats; the application still owns resource identity, limits and semantics. | Duplicate keys, unsafe counters, nonfinite values, digest and cross-language vectors; W03 |
| Vision, virtualization and extended HID are qualified extensions | S38/S42–S44 expose platform concepts. They do not prove semantic target stability, an independent macOS seat in a Space, or virtual pen acceptance. | X02/X05/X06 capability profiles and G10–G12; no silent substitute |
| Programmatic orchestration and code policies are research support | S41/S53 demonstrate patterns in their own settings; OSWorld S45 supplies evaluation inspiration. | No imported token-savings/benchmark prediction; Cozea A/B/C and held-out tests decide G09/G10 |

No implementation-ready claim depends on a moving documentation page silently becoming a tested runtime. For any optional symbol unavailable in the chosen SDK, retain the baseline provider and mark that capability unqualified. For a required topology/engine/input experiment that fails, follow D30's specified fallback or blocked gate with an ADR; do not invent an untested replacement.
