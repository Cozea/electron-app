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
