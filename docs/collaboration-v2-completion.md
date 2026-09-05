# GitHub-backed collaboration completion

Status (2026-09-05): the continuation from `2d861c60` implements native-authority, shutdown, immutable commit-review and bounded local-recovery hardening on `codex/collaboration-v2-complete`. The original PR #141 foundations and provider pin `f2df43a98` are retained. This is not a completed collaboration release; remaining code blockers are listed below, separately from packaged acceptance.

The user authorized all feasible continuation work and will perform final packaged two-device testing. Read `docs/collaboration-v2-pr-handoff.md` first. Both release gates remain disabled; no deployment, collaboration reset or release has been performed by this continuation.

## Scope and release gate

GitHub-backed code collaboration, whole acknowledged shared-text commits, optional publisher-owned binaries, reviewed local-text import, isolated session workspaces, and collaboration-only alpha reset. Media is deferred. Preserve identities, projects, chats, ordinary folders and Git history. Existing project synchronization remains available while the new runtime is incomplete.

- [ ] 1. Reconcile main; verified installations and room authority.
- [ ] 2. Workspace lifecycle and Start/Join/Resume/Leave/End UI.
- [ ] 3. Encrypted bootstrap, editor/file operations and durable recovery.
- [ ] 4. Exact Commit, verified Push, participant adoption and safe compaction.
- [ ] 5. Observer, onboarding, project-opening and error flows.
- [ ] 6. Alpha inventory/reset, compatible deployments and packaged two-device acceptance.

All standard typechecks, lint, tests and production builds must pass. Two independently authenticated packaged devices must then complete the deployed workflow, including offline/restart recovery and exact publication. Simulated room tests are not this completion gate.

## Implemented foundations

- Server-authenticated GitHub setup requests expire and bind the device to its Cozea organization. OAuth enumerates accessible installations and verifies account ownership or GitHub organization administration. Only verified catalog entries can enable project repository bindings. A shared installation revocation record invalidates all associated entries without pagination; setup verification timestamps precede repository enumeration so an in-flight setup cannot bypass revocation. Exact remote branch resolution produces an expiring server proof required for session creation.
- The room rechecks device/session/repository authority for every operation and periodically for idle sockets. Observers cannot submit updates or barriers. Encrypted envelopes validate room, operation, key version, IV/tag structure and size; malformed records pause recovery.
- Session-specific key APIs derive the authenticated sender, require active membership, validate the wrapping identity, and require the current key before sharing with another active participant. Legacy project-key APIs reject session rooms. New-device initialization is elected server-side; other devices wait for wrapped keys.
- `SessionWorkspaceCoordinator` creates catalog-reserved linked worktrees at the verified base and resumes without resetting dirty work. Reviewed text imports recheck content hashes. Leave restores the source-workspace binding and retains session data. Temporary-index commit preparation preserves evolving working files. Explicit Push sends only the prepared object to the session branch without force; retries first check server verification.
- `CollaborationSessionRuntime` owns the main-process file CRDT, transport, acknowledged state and encrypted recovery. Electron registers one application-scoped host and IPC surface. The gated header controls and editor subscribe to that host; session workspaces never start the legacy project transport or watcher.
- Stable file IDs separate text from paths and tombstones. Concurrent rename/edit and delete/edit retain text. Path collisions are explicit. External edits can be interpreted against the last projected CRDT state. Lazy Git-file initialization uses a room lease; ordinary editor updates cannot create files or change path metadata.
- Outbound ciphertext is persisted before send and removed after durable acknowledgement. Incoming state advances only through contiguous, durably logged sequences. Large updates use bounded, checksummed chunks; room chunk storage survives reinstantiation.
- Encrypted CRDT checkpoints retain Yjs identities with garbage collection disabled. One device creates canonical bootstrap. Upload ciphertext is persisted locally so retries reuse the same IV/envelope; a replacement checkpoint becomes durable before covered local logs or old room checkpoint pieces are removed.
- Verified publication inserts a durable delivery record in the same Convex transaction as base advancement. A scheduled internal action retries the authenticated room handoff. The room orders publications by publication revision, supports binary-only publications at the same text sequence, retains updates until an encrypted checkpoint covers them, and delivers the published base on reconnect. Verification receipts support retry after a lost response. Project deletion includes publication and branch-resolution rows.

## Integrated implementation

- The catalog-owned workspace lifecycle, main runtime host, encrypted key cache, offline restart, recursive watcher, durable projection recovery, and direct CRDT editor are wired into Electron and the project header. Failed editor writes remain queued across editor-view closure; encrypted ingress is saved before applying accepted edits. Starting and joining remain explicit.
- Projection uses encrypted baselines and write-ahead recovery, retains displaced files, and detects concurrent path conflicts. Publication fetch/adoption updates the branch and index while preserving newer shared text and local binary edits. Prepared commits can be recovered, renewed, pushed, or discarded explicitly.
- Organization-bound authorized repository download is integrated into workspace repair with progress, cancellation, and retry. Git credentials stay in main memory and subprocess environment. Interrupted checkout only fills missing indexed files; changed branch, HEAD, index, or working files stop recovery without overwriting data.
- Access removal freezes writes and rotates to a durable encrypted checkpoint before activating the replacement key. Remaining devices receive device-encrypted keys. Older pending ciphertext is copied under the new key with the original Yjs operation identities; old records are removed only after durable acknowledgement under the new key. Superseded pending rotations are replaced after a further removal.
- Generation-3 sessions use protocol 3.0; existing project synchronization keeps protocol 2.1. Server session creation requires `COLLABORATION_G3_CREATE_ENABLED=1`, and the renderer controls require `VITE_GITHUB_COLLABORATION_RELEASE=1`. Both remain disabled by default. Rollback disables creation without deleting recovery.
- Session exit suspends new workspace actions before stopping catalog-owned terminals and previews. Failed termination remains retryable. A missing original workspace does not leave write authority active.

## Continuation hardening implemented

- Native provider, terminal and mutating T3 RPC admission derives workspace authority through inherited main-process IPC, canonical catalog paths and fresh server membership. Revocation fences late admissions, drains admitted actions and stops only matching resource owners. Provider feedback upload is guarded; interrupting an inactive provider does not restart it. The native source overlay preserves unrelated fork edits with a digest receipt.
- Child shutdown awaits real exit, escalates when required and reports unconfirmed termination. Editor IPC queues block whole-window unload until durable acceptance. Application recovery preparation happens after renderer unload consent and before catalog/native disposal; partially stopped hosts remain safely retryable.
- Transport shutdown fences socket callbacks, drains recovery/incoming/outgoing work and waits for runtime file/checkpoint/projection producers before the final store flush. A real full-suite observer-recovery teardown race led to this fix; it was not hidden with test retries.
- Prepared review reads immutable Git objects, verifies ancestry, displays text/binary changes and binds Push to the exact reviewed SHA. Explicit binary selection binds bytes, executable mode and deletions, with checks during preparation. Ordinary text cannot bypass the shared barrier through binary selection. Deprecated direct prepare/push IPC paths reject bypasses.
- Recovery-store writes and projection allocations have 1 GiB aggregate admission and 256 MiB per-room store admission across key versions, counting existing temporary files and backups. Independent store handles serialize identity checks and mutation. Metadata-only inventory and catalog-associated cleanup authenticate a replacement checkpoint before removing at most 256 covered receive-log records per key per call. Unpublished records, keys, prepared commits, workspaces and backups are retained.

## Remaining implementation and acceptance gaps

1. Complete automatic replay for an unacknowledged lazy file initializer whose lease is replaced during key rotation. Existing code deliberately retains the source ciphertext and reports a recoverable diagnostic. Complete whole-host offline/lost-reply/repeated-removal rotation coverage.
2. Finish external CLI rename identity reconciliation and the complete concurrent edit/delete/path-collision matrix. Explicit shared rename operations already retain stable identities; arbitrary external rename detection is not complete.
3. Finish target-branch-advancement controls and the full restart/authorization-failure UI matrix. Host retry/shutdown handling is improved, not a substitute for all required user flows.
4. Complete room/checkpoint-history and sealed-key-history retention policy, plus the broader collaboration-only reset inventory. Local store/projection quotas and conservative covered-log cleanup are implemented; they are not a complete cross-service garbage collector or an implemented alpha reset.
5. Validate GitHub OAuth and configure/activate signed webhooks with the compatible gateway using deployment-owner credentials. No OAuth browser acceptance, webhook activation, Convex deployment, gateway deployment or reset was performed here.
6. After code blockers and restricted acceptance setup are ready, run the complete deployed packaged workflow with two independently authenticated devices, including a fresh checkout, offline/restart recovery, exact publication, base adoption, quota handling and compaction. Preserve identities, projects, chats, ordinary folders, Git history and unpublished recovery. Use only `bunx convex deploy` for approved Convex production deployment, never a development deployment.

## GitHub App setup state (historical credential handoff; not revalidated by this continuation)

The existing app is **Cozea Source Control**, app ID `3150202`, client ID `Iv23likWiGv8yC0Vufon`, owned by Cozea. Settings: <https://github.com/organizations/Cozea/settings/apps/cozea-source-control>.

On 2026-09-04T23:45Z the user supplied a newly generated PEM and displayed client secret. A signed GitHub App request verified app ID, slug and Cozea ownership. The gateway secret inventory confirms `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_JWK`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_CALLBACK_URL` are configured. Credential transfer used ephemeral RSA-OAEP encryption and Wrangler stdin; temporary transfer material was removed. No credential values were printed or committed. The user-owned PEM remains in Downloads with mode 0600. Original GitHub credentials remain untouched.

GitHub confirmed the OAuth redirect URI was saved as `https://cozea-collab.kelyan-engone.workers.dev/collab/github/callback`. The full OAuth flow is not yet validated. Setup URL remains empty and webhooks remain inactive. The user approved Members read; GitHub confirmed the permission update for Cozea installation `118021065`, preserving its existing repository scope. The separate personal installation was unchanged. The webhook at `/collab/github/webhook` still needs a matching secret and activation when the compatible gateway is deployed.

During the original credential setup, only gateway secrets, the GitHub callback and the approved installation permission changed. This continuation has committed and pushed source hardening, but has not deployed the application/Convex/gateway, changed credentials, activated webhooks or performed an alpha reset.

## Original implementation environment and baseline verification

Docker is unavailable; use existing local Bun without host system-package installation. Worktree dependencies link to already-installed root packages, including the pinned T3 package dependencies. Another task owns `provider-upstream`; do not touch it or unrelated root edits.

Behavioral coverage uses actual temporary Git repositories, real encrypted Yjs documents, filesystem recovery, and an isolated Durable Object runtime. Current tests include two main-process session runtimes editing through that room and recovering after restart, observer denial, canonical checkpoint retries, failed checkpoint persistence, older offline edits, exact temporary-index commits, non-fast-forward rejection and lost Git-push responses. Full checks are recorded in the workspace continuity file as they complete.

Verification (2026-09-05): after main reconciliation, full Vitest 2,258 passed / 7 skipped; application, Electron, test and Worker typechecks passed; lint and production build passed. A full-suite run exposed an in-flight projection seeing a new external file before its canonical disk baseline was saved. Waiting for existing projection work before file initialization/discovery fixed the race; the complete suite then passed. Existing Vite/SQLite warnings remain. These results do not establish deployed or packaged acceptance.
