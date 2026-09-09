# Collaboration refactor implementation ledger

Approved: 2026-09-09. Baseline: `509ce3f32b38afcdfd675035e4432ebb3090adb3`, PR #141.

## Decisions

Preserve Electron/React/T3, the device-principal model, catalog-owned isolated workspaces, explicit session lanes, the pinned Yjs version, encryption, and separate Commit/Push. Implement the approved P0–P9 plan on the existing PR branch. Do not merge or deploy. No native UI rewrite, speculative document sharding, live arbitrary binary replication, or media implementation.

The target is one utility-process canonical engine, renderer session mirrors, explicit live/published/projected baselines, a dedicated encrypted-payload Node-SQLite store, revision-aware managed agent operations, incremental projection, scoped recovery, and a complete session lifecycle.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| P0 | Executable baseline, pinned runtime inventory and acceptance evidence | Started: fixture and runtime tests added; results must be attached to the actual commit |
| P1 | Complete checkpoint/update/initialization protocol and authority | Not implemented |
| P2 | Publication manifests and checkpoint-safe compaction | Not implemented |
| P3 | Single lifecycle owner and off-main engine | Not implemented |
| P4 | Transactional store and copy/verify/switch migration | Not implemented |
| P5 | Incremental documents, projection and bounded replay | Not implemented |
| P6 | Stable editor mirror and control UI lifecycle | Not implemented |
| P7 | Revision-aware agents, operation groups and isolated tasks | Not implemented |
| P8 | Scoped/offline recovery, readiness and session completion | Not implemented |
| P9 | Integrated, packaged, cross-device and rollout validation | Not implemented |

## Evidence rules

A commit is not a test result. A CI pass is not packaged or cross-device evidence. Record exact SHAs, commands, runtime versions, OS/architecture and artifacts. Do not mark acceptance cases passed merely because their interfaces exist. Source-string tests are architectural checks, not protocol tests.

The execution container initially has Node 22.16 but no repository dependencies or outbound DNS. The reproducible fixture workflow exports only tracked repository source and dependency files, never .git, credentials, environment files or runner configuration. It enables executable local testing without replacing the pinned dependencies. The fixture is generated only for an explicitly marked branch commit and expires after one day.

## Acceptance cases to close

T01 fresh bootstrap; T02 initialization election/crash; T03 observer reads; T04 bounded chunks; T05 retries/ordering; T06 established-socket authority changes; T07 repeated rename/publication; T08 create/delete/recreate/modes; T09 capture fence; T10 lost publication response; T11 reconnect below compaction floor; T12 process crashes; T13 producer drain; T14 migration interruption; T15 quota/corrupt/disk-full; T16 incremental edit costs; T17 idle feedback; T18 replay/generator fairness; T19 platform/cross-volume disk safety; T20 editor composition/undo; T21 repeated commit lifecycle; T22 stale identities; T23 no document-induced control queries; T24 real agent baseline; T25 operation groups/snapshots; T26 isolated change-set review; T27 compensating revert; T28 scoped conflicts; T29 offline recovery/readiness; T30 compatible rollout/rollback.

All T01–T30 remain unverified until their behavioral evidence is recorded.
