# D16 — Execution journal, delivery certainty and crash recovery

**Purpose:** make reconnects/retries safe and failures useful without claiming atomic transactions over arbitrary desktop applications. **Sources:** durable local storage semantics [S27](29-research-register.md#s27), canonical request hashing [S30](29-research-register.md#s30), cooperative protocol tasks [S02](29-research-register.md#s02).

## 1. What is and is not guaranteed

The host can deduplicate admission and retain outcomes. It cannot atomically commit an external GUI effect and its own SQLite record. A crash after submitting a click but before durable acknowledgement creates uncertainty. Do not label that interval exactly-once delivery or automatically replay it.

The selected guarantee is **at-most-once admission for a known request identity within its retained workspace/runtime history, explicit possible-effect uncertainty, and deterministic handling of duplicate status/answer requests**. Application receipt and task outcome are separate evidence. A returned `submitted` does not mean a file was copied, a message sent or a stroke rendered.

## 2. Records and storage

Use a device-local journal under Cozea userData, partitioned by device/project/workspace ownership. SQLite WAL with `synchronous=FULL` is the initial durability profile; record actual filesystem/OS qualifications and do not overstate power-loss guarantees. Store metadata and sensitive payloads separately. D19 defines encrypted payload retention and exports.

Tables: `workspaces`, `controls`, `executions`, `operations`, `checkpoints`, `checkpoint_responses`, `artifacts`, `events`, `request_keys`, and `runtime_boots`. Primary keys are host-minted opaque IDs. Unique constraints bind `(workspaceGeneration, idempotencyKey)` to source/request digest and execution ID; `(executionId, operationSequence)` binds each native operation; checkpoint response ID/digest has a unique consumed row.

A request digest covers canonical contract version, code bytes/module imports hash, budgets that change effects, target/grant mode and owner scope. Canonicalize JSON with the selected RFC8785 profile and hash source bytes explicitly. Do not log unsalted hashes of secrets as supposedly safe redaction: stored code/request payload hashes can leak low-entropy values. Protect records at rest and expose only necessary IDs to telemetry.

## 3. Execution admission

`exec` first validates schema, owner and workspace, computes the request digest and starts a journal transaction. A new idempotency key creates a `queued` execution. An existing key with the same digest attaches to its existing state/result; a different digest returns `REQUEST_CONFLICT`. It must not evaluate the source a second time simply because the previous HTTP response was lost.

Journal availability is part of effect admission. If disk full/corruption prevents recording new effect intent, reject before dispatch rather than run unjournaled. Read-only evidence can still be offered under a degraded diagnostic mode, clearly marked. Do not silently switch SQLite to a less durable profile for speed.

Keep idempotency keys while a workspace generation is alive, subject to an explicit storage quota. Do not evict them and later allow the same key to create a new effectful execution. When quota is reached, require archival/closing/new workspace generation. Closed-generation keys are rejected by generation state even when detailed receipts expire.

## 4. Native operation states

An operation progresses through `prepared`, `admitted`, `dispatch-possible`, `submitted`, `cleanup`, and terminal receipt. `not-submitted` is valid only when no potentially effectful boundary was crossed. Before the first actual input or side-effecting focus recipe, durably record `dispatch-possible`. This can conservatively mark an operation uncertain if a crash happened just before submission; it avoids falsely asserting no effect after submission.

Timeline sample execution stays in native memory with sequence/progress counters. Persist one operation intent before the path and a terminal receipt after it, with periodic bounded progress checkpoints for long timelines if required. Never fsync every movement sample. On driver/host crash, any operation beyond `dispatch-possible` without a terminal record is `interrupted-uncertain` and must be observed before any deliberate recovery.

Driver boot IDs and operation IDs prevent a late callback from a prior generation from completing a new record. The host may query the same surviving driver operation after a transport disconnect; a restarted driver cannot claim to know whether an old application consumed its events.

## 5. Receipt contract

A receipt contains operation ID, execution/cell/sequence, target identities/generations, chosen route, submission (`not-submitted`, `submitted`, `uncertain`), evidence (`not-checked`, `change-observed`, `no-change-observed`, `unavailable`), outcome (`unverified`, `verified`, `failed`), evidence references, timing spans and retry disposition. Outcome verification names the exact predicate and observation IDs.

A matched canvas pixel change verifies a local effect, not the artistic result. A new Finder item may verify destination presence but not byte-for-byte integrity unless stronger evidence is explicitly obtained. A semantic API success code is submission evidence; it is not proof all intended downstream effects completed.

Errors preserve phase, OS/backend code, completed prefix, affected dependencies and any cleanup failure. Tool responses are compact; bulk images/text are referenced or explicitly emitted. Never automatically serialize a screenshot-heavy result twice just to size a tiny acknowledgement cache.

## 6. Recovery matrix

| Failure | Recovery |
| --- | --- |
| HTTP response lost, runtime alive | Inspect/reattach by execution ID or idempotency key; no source reevaluation |
| Guest throws before effects | Return source-mapped exception and no-effect receipt |
| Guest throws after effects | Preserve prior receipts, release owned input, report partial execution |
| Worker lost | Revoke control, mark workspace lost, retain journal/pure saved data; no stack restoration |
| Driver lost after possible dispatch | Stop admission, record uncertainty, reacquire a new driver/targets before deliberate recovery |
| Host lost | Native liveness expires; cleanup independently; restart reads journal and never autoplays effects |
| Duplicate checkpoint answer | Same digest coalesces; conflicting answer rejected |
| Permission revoked midtimeline | Stop/cleanup, terminal partial/uncertain receipt |
| Journal disk full before dispatch | No input; explicit durable-admission failure |

## 7. Undo and replay

Undo is a new application action with its own grant and target evidence. It is not database rollback. Do not automatically send Cmd+Z after arbitrary failure; the application may undo the user's work or a different earlier effect.

Offline replay feeds recorded evidence and intercepted device calls to a simulator. It can test control flow and receipt handling. Real-desktop replay is a new explicitly authorized execution with freshly acquired targets and idempotency identity; it cannot reuse old authorization or coordinates as proof of safety.

## 8. Retention and tests

Default detailed metadata retention is seven days with a per-workspace cap, while active-generation idempotency tombstones persist until close. Sensitive code/evidence payload retention is separately opt-in and may be much shorter. Diagnostics can retain redacted counts without frame/text contents. Deletion must state whether data has already been exported to a provider.

Files: `packages/aid-host/src/journal/{schema,ExecutionJournal,RequestDeduplicator,ReceiptAssembler,RecoveryCoordinator}` and native `OperationLedger`/progress bridge. No cloud Convex journal is required for local correctness.

**JRN-01:** lost response never duplicates effects. **JRN-02:** same key/different code conflicts. **JRN-03:** fault injection at every journal/dispatch boundary yields correct certainty. **JRN-04:** disk full prevents unjournaled input. **JRN-05:** old-generation callbacks are rejected. **JRN-06:** checkpoint answers are consumed once. **JRN-07:** active-generation key history is never silently forgotten. **JRN-08:** cleanup failures remain visible. **JRN-09:** read-only replay cannot reach native effects. **JRN-10:** recovery never automatically sends Undo or replays code to rebuild heap. Gate G08 is required for reconnectability claims.
