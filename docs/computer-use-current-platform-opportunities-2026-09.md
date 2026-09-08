# Programmable AIDs: current platform opportunities (2026-09)

## Purpose

This note records current protocol/platform developments that may materially improve the `feat/programmable-aids-runtime` design. It is research input, not an implementation claim. The product/runtime target remains `docs/computer-use-programmable-aids.md`.

## 1. MCP 2026-07-28: stateless protocol, explicit stateful AID handles

The 2026-07-28 MCP specification removes the protocol-level initialize/session lifecycle and `Mcp-Session-Id`. Requests are self-describing. Stateful applications are still explicitly supported by returning an application handle and passing it back on later calls.

Target Cozea mapping:

```text
stateless MCP request
  -> aid_session_id
  -> stateful local AID runtime
       - persistent JS realm
       - application/window handles
       - cursor state
       - warm capture ownership
       - spatial/gesture handles
       - input ownership
```

Do not couple AID lifetime to an MCP transport connection. Distinguish at least:

- MCP request identity;
- agent turn identity;
- AID session identity;
- JavaScript execution identity;
- window/application handles;
- observation/spatial handles.

Candidate public MCP surface may become very small (`computer.open`, `computer.exec`, `computer.close`, plus discovery/diagnostics), while the general computer API lives inside the programmable AID SDK.

Source: https://blog.modelcontextprotocol.io/posts/2026-07-28/

## 2. MCP Multi Round-Trip Requests (MRTR): user confirmation without persistent transport sessions

MCP 2026-07-28 introduces Multi Round-Trip Requests. A server can return `input_required`, the client gathers an elicitation/confirmation, and then retries the original request with the response and opaque request state.

Potential AID use:

- a JavaScript program reaches a destructive or sensitive UI action;
- native execution pauses before dispatch;
- MCP returns a confirmation request;
- the human approves/denies;
- execution resumes against the same explicit AID/application state handle.

This is a strong fit for visible, user-supervised computer control because confirmation no longer requires a permanently open bidirectional MCP connection.

Source: https://blog.modelcontextprotocol.io/posts/2026-07-28/

## 3. MCP Tasks extension: long-running visible `computer.exec`

The official `io.modelcontextprotocol/tasks` extension allows a `tools/call` to become an asynchronous task with `tasks/get`, `tasks/update`, and `tasks/cancel`.

Potential AID use:

- long JavaScript programs containing multiple cursor journeys/waits do not need one held HTTP request;
- task identity is separate from AID session identity;
- cancellation can map directly to native input cleanup;
- execution status can expose the last completed AID operation without returning screenshots continuously.

Do not use the MCP task as the implicit computer state container. The AID session remains an explicit application handle.

Sources:
- https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

## 4. MCP Trace Context + OpenTelemetry: empirical end-to-end latency attribution

MCP 2026-07-28 documents W3C Trace Context propagation in request `_meta` (`traceparent`, `tracestate`, `baggage`).

Use this to correlate one model-facing operation across:

```text
model/host
 -> MCP request
 -> Electron broker
 -> JS AID executor
 -> Swift native runtime
 -> cursor travel
 -> input dispatch
 -> AX/capture observation
 -> image encoding
 -> final result
```

Cozea already has native signposts. The target is one trace ID across the entire stack so future performance claims are measured rather than inferred from wall-clock task duration.

Source: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

## 5. MCP full JSON Schema 2020-12

MCP 2026-07-28 lifts tool schemas to full JSON Schema 2020-12, including composition, conditionals, `$ref`, and `$defs`.

This matters less once `computer.exec` becomes the main interface, but remains useful for precise schemas for `open`, `exec`, `close`, task/confirmation envelopes, capability discovery, and structured results.

Source: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

## 6. WebAssembly Component Model / WASI 0.3: candidate isolation boundary for agent JavaScript

WASI 0.3 was ratified on 2026-06-11. It adds native async functions, streams, and futures to the WebAssembly Component Model. Wasmtime denies guest access to system resources by default unless the host explicitly provides capabilities.

This is highly relevant because the target requires free-form programmable JavaScript but `node:vm` is not a security boundary.

Prototype direction:

```text
agent JavaScript component
  imports only typed AID capabilities
     apps/windows
     pointer
     keyboard
     observation
     timers/math
  NO implicit filesystem/process/network/Node/Electron access
```

WIT resource handles also map naturally to `app`, `window`, `surface`, and observation handles. WASI 0.3 native async could let those host capabilities expose Promise-like operations without embedding a second event-loop protocol.

This should be prototyped before commitment because JavaScript guest-toolchain support for WASI 0.3 is still landing across the ecosystem.

Sources:
- https://bytecodealliance.org/articles/WASI-0.3
- https://component-model.bytecodealliance.org/reference/faq.html
- https://component-model.bytecodealliance.org/running-components/wasmtime.html

## 7. Swift 6.3 `@c`: simplify the native ABI boundary

Swift 6.3 (released 2026-03-24) adds `@c`, which can expose Swift functions/enums through generated C declarations.

Cozea currently maintains an explicit C ABI bridge between the Swift runtime and Rust N-API layer. During the AID runtime refactor, evaluate whether `@c` can remove boilerplate and reduce mismatch risk without sacrificing the deliberately versioned ABI boundary.

Do not change the ABI solely because the feature exists; prove generated-header stability and packaged Electron loading first.

Source: https://www.swift.org/blog/swift-6.3-released/

## 8. Swift 6.2/6.3 concurrency and testing improvements

Swift 6.2 introduced more approachable concurrency, named async task debugging, opt-in strict memory-safety checking, typed NotificationCenter APIs, transactional Observation streams, and better Swift Testing support. These features can improve the implementation quality of the persistent native AID runtime even though they are not product features.

Potential uses:

- explicit concurrent/off-main capture and encoding;
- easier tracing of cursor/input/capture tasks;
- typed lifecycle notifications instead of stringly notification glue;
- repeated/flaky native input tests;
- strict-memory-safety audits around private SPI/C interop boundaries.

Source: https://www.swift.org/blog/swift-6.2-released/

## 9. Newer ScreenCaptureKit screenshot APIs: conditional optimization path

Current Apple SDK documentation exposes `SCScreenshotConfiguration` / `SCScreenshotOutput` and `SCScreenshotManager.captureScreenshot`, with controls including output width/height, PNG/JPEG/HEIC content type, source/destination rects, cursor inclusion, child-window inclusion, clipping/shadow behavior, and SDR/HDR output.

Potential benefits:

- request model-appropriate dimensions/format directly;
- avoid some custom resize/encode work on supported OS versions;
- capture a requested region without always encoding the full target window;
- explicitly control child-window inclusion when sheets/popovers matter;
- explicitly omit the physical cursor from model screenshots when the Cozea cursor is rendered separately.

The branch supports macOS 14+, so any newer API must be availability-gated and benchmarked against the warm-stream path rather than replacing it blindly.

Sources:
- https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration
- https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager

## 10. ScreenCaptureKit rolling clip buffering: future temporal-observation/debug capability

Apple's current SDK documentation includes beta `SCClipBufferingOutput`, which can attach to an active `SCStream` and retain a rolling buffer of recent capture content (documented up to 15 seconds) for export on demand.

This is not required for v1 of programmable AIDs, but may later be useful for:

- debugging ambiguous input delivery with a short visual trace;
- producing reproducible live-test evidence;
- future temporal/multimodal observation where a still image cannot explain what happened.

Do not make release behavior depend on the beta API.

Source: https://developer.apple.com/documentation/screencapturekit/scclipbufferingoutput

## 11. App Intents 2026 improvements: optional semantic/hybrid AID

Apple's June 2026 App Intents updates add richer schema integration, stable cross-device entities, ownership-aware confirmation, and additional system representations.

For apps that expose App Intents, Cozea could optionally surface a semantic capability alongside visible GUI control. This must remain explicit hybrid execution; it must not secretly replace a visible pointer/keyboard task while pretending the GUI performed it.

Sources:
- https://developer.apple.com/documentation/Updates/AppIntents
- https://developer.apple.com/documentation/AppIntents/app-intents

## Priority recommendation

Near-term implementation priority:

1. **Adopt the MCP stateless/application-handle architecture in the new AID interface.**
2. **Design `computer.exec` so it can map to MCP Tasks and MRTR without changing the local AID state model later.**
3. **Prototype a Wasmtime/WASI 0.3 capability sandbox for free-form JavaScript before choosing a JS execution engine.**
4. **Propagate MCP/W3C trace context into existing native signposts before performance tuning.**
5. **Evaluate Swift 6.3 `@c` while touching the native ABI, but do not rewrite a working boundary for aesthetics.**
6. **Availability-gate and benchmark newer ScreenCaptureKit screenshot APIs; keep the persistent turn-scoped SCStream architecture as the baseline.**
7. Treat clip buffering and App Intents as optional later capabilities, not core dependencies.
