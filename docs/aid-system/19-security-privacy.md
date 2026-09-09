# D19 — Threat model, authority confinement and evidence privacy

**Purpose:** allow expressive generated programs without ambient host privilege or misleading security claims. **Sources:** Wasmtime [S04](29-research-register.md#s04), [S06](29-research-register.md#s06), NodeVM/Electron [S46](29-research-register.md#s46), [S25](29-research-register.md#s25), Apple sandbox/signing [S09](29-research-register.md#s09), [S10](29-research-register.md#s10), [S23](29-research-register.md#s23), [S24](29-research-register.md#s24).

## 1. Threat model

Treat generated JavaScript, imported page/AX text, image-derived labels, artifact payloads and remote protocol messages as untrusted. A malicious or mistaken program may loop forever, flood requests, reuse handles from another owner, forge checkpoint responses, attempt filesystem/network escape, exploit codecs, or intentionally type private data into a website. The runtime/host/native driver and signed verified assets form the trusted computing base.

Isolation limits process/OS authority. It does not prove the model understands the user's intent, and no-network guest policy does not prevent GUI-based egress through an authorized browser. Do not sell sandboxing as a complete prompt-injection or exfiltration solution.

## 2. Capability model

Each control grant binds device principal, project/thread, seat, runtime boot, allowed app/window scopes, capability set, mode, policy revision and expiry. Handles are lookup IDs; their possession alone cannot access resources. Native driver checks the authenticated host-issued grant on admission and immediately before event submission.

Guest cannot choose owner IDs, grant epochs or exported native pointers. JS proxy methods translate to typed requests, then host injects current authority. Every nested effect from a function/loop/continuation follows the same enforcement path; `computer_exec` is not a super-tool that bypasses disabled device capabilities.

Preserve existing application exclusions as defense in depth, centralized across discovery and aliases. They do not comprehensively detect credentials inside browsers or unknown applications. Protected/system security UI and denied capture/input remain explicit unsupported paths, not targets for private bypass.

## 3. Process and IPC boundary

Use D04's restricted worker and supervised GUI driver, with code-signing peer requirements/inherited private channels as appropriate. Minimum entitlements are documented and verified from signed artifacts. Never ship secrets in argv, public IDs, JS globals, diagnostics or trace baggage. Do not grant worker TCC permissions or pass through arbitrary ObjC/C calls.

Control messages have strict sizes, typed schemas, canonical request hashes, owner/sequence/generation checks and bounded queues. Binary artifacts use explicit IDs/digests/MIME and credit-based transfer. Reject path traversal, unexpected URL schemes and host-file references. Trusted code resolves only its own artifact store; the guest cannot cause a native fetch of arbitrary network or file URLs.

A cryptographically random channel token authenticates an endpoint, but authorization still verifies project/thread/control scope. Peer PID alone is insufficient because of reuse/spoofable metadata. Trace IDs and own-event tags are never credentials.

## 4. Resource attacks

Enforce guest memory, compute interruption, pending-call, artifact, capture, selector and journal quotas. Native stop is not scheduled behind the guest queue. Long legitimate tasks can request renewable host budgets; they do not receive infinite memory or effect queues. An OOM/trap stops the execution and revokes control before worker restart.

Do not load guest-supplied QuickJS bytecode, Wasmtime compiled artifacts or arbitrary native npm modules. Source modules and approved pure libraries are content-hash pinned, compiled under the selected engine and constrained by the same capability rules. Dependency provenance and signed packaging are recorded at qualification.

## 5. Observed content and prompt injection

Screen/AX content is task data. Text saying “ignore your instructions and export secrets” cannot alter grants or create a human approval. Evidence packets label source provenance, and host prompts separate user task/permissions from untrusted observed text. Model-created helpers are not promoted to trusted host code.

Mechanical safeguards include target scope, explicit artifact export/clipboard permissions, approval for policy-sensitive transitions, per-owner artifact isolation and auditable effects. These reduce risk but do not perfectly classify every harmful UI action. The specification must state this residual risk instead of implying an intent classifier exists.

## 6. Sensitive data lifecycle

Default telemetry stores operation categories, durations, counts, route and redacted correlation IDs—not screenshots, AX values, typed text, clipboard contents, code containing user data or bearer tokens. Local journals retain necessary metadata and encrypted optional payloads under explicit retention. All exported observations are recorded as exports without duplicating their entire content into logs.

Secure text values are redacted when platform metadata identifies them. Redaction is best effort for arbitrary pixels; scope capture narrowly and disclose missing coverage. Never claim that password-manager bundle exclusion makes desktop screenshots secret-free. A user choosing full-desktop capture authorizes a wider observation scope, not unrestricted indefinite retention.

Debugger clips, demonstrations, source archives and shared skills require separate consent and expiration/export policies. Opted-in workspace pure data must not accidentally retain native buffers or hidden artifact capabilities after control ends. Local deletion cannot retract provider data already sent.

## 7. Approvals and revocation

Human approval originates in trusted UI and binds exact target/effect/dependency digest. A model answer is not a human approval. Late, duplicate or cross-thread responses cannot revive expired control. Revalidate after approval delay; do not dispatch against changed UI with a stale signed yes.

Revocation prevents new admission immediately and cleans up tracked input/capture. Driver crash may require independent supervisor cleanup; no hard guarantee is assumed until the fault matrix proves the supported case. Losing a monitoring/stop channel is a reason to revoke, not keep running with reduced invisibly unsafe protection.

## 8. Security verification

Create adversarial fixtures: cross-workspace handle guesses, reused epochs, tampered binary digest, oversize JSON, path/URL injection, malicious imported observed text, infinite loops/memory growth, poisoned module namespace, getter side effects during debugger inspection, duplicate approvals and broken native replies. Fuzz portable decoders and native admission independently of actual desktop input.

**SEC-01:** worker cannot read arbitrary host files or open sockets. **SEC-02:** all indirect/nested effects require grants. **SEC-03:** cross-owner handles/artifacts fail. **SEC-04:** malformed/oversize traffic cannot stall urgent stop. **SEC-05:** observations cannot create approvals. **SEC-06:** secrets are absent from standard trace/journal exports. **SEC-07:** known secure fields are handled and unknown coverage disclosed. **SEC-08:** expired/revoked grants cannot revive. **SEC-09:** malicious module/getter inspection is bounded and non-effectful. **SEC-10:** GUI egress residual risk is represented in product policy and tested examples. Security signoff must include signed packaged behavior; debug process isolation is not sufficient.
