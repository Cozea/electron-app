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

