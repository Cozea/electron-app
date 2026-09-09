# D06 — Same-model decisions, human approvals, and resumable continuations

**Purpose:** let an agent write a procedure, pause when new judgment is required, inspect evidence, and continue the same live procedure without replaying earlier effects. **Depends on:** [D03](03-javascript-workspaces.md), [D05](05-lifecycle-authority.md), [D16](16-journal-recovery.md), [D17](17-host-provider-protocol.md).

## 1. Research and boundary

The supplied Codex transcript establishes composable JavaScript, not stack-preserving decision checkpoints. This subsystem is an original design. MCP MRTR and Tasks provide ways to carry requests for input, but do not serialize a JavaScript continuation or guarantee exactly-once desktop behavior. Tasks input is obtained through the task-specific mechanism; same-agent judgment is distinct from human elicitation. [S01](29-research-register.md#s01), [S02](29-research-register.md#s02) support the protocol facts, not this host integration.

The implementation must retain a pending guest Promise in the resident worker. It must not resume by evaluating the original cell from line one. A worker crash loses that continuation. Durable records permit explanation and replanning, not transparent restoration of an arbitrary stack.

## 2. Checkpoint types and authority

Define `model-decision`, `human-approval`, and `debug-pause`. All are safe boundaries with no automation-owned held keys/buttons. A model decision may choose among already authorized targets or return structured planning data. It cannot grant a new capability. A human approval is handled by trusted Cozea UI and binds a concrete action/grant digest; guest code cannot impersonate the approver. Debug pause never changes permissions.

`aid.execution.decide({question, observation, responseSchema, choices?})` creates a model-decision. SDK permission-sensitive effects may cause a host-generated human-approval before their dispatch. The guest is allowed to request approval, but its description is supplemented with trusted target, capability and effect information. Do not treat a guest-supplied friendly label as the complete consent request.

## 3. Normative checkpoint record

Store: `checkpointId`, `executionId`, `workspaceId`, control ID/epoch, owner tuple, kind, source cell/line, question, immutable evidence IDs, response-schema hash, optional choice IDs, dependency fingerprint, creation/deadline times, status, consumed response digest and next journal sequence. Sensitive answers are encrypted or omitted according to D19. A transport task ID is a projection, not checkpoint identity.

Stored states are `pending -> accepted -> settled`; alternatives are `rejected`, `expired`, or `lost`, as in [state-machines.json](contracts/state-machines.json). Preparation occurs before publication. Acceptance is one durable compare-and-set on an explicit consumed flag and answer digest (JSON `null` is a valid answer, never an unanswered sentinel). Denial, cancellation and dependency invalidation are rejection reasons. Persist the validated response before resolving the guest Promise. The checkpoint can resume only the exact execution and worker generation that created it.

## 4. Suspension algorithm

1. Validate the checkpoint request, bounded question/schema/evidence references, and ownership. Selective evidence export must already be permitted.
2. Await completion of earlier ordered effects. If guest work has unbalanced held input, release its owned state and fail with `UNSAFE_CHECKPOINT`; do not leave the button down and hope the model answers quickly.
3. Freeze the evidence packet and relevant dependency digest. Do not keep updating an image underneath a previously returned observation ID.
4. Register the guest completion slot and host checkpoint record before returning a checkpoint handle/status to T3. Any subsequent input request from this execution is parked until the checkpoint resumes.
5. Mark the logical task as intentionally waiting. Keep host liveness independent of screenshot frequency. Apply a stated capture policy while waiting, rather than quietly transferring control to an idle expiry timer.
6. Emit the question and actual image/text evidence through the provider adapter. The question comes back to the same controlling agent context; no secondary inference is implied.

A pending checkpoint does not hold the physical-input mutex indefinitely. However, the seat control grant remains owned; another execution cannot inject input through it. Pure queries and approved evidence preparation may proceed. A competing control request gets `SEAT_BUSY` until the owner explicitly yields or ends.

## 5. Resume algorithm and exactly-once answer consumption

A response contains checkpoint ID, response ID/idempotency key, and JSON value. Trusted host context supplies owner/epoch. Validate schema, size, expiry, choice identity and checkpoint state. Repeated identical response IDs return the same result; a different value for a consumed checkpoint returns `REQUEST_CONFLICT`.

Before resolving the Promise, check the control is still valid and target dependencies still match. If the response concerns a result that disappeared, set `rejected` with reason `DEPENDENCY_CHANGED`, attach fresh scoped evidence if authorized, and reject with `DEPENDENCY_CHANGED`. The agent must decide again or change procedure. Never select the nearest surviving result because its coordinates resemble the original.

Append `checkpoint.accepted` durably, then settle the guest slot once on the worker's engine thread. Record `checkpoint.settled` when the worker acknowledges. An identical duplicate sees that recorded disposition even if dependencies later change back. A disconnect after answer persistence is recovered through `inspect`; it must not generate a second answer or run the prefix again. If the worker dies after answer persistence but before acknowledgement, report `WORKSPACE_LOST` with the answer record and last effect certainty. Do not pretend the answer was never used.

## 6. Cozea orchestration mapping

The existing T3 lifecycle derives terminal behavior from provider `activeTurnId` and status. That individual provider response may end while a logical AID task is awaiting a decision. Introduce `AidTaskBinding` keyed by trusted environment/thread/provider-instance plus logical task. It references active execution/checkpoint IDs and says whether a provider terminal event is a true control endpoint or an intentional continuation boundary.

The host must enqueue one continuation message containing the pending question/evidence and the permitted `computer_respond` call. An implementation must not append arbitrary messages directly to provider history files. Use each provider's existing orchestration API and preserve its tool-result/call-ID requirements. If a provider cannot continue the same context, return a pending checkpoint to the user-facing host with an explicit capability limitation; do not spin a hidden replacement agent.

T3 terminal cleanup is deferred only for a registered waiting execution whose local host heartbeat remains valid. Explicit user stop, actual thread termination, policy revoke and fatal provider error still stop control. Late terminal events from an older provider turn cannot close a newer control epoch. D17 defines fixtures for these races.

## 7. Budgets, privacy, and editing

Default model-decision deadline is 120 seconds; a trusted host may extend it within task policy. Human approval defaults to a 120-second decision window, after which the pending action expires. Long human waits can release capture and reacquire evidence before approval, while never changing the effect digest silently. A workspace may remain resident after expiry for inspection, without live authority.

Do not allow a second effectful `exec` to mutate imported state while another execution waits. A human may cancel and start a replacement cell; that is a new execution with fresh targets. The debugger may edit an unexecuted planned suffix through the explicit design in D23, not mutate a live closure behind the waiting program.

Checkpoint images are privacy-bearing artifacts. Once exported, their existence is recorded even if the checkpoint expires. Local expiry cannot retract information already sent to a model. Never include authentication tokens or native capability secrets in checkpoint packets.

## 8. Failure behavior

No evidence available: return a typed read failure and preserve whether previous effects occurred. User denies: reject the pending operation without executing it. Target changes: invalidate before resume. Control revoked: reject and stop. Duplicate answer: coalesce or conflict, never apply twice. Model answers invalid JSON: keep waiting with bounded validation feedback; three malformed responses trigger host-visible failure rather than an infinite loop. Worker lost: terminal continuation loss, journal retained.

## 9. Implementation files and tests

Add `packages/aid-host/src/checkpoints/{CheckpointStore,DecisionRouter,ApprovalBroker,ContinuationCoordinator}.ts`, the worker's `PendingPromiseRegistry`, and T3 `AidTaskBinding` integration through the source-controlled toolkit patch/module in D27.

**CP-01:** two preceding clicks occur once across a decision and response. **CP-02:** duplicate identical responses resume once. **CP-03:** conflicting response rejected. **CP-04:** button-held checkpoint is cleaned up and rejected. **CP-05:** target replacement invalidates a selected choice. **CP-06:** lost response recovered through inspect without replay. **CP-07:** provider-ready event during a valid checkpoint does not tear down capture/control. **CP-08:** real stop during the same state does tear down. **CP-09:** worker loss never transparently recreates a continuation. **CP-10:** images arrive as actual multimodal content for every qualified provider. Gate G03 must pass before exposing `decide` as supported.

## Contract clarification: approval is not blanket grant replacement

A human approval normally creates a single-use permit for the pending concrete effect under the current live control epoch. It does not revive an expired control or silently change every previously retained proxy. A broader capability expansion is an explicit host grant update with new policy revision and newly acquired bindings as necessary. Denials/revocations invalidate admission immediately; matching a model-selected choice never expands authority.
