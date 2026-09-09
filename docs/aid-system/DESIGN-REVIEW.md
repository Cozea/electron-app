# Design completion review — 2026-09-09

This review resumes the actual branch at `bd3f1ea2b29475312c3bf7a1f840a554788bb2a6`. It distinguishes the recovered 27-subsystem corpus from newly completed supporting material. It does not rely on the earlier empty downloads or on an export-only workflow being green. The validation JSON produced by `tools/design.py check` records the exact checked source hashes; the export additionally requires a clean committed checkout and compares every file with `git show` at that commit.

## 1. Original intent and implementation coverage

The design remains a programmable environment over general computer devices. The native runtime does not implement “draw a dog,” “skip ads,” or task-specific commands. The agent writes those procedures, retains useful pure code, requests judgment when needed and drives real visible interaction. The initial implementation is inside Cozea; public npm/MCP packaging remains a later product decision.

| Original design point | Owning implementation design | Contract and prescribed evidence |
|---|---|---|
| Device programmability instead of a fixed task catalogue | D01–D04 | `Aid`, modules and general device interfaces; API/JS acceptance; G02/G09 |
| Discoverable JavaScript SDK, ordinary computation and reusable procedures | D02/D03/D21 | 78 guest method signatures; explicit exports and frozen imports; positive navigation/drawing cells; G02/G10 |
| Pause for same-agent judgment and resume once | D06/D16/D17 | `decide`, checkpoint/result schemas, duplicate/null/conflict tests; CP/JRN cases; G02/G03/G04 |
| Queryable, attention-directed evidence | D07–D09 | `Observation`, `Coverage`, frame/crop/base identities and authorized artifact transfer; OBS/AX/CAP cases; G06/G07 |
| Agent-written local sensors | D10 | `Events.until`, `watchQuery`, bounded read-only evaluations and stable observations; WATCH cases; G06 |
| Expressive physical devices and low-level access | D12/D13/D15/D26 | `Pointer`, `Keyboard`, `Timeline`, explicit clipboard; native input and IME fixtures; G05/G12 |
| Meaningful spatial references and action-specific validity | D11 | Framed points, `SurfaceBinding`, semantic versus spatial fingerprints; status/ink/zoom/focus cases; G06 |
| Native coordinated timelines | D12 | Ordered pointer/key/condition channels, overload policy and per-event revoke fence; MOTOR cases; G04/G05 |
| Truthful visible cursor without fixed ceremonial delays | D14 | Real tip origin and shared event/presentation schedule; 60–250 ms calibration target; CUR cases; G05 |
| Separate memory, authority, execution and recording | D05/D09/D19 | Workspace/control/epoch/observation identities; warm owner tests and separate retention; G04/G07/G08 |
| Useful failures, journals and recovery | D16 | Submission/evidence/outcome; operation barriers; active-generation admission index; 67 schema/semantic vectors plus retention models; G04/G08 |
| Expressive sandbox with independent stop | D03/D04/D18/D19 | QuickJS/core-Wasm candidate, bounded queues and isolated worker, native supervisor; G01/G02/G04/G08 |
| MCP outside the control loop | D17/D27 | Six host operations, separate negotiated protocol profiles and provider images; G03 |
| Procedural memory, planning, debugger, demonstrations, seats and richer devices | D21–D26 | X01–X06 retained individually; per-feature G10–G12 procedures |
| Prove infrastructure overhead separately from model performance | D20/D30 | Matched A-native/B-JS procedures, C-model outcomes, held-out apps, p95 and overhead budgets; G09 |

The roadmap's W01–W35 and X01–X06 identifiers are retained. W04/W05 perform early feasibility experiments with fake effects. W29 depends on W32's signed packaging; numeric IDs do not impose a serial implementation order. G01–G09 are core gates; G10–G12 govern extension claims. All runtime qualification records start `not_run`.

## 2. Reconciled decisions and changed owners

| Finding at the checkpoint | Resolution in the owning files | Verification |
|---|---|---|
| Two revision-1.1 host vocabularies | D02/D31 select `{method,params}`, `apiRevision`, `text`, `targetApps`, `requestedBudget`, `answer` and PID+launch identity | One source generates SDK wire types and all schema files; legacy variants have negative vectors |
| Two generators disagree on SDK methods, W IDs and gates | `contract-source.json` is the design input; one `design.py` pipeline; old commands only delegate | Deterministic drift check; compiler AST includes methods inside inline `Aid` groups; D28 prerequisites checked against manifest |
| Alternative SDK omitted useful operations | Retain original richer SDK; add explicit menu/raw children/focus/crop/diff/approval/pure-module persistence | 78 signatures classified; actual `aid:runtime` module resolution and consumed negative type expectations |
| Two D31 files claimed authority | `31-design-reconciliation.md` owns decisions; former path redirects; unique pure-init/inspection/attention rules merged | Historical text remains at the checkpoint; source preservation is reviewable in Git |
| D05 and D31 disagree on heartbeat | Keep D05's 2-second heartbeat/10-second lease profile | Same values in both owners; runtime timing still G04 |
| State names disagree across subsystems | D05 execution/control, D06 checkpoint and D09 capture now use the generated graphs | Reachability, terminal-edge and status-shape checks; UI projections remain explicitly separate |
| D31 and MASTER journal after preparation | Durable possible-dispatch boundary precedes launch/activation/window mutation/real pointer approach | D12/D16 ordering preserved; contact prevented after approach still records the earlier effect |
| Clipboard restoration falsely described as atomic CAS | D13 policy propagated to SDK, W12 and G05: off by default; opt-in best effort with detected-write skip | Primary NSPasteboard semantics reviewed; concurrent writes remain a declared limit |
| W08 retry-window tombstone could permit replay after eviction | Retain admission index until namespace closure; reject new admission at quota | Original six retention tests retained; response expiry/old retry/quota/closed namespace cases |
| Checkpoint test used null as “unanswered” | Explicit claimed flag and stored answer digest | New JSON-null duplicate/conflict tests |
| Nested receipts bypassed semantic checks | Recursively validate counters, evidence and execution linkage | Nested evidence mismatch and UInt64 overflow negatives |
| Waiting/terminal result constraints disappeared in later schema | Restore matching checkpoint kind and quiescence; lost/failed cleanup can remain unknown | Missing/wrong checkpoint, held wait, terminal checkpoint, complete-not-quiescent and lost-cleanup fixtures |
| Capture reference model could free pending startup too early | Lifecycle start reservation outlives frame borrowers; late orphan start stops its own generation | Dedicated late-start-after-last-borrow case; D09 and G07 retain real async race qualification |
| Research numbers point to unrelated APIs | Rebind citations by the API/topic in each sentence, with a recorded mapping | Exact S anchors; provider, NodeVM, clipboard and policy-code entries added rather than made-up D anchors |
| Later notes incorrectly imply July MCP release may not exist | Published release and Tasks profile confirmed; T3 deployment remains unqualified | D29 primary sources and D17 profile mapping; no universal protocol-method assumption |
| Export/check workflow mutated sources and could package pre-commit output | Read-only check/export; clean committed source required; per-file `git show` comparison | Check preserves source hashes; ZIP reopened and compared, including reading edition |

## 3. End-to-end semantic traces

### SCE-01 — Draw, pause, move window, duplicate answer, crash

1. W11/W13 input timelines run under W07's seat permit and current epoch. W08 records possible dispatch before effects and completed stroke receipts afterward. Three completed strokes remain three completed effects, independent of a later failed cell publication.
2. W24 joins/cancels conflicting children and confirms all automation holds released. It creates one pending checkpoint with exact execution/worker generation, frozen evidence, schema and surface dependency digest. The live Promise and local variables remain resident; model evidence is emitted through W25/W26.
3. Moving the window changes the spatial dependency. Physical user takeover also revokes authority; neither event changes the identity of the original observation. Expected ink alone would not invalidate the surface.
4. The first schema-valid response is durably accepted once. Revalidation rejects the pending Promise with `DEPENDENCY_CHANGED` or `CONTROL_EXPIRED` as appropriate. A null answer is processed exactly like any other JSON value. Reverting the window afterward does not turn the recorded rejection into a resumption.
5. An identical response returns the saved disposition; a conflicting one fails `REQUEST_CONFLICT`. A crash then marks the live workspace/continuation lost. Its source, saved pure data and journals may remain. No reconstruction replays the first three strokes.
6. A new deliberately admitted execution can inspect the current canvas and reacquire a target. Its control and effect IDs are new. G02/G03/G04/G06/G08 must verify the full trace on the signed fixture; small model tests only cover individual boundaries.

### SCE-02 — Capture start races revocation and replacement

The registry reserves capacity and owner A for generation 7 before starting a stream. It tracks the pending startup separately from frame borrowers. Revocation prevents new generation-7 publication immediately, marks it retiring and cancels/drains borrowers. Owner B reserves generation 8; it cannot resurrect 7. A late successful start for 7 is stopped using its own stream handle, then its reservation is released. Its callback cannot remove 8, return A's pixels to B, or double-release a retained buffer. All pending starts/stops count against capacity. An encode finishing after revoke fails export authorization even if its pixels were captured earlier. Owners, borrowers, callback generation and artifact authorization are jointly required by D05/D09/D19 and G07/G08.

### SCE-03 — Possible contact, lost response and expired detail

The journal records possible dispatch before the first external effect. A process/transport failure afterward cannot establish `not_submitted`. A retry with the original scoped key attaches to the admitted execution, and a changed digest conflicts. Expiring images/logs changes history availability, not admission identity. At index quota, new work fails before submission while existing retry keys still resolve. Closing a workspace generation makes its namespace unavailable; opening the same human name creates a new generation. No fallback backend, recapture under an old observation ID, Undo or prefix replay is automatic. JRN-01/02/03/07/10 and retention models are the design oracles; G04/G08 supply live evidence.

### SCE-04 — Native stop while JavaScript or AX is blocked

Native epoch revocation does not wait for the guest, renderer, image encoder or an AX reply. The urgent path stops new admission and scheduled activating samples; cleanup releases only automation-owned state. The seat guard is explicit and non-reentrant across awaits. A late worker completion cannot renew the grant. An already posted OS event may still finish in the application. `stopping`, expired authority and confirmed `quiescent` are separate facts. Lost/failed/interrupted execution can report `quiescent:false` while the supervisor is unreachable; completed/cancelled cannot claim successful cleanup prematurely. G04 measures stop and release latency separately from application outcome.

### SCE-05 — Retained helper and changing evidence

A successful `geometry` cell publishes an ellipse function; private locals remain private and imports freeze to the admitted revision. A later cell imports that function without reevaluating the module. Failed-cell heap mutations are not rolled back. Pure persisted source initializes with effects denied; inspector access never invokes getters or Proxy traps. After control close, all old native proxies expire and recording stops, although the helper remains under retention policy. The next cell reacquires the application, observes the current surface and binds fresh geometry. A live watch can react locally, but it has read-only bounded evaluations and its resulting action checks the target again. D03/D05/D10/D21 and G02/G04/G06/G10 cover this trace.

### SCE-06 — Provider input and approval boundaries

The adapter retains AID execution/checkpoint IDs independently of provider call IDs and MCP task IDs. Model judgments return to `decide`; human approvals arrive only through the trusted UI. Older negotiated MCP lifecycle handling remains intact; 2026-07-28 MRTR retry and Tasks update use distinct protocol flows but attach to the same local continuation. Provider-specific image blocks carry real authorized bytes; unsupported image-in-tool pathways return an explicit limitation or use a separately qualified provider pathway. No hidden secondary model, duplicated effectful invocation or forged `approvedBy` field is accepted. G03/G08 qualify actual pinned T3 and provider behavior.

## 4. What the checks establish

The eight suites check deterministic generated outputs; internal links; roadmap and state graphs; JSON Schema plus recursive semantic counterexamples; bounded reference models and retention; real TypeScript module/type resolution plus method coverage; deliverable/traceability inventory; and read-only validation. Export is an additional committed-byte comparison. The reference tests are intentionally not a native runtime emulator, and pure module reuse under Bun is not a QuickJS/Wasm qualification result.

Every subsystem's named acceptance cases remain its implementation test specification. The traceability artifacts link those owning requirements to contracts, work packages and qualification gates. Performance budgets, signed topology, TCC attribution, Notes drawing, held-out app outcomes and provider compatibility have **not** been measured by this documentation task. D30 prescribes experiments and failure decisions for them. Implementation begins at W01; unresolved platform results are explicit gates rather than concealed architectural choices.


Repository-wide `bun run typecheck` was invoked in this Linux checkout and stopped because the application dependency tree does not contain `tsc`. No application compiler success is claimed. The isolated, pinned TypeScript design project compiled with `strict` checks and negative assertions; no application/runtime sources or dependency lockfiles were changed.
