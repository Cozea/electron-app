# Collaboration refactor implementation ledger

Approved: 2026-09-09. Original baseline: `509ce3f32b38afcdfd675035e4432ebb3090adb3`, PR #141, branch `refactor/collaboration-v2-end-to-end`.

## Fixed scope

Preserve Electron/React/T3, device principals, catalog-owned isolated workspaces, explicit session lanes, pinned Yjs, encryption and separate Commit/Push. No merge or deployment. No native UI rewrite, speculative document sharding, arbitrary live binary replication or media implementation.

Target: one utility-process canonical engine; renderer session mirrors; explicit live/published/projected baselines; dedicated encrypted-payload Node-SQLite storage; revision-aware agents; incremental projection; scoped recovery; complete session lifecycle.

## Saved implementation and evidence

- `b1570d0`, `7e92e72`: P0 runtime tests, executable fixture and evidence workflow. Node SQLite/Yjs baseline tests pass. The local execution service became unresponsive after fixture transfer; subsequent candidates are executed in Actions instead.
- `1515b481dbdf13b1e102883853f660eeae2a1b02`: real desktop -> gateway -> room checkpoint protocol; elected durable upload/file-initialization leases; observer reads; protocol revision validation; admission-time authority; Git publication no longer deletes replay history. Candidate run `34301733740` tested exact tree `f9d4069bc6e18918a899a02f3b256b4f2207f442`: four typechecks, lint, 8 targeted tests pass. One lint warning for an ambient test reference.
- `f18bba493c0b0c84a8ad21f1d172deffba1c004a`: large update upload/replay, bounded durable chunk assembly, exact retry identity, local outbox retained until canonical persistence, socket revision negotiation. Candidate run `34302759025` tested exact tree `5892a618c118f586c41a3913c1dd73a415e2eb4a`: four typechecks, lint, 15 targeted tests pass. Two ambient-reference lint warnings. Real local WebSockets connect the actual provider and room; tests mock external Convex authority and emulate Durable Object storage with production per-value/batch bounds.

Tests include fresh bootstrap, observer read/write distinction, checkpoint chunks, mismatched protocol rejection, file lease takeover, preservation on publication, large Unicode updates to concurrent/late clients, offline recovery after ACK-before-echo, delayed local persistence, room re-instantiation mid-upload, same-ID retry, revoked established sockets, bounded staging and checksum mismatch.

## Remaining phase status

| Phase | Status |
| --- | --- |
| P0 | Executable baseline and evidence established; full acceptance matrix still open |
| P1 | Core checkpoint, file initialization, chunked transport and ACK durability connected and tested; further fault/rollout/flow-control coverage remains |
| P2 | In progress: immutable publication baselines, retained prepared captures, repeated Git cycles; safe compaction still to implement |
| P3 | Not implemented: off-main owner and complete lifecycle surface |
| P4 | Not implemented: transactional store/migration |
| P5 | Not implemented: incremental document/projection and fair scheduling |
| P6 | Not implemented: editor/control lifecycle |
| P7 | Not implemented: revision-aware agents and operation groups |
| P8 | Not implemented: scoped/offline recovery and readiness/workflow |
| P9 | Not implemented: packaged/cross-device/platform/rollout release evidence |

## Delivery constraints

The temporary candidate workflow applies reviewed exact transformations, runs checks, uploads Git blobs, and verifies the resulting tree equals `git write-tree`. It never updates a branch. The connector explicitly creates the commit and advances the branch without force. Remove the temporary recipes at final cleanup; they are an execution adapter, not production architecture.

A saved commit is not a test result. Candidate-tree validation is distinct from the final commit's full-suite/build run. Unit/provider integration is not packaged or physical cross-device evidence. Do not mark all T01–T30 complete from the targeted cases above. No production deployment has been performed.


## 2026-09-09 continuation: P2 publication and compaction

- Committed `6e5365589d5f8790c3894bffd13cdd7bb3cb8c02`: immutable per-publication file manifests captured from durable encrypted commit bases. Repeated rename/publish, delete/recreate, executable modes, unopened Git objects, and post-barrier edits have real-Git regression coverage. Candidate tree `b49c1252b5a132f36eb098aa4de83e6edc9f49a1` passed all four typechecks, lint, and 22 targeted tests in run `34303830696`.
- The next compaction slice negotiates checkpoint protocol revision 2. The client must authenticate, parse and durably save an exact finalized checkpoint before requesting compaction. Floor plus replacement anchor are durable before bounded 32-update cleanup batches. Each deletion transaction retains the exact operation receipt and adjusts replay accounting; accepted chunk payloads are retired with their record.
- Receipt metadata remains pinned for the lifetime of the session. A hard limit of one million accepted operations bounds it; hitting capacity retains pending work and requests an explicit successor session. There is no time-based deduplication eviction that can reaccept an old operation under a new sequence.
- Superseded checkpoints of the same key have a 30-minute reader/finalization-retry grace window. Active checkpoints for every key and the compaction anchor are never selected by this cleanup. Rotation upload does not compact before key activation.
- Local acknowledged snapshots are pinned while an asynchronous commit/rotation capture may need an older sequence. Compaction requests from older completions cannot move the local baseline backwards.
- Routine checkpoint maintenance is independent of Git publication and inactive during an unchanged idle session. A lost compact response is retried even after the replacement became durable locally.
- Local targeted integration validates actual WebSocket clients/room, real checkpoint client/gateway, interrupted deletion, delayed chunk retries, expired-reader checkpoints, post-checkpoint suffix replay, bounded deletion batches and lost compact responses. The local fixture initially lacks vendored T3 dependencies, so renderer/Electron/test-project typechecks must be verified by the candidate runner until that fixture is extended. Worker typecheck and lint pass locally. Existing triple-slash lint warnings remain in the test fixtures.
- P3–P9 remain implementation work; none is declared complete by these regressions. Physical cross-device, packaged platform and production deployment validation are still not claimed.
