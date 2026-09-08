# D03 — Persistent JavaScript workspaces and execution semantics

## 1. Design choice and research boundary

Use **named ES-module cells** in a resident JavaScript realm. QuickJS is the first engine candidate: its published manual documents modern ECMAScript modules, promises, embedding and resource controls. It does not supply an entire Cozea notebook, a safe host API or transparent persistence after process death. Its `std`/`os` CLI modules must not be exposed. [S03](29-research-register.md#s03).

The target is full language expressiveness inside an explicit capability environment. Do not implement a whitelist of loops, syntax fragments or named tasks. A module cell may compute arbitrary geometry, define closures/classes, compose async calls and create reusable helpers. It receives `aid` through the only built-in effectful import, `aid:runtime`; pure versioned modules come from `aid:math`, `aid:geometry` and approved source modules.

## 2. Module-cell contract

Each `exec` supplies `cellName`, source text, an idempotency key and optional requested budget. Admission creates a unique `executionId` and unique engine module URI `execution:<id>/<cellName>.mjs`. A new idempotency key deliberately runs a new module even if the source text is identical. Repeating the same idempotency key attaches to the prior execution instead of running again.

At admission, resolve every `workspace:/name` import to the current successful revision and freeze that mapping in the execution record. A running program is not hot-swapped when another revision is published. Remote URL, filesystem, package-name and native shared-library imports are rejected by the host module loader. A model may request source from an approved workspace/module registry; the source still runs under the same guest capabilities.

A successful module cell publishes its export namespace under `workspace:/cellName` with an immutable revision ID. Later cells can import exported functions and objects. Example:

```javascript
// Cell "geometry"
export function circle(cx, cy, r, n = 80) {
  return Array.from({length: n + 1}, (_, i) => {
    const t = 2 * Math.PI * i / n;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
}
```

```javascript
// A later cell, without rerunning the geometry cell.
import { circle } from "workspace:/geometry";
import { aid } from "aid:runtime";
export const points = circle(0.5, 0.5, 0.2);
await aid.execution.emit({kind: "text", text: `${points.length} points ready`});
```

Non-exported lexical bindings remain private to that module and may live as part of exported closures; they are not automatically global notebook names. Duplicate lexical declarations are allowed across separate cells. Rebinding a published name requires a new successful cell revision. This explicit rule avoids the false promise that a disposable async wrapper preserves arbitrary `const` declarations.

## 3. Failure and heap semantics

Publishing a namespace is conditional on successful module completion, but JS heap mutation is not a transaction. A failing cell may already have mutated an object imported from a previous module or produced desktop effects. The host records `failed` and the last operation receipt; it does not roll back imported objects or re-run the cell. A workspace inspection identifies the failed revision and any published modules it depended on.

An import refers to an already evaluated resident module namespace. Loading a saved source file into a fresh worker does not reproduce its old live state. Pure saved helpers are explicitly marked `pure-init` and verified to request no device effects during module initialization; otherwise their initialization requires normal execution authorization. There is no automatic replay of effectful module initialization on restart.

Handle proxies captured by functions remain bound to their runtime/control generation. A future control episode may reuse the pure geometry helper, but a closure holding an old `Window` must fail with `RESOURCE_EXPIRED` until the program explicitly acquires a new handle. Do not silently resolve by title to a different window.

## 4. Event loop and async device bridge

Run one engine thread per resident workspace worker. A Promise-returning native SDK call allocates a monotonically increasing guest call ID, serializes a typed request and returns immediately. The trusted worker transfers it to the host; no native effect is performed directly by guest memory access.

Responses are queued into a bounded completion channel. On the engine thread, resolve/reject the corresponding Promise, then pump pending ECMAScript jobs under a compute quantum. Never call into a JS context concurrently from XPC/IPC callbacks. Rejected native calls are ordinary structured errors; cancellation remains effective even if JavaScript catches and ignores the error because the native control epoch is revoked.

Timers are SDK-owned asynchronous waits with monotonic deadlines. `setTimeout` may be provided as a compatibility convenience backed by the same scheduler, but process timers, `process.nextTick`, Node globals and browser DOM globals are absent. Microtasks have a job quantum; an endlessly self-replicating Promise chain must not starve revocation or host state reporting.

Full ECMAScript computation does not imply a browser API implementation. `Intl`, WebCrypto, streams or other non-core facilities are exposed only if the selected engine/built-ins actually implement them. `describe` states the language profile and available standard-library subset rather than pretending QuickJS is Node or Chrome.

## 5. Structured concurrency

One module execution may perform parallel pure computation and independent observations. Physical effects are serialized by the native seat permit, not by their Promise creation order alone. For coordinated keyboard/pointer channels, use a native timeline; do not race two unrelated `Promise.all` effects.

Each SDK request belongs to an execution-owned child scope. Execution completion waits for admitted child effects to settle or cancels unawaited children. A Promise deliberately detached with `void` does not gain a background control lifetime. A watch can remain live across cells only as a workspace resource with no effect authority; automatic reactions require an active execution/control binding.

Raw button/key holds are tracked by the native driver. A program returning while holding a button triggers cleanup and an explicit receipt warning. A model/human checkpoint is rejected until held input is released or the caller uses a structured release boundary. Arbitrary callbacks are not allowed to extend a held gesture across an inference wait.

## 6. Budgets and scheduling

Initial qualification defaults are 256 MiB guest linear-memory ceiling, a 10 ms compute quantum, 64 pending device calls, 256 queued completion records and a 120-second execution wall budget, extendable by the host under active task authority. These are versioned resource policy, not API expressiveness limits. Large geometry can be streamed as checked path chunks without one enormous JS array.

Account compute, waiting and native input time separately. Model/human checkpoint time does not consume the active compute allocation, but consumes checkpoint/control retention leases. CPU/fuel limits do not stop a hanging native host call; every host request has its own deadline and driver cancellation. Memory exhaustion marks the workspace lost when the engine cannot recover reliably; it cannot leave live native input running.

The host may renew a legitimate long-running execution from independent task liveness. It may not grant infinite background control just because a loop produces logs. Guest logs are bounded text records, escaped by the UI, with dropped-count metadata.

## 7. Workspace inspection and persistence

`inspect({workspaceId})` returns published module names/revisions, execution states, source references and safe export summaries. It does not evaluate arbitrary getters or invoke functions while enumerating values. Inspect property descriptors; summarize proxies by handle kind/generation. Limit nesting, cycle size and string length with an explicit truncation indicator.

During a pending execution checkpoint, only typed `respond` and metadata inspection are allowed in the same realm. A second mutating cell is queued/rejected `WORKSPACE_BUSY`; it must not modify variables behind the suspended program's back. Debugger suffix replacement is a separate safe-boundary operation defined in D23.

Persist only opted-in source modules, JSON-compatible pure data and metadata under the existing local app storage policy. Never serialize AX handles, live promises, native pointers or active authority. After restart, open a new realm, load approved pure state, and require re-observation/control reacquisition. Explain lost continuations plainly.

## 8. Files and test contract

Proposed files: `packages/aid-sdk/src/runtime/{proxy,errors,execution,modules}.ts`, `native/aid-worker/src/{engine,modules,jobs,budgets}.rs`, bundled QuickJS guest source and a locked build manifest. Engine-specific C symbols belong behind a tested adapter; do not expose them in the public SDK. Source maps follow the standard source-map format, with cell URIs retained in error locations. [S29](29-research-register.md#s29).

**JS-01:** export a closure, import it in two later cells, and verify state persists without re-evaluation. **JS-02:** duplicate cell-local `const` names do not collide. **JS-03:** a failed cell publishes no new namespace but reports already executed effects. **JS-04:** identical idempotency key never repeats an effect; a new key intentionally can. **JS-05:** denied filesystem/URL/native-module imports fail. **JS-06:** infinite loop and infinite microtasks are independently interruptible. **JS-07:** checkpoint resume preserves local variables without replay. **JS-08:** worker death expires promises/handles and cancels control. **JS-09:** exports inspection does not execute getters. **JS-10:** image-result Promise carries an artifact reference, not base64 copied into every heap snapshot. Gate G02 qualifies these before a model can run generated code on a real desktop.

## Contract clarification: runtime facade and module environment

The imported `aid` facade resolves the current host-established execution context when a method is called. It does not capture and transfer an old grant simply because a pure exported function retained the facade. Actual app/window/surface proxies remain bound to their minted runtime/control generation and expire accordingly. A saved helper can call the current facade to reacquire targets; it cannot make a retained old native handle valid.

Host job evaluation and watch predicates run in explicit guest subscopes. Predicate evaluation receives no effect-admission scope even when its parent execution can write input. Do not trust a guest boolean claiming it is outside predicate mode; the embedding/host scheduler owns the request context and enforces the scope.
