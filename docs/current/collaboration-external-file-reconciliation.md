# External file identity and local suspension evidence

The workspace scanner reads structured Git porcelain-v2 rename records and refreshed filesystem identities from encrypted projection receipts. It resolves unique renames before projecting deletions or importing untracked paths. Ambiguous evidence, occupied targets, and delete/edit conflicts retain reviewable text in the encrypted recovery journal and pause unsafe synchronization. Quarantined recovery paths remain excluded.

External operations enter the encrypted outbox with a durable hold. Provider replay excludes the held row until final admission; rotation carries its stable operation identity to the replacement row. Projection intent replay reuses that row, including after lost acknowledgement. Failure to retain conflict evidence leaves synchronization fenced.

The additive Yjs rename-intent map preserves concurrent target choices under either winner order. Sequential renames replace only observed intents, same-target intents collapse, and explicit resolution preserves the file identity. Both filesystem projection and acknowledged commit snapshots reject unresolved choices. The recovery panel flushes renderer edits before choosing a path. Unknown or malformed intent history yields a visible paused diagnostic.

Failed startup and authority loss suspend the local runtime without implicitly leaving room membership. Explicit Leave retains its membership action. Teardown drains owned maintenance/publication before removing the hosted owner; failure keeps the owner available for retry.

## Validation

- Document and durable-store edge tests: 11 passed (`/tmp/cozea-rename-edge.log`). Includes snapshot rejection, explicit restore choice, malformed registry, and paired durable admission metadata.
- Electron, renderer and test typechecks passed on the combined source. Focused oxlint and `git diff --check` passed.
- `bunx vitest run tests/collaboration/sessionInitializerRecovery.test.ts tests/collaboration/sessionHostSuspension.test.ts tests/collaboration/sessionRuntimeIntegration.test.ts tests/collaboration/sessionExternalGitStatus.test.ts`: 4 files, 36 passed, 208.29 seconds (`/tmp/cozea-rename-final-runtime.log`). This includes actual Host reopen/crash recovery against the combined teardown changes, both concurrent rename winner orders, older checkpoint/restart resolution, real Git/inode detection, held replay and rotated-held identity.
- `bunx vitest run tests/collaboration/sessionFileProjection.test.ts tests/collaboration/sessionFileDocument.test.ts tests/collaboration/durableSessionStore.test.ts`: 3 files, 18 passed (`/tmp/cozea-rename-final-projection.log`).
- Final malformed-intent string-type hardening received a focused runtime/document rerun: 2 passed (`/tmp/cozea-rename-corrupt.log`).

The room fixture executes real runtime, encrypted durable store, checkpoint APIs and CollabRoom message handlers with controlled authority and local WebSocket delivery. Git cases use actual temporary repositories and filesystem inodes. Host coordinator fault gates are controlled boundaries. This evidence does not claim production Convex authentication, real network transport or desktop GUI interaction. Existing generation/release gates remain disabled.

Historical checkpoints without a rename-intent registry remain readable; unrecorded historical competing intent is not invented. Retained conflict copies require explicit Save or Discard even after a shared path is chosen.
