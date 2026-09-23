# Upstream provider integration plan

Status: implementation and available-host verification complete in `codex/provider-upstream-integration`; release qualification limits are recorded below.
Prepared: 2026-09-05T04:47:58+08:00.

## Objective and acceptance

Adapt the upstream T3 provider improvements to Cozea while preserving existing conversations, provider-instance identity, the workbench, and Cozea's browser/DevApp integration. Ship the Codex resume repair independently, then integrate a coherent upstream server baseline and expose the agreed features through Cozea's own UI.

Completion requires all of the following:

1. Codex conversations containing completed sub-agents and supported rate-limit error history resume using their original native thread IDs.
2. Codex asynchronous questions work during active turns and after completion/restart, without being mistaken for blocking RPC questions.
3. Users can explicitly compact a conversation when its provider supports the operation.
4. Opt-in continuation works through Cozea-controlled app/server updates, with one continuation owner and no duplicate submissions.
5. OpenCode approval, cancellation, reconnect, process-isolation, and progress fixes reach Cozea's UI.
6. Antigravity has an end-to-end local setup and chat path, with truthful capability restrictions and isolated provider accounts.
7. All four existing primary providers retain their baseline behavior, including native history, drafts, skills, model controls, approvals, artifacts, and managed preview tools.
8. Clean-checkout preparation and the packaged application run the same reviewed fork revision. Compatibility and data-migration tests pass before rollout.

## Verified baseline

| Item | Inspected value |
| --- | --- |
| Cozea fork pin | `46c3f1217730a819fc79e95b7684784312269602` |
| Frozen upstream candidate | `0a590fa01af66ec135d2ebf2d5542b08a37dc275` |
| Common ancestor | `a3a8cbd60539b4af4de8f96c892dbd07a2b6c041` |
| Divergence by ancestry | 10 fork-only commits; 495 upstream-only commits |
| Integration preview | `git merge-tree --write-tree --name-only HEAD origin/main` found 10 conflicting paths; working checkout unchanged |
| Codex schema source reference | Both trees retain `678157acaa819d5510adfe359abb5d0392cfe461`; upstream adds compatibility overrides |
| Local database changes | Upstream introduces migrations 044–047; downgrade compatibility is not yet established |
| Workspace condition | Existing uncommitted history, composer, provider-update, and Dockview work must be preserved |

The candidate is a fixed research snapshot, not an instruction to track moving `main` during implementation. At implementation start, record current refs and any new upstream fixes separately. A changed target requires an updated comparison and test matrix.

The August architecture documents describe earlier stages of the T3 cutover. This plan uses the current spawned T3 server and RPC bridge; it does not repeat the original runtime migration.

## Scope and integration strategy

Use two deliverable tracks in sequence:

- **Repair release:** backport the small, upstream-owned Codex compatibility changes to the current Cozea fork. Keep this independently releasable.
- **Integration release:** merge the frozen upstream baseline into the repaired Cozea fork, reconcile Cozea extensions, update the parent contract/transport boundary, and adapt the feature UI. Preserve upstream ancestry so subsequent updates remain reviewable.

The upstream merge imports a coherent server implementation, including its dependency and persistence changes. Only the feature surfaces in this plan are enabled or exposed intentionally. Audit new default behavior, RPC capabilities, and persisted event types even when their corresponding upstream UI is not adopted.

Keep Cozea's Dockview layout, capsule composer, device identity, Convex/Yjs collaboration, workspace ownership rules, native history associations, skill library, and release distribution. Do not adopt T3's desktop/web/mobile shells or introduce an additional browser host. Grok remains at its existing opt-in policy. Mobile/remote Antigravity setup, reset-credit redemption, and a new general file-upload UI are separate follow-ups; decoding already-persisted file attachments remains part of integration compatibility.

## Upstream change inventory

These commits identify behavior and review evidence. They are not a promise that each feature is an independent cherry-pick.

| Area | Upstream sources | Integration treatment |
| --- | --- | --- |
| Codex multi-agent schemas | [f925d6394 / #8346](https://github.com/pingdotgg/t3code/commit/f925d6394) | Backport generator overrides, committed generated output, and regression tests together. |
| Codex account-plan schemas | [94401d01b / #8447](https://github.com/pingdotgg/t3code/commit/94401d01b) | Include in the compatibility repair after checking its small dependency closure. |
| Codex rate-limit resume | [75ab5ab3f / #8897](https://github.com/pingdotgg/t3code/commit/75ab5ab3f) | Backport targeted error-schema compatibility and tests; do not require the larger async-question feature. |
| Codex async questions | [d76b24dd1 / #9512](https://github.com/pingdotgg/t3code/commit/d76b24dd1) | Keep adapter, orchestration, durable request lookup, and contract changes together. |
| Update continuation | [5b7d72aad / #9167](https://github.com/pingdotgg/t3code/commit/5b7d72aad) | Adapt markers and startup reconciliation to Cozea's actual updater/supervisor. |
| Compaction | [c5ba51d62 / #9293](https://github.com/pingdotgg/t3code/commit/c5ba51d62) | Use this final implementation, not the earlier reverted compaction change. |
| OpenCode reliability | [01f3e50ec / #9653](https://github.com/pingdotgg/t3code/commit/01f3e50ec) plus preceding process/permission fixes | Retain the complete upstream implementation and its supporting ownership/reconnect changes. |
| Antigravity | [06336460c / #9348](https://github.com/pingdotgg/t3code/commit/06336460c) plus subsequent fixes through the frozen target | Include setup, installation, auth isolation, model discovery, ACP handling, and capability restrictions. |

## Phase 0 — Establish an isolated baseline

Work products:

1. Record parent HEAD, submodule pin, dirty-file inventory, runtime bundle identity, and selected provider CLI versions/paths. Record only redacted diagnostics, never credentials.
2. Create dedicated parent and fork integration worktrees on `codex/` branches. Keep the user's current checkout and running development app intact. Explicitly inventory local provider-update/history changes that the integration branch will need; do not accidentally omit them by starting from a clean committed HEAD.
3. Run baseline checks on the chosen parent base and repaired/current fork. Record existing failures separately from new failures. Earlier continuity results are context, not proof that the present baseline passes.
4. Create isolated runtime state and test projects. For persisted-state tests, use SQLite's backup facilities or a stopped, consistent database copy; a raw copy of a live SQLite database is insufficient. Keep private history fixtures local and use synthetic/redacted fixtures in commits.
5. Validate a container workflow for portable server/schema checks, using the existing vendor devcontainer as a starting point. It is not yet verified against the current preparation workflow. If insufficient, add a minimal repo-scoped harness and document it in AGENTS.md. Use existing macOS tooling for Electron/native packaging and live UI tests; install no host system packages.

Use Bun to invoke root scripts. The existing `prepare-t3-runtime` implementation delegates to the vendor's declared pnpm version inside its separate workspace; preserve that boundary instead of mixing lockfiles or installing a global toolchain.

Exit: reproducible baseline, documented failing checks if any, isolated test data, and a recorded list of local changes to carry forward.

## Phase 1 — Repair Codex history compatibility

Fork paths: `packages/effect-codex-app-server/scripts/generate.ts`, its committed `src/_generated/schema.gen.ts`, `src/schema.test.ts`, and provider resume tests where needed.

Implementation:

- Apply upstream's multi-agent compatibility changes across every generated response/notification namespace, including `completed`, newer collaboration tool names, and `interrupted` tool status.
- Include the account-plan and history rate-limit compatibility fixes after resolving patch dependencies. Later commits may have context from unrelated work; port their bounded semantic changes instead of blindly accepting a conflicted hunk.
- Import upstream's committed generated output with its generator changes. Do not hand-edit a single generated enum or regenerate the unrelated ACP package.
- Keep the original native thread binding on decode failure. A schema mismatch must not trigger an automatic replacement conversation. Retain missing-thread recovery as a distinct condition, and honor explicit native-history selection.
- Add a recognizable compatibility error presentation: state that the provider integration needs updating, keep history accessible, and give a deliberate retry path after repair. Avoid exposing raw history or schema payloads in the user-facing message.
- Rebuild the fork, update the parent gitlink/pin metadata, and verify the prepared and packaged bundles contain the repair.

Acceptance tests:

- Decode notifications and full read/resume/rollback histories containing completed sub-agent activity, new tool names, interrupted statuses, supported plan types, and rate-limit errors.
- Start a fixture conversation, persist it, restart the server, resume the same native thread, and submit a subsequent message.
- Verify an unsupported payload reports compatibility failure without clearing the binding; genuinely missing-thread behavior still follows its existing explicit-history rules.
- Verify fresh chats and older supported fixtures still work.

Exit: the original failure is reproduced by a test, repaired, and verified in the built runtime. Validate the friend's affected history only if it is available; otherwise report synthetic coverage and do not claim that specific conversation has been recovered.

## Phase 2 — Integrate upstream and preserve Cozea extensions

Merge the frozen upstream target into the repaired fork. Review all fork-only changes, including cleanly merged files; a clean Git merge does not prove behavior survived.

The preview identified these conflicts:

| Conflicting path under `vendor/t3code` | Required resolution |
| --- | --- |
| `apps/server/src/assets/AssetAccess.test.ts` | Retain Cozea artifact access behavior and upstream attachment/access coverage. |
| `apps/server/src/mcp/toolkits/preview/tools.ts` | Preserve the Cozea preview catalog and approved DevApp operations while adopting upstream toolkit changes. |
| `apps/server/src/provider/CodexDeveloperInstructions.ts` | Preserve managed-preview instructions without duplicating or contradicting upstream guidance. |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts` | Preserve preview/tool instructions and Cozea event semantics alongside upstream SDK behavior. |
| `apps/server/src/provider/Layers/CodexProvider.ts` | Reconcile Cozea account-limit reporting with upstream provider snapshots and limits. |
| `apps/server/src/provider/Layers/CursorAdapter.ts` and `.test.ts` | Preserve managed preview and ACP option IDs; retain upstream permission/model fixes. |
| `apps/server/src/provider/Layers/OpenCodeAdapter.ts` and `.test.ts` | Preserve Cozea MCP context while adopting process isolation, permission, cancellation, and progress fixes. |
| `apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts` | Keep correct native option IDs and Cozea event translation for every ACP provider. |

Preservation checks must explicitly cover the fork's ten commits: reasoning artifacts, preview automation, managed-preview instructions, provider maintenance/status handling, snake_case file-path collection, embedded selector runtime, DevApp tool catalog/invocation, and account-limit ingestion. Consolidate equivalent implementations rather than emitting duplicate usage events or maintaining two execution owners.

Adapt `scripts/prepare-t3-runtime.mjs` policy patches to the new bundle. Preserve Cursor/OpenCode defaults, explicit persisted disables, correct selected-executable npm prefix targeting, and neutral Cozea branding. Keep fail-fast anchor tests; move an equivalent behavior into fork source only with a clear removal of the obsolete bundle patch.

Audit upstream dependency and runtime changes before adoption, including its Effect beta, SDK version, and archive/runtime-installation dependencies. The vendor's Effect upgrade is distinct from Cozea's root effect-smol pin. Do not repin the root four-package Effect family merely to make generated contract errors disappear.

Exit: the merged server builds and passes its appropriate suites; each Cozea extension has preservation evidence. The parent app is not considered integrated yet.

## Phase 3 — Update contracts, transport, and persisted-state compatibility

Primary parent paths:

- `scripts/vendor/sync-t3-contracts.mjs`, `packages/contracts/src/t3/`, and `shared/assistant-contracts/`.
- `packages/client-runtime/src/t3/`, especially `t3OrchestrationClient.ts`, `effectRpcClient.ts`, and server-config projection.
- `apps/desktop/src/substrate/createT3OrchestrationApi.ts`, `createT3NativeApi.ts`, and cutover hooks.
- `tests/substrate/` contract, config, orchestration, RPC, and replay tests.

Implementation:

1. Inventory the changed commands, events, provider capabilities, setup operations, asset shapes, and settings actually crossing Cozea's boundary. Match the frozen fork's definitions; do not infer success from TypeScript casts.
2. Fix the sync workflow before using it. It currently deletes/recreates the destination, has a static export list, reads the documented pin rather than verifying HEAD, and injects `@ts-nocheck`. Add revision validation and a reviewable check/diff path. Preserve reviewed exports, include required new groups, and do not introduce newly suppressed files. Resolve new typing gaps through explicit local adaptation; any necessary root Effect migration is a separately assessed dependency milestone.
3. Keep public provider capabilities truthful across schema, projection, and UI. Unsupported compaction, conversation rollback, model changes, or setup actions must not appear enabled merely because a provider exists.
4. Test migrations 044–047 and any persistence changes carried by the final repair/integration commits. Migration 044 rewrites project-created event payloads and clears model defaults it classifies as automatic: verify that classification against Cozea-created projects and preserve explicitly chosen defaults. Migration 045 adds auto-pull with a disabled default; keep automatic Git pulls disabled unless separately integrated with Cozea's collaboration ownership. Migration 046 repairs settlement timestamps; 047 adds project-icon storage. Test old data in an isolated environment, including older pending approvals and questions outside the recent activity window.
5. Ensure new file-bearing history/events decode without crashing startup or shell subscriptions. A new attachment type does not automatically authorize or require exposing an upload control.
6. Test old-client/new-server and new-client/old-server behavior at the bootstrap boundary. Prefer an explicit version/feature mismatch over partial operation with incompatible contracts.

Exit: the parent app boots against the merged server, projects and histories load, and basic chat/approval/stop work on the four existing providers. Persisted-data upgrade and rollback limits are documented.

## Phase 4 — Adapt the Cozea feature surfaces

### 4A. Codex asynchronous questions

Map upstream's distinction through `pendingUserInput.ts`, `chat/session-logic.ts`, `ComposerPendingUserInputPanel.tsx`, `CozeaChatSurface.tsx`, and the workbench assistant controller.

- Blocking requests keep the native request/response path. Async questions are notifications answered by a new user message, using upstream's atomic resolution/message behavior.
- Async questions appear in a compact question panel while streaming and Stop remain available. Preserve the normal composer draft and attachments; do not reuse an answer field as the main draft.
- Answering during a turn steers that turn; answering after completion starts the appropriate next turn. Request/message identities prevent double-clicks and reconnect retries from submitting twice.
- Persist unresolved question identity and answer drafts by conversation/request. Reopen pending questions after reload, history switching, tile closure/reattachment, or server restart. Do not discard a request because it fell outside the recent timeline window.

Tests: active/finished turn answers, multiple questions, free text/options, duplicate submission, lost acknowledgement, reconnect, old pending requests, multiple tiles/windows, and unchanged blocking questions.

### 4B. Context compaction

- Add a capability-gated `/compact` command and a matching existing chat-menu action. Dispatch through the upstream orchestration path; do not send the text to an unsupported provider as if it were an ordinary prompt.
- Permit compaction only in an eligible session state. Show progress and a retryable failure. Keep main drafts and attachments intact.
- Display before/after token usage only when the provider reports it. Do not invent a percentage saved.
- Keep native history and visible messages; compaction changes provider context, not project files or the user's historical record.

Tests: capability gating for every driver, successful and failed compaction, busy/pending-approval state, duplicate invocation, disconnect/restart mid-operation, and subsequent send/resume. Confirm exact supported drivers from the integrated snapshots.

### 4C. Continuation through Cozea updates

Paths include `apps/desktop/electron/substrate/ShadowServerManager.ts`, `shadowHostedRuntimeMonitor.ts`, `apps/server/src/t3Bootstrap.ts`, the actual Electron updater handlers, `useAutoUpdater.ts`, and upstream startup reconciliation.

- Expose “Continue active chats after updates” in the existing update/settings surface, off by default.
- Before a controlled update, ask the server to durably mark eligible active sessions using the upstream continuation mechanism. Only proceed with continuation semantics after marker persistence is acknowledged.
- Have the replacement server reconcile the markers. The renderer reconnects and displays progress; it must not independently send another Continue message.
- Bind continuation to the exact provider instance, native conversation, workspace, and marked turn. Consume/clear markers according to upstream semantics, with tests around crashes between dispatch and acknowledgement.
- Respect explicit Stop, missing providers, expired approvals, unavailable workspaces, logout, and changed identity. Report failures without creating an endless retry loop.
- Renderer-only reload reconnects normally. Unexpected server crashes retain explicit recovery unless a valid controlled-update marker exists. Ordinary Quit must not silently opt the user into continuation.

Tests: option off/on, update cancellation/failure, one and several active providers, repeat startup, Stop during update preparation, pending approval/question, missing instance, and no duplicated user messages. Do not promise transactional exactly-once execution of external tools; test and document ambiguous crash recovery.

### 4D. OpenCode reliability

- Carry the upstream permission lifecycle through Cozea's existing approval panels: old saved permissions remain actionable, failed replies remain retryable, and completed requests close even when an event was missed.
- Preserve permission option IDs/scopes. Automatic full-access decisions must not create persistent workspace grants that widen a supervised session.
- Use upstream per-thread managed chat-server ownership and instance-owned catalog helpers. Preserve Cozea's thread-specific MCP/preview routing when two chats share a directory.
- Stop must settle the UI and stop the intended parent/child sessions. Reconnect must preserve the native session and avoid stale permission/running indicators.
- Show actual task/command progress without treating TodoWrite or approval history as file edits. Retain pipe draining, bounded retention, and late-event protections.

Tests: supervised/full-access isolation, two chats in one workspace, child approval, lost approval event, failed reply/retry, Stop during permission/tool work, late abort, external server reconnect, and repeated start/stop without leaked processes/listeners.

### 4E. Antigravity in Cozea

Treat this as a complete provider setup feature, not an added picker label. First map Cozea's current provider setup/status entry points; the dedicated setup surface and secure-settings extension point remain implementation discovery items.

- Register the driver, identity/label/icon, catalog, capabilities, status and remediation actions. Default to disabled until the user explicitly enables/sets up an instance.
- Initial acceptance uses local Google browser sign-in on the supported host, explicit managed install/update, and a supported manual binary path. Show install progress, cancellation/failure, sign-in completion, model discovery, disable/sign-out/removal semantics.
- Preserve upstream per-instance account profiles, sanitized launch environment, owned callback flow, shared immutable runtime installations, and leases protecting running versions. Background probes must not install software or start login.
- Use the existing Cozea external-browser path for sign-in. Provider account auth stays separate from Cozea device/organization identity. Do not import an upstream plaintext API-key field; additional API-key/enterprise sign-in modes need an approved secure-storage design before exposure.
- Hide unsupported conversation rewind/edit-and-resubmit and the unsupported generic Plan toggle; retain native `/plan`. Fixed-choice questions require native option IDs. A file checkpoint is not permission to claim conversation rollback.
- Validate provider-specific attachment limits before send. Keep existing image support; additional file/audio input controls are outside this plan.
- Show sub-agent batches truthfully without inventing child control or success states. Ensure approved Cozea preview/MCP operations remain scoped to the requesting instance/thread.
- Unsupported local architectures must show an accurate unavailable state. Remote/mobile setup is not part of initial acceptance.

Tests: install interruption/resume, two isolated accounts, sign-out during activity, runtime removal while leased, expired/wrong-flow callbacks, capability gating, skills discovery, image rejection bounds, chat/resume/Stop, and app restart. Real sign-in is a user-operated step; never ask for secrets in chat or logs.

## Phase 5 — Compatibility maintenance and release verification

Add a small, machine-readable tested-provider manifest containing driver, tested CLI/runtime versions, adapter revision, and verified feature support. Populate it from actual tests; do not label every version above a minimum as compatible.

Add a repeatable CI check for:

- Saved-history decoding and start/resume/interrupt/approval semantics for each provider.
- The known Codex multi-agent and rate-limit fixtures, async question durability, and OpenCode permission/stop regressions.
- Agreement between parent gitlink, runtime constant, documented pin, contract manifest, and packaged runtime metadata.
- Availability of the fork commit from `Cozea/t3code` in a clean checkout. `sync-t3code-pin.mjs` currently fetches `origin`; the inspected local `origin` is pingdotgg, whereas `.gitmodules` points at Cozea. Make fork-pin retrieval explicit without relying on an incidental remote name.
- Runtime policy-patch anchors and absence of newly introduced `@ts-nocheck` files.

Expose an unfamiliar CLI version as unverified with useful diagnostics; a confirmed incompatible protocol should fail with a clear compatibility message. Preserve the original session binding. Do not silently downgrade a user's CLI, auto-update their CLI, or discard unknown security/approval requests.

This phase defines CI/manual compatibility checks. It does not create a scheduled Codex automation or grant installation/update authority.

## Verification and rollout gates

Run focused tests as each behavior changes, then the full relevant suite before integrating the parent. Execute the actual vendor test scripts through the established isolated package-manager wrapper; root tests alone do not prove the vendor tests passed.

Parent verification:

```sh
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
bun run test
bun run build
bun run prepare:t3-runtime:check
bun run smoke:t3-server
bun run prepare:t3-runtime:package
git diff --check
```

Also run the appropriate vendor schema/provider/orchestration/persistence suites, then the broader vendor server suite and typecheck. Add formatting checks for changed files. Verify native packaging on each supported release target; Linux container success cannot substitute for macOS Electron/PTY testing. If DevApp contracts change, also run `bun run devapp:check` and the existing package-boundary checks.

Live matrix for Codex, Claude, Cursor, and OpenCode: new chat; resumed chat; streaming; Stop; approval allow/deny; question reply; model selection; image attachment; skills; artifact view; two same-provider instances; project/history switching; draft restoration; and managed Browser/Dev Server/DevApp automation. Add feature-specific cases from Phase 4 and a fresh-profile/upgrade-profile packaged-app run. Record unavailable provider credentials/platforms as unverified rather than passed.

Rollout order:

1. Review and test the Codex repair fork change and matching parent pin change as a small pair.
2. Review the larger fork merge separately, with a preservation report for all Cozea extensions.
3. Review parent contracts and feature adaptations in focused stacked changes against that frozen fork. Keep user-facing features disabled until their end-to-end tests pass.
4. Run a candidate build using isolated and migrated test profiles; then follow the existing canary/beta/stable release process when publication is explicitly requested.

Publish the referenced fork commit before a parent branch or release depends on it. Remote pushes/PR publication/releases remain separate execution actions, subject to the user's authorization and repository workflow; this planning task performs none.

## Rollback and data handling

The small schema repair should not require new T3 database migrations. Still test its actual persisted output and avoid recommending a CLI downgrade as a recovery mechanism.

For the full integration, capture a consistent pre-upgrade T3 database/settings backup and record the runtime revision that owns it. Test the new server against that copy first. New event types and migrations can make older runtimes unable to read newer data; reverting the submodule is not a verified rollback.

Prefer a forward fix after new conversations are created. If rollback is necessary, close the runtime, preserve the entire post-upgrade state separately, and restore only a known-compatible pre-upgrade test/approved backup with clear accounting for intervening conversations. Never overwrite or delete native provider rollouts. Provider-native histories may also evolve independently of Cozea's database; restoring the database does not downgrade those histories.

Failure gates: failed replay; missing native bindings; duplicate sends/continuations; widened permissions; broken Cozea preview/DevApp grants; cross-account state; a packaged runtime differing from the tested fork; or an unresolved new typecheck/build failure. These block rollout.

## Documentation and completion record

Update `docs/substrate-t3-pin.md`, `docs/substrate-t3-build.md`, and `apps/desktop/electron/substrate/constants.ts` with every shipped pin. Update the root AGENTS.md for changed provider capabilities/container commands; update both AGENTS.md and `docs/release-process.md` when update behavior changes.

Document user-visible question, compaction, continuation, and Antigravity behavior in a provider guide under `docs/`. Refresh `docs/assistant-artifacts.md`, `docs/agent-skills.md`, and `docs/dev-server-agent-automation.md` where integration changes their contracts. Record the final tested versions, patch inventory, storage compatibility, check results, and remaining limitations in this plan and `.agent/CONTINUITY.md`.

Suggested review units: (1) Codex compatibility repair, (2) coherent fork merge and extension preservation, (3) parent contracts/preparation/data compatibility, (4) async questions, (5) compaction, (6) controlled-update continuation, (7) OpenCode UI/lifecycle verification, (8) Antigravity setup, and (9) compatibility CI/docs/final qualification. Units 4–8 depend on units 2–3; the small repair can ship first. No sub-agent delegation is implied by this breakdown.

No reliable calendar estimate is assigned before the contract/Effect boundary, migration tests, and Antigravity setup surface are assessed. Those are the largest unresolved implementation costs. The merge preview establishes conflict locations, not implementation completion or test success.

## Execution record (2026-09-05)

- Isolated baseline preserves the local UI changes in parent commit `4aa413be`.
  App typecheck/lint/build and 2079 tests passed (7 skipped).
- Independent repair branches retain fork `7df4f7903` and parent `0366aeba`.
  Regression reproduced before repair. Schema/adapter checks, isolated Cozea RPC
  smoke and portable packaging passed. The friend's private history was not supplied.
- Fork merge `e6fd2165c7c1e8a1a0563c993d5205d53480130b` preserves upstream ancestry
  at frozen target `0a590fa01af66ec135d2ebf2d5542b08a37dc275`. All ten Cozea fork
  changes were reviewed against that target, including clean merges. The final
  server/schema/contracts suite passed 4110 tests (9 skipped); added Antigravity
  preview scoping plus Claude tests passed 115 tests. Server typecheck, lint and
  bundle build passed. Reasoning events were consolidated; normalized usage and
  Cozea native usage history share one event. macOS nested-file canonicalization
  and outside-workspace leaf symlinks have regression coverage.
- Parent contract adaptation removes generated type suppressions and translates
  schema-construction APIs for the existing root Effect pin. Runtime identity is
  checked before database startup. Five new contract/bootstrap tests pass; app
  typecheck, Electron typecheck, lint, build and the 2079 existing tests pass.
- Fork continuation commit `59e1f1749a90912a5d68eedf026c4ba7fdcfb204` and parent
  pin `7b5920d7` add parent-only IPC preparation/cancellation and refuse unstamped
  bundles. The fork feature branch was pushed after explicit user authorization;
  an empty Git repository fetched that exact revision from Cozea/t3code.
- Cozea question/compaction, native permission labels, controlled updates and
  local Antigravity setup are implemented. Actual Electron component QA passed
  active Stop, independent message/image drafts, scoped keyboard events, duplicate
  native option labels, lost-ack/reload retry identity, completed-turn answer,
  independent windows/tiles and OpenCode workspace warnings. Setup QA passed
  explicit enable/install/cancel/progress, browser flow/cancel, separate account
  IDs and sign-out/disable with a fixture transport. It caught and fixed the
  early-auth-notification/browser-open race; two focused regressions cover it.
- The repeatable vendor compatibility command passed 1561 tests (8 skipped);
  final parent suite passed 2106 tests (7 skipped), including the auth race and
  preference regressions. App/Electron/test typechecks, lint, production build and
  whitespace checks passed.
- Source shadow RPC and host-update prepare/cancel smoke passed. Portable runtime
  preparation passed at `59e1f1749`; final built-shadow RPC and host-update smoke
  passed after rebuilding the parent. Runtime and contract identity checks pass.

### Native and release qualification boundaries

| Environment/case | Evidence and result |
| --- | --- |
| macOS arm64 / Codex CLI 0.153.2 | Auth/catalog, consecutive `gpt-5.6-luna` turns and a further turn after server restart passed in an isolated project. The exact native rollout contains all three user turns. Completed-subagent history/process restart uses synthetic protocol fixtures; the friend's rollout and 0.153.3 binary were unavailable. |
| Claude CLI 2.1.260 | Auth/catalog probe passed. A real chat reached the adapter and displayed the provider account rejection; successful-turn qualification is unavailable with this account. |
| OpenCode CLI 1.18.28 | Auth/catalog probe passed. Lifecycle/permissions/stop use upstream integration fixtures; real paid-model conversation matrix remains unverified. |
| Cursor | Native executable unavailable in this host's PATH; adapter/ACP fixtures pass. Native UI matrix remains unverified. |
| Antigravity | Auth/account/install/lease/skills/attachment tests and actual Cozea setup UI with fixture transport pass. Real Google browser sign-in is user-operated and was not performed. |
| App update | Parent transport, multi-host preparation/cancel/failure, off/on preference and startup reconciliation are tested. Signed installer replacement requires a release candidate and was not invoked. |
| Packaging/platforms | macOS arm64 portable runtime and production bundles built. Docker daemon and other native release architectures were unavailable; those targets remain unverified. |

The machine-readable manifest deliberately has no fully qualified native-version
entries yet. Observed versions and limited live smoke results do not certify the
entire live matrix. Feature-specific automated and Electron fixture checks are
repeatable, while the credential/platform/release cases above are explicit rollout
gates. No release, parent push, main merge, real Google login or private-history
recovery is claimed. Existing source and distribution publication rules remain
in force. Do not downgrade a live database to test rollback.


### Reviewable parent stack

- `c6f9e42a`: upstream conversation UI, async answer durability, compaction,
  permission scopes, history variants and local Antigravity setup/capabilities.
- `bb5f1808`: controlled-update preference, parent/shadow/T3 transport, multi-host
  preparation/cancellation and retry behavior; operator documentation updated.
- Compatibility CI and provider documentation follow as a separate change.
  Only the fork feature branch was published; parent changes remain local.


### Final verification (2026-09-05T00:03Z)

A separate parent clone at `d493cc2b` initialized its submodule directly from
Cozea/t3code and fetched `59e1f1749`. `bun run bootstrap` rebuilt from the frozen
lockfiles without adopting the implementation worktree's bundle. Its app
typecheck, production build, compatibility/contract manifest check and isolated
shadow RPC/update prepare-cancel smoke all passed; both source trees stayed clean.
The implementation worktree's portable runtime metadata names that same full SHA.

Final root result: **2106 passed, 7 skipped**. App/Electron/test typechecks, lint,
production build, contract/pin checks and diff whitespace passed. The vendor
compatibility suite passed **1561 tests, 8 skipped**; the earlier complete merged
server/schema/contracts suite passed **4110 tests, 9 skipped**, with the subsequent
host continuation change covered by 22 startup/update tests and a fresh server
bundle/typecheck/lint. Existing Vite configuration/native-loader warnings and
SQLite experimental notices remain; no new failing checks are hidden.

The implementation is ready for parent-branch review. Publication of the parent,
main merges and releases were not authorized or performed. Real credential,
signed-updater and unavailable-platform cases in the table remain release
qualification gates, not claimed successes. The user's original checkout and
native histories were preserved; only clearly isolated QA conversations were
created for live tests.

### Local-main extended QA (2026-09-05)

Local main was integrated at `5827b00a` and the actual Cozea app restarted with
its existing data intact. Extended testing found that native Codex cancellation
stopped execution but was labelled completed: terminal notifications mapped to
ready, and later checkpoint events overwrote terminal states. Fork follow-up
`f2df43a98` preserves interrupted/cancelled and failed states through checkpointing;
Cozea's local event reader now follows the same terminal-state behavior.

The cancellation regression failed before the repair. The full vendor suite now
passes **4117 tests, 9 skipped**. With explicit approval, the fork feature branch
`codex/provider-qa-fixes` was published and an independent bare repository fetched
its exact SHA. Parent main remains local; no release was published.

Further real desktop checks found and repaired three parent integration problems:

- Provider installation can take five minutes, but its client RPC deadline was
  only sixty seconds. Provider updates now have a six-minute deadline; ordinary
  RPC requests retain their existing deadline. A fake-clock integration test
  verifies that a slow update succeeds while an ordinary request times out.
- Upstream shell upserts were incorrectly cast as domain events and deferred by
  a recovery coordinator expecting contiguous history sequences. Shell updates
  now materialize metadata snapshots directly, tolerate sparse sequences, and
  retain cached transcript slices. Tiles own their detail streams; global shell
  hydration no longer subscribes to every historical thread. A finished live
  Codex turn now releases the Working indicator and composer.
- Native Codex can flush buffered text after the interrupted session event. That
  text previously reactivated the busy indicator. Terminal state now survives
  those late chunks until the next turn starts; interrupted/ready/error ordering
  regressions verify text retention and subsequent-turn streaming.

Also fixed misleading provider-update copy and verified actual installed/available
versions in the UI. With explicit approval, Cozea's update buttons installed
Codex **0.153.3** and OpenCode **1.18.29**. Live CUA checks on the existing macOS
arm64 development app passed:

- Codex new chat, renderer reload/resume, completed-state idle transition and Stop
  with both database session/turn marked interrupted and the composer available.
- Codex 0.153.3 resumed isolated 0.153.2 history containing interruption and
  compaction. Native 0.153.2 Stop, post-Stop chat, compaction and post-compaction
  chat also passed against the repaired server.
- OpenCode with Gemini 3.7 Flash returned real responses before and after reload;
  the unsent draft survived reload, the composer settled, and model catalog opened.
  An earlier OpenRouter GPT-5 Mini request on 1.18.28 was rejected for insufficient
  credits; that account/model result does not apply to the successful Gemini test.
- Project/tile restoration, layout split/maximize/restore, Artifacts round-trip,
  Agent Skills rendering and blocked-provider screens were exercised.

Final parent checks: **2117 tests passed, 4 skipped**; app/Electron/test typechecks,
root and scoped client lint, production build and runtime/contract/pin checks pass.
An existing 30ms logging assertion failed during an earlier concurrent vendor/root
run; the full root suite passed when rerun independently. Existing Vite/native-loader
and SQLite warnings remain. An unsigned arm64 `.app` was rebuilt under
`.agent/provider-upstream/packaged/mac-arm64/Cozea.app`; packaging omits optional
binaries for other platforms and skips signing as requested by the local QA lane.

The packaged T3 payload was tested through the built shadow bootstrap with fresh
state and a private copy of pre-upgrade state. The copied database preserved
**14 projects, 69 threads, 478 messages and 57 native bindings**, including hashes
of message text and resume data. Expected startup changes are new project columns,
thread settlement metadata and runtime last-seen timestamps; these are not data
loss. Logs and receipts are under `.agent/provider-upstream/qa-final-*` and
`packaged-final-upgrade-verification.json`.
The packaged GUI itself was not launched against the user's live profile.

Claude chat remains blocked by the existing provider account rejection, Cursor CLI
is absent, Antigravity login is not configured, and other operating systems and
signed installer replacement are not live-qualified. Automated fixtures cover
those protocol paths, but the manifest intentionally keeps full native matrix
qualification false. No private rollout was rewritten or deleted; only QA chats
and explicitly approved CLI updates were added to this machine.
