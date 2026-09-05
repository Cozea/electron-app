# Collaboration continuation: PR handoff

## Status and release decision

Supervised continuation on `codex/collaboration-v2-complete`, 2026-09-05.
The user has authorized supervised implementation and all feasible automated and
packaged GUI acceptance, with the Computer plugin for desktop interaction. Its
tools are not yet available in this task; installation guidance has been supplied.
This PR implements
substantial hardening, **not every remaining item in the original completion
plan**. Known code blockers below must not be relabeled as manual QA.

Both default/release gates remain disabled:
`VITE_GITHUB_COLLABORATION_RELEASE` and `COLLABORATION_G3_CREATE_ENABLED`.
Compatible production Convex and Worker code is deployed with new-session creation
disabled. The signed webhook endpoint is configured and tested with a synthetic
ping; GitHub's App webhook configuration API returns 404, so actual GitHub delivery
and OAuth remain unverified. The collaboration-only alpha inventory was empty and
no data was deleted. No main push, release tag or packaged acceptance occurred.
Ordinary project synchronization and the pinned T3 fork are retained. Exact
deployment and inventory evidence is recorded in
[the deployment note](current/collaboration-gated-deployment-2026-09-05.md).

## Implemented in this continuation

### Native authority and owned-process shutdown

The maintained prebuild T3 source overlay guards write-capable provider methods,
terminal operations, mutating RPC handlers and queued command execution. Native
requests use the inherited parent IPC route to main; canonical catalog bindings
and freshly authenticated session authority determine admission. Nested ordinary
bindings cannot hide an enclosing session. Generic native Git mutations are denied
in session workspaces; publication uses the exact collaboration commit pipeline.

Revocation fences late grants and drains admitted work before acknowledging scoped
provider/terminal shutdown. A disconnected-but-not-exited child is not success.
Native resource owners must be registered before a shutdown acknowledgement.
Feedback upload is guarded because the native implementation may recover a provider.
Interrupt remains available for active work but must not resurrect a stopped agent.
The native regression retains a stopped thread binding and verifies repeated
interrupts do not start it or disturb an unrelated active thread.

Child termination now waits for observed exit, with bounded TERM-to-KILL escalation
and retryable failure. Proxy-close failure does not skip T3 process termination.
These are application authorization and ownership controls, not a new OS sandbox.

### Durable application and session exit

Renderer edits awaiting main-process durable acceptance veto whole-window unload.
The view-independent editor queue retains failed IPC writes. Once renderer unload
consent succeeds, application `will-quit` prepares collaboration recovery before
catalog/native disposal. Failed preparation leaves owners available; successful
partial shutdowns are not repeated against destroyed CRDTs.

Runtime shutdown fences new work and drains already-entered editor, file,
checkpoint, projection and transport operations. The transport detaches/fences
socket callbacks before awaiting encrypted incoming/outgoing/recovery work. The
final store flush occurs after receive callbacks finish. This fixes an actual
full-suite race where an observer recreated recovery files after shutdown.

### Exact commit review and explicit binary selection

The review reads the prepared commit's immutable Git objects, verifies its parent,
and displays text diffs and binary summaries without invoking external diff or
text-conversion helpers. It never reviews an evolving worktree/index. The UI
requires review acceptance and sends the exact reviewed SHA with Push.

The binary picker enumerates Git-only regular-file candidates, defaults to no
selection, and binds byte contents, executable mode and deletion state by hash.
Preparation rechecks selected snapshots; changed bytes/modes are rejected rather
than silently included. Ordinary text cannot bypass the acknowledged CRDT barrier
by being submitted as a binary. Deprecated direct prepare/push IPC bypasses reject.

### Conservative local storage retention

Store writes use shared admission across independent handles and key versions.
Store/projection allocation checks count interrupted writes and retained backups,
with a 1 GiB application recovery budget and 256 MiB per-room store budget.
Full storage pauses new allocations; it never causes eviction of unpublished work.
Metadata-only inventory returns counts rather than source paths, text or keys.

Explicit catalog-associated cleanup authenticates the exact replacement checkpoint,
then deletes only covered receive-log records in bounded batches. Outboxes, editor
ingress, pending checkpoint uploads, sealed keys, prepared Git objects, retained
workspaces, unknown temporary files and projection backups are not deletion targets.
Server checkpoint replacement now records durable cleanup cursors, and closed
rooms retire bounded receipt metadata while retaining encrypted recovery. Local
sealed-key/basis retention now uses conservative dependency proofs and bounded
storage admission. See [local key retention](current/collaboration-local-key-retention.md) and
[checkpoint retention](current/collaboration-checkpoint-retention.md).

### Initializer, projection and offline recovery

Canonical room catch-up precedes optimistic replay. Accepted initializers with
lost replies, renewed leases and repeated key rotation recover with stable Yjs
and encrypted operation identities. Competing histories become encrypted recovery
entries with explicit Save-as-new and Discard controls. Startup/watchers preserve
quarantined paths, including offline creates/renames and later disk variants;
resolved paths cannot silently reimport themselves. Journal mutations serialize
while transport acknowledgement waits remain independent. Behavioral evidence and
the controlled fixture boundaries are documented in
[initializer recovery](current/collaboration-initializer-recovery.md).

## Verification and what it proves

The recovery milestone at `85a385c5` passed immutable CI run `33953113424`,
including all application/native typechecks, lint, the full behavioral suite,
repeated recovery/shutdown checks, provider compatibility and production build.
Subsequent changes require their own checks.

Target advancement controls now retain an immutable starting target SHA and offer
continuation or End followed by reviewed Start. See
[target branch changes](current/collaboration-target-branch.md).

Earlier work used GitHub Actions and a Linux conversation container. The current
supervised continuation uses the macOS worktree and installed toolchains. Local
behavioral tests and production dry runs supplement the immutable CI results;
neither establishes packaged multi-device acceptance.

The integrated hardening at `38d45e9e` passed run `33943061753`, including native
typecheck, 103 focused regressions, three consecutive session-runtime recovery
runs, all four application typechecks, lint, the full behavioral suite, provider
compatibility/native suites and production build. The final stopped-interrupt and
feedback-admission changes are verified by the finalization/PR runs rather than
being attributed to that earlier run.

The retained read-only `Collaboration v2 branch validation` workflow checks the
actual source and PR merge candidate, not a patch applied only during testing.
Temporary integration drivers and write-capable task workflows are removed from
the finalized tree. Use the final PR head's checks as the review result. None of
these checks establishes packaged, independently authenticated production acceptance.

### Local native entrypoint evidence (2026-09-05, continuation from `aff1c8be`)

The maintained overlay now adds an authority-enabled test of the actual native
`ProviderService` entrypoints and production terminal-authority wrapper. Controlled
trusted-host IPC replies deny observer/revoked/closed requests before adapter
start/send/feedback and terminal open/write/restart effects execute. A deferred
adapter start holds Stop acknowledgement pending; the second owner sweep stops its
late session. An unrelated provider and terminal remain usable, stopped threads
cannot relaunch before explicit activation, and reactivation restores editor work.
The existing native stopped-interrupt regression remains in the ordinary suite.
`test:provider-compatibility` runs this test separately with authority enabled, then
runs the forked guard/IPC smoke. The smoke has bounded child-exit cleanup.

Local evidence: 37 focused desktop authority/shutdown tests passed; 95 native
ProviderService/ACP tests passed in a focused run; the separately selected native
entrypoint test and forked IPC smoke passed. Native typecheck and compatibility
manifest checks, focused oxlint, and overlay-receipt consistency checks passed.
The broad compatibility run had **1 failure / 1,564 passed /
8 skipped**: ACP `completes session/load after replay becomes idle while its RPC
stays pending` hit its two-second timeout. Its focused pass does not resolve the
broad-run failure or establish that it is a preexisting baseline failure.

The parent supervisor subsequently reran the entire compatibility command without
competing builds/typechecks. It passed: **122 files, 1,565 tests / 8 skipped**, then
the separate authority regression and installed IPC smoke passed. This establishes
a successful complete local run; the earlier ACP timeout remains an intermittent
failure to track, not a proven baseline issue. Log: `/tmp/cozea-supervised-native-validation.log`.

These tests use controlled authority decisions and simulated provider/PTY engines.
They prove service admission/ownership behavior, not Convex authentication, actual
provider/PTY process termination, full WebSocket routing, or packaged acceptance.

## Remaining release-blocking implementation

1. Finish external CLI rename identity reconciliation and the complete concurrent
   edit/delete/path-collision matrix. Explicit CRDT rename is not proof of arbitrary
   external rename detection.
2. Complete the full retry/leave/onboarding
   matrix after runtime restart or authorization failures.
3. Complete in-app reading/export of encrypted-only retained recovery after End;
   folder discovery and safe cleanup are available. Preserve unpublished and unknown
   recovery; repeat the completed production/local inventory before rollout.
4. Validate OAuth end to end and activate/verify actual GitHub webhook delivery.
   Deploy subsequent compatible changes with creation disabled, then execute the
   complete independently authenticated packaged acceptance worksheet.

## Deployment-owner sequence

Read the historical credential handoff without printing secret values. Verify the
actual GitHub App, installation scopes, Worker configuration and current production
schema before changing any service. Do not assume historical credential state is a
current successful OAuth or webhook test.

Keep ordinary clients compatible and session creation disabled during deployment.
Only `bunx convex deploy` is permitted for approved Convex production deployment;
never invoke a development deployment. Use the existing Worker/container deployment
workflow. Do not install a webhook endpoint against incompatible code or report it
active before a signed delivery has been verified.

Inventory generation-owned Convex rows, room objects and local caches before any
reset. Preserve identities, projects, chats, ordinary folders, Git history and all
unpublished recovery. Rollback disables creation; it does not delete recovery.
There is no complete reset executor or deployment automation delivered in this PR.

## Packaged acceptance worksheet

Use two separately initialized device identities and independently authenticated
GitHub/Cozea sessions, including one fresh checkout/package. Merely opening two
windows against the same user-data directory is not this test. Use an explicitly
approved restricted acceptance configuration; do not generally enable production
session creation just to run QA.

| Scenario | Required result |
| --- | --- |
| Ordinary project, both gates off | Existing offline project editing/sync and unrelated chats remain usable. |
| Connect/start/join/observer | Verified repository identity; explicit join; no incidental import of another participant's local changes. |
| Native observer denial | Direct native RPC/provider/terminal writes fail; no native process is launched by a stopped-thread interrupt or feedback-recovery path. |
| Revocation and Leave | New admissions fail; the owned agent/terminal/preview actually stops; unrelated active work remains running; unconfirmed stop exposes retry. |
| Renderer IPC failure and close | Failed or in-flight edits block closure, remain queued, and can be accepted/retried without losing their identity. |
| Quit and controlled update | Cancel-close retains services; durable prepare precedes disposal; failed stop/persistence remains retryable; controlled continuation is not doubled. |
| Offline/restart recovery | Ciphertext persists before acknowledgement; accepted text converges after restart; previous-key work is never silently discarded. |
| Exact commit and binaries | Every acknowledged shared-text edit through the barrier is included; only selected binary snapshots are included; later text/index/binary changes remain outside the reviewed commit. |
| Push/adoption | Push is explicit and non-forced; lost responses are recoverable; all participants adopt the verified commit without overwriting newer shared text or local binaries. |
| Storage exhaustion/cleanup | Quotas pause writes visibly; authenticated covered-log cleanup is bounded; pending edits/keys/backups and ordinary projects are unchanged. |
| Compaction/rotation/advanced target | Complete the remaining implementation first, then verify lost replies, offline members, repeated removals and non-fast-forward handling without auto-merge/rebase. |

Record package/source SHA, native pin/overlay identity, both public device IDs,
deployment revisions, each result and content-free failure diagnostics. Never place
access tokens, private keys or source-file contents in the acceptance log. Only
consider enabling the release after both code blockers and the complete worksheet pass.
