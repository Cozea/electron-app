# GitHub collaboration implementation handoff

> Historical handoff at `2d861c60`. The subsequent continuation is documented in
> `docs/collaboration-v2-pr-handoff.md`; use that and the updated completion document
> for current code status. Both gates remain off and release-blocking work remains.

## Assignment

Continue the approved end-to-end GitHub-backed code collaboration plan on
`codex/collaboration-v2-complete` in `Cozea/electron-app`. The user requested this
handoff and publication of the branch; the previous agent stopped implementation
at that request. The feature is incomplete and must remain gated.

Read `AGENTS.md`, `.agent/CONTINUITY.md` when available, and
`docs/collaboration-v2-completion.md` before editing. The completion document is
the current status; the older documents under `docs/current/` describe the
original PR foundations and are not evidence of completion.

The existing local worktree is
`/Users/admin/cozea/electron-app/.agent/worktrees/collaboration-v2`.
Checkpoint `41b7b17b` integrates PR #141 and the collaboration implementation.
The subsequent merge reconciles committed main `bbf9ceab` and provider fork
`f2df43a98bc42936dd2a031d832c8c4dae53398a`. That fork commit is available remotely
on `Cozea/t3code`, branch `codex/provider-qa-fixes`. Do not change the root checkout
or another task's uncommitted provider work. Initialize the submodule from
`.gitmodules`; this worktree's historical local origin still names upstream.

## Product contract

Connect GitHub → open project → explicitly start/join → edit together → commit
the exact acknowledged shared-text barrier → explicitly push the session branch
→ every participant adopts the verified commit → leave/resume/end safely.

GitHub is required for live sessions, while ordinary local projects remain
usable. Code only; no audio or screen sharing. Importing existing local text is
reviewed and optional when starting; joining never imports unrelated changes.
Commit includes all shared text through its barrier and only explicitly selected
publisher binaries. Never broadly commit an evolving working directory, force
push, or automatically merge/rebase an advanced target branch.

## Implemented entry points

- Main: `apps/desktop/electron/collaboration/SessionRuntimeHost.ts`,
  `CollaborationSessionRuntime.ts`, `SessionWorkspaceCoordinator.ts`,
  `SessionFileProjection.ts`, `AuthorizedRepositoryDownloader.ts`,
  `registerCollaborationHandlers.ts`.
- Recovery: `DurableSessionStore.ts`, `SessionKeyCache.ts`, `SessionKeyManager.ts`,
  `SessionKeyRecovery.ts`, `SessionCheckpointClient.ts` in that directory.
- Shared CRDT/transport: `shared/SessionFileDocument.ts`,
  `CollaborationTransport.ts`, `AcknowledgedCollaborationState.ts` and
  `collaboration*.ts` contracts.
- UI: `apps/desktop/src/features/collaboration/ProjectCollaborationControl.tsx`,
  `SharedSessionEditor.tsx`, `runtime/SessionEditorBridge.ts`.
- Backend: `convex/collaboration*.ts`, `convex/lib/collaboration*.ts`,
  `cloudflare/worker/src/routes/collaboration*.ts`, and the encrypted room/checkpoint
  implementation under `cloudflare/worker/src/`.
- Behavioral tests: `tests/collaboration/`. These use actual temporary Git
  repositories, encrypted Yjs states and an isolated room; retain this approach.

## Start with these blockers

1. Enforce observer/session authority at the native T3 provider/RPC boundary.
   Current main workspace IPC guards do not cover direct native T3 agent commands.
   Leave/revocation now suspends new workspace actions and awaits owned terminal
   and preview termination, but running agents still need shutdown. Inspect
   `apps/server/src/t3Bootstrap.ts`, `apps/server/src/t3/orchestrationProxy.ts`,
   the pinned provider service, and the maintained runtime-patch machinery in
   `scripts/prepare-t3-runtime.mjs`. No T3 authorization patch has been started.
2. Finish automatic replay for an unacknowledged lazy file initializer whose
   lease was invalidated by key rotation. Current migration retains its original
   ciphertext and reports a recovery diagnostic. Add whole-host rotation tests
   with offline edits, lost replies and repeated removals.
3. Finish external CLI rename identity handling, whole-window close protection
   for editor updates awaiting IPC acceptance, prepared-commit diff review and a
   proper binary-selection UI. Harden failed runtime restart/authorization states.
4. Bound retained storage across key versions, checkpoint history and projection
   backups; implement explicit catalog-owned cleanup, content-free diagnostics,
   and target-branch-advancement controls.
5. Complete GitHub onboarding/webhooks, the collaboration-only reset inventory,
   compatible production deployment, and the complete packaged acceptance matrix.

Both release gates remain off by default:
`VITE_GITHUB_COLLABORATION_RELEASE` and `COLLABORATION_G3_CREATE_ENABLED`.
Generation-3 session protocol is 3.0; legacy project synchronization keeps 2.1.
Do not disable legacy synchronization on ordinary workspaces. Session workspaces
must not run a second renderer transport or the legacy project watcher.

## GitHub and deployment state

The user authorized the full original implementation, including main/auth/schema
changes, compatible deployment and a collaboration-only alpha reset. They later
asked this agent to stop and hand off. No source deployment, Convex deployment,
reset, main-branch push or release was performed by this collaboration task.

GitHub App: **Cozea Source Control**, app `3150202`, client
`Iv23likWiGv8yC0Vufon`, owner Cozea. The gateway already has the App ID, private
JWK, client ID/secret and callback URL in Worker secrets. Never print them.
The user-owned PEM remains at
`/Users/admin/Downloads/cozea-source-control.2026-09-04.private-key.pem` with
mode 0600. Original credentials were preserved. Members read was approved and
accepted for Cozea installation `118021065`; existing repository scope and the
separate personal installation were preserved.

OAuth callback is configured as
`https://cozea-collab.kelyan-engone.workers.dev/collab/github/callback`.
OAuth end-to-end validation is pending. Webhooks are inactive and their secret
is unconfigured; set up the signed `/collab/github/webhook` endpoint with the
compatible gateway. Worker `cozea-collab` uses account
`c9081ef53a698d2ee92516a8a7752ebc`. Wrangler configuration is
`cloudflare/worker/wrangler.jsonc`; its container binding may require the existing
image build/deployment workflow.

Only use `bunx convex deploy`, never a development deployment. Inventory obsolete
collaboration rows, room storage and local caches before resetting anything.
Preserve identities, projects, chats, all ordinary folders and Git history.
Rollback disables new session creation and retains unpublished recovery data.

## Verification and completion

After reconciliation, full Vitest passed **2,258 tests / 7 skipped**. Application,
Electron, test and Worker typechecks, lint and production build also passed
before handoff publication. Earlier full-suite testing exposed an in-flight
projection racing newly discovered files; draining projection before file
initialization/discovery fixed it. A clean focused run alone did not expose it.

Docker is unavailable on this machine. Existing local Bun dependencies were used,
without system package installation. No dependencies were added. This worktree's
node_modules links reference the existing root installation. A fresh checkout
must bootstrap the pinned runtime before packaged tests.

Do not call this complete until two independently authenticated **packaged**
desktop instances, including a fresh checkout, complete the deployed workflow
with offline/restart recovery, exact publication, base adoption and checkpoint
compaction. None of that deployed packaged acceptance has been performed yet.
