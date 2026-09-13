# Repository and collaboration progress audit

Snapshot: **2026-09-12T16:45:56+08:00**; checks completed later in the same audit.

Scope: repository state, every open PR, uncommitted changes, and comparison with the supplied master implementation plan. The attachment's implementation instructions were treated as document content, not authorization to implement, commit, merge, or deploy.

## Assessment

This is a substantial but incomplete migration. The daemon, filesystem-to-CRDT pipeline, session room, and AutoGit have real production entry points. However, “through P22” describes the breadth of implemented features, not satisfaction of P00–P22 exit gates. Background authentication/restart, full Session Workbench lifecycle, immutable binary storage, durable rebase recovery, fresh-checkpoint merge, and removal of legacy owners remain material gaps.

The working tree is further along than the open collaboration PR, but currently fails renderer and test typechecks and one focused integration test. It is not ready to treat as a completed plan or a green merge candidate.

## Baselines and repository state

| Layer | Observed state |
|---|---|
| Supplied plan baseline | `6f13aa8c2094052402b4aa47fed13d0bdc87ac65` |
| Current GitHub main and local origin/main | `ef72d9a56f9c42e328d2d94c2457d54b43121000`; verified with GitHub API |
| Checked-out branch | `feat/collab-step3-session-ui` |
| HEAD and PR #168 head | `f2fa41148c1fb7af6fd0a68a57c7190694ccf007` |
| Branch relationship | 16 commits ahead of main, 0 behind |
| Attachment vs repository plan | Byte-identical to `docs/collaboration/collaboration-autogit-master-plan.md` |
| Initial local changes | 47 modified ordinary tracked files, one dirty submodule, three untracked files |
| Tracked top-level diff | 1,955 additions / 299 deletions; excludes untracked contents and internal submodule diff |

Main already contains projectd foundations and the audit-remediation/session-host work. PR #168 adds app startup/packaging, mounted session UX, AutoGit, outside-push integration, target tracking, rebase and merge controls. Dedicated session provisioning and binary cloud transport are additional uncommitted work.

The repository remains an Electron/React desktop, Convex control plane, Cloudflare room transport, and vendored T3 agent runtime. projectd is an additional background owner in active migration, not yet the sole collaboration or Git authority.

## Every open PR

GitHub state is a point-in-time snapshot. “Mergeable” below means Git can combine the branch; it does not mean approved or ready to ship. Scope was assessed from PR metadata, descriptions, changed-file inventories and relevant source—not an exhaustive line-by-line correctness review of all seven PRs.

| PR | Scope | State and checks | Relationship to this plan |
|---|---|---|---|
| [#168 — Live collab: session UI, AutoGit, P20–P22, renames, invitee copies](https://github.com/Cozea/electron-app/pull/168) | 103 files; +11,035 / −1,977 | Open, non-draft, mergeable but BLOCKED; Navigation Runtime Validation fails; native checks and CodeQL pass | Primary implementation branch. Does not include current dirty additions. |
| [#165 — Draft: browser WebContentsView modernization](https://github.com/Cozea/electron-app/pull/165) | 68 files; +7,598 / −228 | Draft, mergeable but BLOCKED; listed checks pass | Separate browser migration. Relevant to P24 browser/preview qualification. Changes preload, workbench presentation and T3 pin. Its host architecture differs from current main's webview instruction; do not silently combine the two contracts. |
| [#149 — fix: CodeRabbit auto-fixes for PR #147](https://github.com/Cozea/electron-app/pull/149) | 9 files; +430 / −42; Computer Use runtime/native fixes | Non-draft; CONFLICTING; only CodeRabbit listed | Adjacent P24 Computer Use capability; requires reconciliation with current native/runtime code. |
| [#135 — Draft: native-first DevApp platform](https://github.com/Cozea/electron-app/pull/135) | 64 files; +7,709 / −92 | Draft; CONFLICTING; listed native DevApp checks pass | Changes P24 DevApp execution surface and shared main/preload/workbench contracts. Not collaboration completion evidence. |
| [#100 — docs: T3 server import plan with cloud swarm map](https://github.com/Cozea/electron-app/pull/100) | 1 planning document; +486 | Draft, mergeable but BLOCKED; historical CircleCI failure | Historical T3 planning. Main already boots vendored T3; the PR's “next step T0” description is stale. |
| [#98 — fix: prevent cloud Vite port drift causing dynamic import failures](https://github.com/Cozea/electron-app/pull/98) | 3 files; +39 | Draft; CONFLICTING; historical CircleCI failure | Development environment fix against old repository layout; no direct phase completion. |
| [#74 — docs: Cozea ↔ t3code substrate upgrade path + full implementation plan](https://github.com/Cozea/electron-app/pull/74) | 2 planning documents; +889 | Draft; CONFLICTING; historical CircleCI pass | Historical substrate planning, not current collaboration authority. |

Do not interpret an old CI result as validation against current main. The other implementation PRs also overlap shared integration surfaces; they are not independent drop-in additions.

## Uncommitted work

| Workstream | Current changes | Assessment |
|---|---|---|
| Dedicated Session Workbench | `WorkbenchManager.ensureSessionWorkbench`, daemon protocol/server, Electron catalog registration and preload | Real provisioning path now exists, unlike committed P13 library-only state. Full ready-before-activation and active/idle integration are incomplete. |
| Create / invite / resume UX | Branch select/create, dirty include/exclude, setup retry, Inbox provisioning and workspace navigation | Advances P14–P15. Two old controller callers still fail typecheck. |
| Binary sync | New `BinaryObjectStore.ts`, new Worker `sessionBinary.ts`, R2 binding, host ingestion, materialization and checkpoint bytes | Advances P11 from library-only to wired but unqualified. Existing AutoGit test fixture now attempts binary fetch and fails. |
| Key rotation | `activeKeyVersion`, keyring query, generation-aware transport, room admission and renderer reconnect | Addresses a previously recorded revocation gap. Fresh join/replay and app-closed rotation still need end-to-end proof. |
| Repository credentials | URL normalizer now retains credential-bearing URLs; Start requires acknowledgement | Deliberate behavior change relative to the supplied plan's credential rules, not simply a completed phase. |
| CI/test repair | Build daemon before integration tests; fixture Git identity helper; filesystem test adjustment | Addresses several current CI failures but has not produced green PR CI. |

Three untracked files are `apps/projectd/src/collaboration/BinaryObjectStore.ts`, `cloudflare/worker/src/routes/sessionBinary.ts`, and `tests/helpers/gitIdentity.ts`. They are imported by modified tracked code and must accompany any eventual checkpoint.

The vendored T3 submodule remains on `be4668f7b439499f39a659055d0f6ec34ac666b2` with its own dirty changes: `apps/server/src/mcp/toolkits/computerUse.ts` (+13/−151) and five untracked Android `.gradle/` directories. These are separate from the collaboration work. No submodule update was made by this audit.

## Phase comparison

“Partial” means implementation evidence exists but the complete requested behavior or qualification gate is missing. Unit tests and source reachability are not packaged release acceptance.

| Phase | Evidence and remaining gap |
|---|---|
| P00 — Rebaseline/ledger | Plan and owner inventory exist; current ledger requires refresh. Its original completion claims were explicitly corrected after an audit. |
| P01 — Domain contracts | Foundation implemented: separate session/workspace/workbench types and state machines. Product integration still incomplete in later phases. |
| P02 — Standalone daemon | Reachable daemon, Unix socket/client, CLI and compiled build. Historical unsigned packaged smoke recorded. Autonomous session restoration remains missing. |
| P03 — macOS lifetime/identity | Helper and universal packaging exist; launcher uses `launchctl`, not the specified SMAppService. Background identity manager is not wired and calls an unserved `/auth/device/token` endpoint. |
| P04 — Registries | Daemon workspace/workbench store works. Local changes bridge session workspaces to Electron's catalog; dual registry/activation integration still needs qualification. |
| P05 — GitService | Real Git service and temporary-index operations exist. Electron/T3/legacy Git owners remain. Bundled Git/LFS and full filter parity gates are not established. |
| P06 — Filesystem observation | FSEvents, scanner, scope and hash index are wired. Symlink ingress is skipped; case-sensitive collision policy is incorrect. Full scale/drop/restart matrix unqualified. |
| P07 — CRDT model | Stable tree IDs and per-file Yjs documents are active. Each host creates a new replica and replays the room; local snapshot restore is not the active boot path. |
| P08 — Snapshot-anchored ingress | Production adapter reconstructs baseline Yjs ancestry and emits deltas. Renames use same-byte matching over a 500ms window; broader rename/edit ambiguity still needs acceptance tests. This window is rename detection, not echo suppression. |
| P09 — Materialization | Active hash/baseline-aware text writes and conflict preservation. Binary materialization added locally. Symlink/case behavior and full crash qualification incomplete. |
| P10 — Durable room | Sequenced encrypted batches, receipts, reconnect and hibernating room are real. Active room lacks the specified durable snapshot/compaction/bootstrap system; app still supplies renewable tickets. |
| P11 — Binaries | Committed state library-only; dirty tree wires encrypted chunks, manifests and checkpoint content. Immutable storage enforcement, resumable transfer, large-file and LFS qualification remain. |
| P12 — Access/lifecycle | Real authenticated sessions/invites/membership/key sharing. Local rotation added. Pause/close complete immediately without final daemon durability/checkpoint handoff. |
| P13 — Session Workbenches | Dedicated clone creation now wired locally. No completed project Workbench switcher/idle lifecycle; activation happens before CRDT readiness. |
| P14 — Create | Current/new branch and dirty inclusion choices added locally. Exact-base dirty import, failure/retry and ready-before-activation gates not met. |
| P15 — Invite/resume | Actual Inbox acceptance and dedicated provision path exist locally. Exact-state bootstrap and app-independent restart/resume remain incomplete. |
| P16 — Leader | Room-authoritative renewable lease, generations and routed manual requests are wired. Two-Mac credential/partition/failover qualification pending. |
| P17 — Checkpoint | Captures room barrier and builds Git tree using temporary index; ordinary push is not forced. Active builder uses participant repository rather than complete hidden-mirror isolation; filter/LFS and durable failover gates remain. |
| P18 — Baseline adoption | CAS ref/index advancement preserves working files; implementation and tests exist. Current CI fixture failures and two-Mac acceptance unresolved. |
| P19 — External Git | Branch/operation pause and leader-side outside-push integration implemented. Full Adopt Git result / controlled Sync UX and external-transition matrix incomplete. |
| P20 — Target tracking | TargetWatcher and UI expose ahead/behind/overlap recommendations; no automatic rebase. Product-run qualification pending. |
| P21 — Rebase | Actual isolated worktree rebase, live integration and force-with-lease path exist. Active recovery state is in memory; conflict flow can import markers into shared state, rather than the plan's isolated durable conflict-resolution workflow. |
| P22 — Merge/PR | Immutable last-checkpoint preview, merge/squash push and PR links exist. Does not force a fresh checkpoint; PR path opens a creation page rather than creating/updating a PR itself. |
| P23 — UI cutover | Daemon session UI mounted, but app ticket/key ownership and legacy branch-based collaboration remain. Dirty UI wiring currently fails typecheck. |
| P24 — Capabilities | Test evidence exists; complete real capability matrix, private-worktree adoption and packaged qualification not established. |
| P25 — Media | Deferred; stub removed. Required microphone/TURN/background policy is not delivered by this branch. |
| P26 — Legacy removal | Not done. Renderer Yjs provider/writeback/binary hooks and legacy Git owners still have production callers. |
| P27 — Release qualification | Not done. Ledger records unsigned packaging and two copies on one Mac, not signed packages on two independent physical Macs. |

## Concrete gaps to resolve before claiming completion

1. **Background authentication and restart.** `CollaborationSessionHost.currentToken` waits for `onTicketNeeded`; `daemonSessionConnector` refreshes through the app. `ProjectdServer` keeps live hosts in a Map populated on attach. A daemon process surviving Electron is not sufficient: token expiry/reconnect or daemon restart still needs the client. See `CollaborationSessionHost.ts:596`, `ProjectdServer.ts:177`, and `identity/BackgroundDeviceIdentity.ts`.

2. **Local idling can still detach.** `useLiveSession.ts:148` disables the daemon hook outside the dedicated workspace, while `useDaemonCollaborationSession.ts:121` interprets disabled as detach. Opening an ordinary workspace on the same session branch can therefore detach the background session. Cleanup now only stops listening, but this separate effect still violates the intended local-idle policy. This is a source-level finding, not a rendered reproduction.

3. **“Ready” precedes hydration.** Start and Inbox call `ensureSession` with `setActive: true`; provisioning saves/activates a workbench before the later route attaches and reconciles the CRDT host. Start then announces “Live session started.” The plan requires exact materialization before activation. The new dirty-import helper also copies the entire source working tree, not a captured delta against the selected immutable branch basis; alternate-base and concurrent-writer behavior needs correction/qualification.

4. **Merge can omit live work.** `CollaborationSessionHost.ts:481` previews `mergeInput()` containing only the last checkpoint and unsaved count. It does not flush/barrier/checkpoint first. Section 22 and M01 require the latest live state. `SessionMerger.ts:121` explicitly previews the last save; PR fallback is a URL.

5. **Pause/close lack handoff.** `convex/collaborationSessions.ts:941` transitions through PAUSING to PAUSED in one mutation; close similarly completes without a final snapshot/checkpoint or unpublished-work decision. Lifecycle labels alone do not implement the required durability boundary.

6. **Binary chunks are not immutable at the storage boundary.** The new `sessionBinary.ts` unconditionally puts bytes at a caller-selected existing object key. Integrity checks catch corruption when reading, but cannot recover overwritten prior ciphertext. Upload/download loops also have no durable progress/resume protocol. The client currently buffers the complete asset during reconstruction.

7. **Rebase durability is incomplete.** `AutoGitAgent` stores pending rewrite state on the instance; `computeRebase` sets `this.rebase` after live integration. No durable production recovery journal captures that handoff. Conflict approval can squash onto the target with shared conflict markers, a different behavior from preserving/resolving the isolated original rebase.

8. **Filesystem coverage is narrower than the plan.** `CollaborationSessionHost.ts:74` uses 512 KiB text classification versus the plan's initial 8 MiB. Larger valid text becomes binary locally. `seedFromFolder` skips symlinks; `ConflictEngine.ts:34` always lowercases paths. Do not mark symlink/case-sensitive APFS tests complete based on model-only support.

9. **There are still multiple owners.** `ProjectSyncProviderRuntime.tsx` imports/mounts `YjsProjectProvider`, `useBinaryFileSync` and `useYjsFileWriteback`. `collaborationGate.ts` falls back to shared-branch equality without a session record. Existing GitSyncService and other Git callers remain. This is explicit P26 work, not merely stale unused files.

## Document and product-decision drift

- The status ledger's P11/P13 “library only” lines predate current dirty wiring; P12 “no mounted create or join” and P15 “no automatic folder” also predate committed changes. Conversely, top-level progress notes are not evidence that phase gates passed.
- PR #168's deployment paragraph says P20–P22 backends are pending. Later committed ledger entries record a Convex redeploy and Worker version `37102137-9d64-49f0-9d44-37667e011819`. These contradict the PR description. Deployment reports were read, not independently revalidated against running production in this audit. Current dirty binary/keyring backend additions have no matching deployment evidence here.
- The ledger records earlier user decisions to share ignored env files by default and use the person's Git setup. Those differ from the unchanged supplied plan (C40 and bundled/scoped Git credential design). Local credential-URL preservation differs further from Sections 17.4 and 27. These need a reconciled specification; historical statements in documents are not new instructions to this audit.
- `.agent/CONTINUITY.md` still described a September 9 editor-centric branch and persistent implementation goal. That briefing is stale for this checkout and this read-only assessment request.

## Verification performed

Docker is installed but its daemon is unavailable (`/var/run/docker.sock` absent). Existing host Bun/toolchain was used; no dependencies or system packages were installed. Tests use the repository's temporary state isolation. No application/session was manually started, no remote changes were requested, and no source implementation was edited.

| Check | Result on dirty tree |
|---|---|
| `bun run typecheck` | FAIL: `LiveSessionBar.tsx:73` still calls removed `switchToBranch`; `ProjectLayout.tsx:327` passes removed `onBranchSwitched`. |
| `bun run typecheck:electron` | PASS |
| `bun run typecheck:projectd` | PASS |
| `bun run typecheck:cloudflare` | PASS |
| `bun run typecheck:tests` | FAIL: unused `publicSessionId`, `collaborationSessionsAccess.test.ts:192`. |
| `bun run lint` | Exit 0, one warning for that same unused variable. Root lint script does not include projectd/Worker source directories. |
| `bun run test -- tests/projectd tests/collaboration` | 42 files pass, 1 fails; 302 tests pass, 1 fails, 1 skips. AutoGit first pair fails to become live after `RECONCILE_FAILED: fetch failed`. The fixture contains a PNG and now exercises the newly wired object transport; the fixture has not been adapted to provide that transport. |
| `bun run build:projectd` | PASS |
| `bun run build` | PASS; bundling does not replace the failing TypeScript checks. |
| `git diff --check` | PASS |

PR #168's [Navigation Runtime Validation run](https://github.com/Cozea/electron-app/actions/runs/34680493128) reports **11 failing tests across six files**, 3,034 passing tests and 21 skipped. Failures include Git identity absence, missing macOS helper in a Linux filesystem test, missing daemon artifact/lifecycle assertion, and a rebase-resolution timeout. Current local patches address some of these; no passing remote rerun was observed.

Full repository tests, fresh standalone Convex typecheck, signed packaging, actual two-Mac runs and production deployment verification were not performed. Historical ledger results are kept separate from checks run here.

## Recommended continuation

1. Make the present work reviewable: finish renamed callers, fix fixture/typecheck failures, include the three required untracked files, and keep unrelated submodule dirt separate.
2. Complete the background lifecycle first: daemon identity/ticket renewal, durable attach/session restore, rotation/replay, and pause/close handoff.
3. Finish P13–P15 as one coherent path: exact branch basis, scoped dirty import, hydrate before activation, persistent switcher and background idling.
4. Qualify binary immutability/chunk recovery, filesystem coverage and Git filter/LFS publication; then durable rebase and latest-barrier merge behavior.
5. Reconcile the plan/ledger/PR descriptions with the accepted product choices, retire the old owners, then run the full signed two-Mac matrix.

Do not jump straight to P26 deletion or P27 qualification on the strength of the current phase labels. The preceding production lifecycle gaps are still observable.
