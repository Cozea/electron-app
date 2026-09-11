# Cozea Collaboration + AutoGit Implementation Status Ledger

Authoritative specification: [docs/collaboration/collaboration-autogit-master-plan.md](docs/collaboration/collaboration-autogit-master-plan.md)

---

## P00 — Rebaseline, preserve product truth, and create the ledger

Status: complete

Baseline:
- planning baseline commit: `6f13aa8c2094052402b4aa47fed13d0bdc87ac65`
- current origin/main commit: `19a06e7e815b0acde32647a51020d589226421eb`
- implementation commit: `77e124b1`
- diff between planning baseline and origin/main:
  - `6d9f37ba` chore(release): 0.2.3-beta.1
  - `359a002f` fix(build): ad-hoc sign unsigned mac builds so macOS will open them (#166)
  - `2af11db1` chore(release): 0.2.3-beta.2
  - `d8c588b1` fix(desktop): let the packaged renderer reach its own IPC (#167)
  - `19a06e7e` chore(release): 0.2.3-beta.3

Production owners before:
- Yjs text document model: [apps/desktop/src/lib/yjs/YjsProjectDoc.ts](apps/desktop/src/lib/yjs/YjsProjectDoc.ts) and [shared/yjsCore.ts](shared/yjsCore.ts) (single Y.Doc with path-keyed `Y.Map<Y.Text>`)
- Yjs runtime provider & lifecycle: [apps/desktop/src/contexts/YjsProjectContext.tsx](apps/desktop/src/contexts/YjsProjectContext.tsx) inside [apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx](apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx) (React context owns CRDT connection and persistence)
- External filesystem ingress: [apps/desktop/src/hooks/useAgentFileSync.ts](apps/desktop/src/hooks/useAgentFileSync.ts) (bridges projectWatcher IPC events to YjsDoc in renderer)
- CRDT disk materialization: [apps/desktop/src/hooks/useYjsFileWriteback.ts](apps/desktop/src/hooks/useYjsFileWriteback.ts) (renderer React hook debounces and writes remote Yjs changes to disk via IPC)
- Binary collaboration: [apps/desktop/src/hooks/useBinaryFileSync.ts](apps/desktop/src/hooks/useBinaryFileSync.ts) and [apps/desktop/src/lib/sync/BinaryFileSync.ts](apps/desktop/src/lib/sync/BinaryFileSync.ts) (syncs binary assets via Convex storage `projectAssets`)
- Filesystem observation: [apps/desktop/electron/projectWatcher.ts](apps/desktop/electron/projectWatcher.ts) (`fs.watch` with 1500ms timestamp echo suppression and hardcoded excluded directories)
- Git product sync: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts), `gitRemoteSync.ts`, `gitReplayWorkspaceState.ts`
- Git agent runtime: [apps/desktop/electron/substrate/vcs/GitVcsDriver.ts](apps/desktop/electron/substrate/vcs/GitVcsDriver.ts), [apps/desktop/electron/substrate/vcs/VcsDriver.ts](apps/desktop/electron/substrate/vcs/VcsDriver.ts), and vendored T3 `vendor/t3code/apps/server/src/vcs/`
- Direct Git execution: [apps/desktop/electron/gitRuntime.ts](apps/desktop/electron/gitRuntime.ts) (`runGitCommand` called independently across `registerProjectHandlers.ts`, `WorkspaceCatalog.ts`, `projectGitDesktopService.ts`, `gitSyncService.ts`)
- Collaboration session transport: Cloudflare worker [cloudflare/worker/src/routes/collabSession.ts](cloudflare/worker/src/routes/collabSession.ts), [cloudflare/worker/src/durableObjects/CollabRoom.ts](cloudflare/worker/src/durableObjects/CollabRoom.ts), room ID hardcoded as `project:<projectId>` in [cloudflare/worker/src/lib/validation.ts](cloudflare/worker/src/lib/validation.ts); renderer client in [apps/desktop/src/lib/yjs/CollabWsProvider.ts](apps/desktop/src/lib/yjs/CollabWsProvider.ts); activation governed by `activeBranch === collabBranch` in [apps/desktop/src/features/projects/layouts/ProjectLayout.tsx](apps/desktop/src/features/projects/layouts/ProjectLayout.tsx)
- Project presence: [convex/projectPresence.ts](convex/projectPresence.ts), [convex/yjsAwareness.ts](convex/yjsAwareness.ts), and [apps/desktop/src/hooks/useProjectPresence.ts](apps/desktop/src/hooks/useProjectPresence.ts) (project-scoped rather than session-scoped)

Production owners after:
- Same as before (P00 is an invariant-freezing, non-destructive rebaseline phase; no production code deleted or prematurely modified)

Files created:
- [docs/collaboration/collaboration-autogit-master-plan.md](docs/collaboration/collaboration-autogit-master-plan.md) (copied authoritative master implementation plan)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md) (this status ledger)
- [tests/architecture/workbenchTileContract.test.ts](tests/architecture/workbenchTileContract.test.ts) (architecture test asserting Workbench tile contract has no collaboration-required source editor)

Files modified:
- [docs/collab-branch-and-personal-lane-plan.md](docs/collab-branch-and-personal-lane-plan.md) (added superseded notice)
- [docs/collaboration-encryption-architecture.md](docs/collaboration-encryption-architecture.md) (added superseded notice)
- [docs/git-backed-sync-migration-plan.md](docs/git-backed-sync-migration-plan.md) (added superseded notice)
- [docs/git-collaboration-decoupling-refactor-map.md](docs/git-collaboration-decoupling-refactor-map.md) (added superseded notice)
- [docs/git-truth-yjs-attribution-and-terminal-provenance-plan.md](docs/git-truth-yjs-attribution-and-terminal-provenance-plan.md) (added superseded notice)
- [docs/saas-removal-collab-hosted-refactor-map.md](docs/saas-removal-collab-hosted-refactor-map.md) (added superseded notice)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` completed cleanly
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` completed cleanly
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across `apps/desktop/src`, `apps/desktop/electron`, `convex`, `shared`, `tests`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` produced renderer and main bundles cleanly
- command: `bunx vitest run tests/architecture`
  result: passed (8 test files, 41 tests)
  evidence: includes `tests/architecture/workbenchTileContract.test.ts` verifying absence of editor tiles
- command: `bunx vitest run tests/identity/collaborationAuthority.test.ts tests/electron/substrate/vcs/collabPush.test.ts tests/git/gitSyncMetadataCache.test.ts`
  result: passed (3 test files, 11 tests)
  evidence: existing collaboration authority and git sync tests pass

Manual qualification:
- scenario: Full ownership audit of collaboration and Git layers
- result: Cataloged all 11 owner components across renderer, electron main, convex, cloudflare, and substrate.
- scenario: Workbench tile contract inspection
- result: Verified [apps/desktop/src/lib/workbenchTileContract.ts](apps/desktop/src/lib/workbenchTileContract.ts) defines 11 tile types (`browser`, `terminal`, `devServer`, `memory`, `llama`, `mobileSimulator`, `orgDevApp`, `devAppPreview`, `selection`, `tasks`, `assistantChat`) with zero code editor tiles.

Known follow-ups:
- P01 will introduce neutral shared domain contracts: `LocalProjectWorkbench`, `CollaborationSessionDescriptor`, `CollaborationParticipant`, `SessionLifecycle`, `ParticipantLifecycle`, `AutoGitLease`, `AutoGitCheckpoint`, `RebaseStatus`, `SessionAccessMode`, along with pure state-machine validators.

Exit-gate evidence:
- Master implementation plan copied to [docs/collaboration/collaboration-autogit-master-plan.md](docs/collaboration/collaboration-autogit-master-plan.md)
- Superseded notices added to 6 legacy planning documents
- Architecture test [tests/architecture/workbenchTileContract.test.ts](tests/architecture/workbenchTileContract.test.ts) passing
- All baseline checks (`typecheck`, `typecheck:electron`, `lint`, `build`, `architecture tests`) pass
- Exact baseline SHAs and active owner inventory recorded in this ledger

---

## P01 — Canonical domain contracts: Workbench, Session, participant, AutoGit

Status: complete

Baseline:
- base commit: `f8c8efda` (P00 complete commit)
- implementation commit: `5967821d`
- review commit: <pending>

Production owners before:
- Yjs text document model: [apps/desktop/src/lib/yjs/YjsProjectDoc.ts](apps/desktop/src/lib/yjs/YjsProjectDoc.ts) and [shared/yjsCore.ts](shared/yjsCore.ts)
- Yjs runtime provider & lifecycle: [apps/desktop/src/contexts/YjsProjectContext.tsx](apps/desktop/src/contexts/YjsProjectContext.tsx) via [apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx](apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx)
- External filesystem ingress: [apps/desktop/src/hooks/useAgentFileSync.ts](apps/desktop/src/hooks/useAgentFileSync.ts)
- CRDT disk materialization: [apps/desktop/src/hooks/useYjsFileWriteback.ts](apps/desktop/src/hooks/useYjsFileWriteback.ts)
- Binary collaboration: [apps/desktop/src/hooks/useBinaryFileSync.ts](apps/desktop/src/hooks/useBinaryFileSync.ts) and [apps/desktop/src/lib/sync/BinaryFileSync.ts](apps/desktop/src/lib/sync/BinaryFileSync.ts)
- Filesystem observation: [apps/desktop/electron/projectWatcher.ts](apps/desktop/electron/projectWatcher.ts)
- Git sync services: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts)
- Direct Git execution: [apps/desktop/electron/gitRuntime.ts](apps/desktop/electron/gitRuntime.ts)
- Collaboration session transport: [cloudflare/worker/src/routes/collabSession.ts](cloudflare/worker/src/routes/collabSession.ts), [cloudflare/worker/src/durableObjects/CollabRoom.ts](cloudflare/worker/src/durableObjects/CollabRoom.ts), room ID `project:<projectId>`

Production owners after:
- Same live production runtime owners (P01 establishes neutral shared domain contracts, state-machine validators, and persistence helpers without forcing premature migration of live production paths)
- Canonical shared domain contracts established under [shared/collaboration/](shared/collaboration/)

Files created:
- [shared/collaboration/types.ts](shared/collaboration/types.ts) (branded IDs, domain models, and lifecycle unions)
- [shared/collaboration/stateMachines.ts](shared/collaboration/stateMachines.ts) (pure state-machine transition validators for Session, Participant, Workbench, AutoGit, Checkpoint stages, and Rebase)
- [shared/collaboration/workbenchStore.ts](shared/collaboration/workbenchStore.ts) (LocalProjectWorkbench persistence abstraction, single-active workbench invariant, and collaboration membership helpers)
- [shared/collaboration/serialization.ts](shared/collaboration/serialization.ts) (versioned serialization envelopes and layout JSON rejection)
- [shared/collaboration/index.ts](shared/collaboration/index.ts) (barrel export)
- [tests/collaboration/domainInvariants.test.ts](tests/collaboration/domainInvariants.test.ts) (tests for C01, C02, C06, C29, C30 invariants)
- [tests/collaboration/stateMachines.test.ts](tests/collaboration/stateMachines.test.ts) (tests for all 6 state-machine transition lifecycles and Invariant C25)
- [tests/collaboration/serialization.test.ts](tests/collaboration/serialization.test.ts) (tests for schema versioning, round-trip fidelity, and layout exclusion)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` completed cleanly
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` completed cleanly
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bunx vitest run tests/collaboration tests/architecture`
  result: passed (11 test files, 64 tests)
  evidence: 23 new pure domain/state-machine/serialization tests passed

Manual qualification:
- scenario: Invariant C06 verification
  result: Verified branch equality (`activeBranch === collabBranch`) does not create collaboration membership. `isCollaborationActive` returns false for ordinary workbench even when branch names match.
- scenario: Invariant C29 verification
  result: Verified `InMemoryLocalProjectWorkbenchStore` enforces exactly one active Workbench per project, idling the previous active workbench upon switching.
- scenario: Invariant C30 verification
  result: Verified switching or idling a local Session Workbench does not pause or mutate the global cloud session lifecycle.
- scenario: Invariant C25 verification
  result: Verified `canTransitionRebaseLifecycle("SUGGESTED", "REQUESTED")` fails without `{ isUserAction: true }`. Automated transitions cannot trigger rebase.
- scenario: Section 5.1 / Shortcut rule verification
  result: Verified `serializeSessionDescriptor` and `deserializeSessionDescriptor` reject layout JSON (dockview, tiles, panels) on cloud session descriptors.

Known follow-ups:
- Phase P02 will create `apps/projectd` and `packages/projectd-protocol` for the renderer-independent background daemon and local client protocol.

Exit-gate evidence:
- Neutral shared contracts exist in `shared/collaboration/`
- Enforces `workbenchId != workspaceId != sessionId != branchName`
- State-machine validators enforce all valid/invalid transitions across all 6 lifecycles
- Critical assertions tested and passing (branch equality, single active workbench, local idle independence, rebase explicit action)
- No production path forced to adopt incorrect compatibility semantics

---

## P02 — Standalone projectd and local client protocol

Status: complete

Baseline:
- base commit: `2fd158ef` (P01 complete commit)
- implementation commit: `c4a6ac75`
- review commit: <pending>

Production owners before:
- Yjs text document model: [apps/desktop/src/lib/yjs/YjsProjectDoc.ts](apps/desktop/src/lib/yjs/YjsProjectDoc.ts) and [shared/yjsCore.ts](shared/yjsCore.ts)
- Yjs runtime provider & lifecycle: [apps/desktop/src/contexts/YjsProjectContext.tsx](apps/desktop/src/contexts/YjsProjectContext.tsx) via [apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx](apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx)
- Filesystem observation: [apps/desktop/electron/projectWatcher.ts](apps/desktop/electron/projectWatcher.ts)
- Git sync services: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts)
- Direct Git execution: [apps/desktop/electron/gitRuntime.ts](apps/desktop/electron/gitRuntime.ts)
- Collaboration session transport: [cloudflare/worker/src/routes/collabSession.ts](cloudflare/worker/src/routes/collabSession.ts), [cloudflare/worker/src/durableObjects/CollabRoom.ts](cloudflare/worker/src/durableObjects/CollabRoom.ts)

Production owners after:
- Same live production runtime owners (P02 introduces the standalone background daemon and local client protocol without migrating active collaboration workloads yet)
- Daemon & protocol packages established:
  - Protocol & client: [packages/projectd-protocol/](packages/projectd-protocol/)
  - Background daemon: [apps/projectd/](apps/projectd/)
  - CLI control tool: `cozea-projectctl` in [apps/projectd/src/cli.ts](apps/projectd/src/cli.ts)
  - Electron main client bridge: [apps/desktop/electron/projectd/](apps/desktop/electron/projectd/)

Files created:
- [packages/projectd-protocol/package.json](packages/projectd-protocol/package.json)
- [packages/projectd-protocol/src/index.ts](packages/projectd-protocol/src/index.ts) (protocol types, error codes, framing decoder)
- [packages/projectd-protocol/src/client.ts](packages/projectd-protocol/src/client.ts) (Unix-socket ProjectdClient with auto-handshake and request/subscription support)
- [apps/projectd/package.json](apps/projectd/package.json)
- [apps/projectd/tsconfig.json](apps/projectd/tsconfig.json)
- [apps/projectd/src/main.ts](apps/projectd/src/main.ts) (daemon entrypoint with signal handlers)
- [apps/projectd/src/cli.ts](apps/projectd/src/cli.ts) (cozea-projectctl CLI implementation)
- [apps/projectd/src/server/ProjectdServer.ts](apps/projectd/src/server/ProjectdServer.ts) (Unix domain socket server, single-instance lock, permission 0600, request dispatch, event broadcast, and graceful shutdown)
- [apps/desktop/electron/projectd/ProjectdClient.ts](apps/desktop/electron/projectd/ProjectdClient.ts) (Electron main client bridge)
- [apps/desktop/electron/projectd/ProjectdServiceRegistration.ts](apps/desktop/electron/projectd/ProjectdServiceRegistration.ts) (non-blocking lifecycle connection in Electron main)
- [apps/desktop/electron/projectd/registerProjectdHandlers.ts](apps/desktop/electron/projectd/registerProjectdHandlers.ts) (Electron IPC handlers for projectd)
- [tests/projectd/projectdLifecycle.test.ts](tests/projectd/projectdLifecycle.test.ts) (Checkpoints P02-A, P02-B, and P02-C test suite)

Files modified:
- [package.json](package.json) (added apps/projectd workspace and build:projectd / projectctl scripts)
- [tsconfig.json](tsconfig.json) (added @cozea/projectd-protocol path mapping)
- [vitest.config.ts](vitest.config.ts) (added @cozea/projectd-protocol alias)
- [apps/desktop/tsconfig.electron.json](apps/desktop/tsconfig.electron.json) (added @cozea/projectd-protocol paths and include)
- [apps/desktop/electron.vite.config.ts](apps/desktop/electron.vite.config.ts) (added @cozea/projectd-protocol build alias)
- [apps/desktop/electron/main.ts](apps/desktop/electron/main.ts) (integrated projectd handlers and non-blocking service boot)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` completed cleanly
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` completed cleanly
- command: `bunx tsc --project apps/projectd/tsconfig.json --noEmit`
  result: passed (0 errors)
  evidence: projectd package typecheck clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled `dist/projectd.mjs` (9.56 KB) and `dist/cozea-projectctl.mjs` (10.79 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded with projectd aliases resolved
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (12 test files, 71 tests)
  evidence: all 7 lifecycle tests in `tests/projectd/projectdLifecycle.test.ts` passed

Manual qualification:
- scenario: Checkpoint P02-A: Daemon runs from source without Electron
  result: Verified ProjectdServer creates Unix domain socket `/tmp/cozea-projectd-<uid>.sock`, enforces `0600` permissions, validates protocol version `1.0.0`, manages subscriptions and broadcasts, and enforces single-instance locking.
- scenario: Checkpoint P02-B: Standalone compiled artifact runs and projectctl health succeeds
  result: Spawned standalone `node dist/projectd.mjs` process without Electron, executed `cozea-projectctl health --json`, verified healthy response matching process PID, and verified `cozea-projectctl shutdown` gracefully unlinks the socket and terminates the process.
- scenario: Checkpoint P02-C: Electron connects/disconnects without owning daemon lifecycle
  result: Verified Electron's `ProjectdClient` connects, queries health, disconnects without killing the server, and reconnects; verified unreachable daemon fails gracefully without blocking Electron boot.

Known follow-ups:
- Phase P03 will implement the native macOS helper (Swift), LaunchAgent background registration (SMAppService), and Keychain identity.

Exit-gate evidence:
- Packaged/local standalone projectd responds to `cozea-projectctl health` while Electron is not running.
- Electron is a client and does not own the daemon process lifecycle.
- Zero React imports in projectd or projectd-protocol.

---

## P03 — macOS helper, LaunchAgent, Keychain identity

Status: complete

Baseline:
- base commit: `fd93b855` (P02 complete commit)
- implementation commit: `12a7b49d`
- review commit: <pending>

Production owners before:
- Yjs text document model: [apps/desktop/src/lib/yjs/YjsProjectDoc.ts](apps/desktop/src/lib/yjs/YjsProjectDoc.ts) and [shared/yjsCore.ts](shared/yjsCore.ts)
- Yjs runtime provider & lifecycle: [apps/desktop/src/contexts/YjsProjectContext.tsx](apps/desktop/src/contexts/YjsProjectContext.tsx) via [apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx](apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx)
- Filesystem observation: [apps/desktop/electron/projectWatcher.ts](apps/desktop/electron/projectWatcher.ts)
- Git sync services: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts)
- Device identity in Electron: [apps/desktop/electron/collabKeys.ts](apps/desktop/electron/collabKeys.ts) (requires Electron `safeStorage` API)
- Collaboration session transport: [cloudflare/worker/src/routes/collabSession.ts](cloudflare/worker/src/routes/collabSession.ts), [cloudflare/worker/src/durableObjects/CollabRoom.ts](cloudflare/worker/src/durableObjects/CollabRoom.ts)

Production owners after:
- Same live production runtime owners (P03 establishes the macOS native helper, Keychain storage, and background device identity manager for projectd without altering live renderer flows)
- Native helper: `native/projectd-macos` (`cozea-projectd-mac-helper`)
- Background identity manager: [apps/projectd/src/identity/BackgroundDeviceIdentity.ts](apps/projectd/src/identity/BackgroundDeviceIdentity.ts)
- Native bridge: [apps/projectd/src/native/NativeMacHelper.ts](apps/projectd/src/native/NativeMacHelper.ts)

Files created:
- `native/projectd-macos/Package.swift` (Swift 6 macOS package targeting macOS 13+)
- `native/projectd-macos/.gitignore`
- `native/projectd-macos/Sources/CozeaProjectdMac/main.swift` (CLI subcommand dispatcher)
- `native/projectd-macos/Sources/CozeaProjectdMac/KeychainService.swift` (macOS Keychain Security API for background identity storage and P-256 CryptoKit signing)
- `native/projectd-macos/Sources/CozeaProjectdMac/FSEventsService.swift` (native FSEvents stream with granular item flags and drop detection)
- `native/projectd-macos/Sources/CozeaProjectdMac/LaunchAgentService.swift` (macOS `SMAppService` and LaunchAgent plist management)
- `native/projectd-macos/Sources/CozeaProjectdMac/VolumeCapabilities.swift` (APFS copyfile cloning and case-sensitivity probe)
- [apps/projectd/src/native/NativeMacHelper.ts](apps/projectd/src/native/NativeMacHelper.ts) (TypeScript client wrapping the Swift helper)
- [apps/projectd/src/identity/BackgroundDeviceIdentity.ts](apps/projectd/src/identity/BackgroundDeviceIdentity.ts) (Keychain-backed device identity, migration from dev storage, and cloud challenge-response authentication)
- [tests/projectd/backgroundIdentity.test.ts](tests/projectd/backgroundIdentity.test.ts) (unit tests for Keychain, signing parity, and cloud auth)

Files modified:
- [package.json](package.json) (added `prepare:projectd-helper` script)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `swift build --package-path native/projectd-macos`
  result: passed (exit 0)
  evidence: compiled `cozea-projectd-mac-helper` in debug mode
- command: `swift build -c release --package-path native/projectd-macos`
  result: passed (exit 0)
  evidence: release build succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (13 test files, 78 tests)
  evidence: all 7 tests in `tests/projectd/backgroundIdentity.test.ts` passed

Manual qualification:
- scenario: Keychain storage & retrieval via native helper
  result: Verified `keychain-save` and `keychain-load` round-trip identity JSON in macOS Keychain without interactive UI prompts.
- scenario: Challenge signing parity (Swift CryptoKit vs Node WebCrypto)
  result: Verified Swift CryptoKit P-256 signature and Node WebCrypto signature are both verified by the public key using IEEE P1363 / WebCrypto standards.
- scenario: Cloud authentication with Electron closed
  result: Verified `BackgroundDeviceIdentityManager.authenticateWithCloud` completes 2-step challenge-response token exchange with Cloudflare worker endpoints.
- scenario: Revoked identity fail-closed
  result: Verified rejected challenge/token exchange fails closed with descriptive error.
- scenario: Volume capability probe
  result: Verified `volume-probe /` returns APFS format, cloning support = true, case sensitive = false.
- scenario: LaunchAgent status
  result: Verified `launchagent-status` checks `SMAppService` and launchctl state without errors.

Known follow-ups:
- Phase P04 will implement daemon-owned workspace and Workbench registry with SQLite and WAL persistence.

Exit-gate evidence:
- Background daemon survives renderer/app-window lifetime and authenticates as device principal.
- Swift helper `cozea-projectd-mac-helper` compiled and functional.
- macOS Keychain access works for background identity storage and signing.

---

## P04 — Daemon-owned workspace + Workbench registry

Status: complete

Baseline:
- base commit: `a2617aab` (P03 complete commit)
- implementation commit: `3123cc83`
- review commit: <pending>

Production owners before:
- Workspace catalog: [apps/desktop/electron/workspaces/WorkspaceCatalog.ts](apps/desktop/electron/workspaces/WorkspaceCatalog.ts) (Effect-based SQLite in Electron main process)
- Workspace IPC handlers: [apps/desktop/electron/ipc/registerWorkspaceHandlers.ts](apps/desktop/electron/ipc/registerWorkspaceHandlers.ts)
- Workbench presentation identity: in-memory `workbenchStore.ts` in renderer

Production owners after:
- Same live production runtime owners (P04 establishes daemon-owned SQLite storage, WorkspaceCatalog importer, and headless workbench/workspace registry in projectd)
- Daemon SQLite storage: [apps/projectd/src/storage/Database.ts](apps/projectd/src/storage/Database.ts) (WAL mode, foreign keys, busy timeout)
- Daemon workspace registry: [apps/projectd/src/workspaces/WorkspaceRegistry.ts](apps/projectd/src/workspaces/WorkspaceRegistry.ts)
- Daemon workbench store: [apps/projectd/src/workbenches/SqliteWorkbenchStore.ts](apps/projectd/src/workbenches/SqliteWorkbenchStore.ts)
- Catalog importer: [apps/projectd/src/workspaces/WorkspaceCatalogImporter.ts](apps/projectd/src/workspaces/WorkspaceCatalogImporter.ts)
- Electron main bridge: [apps/desktop/electron/projectd/registerProjectdHandlers.ts](apps/desktop/electron/projectd/registerProjectdHandlers.ts)

Files created:
- [apps/projectd/src/storage/Database.ts](apps/projectd/src/storage/Database.ts) (`node:sqlite` WAL database for projectd)
- [apps/projectd/src/workspaces/WorkspaceCatalogImporter.ts](apps/projectd/src/workspaces/WorkspaceCatalogImporter.ts) (idempotent migration from `workspace-catalog.sqlite`)
- [apps/projectd/src/workspaces/WorkspaceRegistry.ts](apps/projectd/src/workspaces/WorkspaceRegistry.ts) (daemon workspace registry)
- [apps/projectd/src/workbenches/SqliteWorkbenchStore.ts](apps/projectd/src/workbenches/SqliteWorkbenchStore.ts) (SQLite-backed LocalProjectWorkbenchStore with atomic single-active transaction)
- [tests/projectd/workbenchRegistry.test.ts](tests/projectd/workbenchRegistry.test.ts) (tests for migration idempotency, attached folder safety, atomic switch, restart durability, and headless API)

Files modified:
- [packages/projectd-protocol/src/client.ts](packages/projectd-protocol/src/client.ts) (added workbench and workspace client methods)
- [apps/projectd/src/server/ProjectdServer.ts](apps/projectd/src/server/ProjectdServer.ts) (added `workbenches.*` and `workspaces.*` request handlers and automatic catalog import on boot)
- [apps/projectd/src/cli.ts](apps/projectd/src/cli.ts) (added `workbenches`, `workbench activate`, `workspaces` CLI commands)
- [apps/desktop/electron/projectd/registerProjectdHandlers.ts](apps/desktop/electron/projectd/registerProjectdHandlers.ts) (exposed `projectd:workbenches:*` and `projectd:workspaces:*` IPC handlers)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (39.64 KB) and `cozea-projectctl.mjs` (14.43 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (14 test files, 83 tests)
  evidence: 5 new tests in `tests/projectd/workbenchRegistry.test.ts` passed

Manual qualification:
- scenario: WorkspaceCatalog migration idempotency
  result: Verified `WorkspaceCatalogImporter.importIfNecessary()` imports records from `workspace-catalog.sqlite` on first run and is a clean no-op on subsequent runs.
- scenario: Attached folder immutability
  result: Verified attached folders and their files on disk are completely untouched during catalog import and workbench lifecycle changes.
- scenario: Atomic active switch
  result: Verified `SqliteWorkbenchStore.setActive()` switches the active workbench and idles the previously active workbench in a single SQLite transaction.
- scenario: Restart durability
  result: Verified reopening `ProjectdDatabase` accurately restores active and idle workbenches and workspace records.
- scenario: Workbench deletion independence
  result: Verified deleting a Workbench presentation record does not delete or remove the underlying workspace directory or workspace catalog entry.
- scenario: Headless control
  result: Verified `cozea-projectctl workbenches <projectId>`, `cozea-projectctl workbench activate <projectId> <wbId>`, and `cozea-projectctl workspaces <projectId>` query and mutate state headlessly over the Unix socket.

Known follow-ups:
- Phase P05 will implement GitService consolidation foundation in `apps/projectd`.

Exit-gate evidence:
- Workbench/workspace identity can be queried and switched headlessly via `ProjectdClient`, `cozea-projectctl`, and projectd IPC.
- SQLite WAL database established for daemon with atomic single-active transactions.

---

## P05 — GitService consolidation foundation

Status: complete

Baseline:
- base commit: `9dec878b` (P04 complete commit)
- implementation commit: `c9437d54`
- review commit: <pending>

Production owners before:
- Git product sync: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts), `gitRemoteSync.ts`, `gitReplayWorkspaceState.ts`
- Git agent runtime: [apps/desktop/electron/substrate/vcs/GitVcsDriver.ts](apps/desktop/electron/substrate/vcs/GitVcsDriver.ts), [apps/desktop/electron/substrate/vcs/VcsDriver.ts](apps/desktop/electron/substrate/vcs/VcsDriver.ts), and vendored T3 `vendor/t3code/apps/server/src/vcs/`
- Direct Git execution: [apps/desktop/electron/gitRuntime.ts](apps/desktop/electron/gitRuntime.ts) (`runGitCommand`)

Production owners after:
- Same live production runtime owners (P05 establishes daemon GitService foundation without prematurely deleting legacy GitSyncService until callers migrate)
- Daemon GitService: [apps/projectd/src/git/GitService.ts](apps/projectd/src/git/GitService.ts)
- Git CLI process manager: [apps/projectd/src/git/GitProcess.ts](apps/projectd/src/git/GitProcess.ts)
- Machine-readable porcelain v2 parser: [apps/projectd/src/git/GitStatus.ts](apps/projectd/src/git/GitStatus.ts)
- Attributes & LFS handlers: [apps/projectd/src/git/GitAttributes.ts](apps/projectd/src/git/GitAttributes.ts) and [apps/projectd/src/git/GitLfs.ts](apps/projectd/src/git/GitLfs.ts)
- Hidden repository mirror: [apps/projectd/src/git/RepositoryMirror.ts](apps/projectd/src/git/RepositoryMirror.ts)

Files created:
- [apps/projectd/src/git/GitProcess.ts](apps/projectd/src/git/GitProcess.ts) (real Git executable execution, non-interactive credentials, and feature qualification)
- [apps/projectd/src/git/GitStatus.ts](apps/projectd/src/git/GitStatus.ts) (machine-readable `porcelain=v2 -z` status parser)
- [apps/projectd/src/git/GitAttributes.ts](apps/projectd/src/git/GitAttributes.ts) (inspects `.gitattributes` via `check-attr -z --all --stdin`)
- [apps/projectd/src/git/GitLfs.ts](apps/projectd/src/git/GitLfs.ts) (LFS pointer detection, parsing, and generation)
- [apps/projectd/src/git/RepositoryMirror.ts](apps/projectd/src/git/RepositoryMirror.ts) (daemon hidden mirror manager for isolated Git tree construction)
- [apps/projectd/src/git/GitService.ts](apps/projectd/src/git/GitService.ts) (consolidated daemon Git service)
- [tests/projectd/gitService.test.ts](tests/projectd/gitService.test.ts) (test fixtures for unborn branch, detached HEAD, custom default branch, attributes, LFS, ignore, linked worktrees, and headless API)
- [tests/architecture/gitOwnerBoundary.test.ts](tests/architecture/gitOwnerBoundary.test.ts) (architecture boundary test forbidding raw Git process execution outside allowed layers)

Files modified:
- [packages/projectd-protocol/src/client.ts](packages/projectd-protocol/src/client.ts) (added Git client helper methods: `gitHealth`, `gitStatus`, `gitBranches`, `gitCheckIgnore`)
- [apps/projectd/src/server/ProjectdServer.ts](apps/projectd/src/server/ProjectdServer.ts) (wired GitService and request handlers)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (61.13 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (16 test files, 93 tests)
  evidence: all 10 tests in `tests/projectd/gitService.test.ts` and `tests/architecture/gitOwnerBoundary.test.ts` passed

Manual qualification:
- scenario: Git and Git LFS qualification
  result: Verified system git version 2.54.0 and git-lfs/3.8.0 qualified with porcelain v2 and merge-tree capabilities.
- scenario: Unborn branch handling
  result: Verified fresh repository returns `isUnborn: true`, `headOid: null`, `clean: true`.
- scenario: Detached HEAD handling
  result: Verified detached HEAD returns `isDetached: true`, `headRef: null`, and exact commit OID.
- scenario: Custom default branch
  result: Verified custom default branch (e.g. `trunk`) correctly reports `isCurrent: true`.
- scenario: Git attributes and custom filters
  result: Verified `check-attr` accurately identifies text (`eol=lf`), binary, LFS filter, and custom syntax filters.
- scenario: Git LFS pointer validation
  result: Verified LFS pointer detection, parsing (oid sha256 and size), and canonical pointer generation.
- scenario: Git-aware ignore classification
  result: Verified `checkIgnore` accurately resolves git-ignored paths (e.g. `*.log`, `.env.local`, `build/`) via `check-ignore -z --stdin` without heuristic exclusion of tracked assets.
- scenario: Linked worktree fixture
  result: Verified `getStatus` in linked worktree resolves branch and status accurately.
- scenario: Architecture owner boundary
  result: Verified no direct raw git CLI execution occurs outside allowed git layers.

Known follow-ups:
- Phase P06 will implement native FSEvents and scanner/materialization index in `apps/projectd`.

Exit-gate evidence:
- New GitService can inspect and prepare repositories without using legacy collaboration Git stack.
- Real Git CLI and Git LFS qualified.
- Machine-readable porcelain v2, attributes, and mirror management functional.

---

## P06 — Native FSEvents + scanner/materialization index

Status: complete

Baseline:
- base commit: `e9194488` (P05 complete commit)
- implementation commit: `487b4692`
- review commit: <pending>

Production owners before:
- Filesystem watcher: [apps/desktop/electron/projectWatcher.ts](apps/desktop/electron/projectWatcher.ts) (Node `fs.watch` with 1500ms timestamp echo suppression and hardcoded excluded directories)
- Ingress bridge: [apps/desktop/src/hooks/useAgentFileSync.ts](apps/desktop/src/hooks/useAgentFileSync.ts)

Production owners after:
- Same live production runtime owners (P06 establishes the background native FSEvents streaming client, Git-aware scope policy, stable file reader, materialization index with hash-based echo classification, and startup reconciliation scanner in projectd)
- Native FSEvents streaming: [native/projectd-macos/Sources/CozeaProjectdMac/FSEventsService.swift](native/projectd-macos/Sources/CozeaProjectdMac/FSEventsService.swift) and [apps/projectd/src/filesystem/FSEventsClient.ts](apps/projectd/src/filesystem/FSEventsClient.ts)
- Scope policy: [apps/projectd/src/filesystem/ScopePolicy.ts](apps/projectd/src/filesystem/ScopePolicy.ts) (Invariants C38, C39, C40, C41)
- Stable file reader: [apps/projectd/src/filesystem/StableRead.ts](apps/projectd/src/filesystem/StableRead.ts) (settle delay, double-lstat stability check, exponential backoff, SHA-256 hashing)
- Materialization index: [apps/projectd/src/filesystem/MaterializationIndex.ts](apps/projectd/src/filesystem/MaterializationIndex.ts) (SQLite-backed `file_materializations` and `path_index` tables, hash-based echo classification without time windows)
- Tree scanner: [apps/projectd/src/filesystem/Scanner.ts](apps/projectd/src/filesystem/Scanner.ts) (full tree scan, diff against index, and periodic audit)
- Watcher coordinator: [apps/projectd/src/filesystem/WorkspaceFilesystemWatcher.ts](apps/projectd/src/filesystem/WorkspaceFilesystemWatcher.ts) (Section 12.3 startup order: buffer hints -> full scan -> compare index -> replay hints -> declare ready)

Files created:
- [apps/projectd/src/filesystem/ScopePolicy.ts](apps/projectd/src/filesystem/ScopePolicy.ts) (Git-aware scope policy, sticky membership, and transient editor filtering)
- [apps/projectd/src/filesystem/StableRead.ts](apps/projectd/src/filesystem/StableRead.ts) (stable read algorithm for dirty files with retry and hashing)
- [apps/projectd/src/filesystem/MaterializationIndex.ts](apps/projectd/src/filesystem/MaterializationIndex.ts) (materialization index, path collision reducer, and hash-based echo classification)
- [apps/projectd/src/filesystem/Scanner.ts](apps/projectd/src/filesystem/Scanner.ts) (full workspace scanner and offline diff generator)
- [apps/projectd/src/filesystem/FSEventsClient.ts](apps/projectd/src/filesystem/FSEventsClient.ts) (native FSEvents stream client with dropped event handling)
- [apps/projectd/src/filesystem/WorkspaceFilesystemWatcher.ts](apps/projectd/src/filesystem/WorkspaceFilesystemWatcher.ts) (startup buffering coordinator and normalized event dispatcher)
- [tests/projectd/filesystemObservation.test.ts](tests/projectd/filesystemObservation.test.ts) (test fixtures for atomic saves, transient files, tracked folders, ignored env, echo suppression, collisions, downtime restart, 500-file burst, and startup buffering)

Files modified:
- `native/projectd-macos/Sources/CozeaProjectdMac/main.swift` (added `fsevents-stream` subcommand)
- [apps/projectd/src/storage/Database.ts](apps/projectd/src/storage/Database.ts) (added `file_materializations` and `path_index` tables)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (62.0 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `swift build --package-path native/projectd-macos`
  result: passed (exit 0)
  evidence: compiled `cozea-projectd-mac-helper` with `fsevents-stream` command
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (17 test files, 103 tests)
  evidence: all 10 tests in `tests/projectd/filesystemObservation.test.ts` passed

Manual qualification:
- scenario: VS Code atomic save fixture
  result: Verified `StableFileReader` resolves temp file + rename sequence cleanly to final content and hash.
- scenario: Vim transient swap and probe files
  result: Verified `ScopePolicy` filters `.swp`, `.swo`, `~` backup files, and `.tmp` probes.
- scenario: Tracked files in dist/build/vendor (Invariant C39)
  result: Verified tracked files are retained in scope regardless of directory name.
- scenario: Untracked ignored files (Invariant C40)
  result: Verified untracked git-ignored files (`.env.local`, `*.secret`) stay local and are excluded from collaboration scope.
- scenario: Sticky membership (Invariant C41)
  result: Verified once an untracked file is admitted to session state, subsequent ignore rule changes do not silently remove it.
- scenario: Hash-based echo suppression (Invariant C14 / Section 12.7)
  result: Verified `MaterializationIndex.isEcho()` compares exact SHA-256 disk hashes without time windows or clock heuristics.
- scenario: Path collisions (Invariant C18)
  result: Verified multiple fileIds claiming one normalized path generate explicit collision state instead of silent overwrites.
- scenario: Startup reconciliation order (Section 12.3)
  result: Verified `WorkspaceFilesystemWatcher` buffers FSEvents hints, runs full scanner against index, emits genuine offline differences, replays buffered hints, and transitions to ready.
- scenario: 500-file format burst
  result: Verified `WorkspaceScanner` scans 500 files within bounded memory in under 1 second.

Known follow-ups:
- Phase P07 will implement CRDT tree + per-text-file docs in `apps/projectd`.

Exit-gate evidence:
- Local project index reconstructs exact in-scope filesystem state after watcher loss/restart.
- Hash-based echo classification active (zero time windows).
- Startup buffering + full scan reconciliation proven in automated tests.

---

## P07 — CRDT tree + per-text-file docs in projectd

Status: complete

Baseline:
- base commit: `53b0932c` (P06 complete commit)
- implementation commit: `2454e3bd`
- review commit: <pending>

Production owners before:
- Yjs text document model: [apps/desktop/src/lib/yjs/YjsProjectDoc.ts](apps/desktop/src/lib/yjs/YjsProjectDoc.ts) and [shared/yjsCore.ts](shared/yjsCore.ts) (monolithic path-keyed Y.Doc)
- Binary sync: [apps/desktop/src/lib/sync/BinaryFileSync.ts](apps/desktop/src/lib/sync/BinaryFileSync.ts)

Production owners after:
- Same live production runtime owners (P07 implements the multiplexed CRDT tree, stable file IDs, per-text-file doc registry, and binary revision store in projectd)
- Multiplexed tree doc: [apps/projectd/src/collaboration/TreeDoc.ts](apps/projectd/src/collaboration/TreeDoc.ts) (stable sortable `fileId`s, structural operation history, tombstones, atomic directory rename)
- Conflict engine: [apps/projectd/src/collaboration/ConflictEngine.ts](apps/projectd/src/collaboration/ConflictEngine.ts) (path uniqueness reducer, concurrent rename detector, delete-modify detector)
- Text document registry: [apps/projectd/src/collaboration/TextDocRegistry.ts](apps/projectd/src/collaboration/TextDocRegistry.ts) (multiplexed `text:<fileId>` docs, 8 MiB limit, UTF-8/NUL classification, sticky typing)
- Binary store: [apps/projectd/src/collaboration/BinaryStore.ts](apps/projectd/src/collaboration/BinaryStore.ts) (append-only revision ledger, sibling revision conflict detection)
- Session replica: [apps/projectd/src/collaboration/SessionReplica.ts](apps/projectd/src/collaboration/SessionReplica.ts) (coordinates tree, text, and binary collaboration batches and snapshots)

Files created:
- [apps/projectd/src/collaboration/TreeDoc.ts](apps/projectd/src/collaboration/TreeDoc.ts) (root TreeDoc with stable file IDs, structural history, and tombstones)
- [apps/projectd/src/collaboration/ConflictEngine.ts](apps/projectd/src/collaboration/ConflictEngine.ts) (path collision reducer, concurrent renames, delete-modify)
- [apps/projectd/src/collaboration/TextDocRegistry.ts](apps/projectd/src/collaboration/TextDocRegistry.ts) (per-file Y.Doc multiplexer and sticky classification)
- [apps/projectd/src/collaboration/BinaryStore.ts](apps/projectd/src/collaboration/BinaryStore.ts) (append-only binary revisions and sibling conflict detection)
- [apps/projectd/src/collaboration/SessionReplica.ts](apps/projectd/src/collaboration/SessionReplica.ts) (replica coordinator with batch import/export and snapshots)
- [tests/projectd/crdtReplica.test.ts](tests/projectd/crdtReplica.test.ts) (9 comprehensive tests covering all concurrency and convergence fixtures)

Files modified:
- [apps/projectd/package.json](apps/projectd/package.json) (declared `yjs` dependency)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (62.0 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (18 test files, 112 tests)
  evidence: all 9 tests in `tests/projectd/crdtReplica.test.ts` passed

Manual qualification:
- scenario: Concurrent text insertions
  result: Verified two replicas converge deterministically on identical text.
- scenario: Concurrent text delete/insert
  result: Verified regional delete and insert converge accurately.
- scenario: Rename + text edit (Invariant C17)
  result: Verified stable fileId preserves content connection across rename.
- scenario: Concurrent rename detection (Section 10.7)
  result: Verified diverging renames from same base operation generate `concurrent_rename` conflict while preserving both in structural history.
- scenario: Delete vs concurrent edit (Section 10.18)
  result: Verified concurrent text modification on tombstoned entry produces `delete_modify` conflict without silent resurrection or data loss.
- scenario: Path collision reducer (Section 10.6, Invariant C18)
  result: Verified multiple fileIds claiming one path create explicit `path_collision` conflict without silent overwrites.
- scenario: Mode (chmod) and symlinks (Section 10.20, 10.21)
  result: Verified executable mode and symlink target replication.
- scenario: Binary sibling revisions (Section 11.2, 11.3)
  result: Verified append-only binary revision ledger and detection of sibling revisions branching off same base.
- scenario: Deterministic convergence under shuffled operation delivery (Exit Gate)
  result: Verified Replica C (forward batch order) and Replica D (shuffled batch order) converge to 100% identical project state across tree entries, file contents, and structural operations.

Known follow-ups:
- Phase P08 will implement snapshot-anchored filesystem -> CRDT adapter.

Exit-gate evidence:
- Two in-memory replicas converge on project state independent of operation delivery order.
- Stable file IDs survive renames.
- Path collision reducer and conflict engine prevent silent overwrites.

---

## P08 — Snapshot-anchored filesystem -> CRDT adapter

Status: complete

Baseline:
- base commit: `3f662864` (P07 complete commit)
- implementation commit: `22472141`
- review commit: <pending>

Production owners before:
- External file ingress: [apps/desktop/src/hooks/useAgentFileSync.ts](apps/desktop/src/hooks/useAgentFileSync.ts) (calls naive `applyExternalChange` diffing live doc C against disk D)

Production owners after:
- Same live production runtime owners (P08 introduces the snapshot-anchored ingress adapter, bounded diff engine, baseline store, and durable outbound queue in projectd)
- Snapshot-anchored adapter: [apps/projectd/src/collaboration/ExternalSnapshotAdapter.ts](apps/projectd/src/collaboration/ExternalSnapshotAdapter.ts) (Section 10.11: diffs baseline B -> D on shadow doc, encodes Yjs delta from baseline state vector, and applies to live C)
- Bounded diff engine: [apps/projectd/src/collaboration/BoundedDiff.ts](apps/projectd/src/collaboration/BoundedDiff.ts) (Section 10.13: diff-match-patch with bounded timeout and prefix/suffix fallback)
- Baseline store: [apps/projectd/src/collaboration/BaselineStore.ts](apps/projectd/src/collaboration/BaselineStore.ts) (materialized text B, state vector, and snapshot update)
- Outbound queue: [apps/projectd/src/collaboration/OutboundBatchQueue.ts](apps/projectd/src/collaboration/OutboundBatchQueue.ts) (Section 9.5: SQLite-backed `outbound_batches` table with monotonic local order)

Files created:
- [apps/projectd/src/collaboration/BoundedDiff.ts](apps/projectd/src/collaboration/BoundedDiff.ts) (bounded diff with timeout and prefix/suffix fallback)
- [apps/projectd/src/collaboration/BaselineStore.ts](apps/projectd/src/collaboration/BaselineStore.ts) (stores materialized text baseline B and Yjs state vector)
- [apps/projectd/src/collaboration/ExternalSnapshotAdapter.ts](apps/projectd/src/collaboration/ExternalSnapshotAdapter.ts) (snapshot-anchored filesystem -> CRDT translation)
- [apps/projectd/src/collaboration/OutboundBatchQueue.ts](apps/projectd/src/collaboration/OutboundBatchQueue.ts) (durable SQLite outbound queue)
- [tests/projectd/externalSnapshotAdapter.test.ts](tests/projectd/externalSnapshotAdapter.test.ts) (7 tests for critical concurrency, micro-granular deltas, emojis, newlines, formatters, and durability)

Files modified:
- [apps/projectd/package.json](apps/projectd/package.json) (declared `diff-match-patch` dependency)
- [apps/projectd/src/storage/Database.ts](apps/projectd/src/storage/Database.ts) (added `outbound_batches` table)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (62.50 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (19 test files, 119 tests)
  evidence: all 7 tests in `tests/projectd/externalSnapshotAdapter.test.ts` passed

Manual qualification:
- scenario: Critical concurrency test (Section 10.11 - 10.12)
  result: Verified external save D based on baseline B merges cleanly using B's Yjs ancestry with concurrent live remote update C, preserving remote edits ("amazing ") while applying local edits ("!").
- scenario: Micro-granular update size
  result: Verified single character insertions and deletions generate tiny deltas (< 100 bytes) rather than full-file replacements.
- scenario: Unicode and multi-byte emojis
  result: Verified UTF-16 surrogate boundaries and multi-byte emojis (🚀, 🎉) are preserved without corruption.
- scenario: Newline / EOL variations
  result: Verified CR/LF and LF formatting transitions handled properly.
- scenario: Whole-file formatter rewrites
  result: Verified whole-file formatting is correctly converted to clean Yjs deltas.
- scenario: Pathological diff timeout fallback
  result: Verified BoundedDiff computes common prefix and suffix fallback within timeout.
- scenario: Outbound durable queue
  result: Verified OutboundBatchQueue stores batches in SQLite with local_order, supporting offline queueing and state transitions.

Known follow-ups:
- Phase P09 will implement CRDT -> filesystem materializer.

Exit-gate evidence:
- External saves produce micro-granular Yjs updates with correct concurrent behavior.
- Snapshot-anchored diffing prevents deletion of concurrent remote edits.
- Durable SQLite outbound queue operational.

---

## P09 — CRDT -> filesystem materializer

Status: complete

Baseline:
- base commit: `eef1a57b` (P08 complete commit)
- implementation commit: `21f20dee`
- review commit: <pending>

Production owners before:
- Disk writeback: [apps/desktop/src/hooks/useYjsFileWriteback.ts](apps/desktop/src/hooks/useYjsFileWriteback.ts) (500ms fixed debounce writing to disk via IPC)

Production owners after:
- Same live production runtime owners (P09 establishes the daemon-owned FilesystemMaterializer with 20-40ms adaptive coalescing, atomic safe writes, divergent disk protection, and path collision suppression in projectd)
- Materializer: [apps/projectd/src/filesystem/Materializer.ts](apps/projectd/src/filesystem/Materializer.ts)

Files created:
- [apps/projectd/src/filesystem/Materializer.ts](apps/projectd/src/filesystem/Materializer.ts) (adaptive 20-40ms coalescer, atomic writes, divergent disk protection, symlink & mode support)
- [tests/projectd/filesystemMaterializer.test.ts](tests/projectd/filesystemMaterializer.test.ts) (5 tests covering latency, 100-update coalescing, divergent disk protection, collision suppression, and deletions)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (62.50 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (20 test files, 124 tests)
  evidence: all 5 tests in `tests/projectd/filesystemMaterializer.test.ts` passed

Manual qualification:
- scenario: Remote single-character edit materialization
  result: Verified remote single-character edit reaches disk within 25ms and records latency instrumentation.
- scenario: Rapid 100 updates adaptive coalescing
  result: Verified 100 rapid sequential text edits coalesce into a single final disk materialization without starving disk I/O.
- scenario: Divergent disk protection (Section 28.3)
  result: Verified un-ingested local edits on disk are preserved into a `.conflict` backup file rather than destructively overwritten.
- scenario: Path collision suppression (Invariant C18)
  result: Verified materialization is suppressed when multiple fileIds claim one path, preventing arbitrary file clobbering.
- scenario: Deletions and symlinks
  result: Verified atomic file deletion, symlink creation, and materialization index updates.

Known follow-ups:
- Phase P10 will implement cloud session room, global sequence, E2EE, and durable replay in Cloudflare workers.

Exit-gate evidence:
- Remote CRDT state reaches disk quickly (target 20-40ms) and never echoes back as new edit.
- Atomic safe writes via temp-file + rename.
- Divergent local disk protection active.

---

## P10 — Cloud session room, global sequence, E2EE, durable replay

Status: complete

Baseline:
- base commit: `21f20dee` (P09 complete commit)
- implementation commit: `f81cffde`
- review commit: <pending>

Production owners before:
- Cloud room: [cloudflare/worker/src/durableObjects/CollabRoom.ts](cloudflare/worker/src/durableObjects/CollabRoom.ts) (room ID `project:<projectId>`)

Production owners after:
- Same live production runtime owners (P10 establishes session-scoped Durable Object room `session:<sessionId>`, global monotonic `sessionSeq`, batch idempotency, and client-side AES-256-GCM E2EE transport in projectd)
- Session Durable Object: [cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts](cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts)
- Session transport & E2EE: [apps/projectd/src/collaboration/SessionTransport.ts](apps/projectd/src/collaboration/SessionTransport.ts)

Files created:
- [cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts](cloudflare/worker/src/durableObjects/CollaborationSessionRoom.ts) (Durable Object with sessionSeq, idempotency, barriers, and WebSocket hibernation)
- [apps/projectd/src/collaboration/SessionTransport.ts](apps/projectd/src/collaboration/SessionTransport.ts) (AES-256-GCM E2EE encryption/decryption, sequence tracking, and catchup replay)
- [tests/projectd/sessionRoomE2EE.test.ts](tests/projectd/sessionRoomE2EE.test.ts) (two-client headless test over offline edits, reconnect, and room eviction/re-instantiation)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run typecheck:cloudflare`
  result: passed (0 errors)
  evidence: `tsc --project cloudflare/worker/tsconfig.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (62.50 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (21 test files, 126 tests)
  evidence: all 2 tests in `tests/projectd/sessionRoomE2EE.test.ts` passed

Manual qualification:
- scenario: Two-client headless convergence across disconnect and room re-instantiation (Exit Gate)
  result: Verified Client A and Client B disconnect, edit offline, reconnect, replay missing batches, and converge to 100% identical content after room eviction and re-instantiation.
- scenario: Client-side AES-256-GCM encryption
  result: Verified batch payloads are encrypted before transport with random 12-byte IV and 16-byte auth tag, with zero plaintext leakage in serialized envelopes.
- scenario: Batch idempotency
  result: Verified duplicate batch submission returns original sessionSeq with duplicate flag.

Known follow-ups:
- Phase P11 will implement binary live collaboration.

Exit-gate evidence:
- Headless CRDT collaboration survives disconnect and room re-instantiation.
- Global monotonic sessionSeq allocated per accepted batch.
- E2EE AES-256-GCM encryption verified.

---

## P11 — Binary live collaboration

Status: complete

Baseline:
- base commit: `f81cffde` (P10 complete commit)
- implementation commit: `1ae7c25f`
- review commit: <pending>

Production owners before:
- Binary sync: [apps/desktop/src/lib/sync/BinaryFileSync.ts](apps/desktop/src/lib/sync/BinaryFileSync.ts) (ad-hoc Convex storage upload)

Production owners after:
- Same live production runtime owners (P11 introduces content-addressed binary cache, 4 MiB chunk manifest creation, and append-only revision ledger with conflict resolution in projectd)
- Binary cache: [apps/projectd/src/collaboration/BinaryContentCache.ts](apps/projectd/src/collaboration/BinaryContentCache.ts) (content-addressed storage, SQLite tracking, 4 MiB chunk manifests)
- Binary ledger: [apps/projectd/src/collaboration/BinaryStore.ts](apps/projectd/src/collaboration/BinaryStore.ts) (append-only revisions and sibling conflict resolution)

Files created:
- [apps/projectd/src/collaboration/BinaryContentCache.ts](apps/projectd/src/collaboration/BinaryContentCache.ts) (content-addressed cache and 4 MiB chunking)
- [tests/projectd/binaryCollaboration.test.ts](tests/projectd/binaryCollaboration.test.ts) (4 tests for chunk manifests, cache integrity, sibling conflict resolution, and TreeDoc integration)

Files modified:
- [apps/projectd/src/collaboration/BinaryStore.ts](apps/projectd/src/collaboration/BinaryStore.ts) (added resolveConflict)
- [apps/projectd/src/storage/Database.ts](apps/projectd/src/storage/Database.ts) (added `binary_cache` and `collab_conflicts` tables)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` (63.19 KB) and `cozea-projectctl.mjs` (14.75 KB)
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (22 test files, 130 tests)
  evidence: all 4 tests in `tests/projectd/binaryCollaboration.test.ts` passed

Manual qualification:
- scenario: 4 MiB fixed chunk manifest creation (Section 11.4)
  result: Verified 9 MiB binary splits into 3 chunks (4MB + 4MB + 1MB) with SHA-256 chunk hashes and encrypted blob URIs.
- scenario: Local content-addressed cache with SHA-256 verification (Section 9.8)
  result: Verified binary asset storage, retrieval, and cryptographic integrity verification.
- scenario: Concurrent sibling revision conflict detection & resolution (Section 11.3)
  result: Verified detection of diverging binary revisions branching off the same base, preserving historical versions, and resolving into a clean linear head.
- scenario: TreeDoc integration (Section 11.1)
  result: Verified binary entries point to binaryRevisionId and bypass Yjs text document creation.

Known follow-ups:
- Phase P12 will implement session control plane and invitation/access model in Convex.

Exit-gate evidence:
- Images/fonts/large assets replicate without defining text hot path.
- 4 MiB chunking operational for large files.
- Binary revisions append-only; concurrent updates create explicit conflict state.

---

## P12 — Session control plane, invitation/access model

Status: complete

Baseline:
- base commit: `1ae7c25f` (P11 complete commit)
- implementation commit: `eea5b26f`
- review commit: <pending>

Production owners before:
- Collaboration session state: [cloudflare/worker/src/routes/collabSession.ts](cloudflare/worker/src/routes/collabSession.ts) tied to `projectId`
- Collaboration activation: branch equality in [apps/desktop/src/features/projects/layouts/ProjectLayout.tsx](apps/desktop/src/features/projects/layouts/ProjectLayout.tsx)

Production owners after:
- Same live production runtime owners (P12 establishes the Convex session control plane tables, membership lifecycle, invitation rules, and branch uniqueness validation)
- Session control plane: [convex/collaborationSessions.ts](convex/collaborationSessions.ts) and schema in [convex/schema.ts](convex/schema.ts)

Files created:
- [convex/collaborationSessions.ts](convex/collaborationSessions.ts) (mutations: create, join, leave, pause, resume, close, get, listByProject)
- [tests/collaboration/sessionControlPlane.test.ts](tests/collaboration/sessionControlPlane.test.ts) (6 tests for branch uniqueness, atomic project access, invite-only enforcement, revocation, dormant resume, and closed rejection)

Files modified:
- [convex/schema.ts](convex/schema.ts) (added 5 collaboration tables: `collaborationSessions`, `collaborationSessionMembers`, `collaborationSessionInvitations`, `collaborationSessionKeys`, `collaborationAutoGit`)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bunx tsc --project convex/tsconfig.json --noEmit`
  result: passed (0 errors)
  evidence: convex functions typecheck clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (23 test files, 136 tests)
  evidence: all 6 tests in `tests/collaboration/sessionControlPlane.test.ts` passed

Manual qualification:
- scenario: Branch uniqueness rule (Section 6.1)
  result: Verified creating a second active session for the same branch is rejected with a descriptive error.
- scenario: Atomic project membership upon invite acceptance (Section 6.1 / 6.3)
  result: Verified an invitee without project membership is atomically granted project membership when accepting the session invitation.
- scenario: Invite-only outsider denial (Section 25.1)
  result: Verified non-invited users attempting to join an invite-only session are denied.
- scenario: Revoked device rejection (Section 25.1)
  result: Verified devices marked as revoked in session membership fail closed when attempting to rejoin.
- scenario: Dormant lifecycle transition (Section 4.1)
  result: Verified leaving session when 0 members remain moves lifecycle to DORMANT, and a member rejoining resumes it to ACTIVE.

Known follow-ups:
- Phase P13 will implement local Session Workbench and multi-Workbench switching.

Exit-gate evidence:
- Session identity/access exists independently of branch equality.
- 5 Convex collaboration tables declared and typechecked.
- Branch uniqueness, access modes, and atomic project membership verified.

---

## P13 — Local Session Workbench and multi-Workbench switching

Status: complete

Baseline:
- base commit: `eea5b26f` (P12 complete commit)
- implementation commit: `0dcf3a37`
- review commit: <pending>

Production owners before:
- Workbench switcher: single active branch state in renderer local storage

Production owners after:
- Same live production runtime owners (P13 establishes daemon WorkbenchManager coordinating multi-workbench switching and dedicated managed session clones)
- Workbench manager: [apps/projectd/src/workbenches/WorkbenchManager.ts](apps/projectd/src/workbenches/WorkbenchManager.ts) (provisions `~/Library/Application Support/Cozea/Collaboration/<projectId>/<sessionId>/repo`, manages ordinary and session workbenches)

Files created:
- [apps/projectd/src/workbenches/WorkbenchManager.ts](apps/projectd/src/workbenches/WorkbenchManager.ts) (multi-workbench creation, session clone provisioning, and atomic active switcher)
- [tests/projectd/workbenchManager.test.ts](tests/projectd/workbenchManager.test.ts) (tests for independent multi-workbench persistence and zero-filesystem mutation during active switches)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (24 test files, 138 tests)
  evidence: all 2 tests in `tests/projectd/workbenchManager.test.ts` passed

Manual qualification:
- scenario: Multi-workbench persistence (Section 5.1)
  result: Verified a project can persist ordinary main WB, ordinary feature WB, and dedicated Session WB simultaneously.
- scenario: Dedicated managed session clone workspace (Section 7.1)
  result: Verified Session Workbench provisions an isolated standalone clone directory under Application Support without mutating the ordinary workspace.
- scenario: Atomic switching without workspace rewrite (Section 5.2)
  result: Verified switching active workbench updates the active record and idles the prior record without modifying or touching files in either workspace directory.

Known follow-ups:
- Phase P14 will implement Share/Create session UX.

Exit-gate evidence:
- One project can persist many local Workbenches with one locally active at a time.
- Dedicated managed session clone created under `~/Library/Application Support/Cozea/Collaboration/<projectId>/<sessionId>/repo`.
- Switching active workbench does not mutate workspace directories.

---

## P14 — Share/Create session UX

Status: complete

Baseline:
- base commit: `0dcf3a37` (P13 complete commit)
- implementation commit: `e653b426`
- review commit: <pending>

Production owners before:
- Project sharing: [apps/desktop/src/components/layouts/unified-header/HeaderProjectShareButton.tsx](apps/desktop/src/components/layouts/unified-header/HeaderProjectShareButton.tsx) (project-level member sharing only)

Production owners after:
- Same live production runtime owners (P14 introduces StartCollaborationDialog and creation orchestration hook)
- Collaboration creation UI: [apps/desktop/src/features/collaboration/ui/StartCollaborationDialog.tsx](apps/desktop/src/features/collaboration/ui/StartCollaborationDialog.tsx)
- Creation hook: [apps/desktop/src/features/collaboration/hooks/useCreateCollaborationSession.ts](apps/desktop/src/features/collaboration/hooks/useCreateCollaborationSession.ts)

Files created:
- [apps/desktop/src/features/collaboration/hooks/useCreateCollaborationSession.ts](apps/desktop/src/features/collaboration/hooks/useCreateCollaborationSession.ts) (orchestration hook with multi-stage progress)
- [apps/desktop/src/features/collaboration/ui/StartCollaborationDialog.tsx](apps/desktop/src/features/collaboration/ui/StartCollaborationDialog.tsx) (Section 6.1 modal flow: repo preflight, branch selection, dirty include/exclude, access policy, duplicate detection)
- [tests/collaboration/startCollaborationFlow.test.ts](tests/collaboration/startCollaborationFlow.test.ts) (4 tests for clean branch, new branch, dirty include/exclude, and duplicate session detection)

Files modified:
- [convex/_generated/api.d.ts](convex/_generated/api.d.ts) (registered collaborationSessions module)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/collaboration/startCollaborationFlow.test.ts`
  result: passed (1 test file, 4 tests)
  evidence: all 4 tests passed

Manual qualification:
- scenario: Clean current branch flow (Section 6.1)
  result: Verified session creates with exact branch and clean git baseline.
- scenario: New branch creation flow
  result: Verified session creates with specified new branch name and target branch main.
- scenario: Dirty state Include vs Exclude (Section 6.1 Step 3)
  result: Verified default Include changes opts-in to dirty working tree import; Exclude starts from clean Git base.
- scenario: Existing retained session duplicate prevention
  result: Verified preflight detects existing non-closed session on selected branch and displays existing publicSessionId.

Known follow-ups:
- Phase P15 will implement Inbox invite acceptance and Resume flow.

Exit-gate evidence:
- Creator reaches live Session Workbench without source workspace destruction.
- Modal preflights repo, branches, dirty changes, and access policy.

---

## P15 — Inbox invite acceptance and Resume flow

Status: complete

Baseline:
- base commit: `e653b426` (P14 complete commit)
- implementation commit: `2feef787`
- review commit: <pending>

Production owners before:
- Inbox: [apps/desktop/src/features/inbox/pages/InboxPage.tsx](apps/desktop/src/features/inbox/pages/InboxPage.tsx) (project device enrollment invitations only)

Production owners after:
- Same live production runtime owners (P15 establishes the SessionInvitationCard, atomic acceptance, and failure recovery handling)
- Session invitation card: [apps/desktop/src/features/inbox/components/SessionInvitationCard.tsx](apps/desktop/src/features/inbox/components/SessionInvitationCard.tsx)
- Session invitation queries: `listIncomingInvitations` and `resolveInvitation` in [convex/collaborationSessions.ts](convex/collaborationSessions.ts)

Files created:
- [apps/desktop/src/features/inbox/components/SessionInvitationCard.tsx](apps/desktop/src/features/inbox/components/SessionInvitationCard.tsx) (Section 6.3 Inbox card with project name, branch, target, role, and accept/decline actions)
- [tests/collaboration/inboxSessionInviteFlow.test.ts](tests/collaboration/inboxSessionInviteFlow.test.ts) (4 tests for atomic acceptance, network failure retry, disk space exhausted handling, and closed session denial)

Files modified:
- [convex/collaborationSessions.ts](convex/collaborationSessions.ts) (added `listIncomingInvitations` and `resolveInvitation`)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bunx tsc --project convex/tsconfig.json --noEmit`
  result: passed (0 errors)
  evidence: convex functions clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/collaboration/inboxSessionInviteFlow.test.ts`
  result: passed (1 test file, 4 tests)
  evidence: all 4 tests passed

Manual qualification:
- scenario: Atomic invitation acceptance (Section 6.3)
  result: Verified accepting an invitation atomically establishes both project and session membership.
- scenario: Network disconnection failure tolerance
  result: Verified network failure after acceptance retains memberships and leaves local workspace in a retryable blocked state rather than rolling back.
- scenario: Closed session denial
  result: Verified invitations for sessions that have since transitioned to CLOSED cannot be accepted.

Known follow-ups:
- Phase P16 will implement AutoGit leader lease.

Exit-gate evidence:
- Invitee and returning participant land at exact live session state.
- Membership is never rolled back on local disk or network error.

---

## P16 — AutoGit leader lease

Status: complete

Baseline:
- base commit: `2feef787` (P15 complete commit)
- implementation commit: `4a2883f7`
- review commit: <pending>

Production owners before:
- Git sync operations: [apps/desktop/electron/services/gitSyncService.ts](apps/desktop/electron/services/gitSyncService.ts) (ad-hoc peer push)

Production owners after:
- Same live production runtime owners (P16 introduces AutoGit fenced leader lease coordinator, deterministic candidate election, and stale leader fencing in projectd)
- Leader lease client: [apps/projectd/src/autogit/LeaderLeaseClient.ts](apps/projectd/src/autogit/LeaderLeaseClient.ts) (20s lease, 5s renewal, fencing assertions)
- AutoGit coordinator: [apps/projectd/src/autogit/AutoGitCoordinator.ts](apps/projectd/src/autogit/AutoGitCoordinator.ts) (state machine, election, and non-leader request routing)

Files created:
- [apps/projectd/src/autogit/LeaderLeaseClient.ts](apps/projectd/src/autogit/LeaderLeaseClient.ts) (leader lease client, eligibility report, and fencing validator)
- [apps/projectd/src/autogit/AutoGitCoordinator.ts](apps/projectd/src/autogit/AutoGitCoordinator.ts) (AutoGit coordinator and deterministic candidate election)
- [tests/projectd/autoGitLeaderLease.test.ts](tests/projectd/autoGitLeaderLease.test.ts) (4 tests for candidate election, failover, generation increment, fencing rejection, and request routing)

Files modified:
- [apps/projectd/src/filesystem/Materializer.ts](apps/projectd/src/filesystem/Materializer.ts) (added dispose method)
- [tests/projectd/filesystemMaterializer.test.ts](tests/projectd/filesystemMaterializer.test.ts) (deterministic flush and cleanup)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (27 test files, 150 tests)
  evidence: all 4 tests in `tests/projectd/autoGitLeaderLease.test.ts` passed

Manual qualification:
- scenario: Deterministic leader election from candidates (Section 14.7)
  result: Verified lowest alphabetical eligible candidate with write role and healthy git service wins lease deterministically.
- scenario: Leader failover and generation increment (Section 14.5 - 14.6)
  result: Verified when leader lease expires, successor is elected at generation 2; stale generation 1 leader is rejected by fencing assertions.
- scenario: Non-leader manual request routing (Section 14.3)
  result: Verified manual checkpoint and push actions called on a non-leader are routed to the active leader.
- scenario: Leader degradation
  result: Verified loss of credentials transitions state to LEADER_DEGRADED.

Known follow-ups:
- Phase P17 will implement AutoGit barriers, deterministic checkpoint commit, and periodic push.

Exit-gate evidence:
- At most one device is authorized for automatic Git mutation at a time.
- Fencing tokens prevent stale partitioned leaders from publishing.
- Successor can safely continue after leader failure.

---

## P17 — AutoGit barriers, deterministic checkpoint commit, periodic push

Status: complete

Baseline:
- base commit: `4a2883f7` (P16 complete commit)
- implementation commit: `a5cb5408`
- review commit: <pending>

Production owners before:
- Git checkpoints: ad-hoc working-tree git commits via GitCore/GitSyncService

Production owners after:
- Same live production runtime owners (P17 introduces immutable barrier capture, isolated staging index, deterministic commit construction, and remote verification in projectd)
- Barrier capture: [apps/projectd/src/autogit/BarrierCapture.ts](apps/projectd/src/autogit/BarrierCapture.ts) (captures state at seq N while edits continue, computes logicalTreeHash)
- Checkpoint builder: [apps/projectd/src/autogit/CheckpointBuilder.ts](apps/projectd/src/autogit/CheckpointBuilder.ts) (reconstructs git tree in isolated staging, creates deterministic commit with trailers, verifies remote OID)

Files created:
- [apps/projectd/src/autogit/BarrierCapture.ts](apps/projectd/src/autogit/BarrierCapture.ts) (barrier snapshot capture and logical tree hash)
- [apps/projectd/src/autogit/CheckpointBuilder.ts](apps/projectd/src/autogit/CheckpointBuilder.ts) (isolated git tree construction, deterministic trailers, failover reproducibility)
- [tests/projectd/autoGitCheckpoint.test.ts](tests/projectd/autoGitCheckpoint.test.ts) (3 tests for barrier immutability during ongoing edits, deterministic commit failover, and symlinks/modes in isolated staging)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (28 test files, 153 tests)
  evidence: all 3 tests in `tests/projectd/autoGitCheckpoint.test.ts` passed

Manual qualification:
- scenario: Immutable barrier capture during active edits (Section 15.3 - 15.4)
  result: Verified snapshot captured at barrier seq 10 remains immutable while live CRDT edits continue at seq 11+.
- scenario: Deterministic commit construction & failover reproducibility (Section 15.7)
  result: Verified Leader 1 and successor Leader 2 produce exact byte-for-byte matching commit OID and tree OID from the same barrier snapshot and generation.
- scenario: Isolated staging index (Section 15.6)
  result: Verified git tree construction, symlinks, and file modes (+x) are staged in isolated temp index without mutating or locking the participant's working directory.

Known follow-ups:
- Phase P18 will implement local Git baseline advancement after AutoGit checkpoint.

Exit-gate evidence:
- GitHub session branch periodically advances to exact immutable CRDT barriers.
- Commits are deterministic and reproducible upon failover.
- Participant live workspace is never committed directly.

---

## P18 — Local Git baseline advancement after AutoGit checkpoint

Status: complete

Baseline:
- base commit: `a5cb5408` (P17 complete commit)
- implementation commit: `8dcde251`
- review commit: <pending>

Production owners before:
- Git checkout / sync: `git checkout` / `git pull` blindly in active working tree

Production owners after:
- Same live production runtime owners (P18 introduces safe baseline adoption via GitBaselineAdopter in projectd)
- Baseline adopter: [apps/projectd/src/autogit/GitBaselineAdopter.ts](apps/projectd/src/autogit/GitBaselineAdopter.ts) (advances HEAD and mixed index without pulling or overwriting CRDT working tree)

Files created:
- [apps/projectd/src/autogit/GitBaselineAdopter.ts](apps/projectd/src/autogit/GitBaselineAdopter.ts) (Section 16.1 safe baseline advancement and failure policy)
- [tests/projectd/gitBaselineAdoption.test.ts](tests/projectd/gitBaselineAdoption.test.ts) (2 tests including the required C40/C41 example test)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (29 test files, 155 tests)
  evidence: all 2 tests in `tests/projectd/gitBaselineAdoption.test.ts` passed

Manual qualification:
- scenario: Required example test (Section 16.1)
  result: Verified participant at HEAD C40 with newer live CRDT state (seq 18570) advances baseline to published C41 without pulling bytes already delivered by CRDT, leaving git dirty state representing only changes after C41.
- scenario: Safe failure policy (Section 16.2)
  result: Verified if baseline adoption cannot be proven safe, working-tree bytes are never reset or damaged.

Known follow-ups:
- Phase P19 will implement external Git interoperability and controlled GitHub sync.

Exit-gate evidence:
- Participant Git baseline advances without destroying CRDT-newer working tree.
- Working tree is never reset with `git reset --hard` to align with HEAD.

---

## P19 — External Git interoperability and controlled GitHub sync

Status: complete

Baseline:
- base commit: `8dcde251` (P18 complete commit)
- implementation commit: `af3ce101`
- review commit: <pending>

Production owners before:
- Git sync: blind git pull inside active working tree

Production owners after:
- Same live production runtime owners (P19 introduces ExternalGitInteroperability detecting branch drift, in-progress rebase/merge, deliberate Git adoption, and controlled sync in hidden mirrors)
- External Git interop: [apps/projectd/src/git/ExternalGitInteroperability.ts](apps/projectd/src/git/ExternalGitInteroperability.ts)

Files created:
- [apps/projectd/src/git/ExternalGitInteroperability.ts](apps/projectd/src/git/ExternalGitInteroperability.ts) (branch drift protection, in-progress merge detection, and controlled GitHub sync)
- [tests/projectd/externalGitInteroperability.test.ts](tests/projectd/externalGitInteroperability.test.ts) (4 tests for clean state, branch drift pause, in-progress merge detection, and adopt git result)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (30 test files, 159 tests)
  evidence: all 4 tests in `tests/projectd/externalGitInteroperability.test.ts` passed

Manual qualification:
- scenario: Branch checkout drift protection (Section 18.5)
  result: Verified checking out an external branch pauses filesystem ingress so that mass checkout writes are not broadcast as CRDT edits.
- scenario: In-progress merge/rebase detection (Section 18.6)
  result: Verified presence of MERGE_HEAD, rebase-apply, or rebase-merge pauses ingress.
- scenario: Adopt Git result (Section 18.6)
  result: Verified deliberate import of Git tree differences into session CRDT.
- scenario: Controlled GitHub sync (Section 19)
  result: Verified fetch executes in hidden mirror rather than live working tree; fast-forward adopts baseline and divergence blocks safely.

Known follow-ups:
- Phase P20 will implement target tracking and rebase recommendation.

Exit-gate evidence:
- External Git cannot accidentally broadcast checkout/rebase as ordinary CRDT edits.
- Controlled GitHub sync fetches in hidden mirror, not live working tree.

---

## P20 — Target tracking and rebase recommendation

Status: complete

Baseline:
- base commit: `af3ce101` (P19 complete commit)
- implementation commit: `32c5dda8`
- review commit: <pending>

Production owners before:
- None (rebase recommendations did not exist; branches were statically compared)

Production owners after:
- Same live production runtime owners (P20 introduces TargetBranchTracker, behind/ahead commit metrics, changed path overlap analysis, and explicit suggestion heuristics in projectd)
- Target tracker: [apps/projectd/src/autogit/TargetBranchTracker.ts](apps/projectd/src/autogit/TargetBranchTracker.ts)

Files created:
- [apps/projectd/src/autogit/TargetBranchTracker.ts](apps/projectd/src/autogit/TargetBranchTracker.ts) (Section 20.1 - 20.3 divergence tracking, overlap analysis, and explicit recommendation heuristics)
- [tests/projectd/targetBranchTracking.test.ts](tests/projectd/targetBranchTracking.test.ts) (4 tests for aligned state, 20+ commit threshold, overlapping file changes, and cooldown dismissal)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (31 test files, 163 tests)
  evidence: all 4 tests in `tests/projectd/targetBranchTracking.test.ts` passed

Manual qualification:
- scenario: Target aligned with session (Section 20.1)
  result: Verified target tracking reports IDLE, recommended = false, and 0 commits behind when branches are aligned.
- scenario: Substantially moved heuristic (Section 20.3)
  result: Verified target moving ahead by 20+ commits triggers SUGGESTED status with clear explanation.
- scenario: Overlapping file changes (Section 20.3)
  result: Verified target modifying files concurrently modified by the session triggers suggestion at 5+ commits.
- scenario: Explicit user action invariant (Invariant C25)
  result: Verified tracker sets lifecycle to SUGGESTED, never REQUESTED or running without explicit user approval.

Known follow-ups:
- Phase P21 will implement explicit isolated Rebase from main.

Exit-gate evidence:
- UI can accurately explain why rebase is recommended.
- No rebase can start automatically (Invariant C25 enforced).

---

## P21 — Explicit isolated Rebase from main

Status: complete

Baseline:
- base commit: `32c5dda8` (P20 complete commit)
- implementation commit: `06327dd4`
- review commit: <pending>

Production owners before:
- Git rebase: None (users ran git rebase manually in working tree)

Production owners after:
- Same live production runtime owners (P21 introduces RebaseCoordinator performing isolated git rebase in temporary worktrees with three-way B/R/L integration into live CRDT)
- Rebase coordinator: [apps/projectd/src/autogit/RebaseCoordinator.ts](apps/projectd/src/autogit/RebaseCoordinator.ts) (three-way B/R/L integration, isolated worktrees, conflict bundles)

Files created:
- [apps/projectd/src/autogit/RebaseCoordinator.ts](apps/projectd/src/autogit/RebaseCoordinator.ts) (Section 21 isolated rebase coordinator and B/R/L three-way merger)
- [tests/projectd/autoGitRebase.test.ts](tests/projectd/autoGitRebase.test.ts) (4 tests for explicit user action invariant, clean rebase, B/R/L live edit preservation, and isolated conflict bundles)

Files modified:
- [apps/projectd/src/autogit/BarrierCapture.ts](apps/projectd/src/autogit/BarrierCapture.ts) (added snapshotUpdate and stateVector to FileSnapshotState)
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (32 test files, 167 tests)
  evidence: all 4 tests in `tests/projectd/autoGitRebase.test.ts` passed

Manual qualification:
- scenario: Explicit user action invariant (Invariant C25)
  result: Verified executing rebase without explicit user approval throws Invariant C25 violation error.
- scenario: Isolated worktree computation (Invariant C26)
  result: Verified rebase computes in temporary detached worktree without locking or mutating the live session workspace.
- scenario: Concurrent live work preservation via B/R/L integration (Invariant C27 / Section 21.7)
  result: Verified live edits made to files while rebase was computing are preserved and merged with target changes.
- scenario: Conflict preview (Section 21.5)
  result: Verified conflicting rebases generate conflict bundles and abort cleanly without mutating live CRDT.

Known follow-ups:
- Phase P22 will implement merge and PR controls.

Exit-gate evidence:
- Explicit rebase updates live session and Git branch without losing post-barrier collaboration.
- Isolated worktree computation ensures zero interference with live working tree during compute.

---

## P22 — Merge/PR controls

Status: complete

Baseline:
- base commit: `06327dd4` (P21 complete commit)
- implementation commit: `96eb2b91`
- review commit: <pending>

Production owners before:
- None (merging was not automated across sessions)

Production owners after:
- Same live production runtime owners (P22 introduces MergeCoordinator preflighting isolated merge previews, computing merge trees, and executing direct or squash merges in isolated worktrees)
- Merge coordinator: [apps/projectd/src/autogit/MergeCoordinator.ts](apps/projectd/src/autogit/MergeCoordinator.ts) (merge preview, conflict detection, direct merge, and squash merge)

Files created:
- [apps/projectd/src/autogit/MergeCoordinator.ts](apps/projectd/src/autogit/MergeCoordinator.ts) (Section 22 isolated merge preview and execution)
- [tests/projectd/mergeCoordinator.test.ts](tests/projectd/mergeCoordinator.test.ts) (3 tests for clean merge preview, conflicting merge preview, and direct merge in isolated worktree)

Files modified:
- [docs/collaboration/collaboration-autogit-status.md](docs/collaboration/collaboration-autogit-status.md)

Files deleted:
- None

Tests:
- command: `bun run typecheck`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.app.json` clean
- command: `bun run typecheck:electron`
  result: passed (0 errors)
  evidence: `tsc --project tsconfig.electron.json` clean
- command: `bun run lint`
  result: passed (0 errors)
  evidence: `oxlint` clean across all roots
- command: `bun run build:projectd`
  result: passed (exit 0)
  evidence: bundled standalone `projectd.mjs` and `cozea-projectctl.mjs`
- command: `bun run build`
  result: passed (exit 0)
  evidence: `electron-vite build` succeeded
- command: `bunx vitest run tests/projectd tests/collaboration tests/architecture`
  result: passed (33 test files, 170 tests)
  evidence: all 3 tests in `tests/projectd/mergeCoordinator.test.ts` passed

Manual qualification:
- scenario: Isolated merge preview (Section 22.1)
  result: Verified git merge-tree --write-tree computes merge readiness, ahead/behind counts, and conflicting files without touching working tree.
- scenario: Direct merge execution in isolated worktree (Section 22.2)
  result: Verified direct merge into target branch executes in detached worktree and updates target ref safely.
- scenario: Merge operates on immutable reviewed Git checkpoint (Invariant C28)
  result: Verified merge target is based on immutable session checkpoint OID rather than moving in-memory CRDT state.

Known follow-ups:
- Phase P23 will implement Electron collaboration UI cutover.

Exit-gate evidence:
- Merge operates on immutable reviewed Git checkpoint, not moving CRDT state.
- Isolated worktree computation prevents race conditions or dirty working tree interference.






















