# Collaboration continuation: PR handoff

## Status and release decision

Continuation from `2d861c60` on `codex/collaboration-v2-complete`, 2026-09-05.
The user will perform final packaged two-device acceptance. This PR implements
substantial hardening, **not every remaining item in the original completion
plan**. Known code blockers below must not be relabeled as manual QA.

Both default/release gates remain disabled:
`VITE_GITHUB_COLLABORATION_RELEASE` and `COLLABORATION_G3_CREATE_ENABLED`.
No deployment, webhook activation, collaboration-only alpha reset, main push,
release tag, credential change or packaged acceptance was performed by this
continuation. Ordinary project synchronization and the pinned T3 fork are retained.

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
This is not a complete cross-service garbage collector: sealed-key history and room
storage policies still require completion.

## Verification and what it proves

GitHub Actions supplies the pinned build toolchains in isolated checkouts. The
Linux conversation container has no network/dependency installation; local checks
there used source inspection and targeted Node/TypeScript-transpiled real-Git and
filesystem experiments. No local macOS checkout or credentials were accessed.

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

## Remaining release-blocking implementation

1. Automatically recover/replay an unacknowledged lazy initializer after its lease
   is replaced by key rotation, with whole-host offline/lost-reply/repeated-removal
   coverage. Existing code retains ciphertext and reports a diagnostic; it does not
   complete this replay path.
2. Finish external CLI rename identity reconciliation and the complete concurrent
   edit/delete/path-collision matrix. Explicit CRDT rename is not proof of arbitrary
   external rename detection.
3. Complete advanced-target-branch controls and the full retry/leave/onboarding
   matrix after runtime restart or authorization failures.
4. Finish sealed-key and server room/checkpoint-history retention, plus bounded
   cross-service generation-reset inventory. The new conservative local cleanup
   must not be broadened into blind directory/row deletion.
5. Validate OAuth end to end, configure and activate the signed webhook, and perform
   compatible production deployment using deployment-owner credentials. Then
   execute only an inventoried, approved collaboration-owned reset, if still needed.

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
