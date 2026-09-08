# D04 — Execution isolation, processes and local IPC

## 1. Selected topology

Use three trust domains: the existing trusted Cozea host, an unprivileged generated-code worker, and a native device driver. The host owns task authorization and provider integration. The worker owns the JS realm. The driver owns AppKit, AX, capture and input. A stop/admission mechanism remains independent of worker scheduling.

The first engine implementation is **QuickJS compiled to core WebAssembly and embedded with Wasmtime in a sandboxed worker service**. The bridge uses explicit async request/completion queues, not a dependency on automatic JavaScript-to-WIT Promise glue. WASI 0.3 and the Component Model are useful qualification candidates for a later bridge implementation; they are not required to make v1 async calls work. This intentionally narrows the earlier speculative “WASI will solve the executor” assumption. [S03–S07](29-research-register.md).

No generated JS runs in Electron main, a Node utility process with ambient APIs, the native driver, or a renderer with privileges. `node:vm` is not the security boundary. Wasm protects guest memory/import access; host import bugs and engine bugs remain threats, so OS process restriction is an additional layer. [S08](29-research-register.md#s08), [S09](29-research-register.md#s09).

## 2. Bundled process layout

Proposed signed bundle:

```text
Cozea.app/Contents/
  MacOS/Cozea
  XPCServices/CozeaAIDWorker.xpc/
    Contents/MacOS/CozeaAIDWorker
    Contents/Resources/quickjs-guest.wasm
  Helpers/CozeaAIDDriver.app/
    Contents/MacOS/CozeaAIDDriver
    Contents/Resources/aid-profile.json
  Resources/aid-contracts/...
```

The worker is an App Sandbox XPC service with no networking, user-selected-file, Apple Events, or unnecessary App Group entitlements. Its own app container is an OS implementation detail, not exposed to guest imports. It uses a small Objective-C/Swift XPC entry shim around a Rust Wasmtime host. Code-signing requirements on both XPC peers restrict the expected product identities and team, with protocol/build hash negotiation in addition. Do not trust PID alone or invent a private audit-token dependency when a supported signing-requirement API suffices. [S23](29-research-register.md#s23), [S24](29-research-register.md#s24).

The driver is a normal unprivileged, GUI-capable nested app with a stable bundle identity. It is launched by the trusted native host bridge with a deliberately minimal environment and inherited channels, not as a root daemon or login item. Its AppKit run loop is live; `LSUIElement`/activation behavior must be verified rather than making it a non-GUI background executable and expecting overlays to work. The driver gets only the OS permissions actually necessary, through the normal system flow.

**Gate G01:** verify which signed process macOS attributes Accessibility/Screen Recording/Input Monitoring to on every supported topology. A helper does not inherit TCC authority merely because Electron loaded it. If this topology cannot satisfy the documented permission UX, keep the new runtime disabled until the specified alternative is qualified; never edit TCC storage or silently ship an ad hoc unsigned fallback.

## 3. IPC channels and authentication

For the spawned driver use three inherited, close-on-exec-managed local channel pairs: normal RPC, artifact transfer, and urgent control. Only the intended child descriptors survive spawn. There is no unauthenticated listening TCP port. Startup negotiates API revision, runtime generation, manifest hash and an unpredictable launch nonce sent over the inherited channel, not command-line arguments or the guest environment. Parent and child validate expected executable identity and the launch binding; the nonce is not exposed to JS.

The guest worker talks to the trusted host through a restricted XPC interface accepting only bounded typed messages/data. It cannot connect directly to the driver. The host fills in trusted principal/project/thread/control fields after checking current policy. Generated code may reference handle IDs but cannot mint a control grant or supply a newer epoch.

Urgent messages are a fixed small vocabulary: revoke control, stop execution, acknowledge quiescence, report liveness and driver health. They have their own queue and bounded frame size. The normal request parser cannot monopolize the urgent path. Every input dispatch checks an atomic revoked epoch even if a previously validated request is still queued.

## 4. Wasm/QuickJS embedding

Compile QuickJS without its CLI, filesystem/process/network standard modules or dynamic native loader. Provide only deterministic/policy-approved built-ins and typed imports for request emission, completion consumption, monotonic time, bounded logs and memory-safe artifact access. No raw Swift objects, Objective-C bridges, arbitrary addresses or borrowed native pointers cross into guest memory.

One Wasmtime Store and QuickJS runtime/context belong to one worker realm. The C guest adapter exposes allocation, module evaluation, pending-job pumping, completion delivery and safe inspection entry points. Bounds-check pointer+length arithmetic on every import, cap allocation before copying, and treat guest strings as untrusted UTF-8. Do not load untrusted QuickJS bytecode or Wasmtime serialized machine code; bundle compiler/engine outputs with the signed distribution and hashes.

Use Wasmtime epoch interruption for responsiveness and optional fuel accounting for deterministic fixture limits. A trap is terminal for the interrupted computation; do not claim arbitrary continuation after a trap. Graceful cancellation first revokes effects, then asks QuickJS to unwind through its interrupt mechanism; if quiescence cannot be established, terminate the worker. [S05](29-research-register.md#s05).

Component Model resources may eventually replace the custom call queue if G02 demonstrates equivalent semantics, cancellation, source maps and performance. The typed SDK/resource contract remains unchanged. Do not require a newly published component feature before first reliable pointer input is available.

## 5. Native concurrency and failure boundaries

AppKit and cursor views stay on the driver's main actor. AX IPC runs on bounded worker lanes, never on the display callback. Capture callbacks retain the latest frame and update small metadata, never encode or execute JS. Image conversion/encoding runs on a separate bounded queue. The input scheduler is single-writer and checks authority at each batch/sample transition. Swift actors protect state but re-enter at suspension; an explicit permit and generation checks define transactions. [S21](29-research-register.md#s21).

The driver must remain capable of processing revoke while AX blocks. Use per-object AX timeouts and separate stop state; cancellation cannot forcibly interrupt an OS call already inside the kernel/app. Classify its result and stop subsequent effects. Native crash cleanup is inherently weaker than normal cancellation; test it, report residual uncertainty and never restart effects automatically.

## 6. Memory and shutdown

Initial host limits: one worker per active workspace, a configurable maximum number of resident workers, 256 MiB guest memory each, bounded metadata queues, and explicit image-credit accounting. Pressure first suspends/evicts idle pure workspaces with warning, never takes away an active driver's stop capability. Workspaces that cannot be restored lose live heap state honestly.

Normal shutdown order: revoke new input; cancel execution children; release owned held state; acknowledge quiescence; stop owned capture; invalidate live handles; close channels; stop worker; stop driver when no controls remain. Abrupt channel loss triggers native liveness cleanup. Do not kill a driver before giving it a chance to release a button, except when it is itself unresponsive; that case is recorded as uncertain cleanup.

## 7. Qualification alternatives, not silent fallbacks

G02 first qualifies the core-Wasm QuickJS queue implementation. If only WASI/Component integration fails, retain core Wasm; no product semantics change. If Wasm overhead or hardened runtime prevents qualification, the predetermined alternative is **native QuickJS inside the same restricted XPC service**, with a separate security ADR and all tests rerun. That removes an inner sandbox layer and cannot be silently substituted by a release build. An unsandboxed Node evaluator is never an acceptable fallback.

The existing in-process Swift bridge can serve as a development comparison driver for fixtures. Shipping it as the new production topology requires its own ADR and fault/TCC review, not a hidden environment-variable workaround.

## 8. Implementation and proof

Files: `native/aid-worker`, worker XPC shim, proposed `CozeaAIDDriver` target in `native/computer-use-runtime`, narrow launch/channel additions to `native/computer-use-bridge`, and host adapters in `packages/aid-host`. Do not add effect/runtime dependencies across root and T3 boundaries casually.

**ISO-01:** guest cannot open a file/socket/process/Node global through any import. **ISO-02:** malformed lengths, prototypes and oversize messages cannot crash the driver. **ISO-03:** wrong-signed XPC peer and forged launch nonce reject. **ISO-04:** busy-loop guest does not delay native revoke. **ISO-05:** denied capture/input has no “helpful” alternate route. **ISO-06:** driver and worker crashes are distinguishable in receipts. **ISO-07:** signed relocated app works with intended TCC identity, no developer machine grants assumed. **ISO-08:** custom guest bytecode/native extension load is rejected. W04/W05 implement this boundary before model-generated code reaches a real target.
