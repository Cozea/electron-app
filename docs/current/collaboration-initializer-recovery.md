# Initializer rotation recovery (review candidate, 2026-09-05)

The runtime catches up canonical state before admitting optimistic replay. A lost
initializer acknowledgement is checked against the current room head, not only a
possibly lagging bootstrap checkpoint. A new valid lease reuses the original Yjs
history and a durable ciphertext identity. Competing initialization creates an
encrypted offline recovery branch while the canonical session remains usable.

An encrypted pre-initialization basis is stored before local mutation. Outbound
updates carry only its authenticated local reference; migration preserves that
reference across key versions. Reconstruction includes pending records, locally
authored acknowledgement logs, and missing canonical structs from old checkpoints
whose covered logs were compacted. Pending structs or delete sets and legacy
missing-basis ambiguity remain explicitly incomplete and retain original records.

Recovery publication uses normal editor admission, encrypted outbox persistence
and room acknowledgement. It creates an explicitly chosen unused shared path;
existing shared, Git-base and filesystem paths are rejected. Partial resolution
retains shared sources until all affected dispositions are durable. Journal
publication is copy-on-write through one runtime mutation queue. Transport ACK
waits remain outside that queue; final resolution merges the latest journal so
concurrent watcher retention survives. Startup retries source retirement after crashes.
Observers can inspect recovered content but cannot publish it.

Projection retains divergent disk bytes before replacing old baselines. A durable
recovery marker prevents a second external write from becoming an old-history
replace against canonical state. Preexisting intent metadata, displaced backups,
and target text are retained; readable unpublished text becomes a recovery item.
Recovered paths remain excluded from ordinary watcher/Git startup discovery, even
after Save or Discard. Absent canonical files and subsequent disk variants remain
reviewable; empty-file recreation and deletion have distinct durable identities.
Binary/unsupported bytes remain Git-only. Backups are read only inside the owned
recovery directory with filename, file type and symlink validation.

## Validation

- `bunx vitest run tests/collaboration/sessionInitializerRecovery.test.ts`: 13 passed.
  Real CollabRoom message handling and durable encrypted stores cover missing and
  lost ACKs, checkpoint lag, compacted accepted dependencies, competing histories,
  multi-file recovery, partial resolution, 1→2→3 rotation, same-key renewal,
  journal/enqueue/retirement failures, observer/revoked authority, binary collision,
  real Git changed-path quarantine after discard/restart and case-only rename,
  and actual SessionRuntimeHost reopen with concurrent canonical/disk writes.
- `bunx vitest run tests/collaboration/sessionOfflineRecovery.test.ts tests/collaboration/sessionKeyRecovery.test.ts tests/collaboration/sessionRuntimeIntegration.test.ts tests/collaboration/sessionFileProjection.test.ts tests/collaboration/sessionHostShutdown.test.ts tests/collaboration/durableSessionStore.test.ts`: 19 passed.
- The full 13-case run preceded final journal serialization. Final serialization
  passed three focused cases (ACK/watcher/restart race, journal/retirement failure
  retry, and enqueue retry) via `bunx vitest run tests/collaboration/sessionInitializerRecovery.test.ts -t "final|journal|enqueue|real Git startup"`. Full final-source validation remains for CI.
- Electron, renderer and test TypeScript checks passed. Focused lint and diff
  whitespace checks passed (one preexisting Host iterable-copy warning).

The room fixture controls trusted authentication decisions; it does not establish
end-to-end Convex/device authentication. Host tests use controlled gateway,
coordinator and OS encryption boundaries. No packaged GUI acceptance is claimed.
One earlier full run missed the crash=true Host failure-injection gate (10/11);
it passed isolated and in the subsequent complete 12-case run. Its original cause is still
unresolved. The injection now requires the authenticated recovery baseline marker
and asserts both retention and crash gates with the open outcome; the Host-only
rerun passes both cases. This is stronger scenario evidence, not a retrospective
claim that the original failure cause was identified.
Original basis/checkpoint evidence remains retained; cleanup of obsolete basis
files is intentionally not part of this migration milestone. Incomplete legacy
branches are inspectable and remain saved; automatic semantic reconstruction of
unknown historical provenance is not claimed.
