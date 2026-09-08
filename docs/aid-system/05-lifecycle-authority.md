# D05 — Lifetimes, authority, seat ownership and liveness

## 1. Separate memory from permission

A workspace is not a desktop session. It contains JavaScript state. A control episode grants temporary authority to operate a specific seat under a task. An execution is one module invocation. An operation is one native effect. A transport request merely locates those objects. This distinction is required both for persistent JS and for stateless MCP; neither an open TCP connection nor a retained variable keeps recording alive by itself. [S01](29-research-register.md#s01).

Authority is bound to Cozea's authenticated device principal (`identityKey`), project/workspace context, assistant thread, provider instance and task approval. These fields are supplied by trusted host invocation context, not JS arguments. A remote future seat adds a device-to-seat grant rather than bypassing this binding.

## 2. State machines

A workspace transitions `opening → ready → closing → closed`, with `lost` on worker failure. `ready` may contain no active control. Pure-data/source retention is an independent explicit setting.

A control transitions `requested → active → stopping → quiescent → closed`. It may enter `waiting-user` before initial authority is granted. `revoked` is a terminal reason, not a reusable state. Every reacquisition produces a new monotonic `controlEpoch`; the old epoch never becomes valid again.

An execution transitions among `queued`, `running`, `waiting-condition`, `waiting-model`, `waiting-user`, `paused`, and a terminal state: `completed`, `failed`, `cancelled`, `interrupted-uncertain`. [D16](16-journal-recovery.md) owns durable semantics. A pending checkpoint does not make input ownership implicit; no held state may persist through it.

A seat has `free`, `owned(controlId,epoch)` and `quiescing` states. Exactly one control may be the physical writer. Other controls may hold independent read grants if allowed. A competing write request returns `SEAT_BUSY` with non-sensitive owner/task display information; it does not silently steal focus or queue for minutes behind another agent.

## 3. Grant contents

A control grant contains owner binding, seat/runtime generation, allowed device capabilities, allowed applications/windows/regions where constrained, operation modes, expiration, liveness policy, capture/export consent, clipboard policy, approval rules and resource budget. The host records a policy revision/hash; the driver stores a verified immutable snapshot plus an atomic revocation epoch.

Modes are `visible-ui` (semantic AX and physical UI allowed), `physical-ui` (only physical UI input for qualification), and `hybrid` (separately approved external capability providers). Read access, screenshot export, clipboard reading and input are separate permissions. Enabling Computer Use does not grant every project file or every future MCP integration.

Existing settings and scheduled-task denial remain fail-closed. Scheduled `allow` may use only the capabilities approved for that task and cannot override the global master switch. A missing/expired scheduled grant is denied. Name/display metadata never authorizes control.

## 4. Admission and dispatch algorithm

For each effect:

```text
verify invocation owner and runtime generation
load current control and policy revision
validate capability and target scope
check idempotency/conflict record
admit operation into bounded execution scope
acquire seat permit, or fail busy
re-read epoch, liveness and target after the await
prepare focus/target and durable dispatch intent
check atomic revoked epoch immediately before submission
submit through selected native route
record receipt and release permit/owned held state
```

Actor reentrancy cannot implement the seat lock by itself: every `await` may permit another message to alter state. Use an explicit cancellation-aware permit with FIFO ordering within one owner, prompt removal of cancelled waiters and no double resume. Cross-owner concurrency must be explicit; reads do not need this permit. [S21](29-research-register.md#s21).

The system cannot atomically lock macOS against a human or another unrelated application. It therefore monitors relevant external changes and revalidates before dispatch, records uncertainty after a race, and refuses to claim a universal no-race guarantee.

## 5. Logical task versus provider turn

Cozea's current `turnEnded` hook resets all native state keyed by thread. The new adapter must distinguish a final user-task completion from a provider response that ended because it returned a program/checkpoint. A live AID execution waiting for model judgment is still part of the logical control episode, not an abandoned tool session.

The host maintains `taskControlBinding` and records whether the provider cycle is `active`, `checkpoint-continuation-pending`, or terminal. An event without that binding cannot extend control. On true task completion, user cancel, provider abort without an owned continuation, policy revoke, workspace closure or host loss, initiate deterministic cleanup. See D17 for event-order and stale turn-ID tests.

## 6. Heartbeats and abandoned work

Initial liveness policy: trusted host sends a control heartbeat every two seconds while the logical task remains active; native expiry is ten seconds without valid host liveness, with the exact values recorded as policy defaults. The heartbeat is independent of screenshot requests, model token arrival and guest loop activity. Each heartbeat binds runtime generation, control ID/epoch and monotonic lease extension; a captured old heartbeat cannot revive a revoked control.

A model thinking for a minute is not host loss. A hung guest sending logs is not trusted task liveness. A disconnected external HTTP request may leave the execution queryable; an actual local host/driver channel loss triggers stop. Suspended machine/wake invalidates active control and requires reacquisition rather than extending an old monotonic deadline across changed desktop state.

Wall, compute, checkpoint and capture budgets are separate. A long human approval wait can stop sensor capture under a disclosed privacy policy while retaining a checkpoint; resume then requires fresh evidence. It must not silently retain a sensitive screen indefinitely merely because the workspace still exists.

## 7. Owned resource teardown

On stop, first atomically reject new input; then cancel queued work and wake waits. The input scheduler sends best-effort releases for automation-owned buttons/modifiers, stops gesture production, and reports `quiescent` only after its queues are drained and held state is reconciled. The host then stops control-owned capture, removes watches with effects, invalidates live target handles and releases foreground ownership.

Do not warp the real mouse back after user takeover or reactivate the prior app. Do not synthesize extra clicks to “unstick” a failed gesture. Key/button cleanup is scoped to tracked automation state; collisions with concurrent physical key state must be tested and reported, not solved by releasing every possible key.

Shared read/capture resources may have multiple authorized owners. Releasing one control removes its references but cannot stop another owner's active capture. Resource pressure never evicts an actively pinned stream without explicit suspension/notification. Workspace pure exports can remain when opted in; all authority-bearing proxies become expired.

## 8. Takeover and approval interactions

A visible Stop action is handled by the trusted host/native channel, not by code in the agent realm. A configured global stop shortcut and a driver-owned status item provide a second path when the renderer is busy. Monitor installation failure means automatic takeover detection is unavailable; the feature must not advertise full autonomous safety until G06 qualifies the available path.

Input event tags help distinguish our own events operationally but are not authentication. External focus change, active pointer interference, new blocking UI or revoked permissions cause stop/revalidation according to target dependencies. A static human mouse elsewhere need not cancel an unrelated read; physical interference with an owned gesture does.

Approvals bind the concrete requested capability/target/action digest and expire on relevant changes. “Approve” never upgrades an unrelated execution or reuses a grant from a prior control epoch. A human denial closes the pending action without replaying its predecessor.

## 9. Data and implementation files

`packages/aid-host/src/control/{ControlStore,TaskBinding,Liveness,PolicyBridge}.ts` owns grants and host state. The driver's `AuthorityRegistry`, `SeatPermit`, `InputOwnership` and `RevocationChannel` own immediate enforcement. Map existing `AuthorizationRegistry`, `InputGate`, `OperationCancellation`, scheduled policy methods and teardown barriers into these components; preserve their tested pre-admission cancellation behavior.

Store control grants only as local sensitive records; IDs in model context carry no independent authority. Persist tombstones long enough to reject stale/replayed epochs after worker restart. A driver boot mints a new generation; grants from before reboot are invalid even if IDs collide.

## 10. Acceptance

**LIFE-01:** pure helper survives control close while input/capture calls through old proxies fail. **LIFE-02:** control remains active over 60 seconds without screenshot requests while valid host heartbeat continues. **LIFE-03:** host channel loss revokes within the configured lease. **LIFE-04:** two agents cannot interleave physical input on one seat. **LIFE-05:** cancellation before permit acquisition never submits input. **LIFE-06:** revocation during cursor travel prevents contact. **LIFE-07:** checkpoint continuation does not receive premature provider-turn teardown. **LIFE-08:** late old turn-end/heartbeat cannot cancel or revive a newer epoch. **LIFE-09:** releasing one capture owner preserves another. **LIFE-10:** wake, driver restart and permission loss invalidate live grants without deleting opted-in pure data. These tests precede any claim of reconnectable, persistent control.
