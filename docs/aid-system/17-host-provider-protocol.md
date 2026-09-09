# D17 — Cozea host, provider adapters and stateless protocol integration

**Purpose:** preserve the native AID contract across T3, model providers, MCP revisions and asynchronous task lifecycles. **Baseline:** `ComputerUseRuntimeService.ts`, pinned T3 `computerUse.ts` at `be4668f7b439499f39a659055d0f6ec34ac666b2`, and Cozea's catalogue patch. **Sources:** [S01](29-research-register.md#s01), [S02](29-research-register.md#s02), [S48](29-research-register.md#s48), [S49](29-research-register.md#s49), [S50](29-research-register.md#s50), trace [S28](29-research-register.md#s28).

## 1. Protocol-neutral authority

`AidHost` owns workspace, control, execution, checkpoint, artifact and journal state. MCP requests locate those records through explicit IDs. A transport connection does not own the JavaScript heap or capture. Stateless transport also does not make a live Mac portable: requests must reach the right device/runtime generation.

Trusted Cozea invocation context supplies device principal, environment, project/workspace, thread, provider session/instance and logical task. Guest arguments cannot choose another principal or thread. Preserve the existing scheduled deny/master-disable checks, synchronous native revocation and anti-cross-thread behavior. Trace metadata is correlation, never a capability.

## 2. Outer tools and admission

Register the six generated tools from D02: `computer_open`, `computer_exec`, `computer_inspect`, `computer_respond`, `computer_close`, `computer_describe`. Tool descriptions explain programmable modules, visible UI mode, explicit evidence and uncertainty. A small outer schema avoids provider-specific flattening of the entire device API.

`computer_exec` returns a completed result when it finishes within the reply window, otherwise an execution handle/status or negotiated asynchronous task. Default synchronous reply window is 2 seconds; that is a response policy, not a two-second execution limit. Long native work remains controlled by the execution budget and host heartbeat. `inspect` retrieves status, pending decisions, receipts and requested evidence. `close` can cancel one execution, end control, or close workspace with explicit scope.

The legacy backend has a T3 30-second fetch timeout and host35-second call timeout. Both must be replaced by this split reply/execution model; merely raising one timeout is not the architecture. An HTTP client disconnect stops its response subscription, not automatically the active execution when the trusted host is still supervising. True host loss still triggers D05 liveness revoke.

## 3. MCP revision adapters

The 2026-07-28 core removes protocol session initialization/`Mcp-Session-Id` and supports application state through explicit handles. This is not evidence the currently pinned Effect/T3 server already supports that revision. Implement transport/version adapters against captured conformance vectors and an explicit compatibility manifest.

Native state is independent of adapter choice. A negotiated modern adapter uses the current spec. A host lacking extensions uses explicit execution/status/respond envelopes over its supported protocol. Do not pretend a legacy initialization handshake is absent while still depending on its implicit state. Keep revision-specific framing in one adapter, not scattered through the SDK.

No public npm distribution decision is required. Internal interface contracts and adapters are sufficient; future packaging can export them without changing desktop semantics.

## 4. Tasks and MRTR mapping

For negotiated Tasks, the task is a projection of an already durably registered execution. `tasks/get` must be able to find the task before its handle is returned. Input requirements during a task use `tasks/get`/`tasks/update` according to the adopted extension revision. Pre-task MRTR is a different transport flow and must not be confused with task updates.

Extension task statuses are not identical to AID execution statuses. A completed tool call may contain an application/tool error; protocol task `failed` has the extension-defined meaning. Keep a mapping table generated/tested from the pinned spec rather than inventing status names. Task cancellation acknowledgement is cooperative and may not establish physical stop. Map it to native revoke immediately, but only advertise `quiescent` after native cleanup acknowledgement.

A resumed input answer resolves a stored checkpoint once. It never retries `computer_exec` from the start or reconstructs its heap by replaying source. Duplicate protocol updates use D16's response-key semantics.

## 5. Provider image and result adapters

The same `EvidencePacket` is converted into the actual provider protocol, preserving tool-call IDs and provenance. An image artifact ID or base64 text embedded in a JSON string is not automatically a visual input. Each qualified provider must receive a real supported image content part and have a test showing the model can inspect it.

OpenAI Responses supports tool output that may be text or supported multimodal content; use its exact pinned shape and preserve `call_id`. Anthropic tool results use their specified message/content structure and matching tool-use IDs. Google's Gemini APIs have different surfaces: Interactions function-result content is not interchangeable with `generateContent` function-response parts. Select the adapter for the actual provider API/SDK in use, not the model marketing name. [S48](29-research-register.md#s48), [S49](29-research-register.md#s49), [S50](29-research-register.md#s50).

The user's Gemini model may be reached through an existing Cozea provider kind. Do not invent a new provider type solely for a model identifier. Test the real chain, including T3's result handling and any intermediate CLI. A wrapper that strips images must report a capability limitation rather than claiming screenshot support because native PNG generation works.

## 6. Same-model continuation scheduling

`AidTaskBinding` relates logical AID work to individual provider turns. When a model-decision checkpoint is emitted, return the pending execution/evidence and enqueue a continuation through the provider's existing orchestration mechanism. The next model response should call `computer_respond`; it must not independently call a duplicate `exec` prefix.

The existing `thread.session-set` terminal hook remains relevant for true task end, but must distinguish intentional AID checkpoint transitions. Late old-turn events are epoch-bound. User stop, thread deletion, fatal provider termination or policy denial remains authoritative and closes control. Do not keep recording forever because a stale checkpoint record forgot to expire.

Provider capability manifest includes images, structured tool outputs, asynchronous tasks, same-context continuation, tool result size, supported MCP revision/extensions and schema restrictions. All entries begin `unqualified`; a protocol fixture and live tool-result test promote each capability individually.

## 7. Trace and lifecycle events

Propagate permitted W3C trace context through host invocation, workspace cell, native operation and capture. Native signposts carry a redacted correlation ID plus phase; the host assembles traces with clock-domain metadata. Do not forward arbitrary baggage containing secrets or treat trace relationships as guaranteed causality.

Host UI receives a bounded typed event stream: execution state, target, operation summary, checkpoint, stop state and explicit evidence links. Logs are not the transport. Backpressure may coalesce progress updates but not drop terminal, permission or uncertainty events. Reconnect uses journal sequence and an explicit gap marker.

## 8. Cozea changes and tests

Keep `ComputerUseRuntimeService.ts` as a thin compatibility/lifecycle facade during development, routing to `packages/aid-host`. Replace the effective tool catalogue through a source-controlled integration module or deterministic reviewed patch, not by editing generated installed files ad hoc. Changes in vendored T3 require a deliberate source commit/gitlink or an exact documented patch manifest and validation; do not repin Effect packages to solve unrelated types.

**HOST-01:** six tools match generated contracts and policy. **HOST-02:** execution outlives reply window but not lost-host authority. **HOST-03:** explicit tool result images reach each provider. **HOST-04:** same-context checkpoint resumes once. **HOST-05:** duplicate task/response delivery does not replay effects. **HOST-06:** terminal turn hooks respect epoch/task bindings. **HOST-07:** unsupported extension negotiates the explicit-envelope adapter honestly. **HOST-08:** scheduled denial cannot be bypassed through `exec` or nested devices. **HOST-09:** cancelled task shows stopping until native quiescence. **HOST-10:** old nine-tool catalogue cannot accidentally coexist as an unguarded alternate path after cutover. Gate G03 includes real pinned T3 bundle tests, not mocked schemas alone.


Provider-path qualification must distinguish ordinary Anthropic client tool results (which can contain supported image blocks) from its programmatic-tool-call answers (text-only). Keep AID image-bearing checkpoints on the former or another explicitly qualified image pathway. No descriptor-to-text fallback may be reported as image delivery. [S49](29-research-register.md#s49).
