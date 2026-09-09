# D02 — Canonical contracts, SDK and progressive discovery

## 1. Selected contract model

AID application contract revision 1.1 uses a **single repository-owned interface definition** under proposed `packages/aid-contracts/idl/aid.idl.json`. It describes resource types, serializable value types, methods, argument/result schemas, required capabilities, effect classes, cancellability and documentation. It is not an arbitrary JSON Schema interpreted as executable code. JSON Schema 2020-12 supplies the value-schema dialect; an explicit method/resource layer supplies the missing RPC semantics. [S31](29-research-register.md#s31).

The generator emits TypeScript SDK types/proxies, Swift Codable values and router signatures, Rust worker bridge types, host method metadata, public tool envelopes, discovery excerpts and fixture validators. Generated files include the IDL hash and generator version. Generation is deterministic, sorts maps where order is immaterial and preserves declared method order. The build fails on uncommitted drift.

The [documentation contract](contracts/aid-sdk.d.ts) freezes the principal SDK surface now. It is an implementation input and test oracle, not a claim that a package already exports it. The authoritative design input is [contract-source.json](contracts/contract-source.json). Its guest declarations, wire schema definitions, method metadata, state graphs and package/gate mapping generate the checked documentation artifacts through [design.py](tools/design.py). Positive and negative vectors are independent test inputs. W03 ports this input into the production IDL and emits cross-language codecs/proxies; the current documentation generator does not pretend to implement native routes.

## 2. Names, numeric rules and identities

Use camelCase for application/SDK JSON fields; MCP's own fields retain their published spelling. The host adapter performs the one mapping. Do not scatter snake/camel conversion across native code.

Identity strings are opaque, owner-bound and runtime-generation-bound. Decimal revision/time counters that can exceed JavaScript's safe integer range are decimal strings on the wire and `bigint` internally. Geometry, durations and bounded counts are finite JSON numbers. Reject NaN, infinities, negative durations, `-0` where canonical hashes depend on it, excess nesting and out-of-range rectangles before native allocation. A point always identifies a coordinate frame; a bare pair is permitted only inside an already-bound surface method.

Every effect envelope includes protocol revision, runtime generation, control ID/epoch, execution ID, operation ID, method and arguments. The trusted host derives device/project/thread ownership; the model cannot override those fields. Identical idempotency keys bind to the same canonical method/arguments/code hash; different content under the same key fails `REQUEST_CONFLICT`. RFC 8785 is the selected canonical JSON representation for hashes, subject to its supported number/string domain. [S30](29-research-register.md#s30).

## 3. Outer host surface

| Method | Meaning | Effect policy |
| --- | --- | --- |
| `open` | Open/reuse a named workspace and request a control episode under existing task approval | Workspace creation is local metadata; granting desktop authority is separately checked. |
| `exec` | Submit one named module cell with source, imports and budgets | Effects are checked per native method, not inferred from “exec” alone. |
| `inspect` | Retrieve execution/workspace state, receipts or approved artifacts | Read, owner checked; reading image bytes can require capture/export scope. |
| `respond` | Answer a live model checkpoint once; trusted UI separately resolves human approvals | Single-use, schema/epoch/dependency checked. |
| `close` | Cancel execution, release control, or close workspace explicitly | Idempotent cleanup; cannot expand authority. |
| `describe` | Return capability catalogue/types/limitations | Read; filter to supported and granted capabilities. |

MCP adapter names are `computer_open`, `computer_exec`, `computer_inspect`, `computer_respond`, `computer_close`, `computer_describe`. A dedicated `computer_cancel` is unnecessary: `close({apiRevision:"1.1",target:{kind:"execution",executionId}})` and native urgent revocation supply explicit cancellation. Protocol Tasks cancellation maps to the same host operation but retains MCP's weaker acknowledgement semantics.

`exec` accepts a caller idempotency key and returns an `executionId`. It may return immediately with a running handle, a complete result, or a decision packet after a bounded wait. It does not require holding HTTP for the whole script. `inspect` has a `sinceSequence` cursor; results report dropped/expired history and never fabricate continuity.

## 4. Inner devices and resource types

The SDK presents `App`, `Window`, `Element`, `Surface`, `Observation`, `Artifact`, `Watch` and `Receipt` resources. Each proxy stores an opaque handle and SDK metadata, not a native address. Proxy construction alone does not confer authority. Every call verifies resource generation and current grant.

`aid.apps.prepare` performs explicit launch/unhide/reopen/foreground intent. Read-only `list`/`get` do not silently launch. `Window.observe` returns immutable evidence; `Observation.query` reads that evidence; `Window.query` performs a scoped live query. This spelling avoids hidden freshness differences. `Element.refresh` revalidates rather than searching for a lookalike replacement. A selector query that finds multiple candidates returns them; `.one()` rejects ambiguity.

`Surface.point(u,v)` produces a typed normalized frame point. `Surface.pointer.stroke(points, options)` accepts points in the bound surface frame. `aid.pointer.click(elementOrPoint)` resolves the correct type; it never guesses whether numbers refer to screen pixels, window points or crop pixels.

Text typing is `keyboard.typeText`; shortcut input is `keyboard.chord`; physical key state is `keyDown/keyUp`. Pointer hold operations are paired with structured scopes; raw primitives remain available but held state cannot survive an execution terminal state, checkpoint or revoked control.

## 5. Effects and authority metadata

Each method declares one of: `pure`, `evidence-read`, `window-mutation`, `semantic-input`, `physical-input`, `clipboard-read`, `clipboard-write`, `artifact-export`, `supervisor`. These are classification inputs, not claims that every semantic input is harmless. A click can delete a file; the policy engine constrains targets/tasks and approval requirements.

A program can introspect available capabilities without receiving secrets. Examples: mouseButtons, relativeMotion, supportedScrollUnits, penPressure=false, observationFormats, minimumOSProfile, secureInputVisibility, clipboardAccessState. `supported`, `qualified`, `granted` and `currentlyAvailable` are separate flags. A private symbol's existence does not set all four true.

## 6. Wire framing and large data

Control messages use bounded UTF-8 JSON with a four-byte unsigned big-endian length on dedicated local byte-stream channels. Initial maximum control frame is 1 MiB; module source and large typed path buffers use an artifact transfer, not an ever-growing JSON field. Normal metadata, urgent revocation and artifact transfer use separate channels so a frame copy cannot block stop admission.

Artifacts are opaque read-only resources. A metadata result gives ID, MIME type, byte length, dimensions, SHA-256, expiration and evidence provenance. Ownership is retained in the trusted store; a model-supplied owner field is rejected. The host requests chunks on the data channel with a bounded 64 KiB chunk size and credit window. Received bytes are verified before publication. There is no model-accessible arbitrary URL/file-path fetch in the artifact service.

Inside the worker, Promise callbacks are indexed by call ID. The host/native bridge never receives a JavaScript function pointer or evaluates a user-supplied predicate. Predicates remain in the guest unless they are a recognized declarative query compiled by the trusted SDK. Frames/artifacts enter Wasm linear memory only for explicitly requested processing within the approved observation scope.

## 7. Errors and receipts

Error codes are stable symbolic values, not text matching. Required families: `UNAUTHORIZED`, `CONTROL_EXPIRED`, `RESOURCE_EXPIRED`, `STALE_TARGET`, `AMBIGUOUS_TARGET`, `FOCUS_CHANGED`, `USER_TAKEOVER`, `UNSUPPORTED_CAPABILITY`, `UNQUALIFIED_CAPABILITY`, `RESOURCE_LIMIT`, `CANCELLED`, `DEADLINE_EXCEEDED`, `REQUEST_CONFLICT`, `CHECKPOINT_EXPIRED`, `DELIVERY_UNCERTAIN`, `DEPENDENCY_CHANGED`, `INVALID_ARGUMENT` and `INTERNAL`.

An error includes phase, retry classification, execution/operation IDs and safe structured details. Retry classification distinguishes an unsubmitted read, a pre-dispatch input failure and possible delivery. Never automatically replay a prefix because the top-level HTTP status looks retryable. The error message helps an agent choose evidence; it does not authorize a fallback route.

Receipts contain separate submission/evidence/outcome fields and optional evidence references. A pure SDK helper does not synthesize `verified` from a native `submitted` response. [D16](16-journal-recovery.md) owns journal transitions.

## 8. Discovery and documentation

The initial model context contains a small SDK index, execution semantics, coordinate rule, effect uncertainty rule and a complete minimal example. `describe("pointer")` returns only that module's types, constraints and examples; `describe(resource)` returns its current capabilities and generation. Full raw schema remains retrievable for complex work. No hard limit on the model's creativity is imposed by progressive disclosure.

Discovery content is generated from the IDL and immutable per API revision; runtime capability status is a separate dated overlay. This permits prompt caching without lying about a runtime's current permission or availability. Source strings from the desktop are data and never merged into SDK documentation.

## 9. Implementation and acceptance

Proposed files: `packages/aid-contracts/idl/aid.idl.json`, `src/validate.ts`, `src/canonicalize.ts`, `scripts/generate.ts`; `packages/aid-sdk/src/generated`; `native/aid-contracts/Sources`; and cross-language golden fixtures. Existing `Resources/tools.json` becomes the v2 compatibility adapter input until cutover, not a competing new schema.

**API-01:** every device method has effect/capability/cancellation metadata. **API-02:** generated files byte-match on two clean machines. **API-03:** coordinate-free/mixed-frame inputs, non-finite values and over-limit frames reject before allocation. **API-04:** cross-owner and stale-generation handles reject even with correct IDs. **API-05:** method docs, TypeScript call and Swift route share one argument fixture. **API-06:** reordered equivalent object keys hash identically while changed arguments conflict. **API-07:** image and path transfers do not enter control logs or block revocation. **API-08:** unknown methods fail without dynamic dispatch to arbitrary Swift/Node symbols.

W02 freezes these contracts; W03 generates codecs and conformance fixtures before any device implementation is exposed. Public npm packaging is not part of this decision.

## Contract clarification: current-target facades and permissions

The root `aid.keyboard` facade is usable only after this execution explicitly established a target through successful `apps.prepare({foreground:true})`, `App.activate()` or `Window.focus()`. It does not follow arbitrary user focus. App/window-bound keyboard facades remain preferable for explicit code. `pointer.moveBy` is a relative displacement from the driver-confirmed current pointer within the active permitted frame, not an unframed absolute point.

`canRetryAutomatically` is false after any potentially effectful submission. A true value is reserved for clearly not-submitted failures or read-only retries within bounds; it is never generated from a lack of observed change. `Receipt.after` identifies the admitted operation barrier, not a promise that the application has completed its effects. Capability metadata for local combinators is not a bypass: all nested effects are authorized individually.


## 10. Exact design profile and codecs

The protocol-neutral request envelope is `{method,params}`. Every params object carries `apiRevision:"1.1"`. `exec` uses `source.kind:"text"`, `requestedBudget`, and a named cell; a control request uses `targetApps`. PID selectors require `launchIdentity`. `respond` uses `workspaceId`, `executionId`, `checkpointId`, `idempotencyKey`, and `answer`. Older `apiVersion/arguments`, `inline`, `apps`, `budget`, and `response` wire spellings are rejected, not compatibility aliases. `aid-wire.schema.json` is a byte-identical compatibility filename for `host.schema.json`.

Guest resources and serialized records are deliberately different layers. W03 implements these exact codecs and round-trip fixtures:

| Guest value | Wire representation and required check |
|---|---|
| `Point` / `SurfacePoint` | `kind:"point"`, frame ID, transform generation, x/y, and units resolved from the registered frame; verify generation and declared unit match; surface method also binds receiver surface ID. |
| `CoordinateFrame` | Wire frame ID/generation, units, bounds, optional parent and row-major six-number affine transform; the trusted frame registry retains runtime and observation lineage. Root frames use identity transform; resolve every nonroot parent under the same owner. |
| `Receipt.after` | Preserve `{operationId,sequence}` exactly; no conversion to a bare operation ID. Wire receipt additionally has sequence, phase and optional failure. Preserve warnings/timings and verification evidence. |
| `Artifact` / `ImageEvidence` | `ArtifactDescriptor` wire metadata uses Unix `expiresAtMs`, runtime generation and selected image dimensions; guest `expiresAt` is the ISO rendering of that value. Image/frame/crop lineage stays in the authorized observation store and is retrievable by observation ID. Methods never serialize. |
| `Observation` emission | Export a typed `observation` emission using `WireObservation`, plus separately selected image emissions. Preserve base, timing, coverage and frames; emitting a full observation does not silently send every cached image. |
| `RegExp` | Bounded `{kind:"regexp",source,flags}` for declarative selectors, or interruptible guest evaluation; never native executable code. Reject unsupported/duplicate flags and oversized patterns. |
| Callbacks / generic scopes | Opaque execution-owned completion slots in the worker queue. Functions stay in the guest; nested leaf calls are independently authorized. Slots expire on execution loss. |
| `Uint8Array` | Bounded artifact chunks/typed transfer with exact length, offset and digest; no JSON arrays masquerading as unlimited buffers. |

The guest surface retains `setBounds`, `buttonDown/buttonUp`, `play`, `withKeysDown`, `readText/writeText/pasteText`, `watchQuery/wait` and `inspectReceipts`. No parallel `moveResize`, `down/up`, `runTimeline`, `withModifiers`, `clipboard.withText`, `events.sleep`, or `execution.receipt` aliases are selected. Raw AX expansion (`Element.children({raw:true})`), application menus, focused-window lookup, crop/diff, and approved pure-module persistence remain expressible.

The native envelope's method string and arguments object are framing only. W03 must generate a closed per-method dispatcher from the catalogue and typed signatures, with receiver/resource/callback codecs above. Unknown methods, surplus fields and unsatisfied capability requirements reject before effects. A generic `arguments:object` validator is not sufficient production admission. API-05 cross-language fixtures are a blocking W03 exit criterion, not a claim this documentation-only generator already produces working Swift/Rust code.

The initial SDK also exposes explicit desktop/region observation, repeated key transitions and image clipboard write/paste. These preserve the originally requested screen/device breadth. `control.captureScope` defaults to `target-windows`; requesting `desktop` requires distinct host approval. Whole-desktop capture is a distinct approved scope; image clipboard bytes use authorized artifacts. The native mode policy still governs the actual route.
