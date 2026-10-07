# Project system completion plan

Prepared 2026-10-01 against source commit `31798bde5cb1c3b9cd4ae4a8681bc3b3a0cbb4d4`. This is a proposed implementation plan, not a report of completed changes. It follows the [project system study](project-system-study.md), [local management examination](project-management-examination.md), and [app study](project-study.md).

Implementation subsequently authorized on 2026-10-01 with an active goal. Track actual changes, executed checks and remaining acceptance in the [implementation ledger](project-system-implementation.md).

## Product outcome and confirmed defaults

Cozea should let a device discover, create, open, repair and manage its projects using local records and local files. Verified cloud services should become necessary when the user invokes sharing, organization features or publication, and while an explicitly joined collaboration session needs them.

The user confirmed two defaults on 2026-10-01: create a personal project's cloud record only when sharing or publishing; make sidebar name/hide controls local, with shared actions explicit. The engineering details and presence policy below are proposals implementing that direction.

| Experience | Proposed completion contract |
| --- | --- |
| First offline launch | Initialize local device identity and presentation, enter the shell, create/open a local project; cloud enrollment is deferred |
| Returning offline launch | List durable local projects, restore the selected workspace and workbench, show useful names and repair states |
| Create / Open Existing | Finish locally without a Convex project or ready cloud principal; canonical folder reuse prevents duplicates |
| Local management | Local display name, hide/unhide, close, repair and removal work without cloud access |
| Shared management | Shared rename/archive/delete, access, invitations and sessions use verified device authority and explicit user intent |
| Sharing / organization publication | Create or reuse an optional cloud association, preserving local workspace and runtime identity |
| Solo local work | Zero project-related Cozea cloud reads/writes or presence traffic after local boot, unless a shared feature is explicitly requested |
| Joined collaboration | Preserve encrypted outbox, dedicated session workspace, explicit enrollment, background lifetime and access-denial behavior |
| Navigation | Preserve layouts, drafts, scroll, process ownership and fast return while narrowing cloud interest |
| Removal | Preserve attached folders; offer Trash only for catalog-proven managed folders; reconcile interrupted operations |

The zero-traffic contract is for a local-only project with no explicitly active shared feature or joined session. Measure device authentication, optional global notifications, AI-provider calls, Git hosting and hosted DevApp execution separately. Offline project operation does not promise offline provider inference or remote Git access.

## Authority and identity model

Extend the existing Electron SQLite catalog with durable local project records; do not use the bounded renderer query cache as their authority. Audit the unused `local_projects_cache` table and introduce versioned authoritative storage rather than silently changing its cache semantics.

| Record | Authority and contents |
| --- | --- |
| Local project | Stable opaque local ID, local display name/override, local visibility, lifecycle/recovery state, timestamps and optional cloud association |
| Workspace | Existing stable workspace ID, exact canonical path, ownership, managed-root proof, marker policy, binding revision and lanes |
| Cloud association | Optional real Convex project ID, device-scoped last-known shared presentation, explicit validation/outcome state; never a credential |
| Workbench / assistant / process | Existing identities and execution roots; resolve their local project association without recreating them |
| Shared project / session | Cloud-verified membership and lifecycle; projectd retains session replica and encrypted recovery authority |
| Operation | Durable operation ID, intended effect, stable resource IDs, completed stages and bounded recovery information |

Use distinct typed local and cloud project references. New local IDs must never be cast to `Id<"projects">`. Add a boundary that translates a local project into its optional shared association before a cloud call. Promotion to sharing must not change the local project ID, workspace ID or execution root.

For existing records, retain a mapping from historical project references to the local entry. Do not bulk rewrite folder markers, layouts, threads or sessions merely to obtain a new ID format. Make compatibility translation explicit at each boundary, then remove it only when migrated callers and stored records have been qualified. Local and shared route locators must be distinguishable; preserve existing stable-ID links and resolve them through the mapping. A previously unknown shared link requires authenticated access/enrollment before creating its local projection.

Keep the Electron catalog, projectd registry and T3 storage separate. Define which service owns each field and how binding revisions propagate between them. projectd's one-time importer alone cannot guarantee that later repair/move changes remain aligned.

## Phase 1 — Establish contracts, baseline and the shared authority boundary

**Work**

- Record the confirmed product defaults, local/shared capability matrix, lifecycle vocabulary, route locator contract, folder ownership rules and process lifetimes. Distinguish Hide on this device, Close workspace, Remove from this device, Leave session, shared Archive and shared Delete.
- Inventory project-ID consumers: routes/bootstrap, catalog and markers, projectd workbenches/sessions, retained contexts, T3 history/drafts, terminals, Dev Servers, tasks, DevApp development/publication and local cleanup. Assign each a local identity or an explicitly shared association.
- Capture reproducible returning/cold launch, project switching and cloud-activity baselines. Count active logical subscriptions, heartbeat mutation attempts, explicit shared operations and session relay bytes independently. Do not equate a hook declaration with a request or a request counter with a bill.
- Reproduce the source-identified `principalId` mismatch using isolated test fixtures. Make self-scoped list/summary/slug/create endpoints derive the caller from `ctx.auth`; audit wrappers and project endpoints for the same class of mistake. Distinguish caller identity from a legitimate target member ID. Do not add account/email/UUID identity fallbacks.

**Primary areas:** `convex/projects.ts`, `convex/lib/authenticatedFunctions.ts`, `convex/lib/deviceAuth.ts`, `shared/workspaceTypes.ts`, router/navigation contracts, existing navigation measurement scripts.

**Exit evidence:** agreed proposed contracts; consumer inventory; repeatable baseline; tests showing an authenticated device cannot list or create as a different principal and legitimate member-management operations still work. The endpoint repair can be a small independent change before broader migration.

## Phase 2 — Durable local catalog and identity-preserving migration

**Work**

- Add versioned local project, cloud-association and operation-journal records with transactional updates, uniqueness rules and typed IPC. Snapshot/list APIs must cover all local project entries and workspaces, not only the currently active workspace per project.
- Backfill local entries from recorded workspace groups, projectd workbench references and available metadata. Reconcile cloud-associated historical records without duplicating a project per workspace. If metadata is unavailable, keep a labelled fallback with explicit unknown shared state; do not invent a name, lifecycle or access grant.
- Preserve workspace/lane/workbench IDs, binding revisions, managed/attached classification, active selection, execution roots, drafts/history and installed release associations. Never infer deletion ownership from directory location.
- Reconcile catalog and projectd binding changes through a revisioned bridge. Detect conflicting/missing paths and repair them explicitly. Repeated migration or replay must converge on the same records.
- Introduce the local project read model for sidebar, command palette, project heading, recents and repair. Shared-only discoveries may appear in an explicitly opened shared view; a cloud list response must not erase local records when it is empty, delayed or unavailable.

**Primary areas:** Electron `workspaces/` migrations/catalog/snapshot, `registerWorkspaceHandlers.ts`, typed preload/shared contracts, projectd `WorkspaceRegistry.ts`/`WorkspaceCatalogImporter.ts`, project sidebar and project navigation.

**Exit evidence:** offline list after restart and expired query cache; multiple workspaces remain one project; repeated import/migration makes no duplicates; old routes and markers still resolve; chat, terminal and layout references survive. A migration crash is recoverable without moving source folders.

## Phase 3 — Local shell and offline entry points

**Work**

- Separate local device readiness from authenticated cloud-session readiness. A local cryptographic installation and local presentation must be sufficient to enter the shell, including when no valid cached cloud bootstrap exists. Cloud tokens/principals remain unavailable until verified.
- Make the local tree render when Convex configuration is absent or the service is unreachable. Isolate cloud hooks/providers behind a valid optional service boundary; do not mount hooks without their provider or create a dummy client as a substitute for availability.
- Route local project opening through durable catalog resolution before cloud metadata. Sidebar titles and project selection come from the local model, with shared presentation layered on only when available.
- Remove cloud-principal prerequisites from local folder preflight/reuse, local workbench resolution and local runtime capability checks. Audit `ProjectSyncProvider` and runtime policy so local work is not gated by sharing readiness.
- Preserve local terminal/T3/preview execution checks and fail-closed private-worktree behavior. Shared controls show their own connection/access state without replacing the entire workbench with a login/recovery screen.
- Keep temporary transport failure, explicit access denial, missing folder and corrupt local metadata as distinct states. Explicit denial stops shared use; it does not trash the attached source folder.

**Primary areas:** `App.tsx`, `AuthContext.tsx`, `ConvexProvider.tsx`, desktop bootstrap/store, `ProjectLayout.tsx`, active workbench scope, local import, workspace runtime policy and application runtime hosts.

**Exit evidence:** cold and returning offline launch; configured-but-unreachable and no-configuration cases; known project opened both by route and folder picker; terminal/preview restoration; useful repair when the path moved. No cached presentation authorizes a cloud action.

## Phase 4 — Local lifecycle with durable recovery

Persist the operation ID and stable intended resources before external effects. A useful internal progression is `requested → inspected/prepared → effect applied → binding committed → completed`, with recoverable/unknown outcomes represented explicitly. Filesystem effects and SQLite cannot be one transaction; inspect durable evidence when replaying each stage.

| Command | Implementation and recovery requirement |
| --- | --- |
| Create | Allocate local identity and journal intent; reserve the exact destination; create folder/Git/scaffold; bind as managed; open workbench. Resume the same attempt after failure/restart; never overwrite an unrelated existing directory |
| Open Existing | Preflight canonical path; reuse a binding or attach the exact selected folder; finish locally. No copy/rename, no source marker for attached non-Git folders, no new ownership claim |
| Rename / hide | Persist local metadata immediately; preserve workbench and runtime identity. A local alias does not relocate a folder or change a shared name |
| Close workspace | Release its local presentation/runtime according to existing lifetime rules and forget the binding. Explain active session consequences without interpreting presentation closure as Leave |
| Locate / repair | Attach the verified exact directory; increment binding revision; reconcile projectd/runtime references before presenting it. Conflicts require a choice, not silent path selection |
| Remove from device | Journal scope and folder choice; stop/disconnect affected runtime ownership; clear project-scoped local state and bindings; allow Trash only with current managed proof. Attached folders survive |

- Treat optional GitHub repository creation as a separate network operation after local readiness; failure must leave a usable project and a clear retry state. Use the same intended owner/name/resource on retry and inspect ambiguous outcomes before another creation attempt.
- Provide bounded startup reconciliation and a small recovery surface for pending operations. Timeouts report an unknown outcome until it is resolved; they do not cancel effects or manufacture rollback.
- In existing cloud-backed compatibility flows, persist creation tokens across retries/restart, make fresh provisioning consistent, and finalize an attached provisioning project even on same-folder reuse. Retire those temporary paths once local creation is authoritative.
- Define restart-safe removal stages for Dev Servers, terminal/workbench sessions, T3 threads/drafts/history, development records, renderer stores and catalog bindings. Record the requested local-data retention choice: hide/close preserves conversations; permanent conversation/draft cleanup belongs to an explicit data-removal choice. Preserve organization-installed artifacts and unrelated projects. A project-wide local removal must explicitly account for any daemon-owned session before forgetting its identity.

**Primary areas:** create dialog, local import hook, workspace actions/repair, catalog/IPC, `projectLocalCleanup.ts`, project mutation timeout and projectd lifecycle interfaces.

**Exit evidence:** fault injection between each meaningful stage; cancel/retry/restart yields one project and one intended binding; optional GitHub failure is nonblocking; managed Trash requires proof; attached folders inside managed roots survive; no orphaned runtime resumes after removal.

## Phase 5 — Optional sharing, authenticated association and shared lifecycle

**Work**

- Promote a local project only on explicit sharing or publishing: Share/invitations, session creation, or organization sharing/publication. Obtain verified cloud authority, persist a promotion token, create/reuse the shared record, then commit the association locally. An existing cloud-backed task feature must request explicit sharing if there is no association; merely opening Tasks must not create a cloud project.
- Make promotion idempotent across response loss and restart. Cloud association is optional, so failure leaves local work usable. Only explicit remote intent may be pending; opening a local-only project must not enqueue a cloud create.
- On another device, authenticate shared access before importing its projection/provisioning a dedicated session workspace. Keep cloud memberships, encryption keys and exact session enrollment distinct from local filesystem binding and matching branch names.
- Layer last-known shared presentation on the local view, with local aliases and shared actions clearly scoped. Revalidate authorization at every remote boundary; handle unavailable/revoked/deleted distinctly. Do not erase a local folder or private state based on a network error.
- Separate Remove from this device from Delete shared project. Preserve the existing bounded cloud row/blob cascade. Shared deletion needs a durable, caller-authorized operation result/receipt that remains queryable long enough after document deletion to distinguish confirmed success, denial and uncertain transport outcome.
- Replace timeout-only deletion coordination with outcome reconciliation: after confirmed remote deletion, complete any separately requested local cleanup once; after response loss, inspect/retry the same idempotent operation. Shared deletion alone must not silently purge retained private conversations or attached files. Do not infer successful deletion from an inaccessible-project result, which may represent access denial.
- Verify downstream task and DevApp callers resolve a real shared ID. Local development and existing installed artifacts remain usable independently; publication/install/hosted execution retain their own authority and network requirements.

**Primary areas:** project association service and local journal, `convex/projects.ts`/project access/lifecycle validators, Share/session controls, projectd session/workbench provisioning, task and DevApp cloud callers.

**Exit evidence:** offline local project promoted once on reconnect; dropped create/delete response reconciles without duplication or premature cleanup; original workbench/chat/process identities survive promotion; mismatched caller denied; two devices associate the shared project with their own local workspaces; original source folder remains separate from the session repository.

## Phase 6 — Cloud activity policy, presence ownership and compatibility cleanup

**Work**

- Replace the two presence-writing hooks with one project/device publisher and read-only UI consumers. Merge active file/route in one place; ensure one consumer unmount cannot delete another consumer's live presence. Qualify timer, visibility and cleanup behavior with fake time plus a live window pass.
- Recommended policy: local-only/solo work publishes no presence; project presence is enabled by explicit collaboration. When a window is hidden, release foreground presence while the daemon continues a joined session. Background session liveness is a separate authority. Document any additional presence mode if the product needs it.
- Activate member rosters, enrollment requests, join-link details and publication detail when their surface/session needs them. Keep only the minimal role/notification information needed by visible controls. Define an explicit bounded policy for global invite summaries, rather than fetching all details for a badge.
- Classify retained pages as local, snapshot-while-hidden or necessarily live. Preserve React state/scroll and workbench runtime retention; release cloud interest for hidden snapshot pages and refresh on reveal. Preserve deliberate live interest only for a justified shared workflow. Query policy changes must keep fast return and correct stale/error states.
- Keep useful user-triggered Changes prefetch bounded. Split local checkpoint-ref cleanup from cloud ephemeral-activity cleanup: a solo clean HEAD must not write to Convex. Shared cleanup should correspond to known shared activity/intent, remain retryable, and preserve comment/reaction lifecycle semantics.
- Remove or rename misleading legacy sync status/actions only after caller and stored-state audits. Audit retired file-sync contracts and retained raw desktop Git exceptions; move an exception to canonical GitService only with behavioral parity evidence. Do not redesign working CRDT, binary or AutoGit protocols as incidental cleanup.

**Primary areas:** `useProjectPresence.ts`, project layout/header, Share/team hooks, sidebar/incoming invitations, retained page query policy, checkpoint cleanup, compatibility project sync context, architecture guards.

**Exit evidence:** zero project cloud operations during a local-only create/open/rename/commit/idle run; one presence timer for eligible shared use; file/route data persists; header/page unmount does not falsely leave; hidden window policy works; live session outbox still progresses; returning pages preserve state and meet the recorded navigation baseline.

## Phase 7 — Qualification, release readiness and documentation

### Behavioral acceptance matrix

| Scenario | Required result |
| --- | --- |
| Fresh install offline; no bootstrap/cloud config | Local shell, create/open/list/manage work; shared actions explain their availability |
| Returning offline after cache expiration | Durable names/list, same workspace/workbench, drafts/history/layout restored |
| Known folder selected twice, including through symlink/canonical alias | One local project/binding; source untouched |
| Multiple workspaces; moved/missing folder | Stable project identity, exact workspace choice, explicit repair; no silent relocation |
| Crash/restart around create/import/bind/activation | Journal converges; no duplicate identity or destructive compensation |
| Shared promotion with lost response | Same cloud association recovered; local execution identity unchanged |
| Removal and late shared-delete success | Correct journaled scope completed once; managed proof enforced; attached source survives |
| Unreachable service versus denied/revoked access | Local work remains available where permitted; no shared authority from caches; joined runtime follows explicit denial rules |
| Retained page/workbench, tile closure, window hide, Quit and daemon restart | Each follows its declared lifetime; chat stream/draft, terminal ownership and previews behave correctly |
| Shared session created/joined on two devices, offline/reconnect | Dedicated folders, encrypted durable replay, binary recovery and AutoGit remain correct |
| Development DevApp, immutable installed release and publication | Local identity mapping works; installed version remains pinned; cloud publication uses verified association |
| Local-only project idle and local clean HEAD change | No project subscriptions/heartbeats/activity writes; measured categories distinguish external services |

### Check strategy

- Extend meaningful behavioral tests in workspace/catalog, projectd registry/workbenches, project lifecycle, bootstrap, identity, retained query policy, presence and checkpoint cleanup. Source-string guards supplement behavioral evidence; they do not prove the offline journey.
- Run affected suites and relevant TypeScript checks per implementation change. At the integrated candidate run renderer/Electron/projectd/Cloudflare/tests typechecks as applicable, lint, relevant full regression, desktop production build and projectd build.
- Use `Dockerfile.agent-checks` for container-compatible checks, with image versions selected from the repository/toolchain at implementation time. Native Electron/macOS and signed two-device qualification require the relevant host environment. This planning pass installs nothing.
- Run provider compatibility checks if provider contracts/runtime binding changes; DevApp generation/check and package boundary checks if its generated contracts change. Do not regenerate pinned ACP contracts or repin Effect incidentally.
- Measure representative local-only idle, shared session, reconnect and retained-page return runs against Phase 1. Record commit, configuration, active feature set, duration, counters, bytes and failures. Report cost savings only if service-side usage supports them.
- Complete the existing [collaboration acceptance roadmap](../collaboration/collaboration-completion-roadmap.md) signed-package/two-physical-Mac gate with matching deployed revisions. Its recorded pending gate is not satisfied by unit tests or the older completed phase labels.
- Update canonical project/workspace/bootstrap/cloud-policy documentation and accurate portions of AGENTS alongside implementation. Update release/operator docs if deployment or release behavior changes; preserve historical study findings as dated observations with links to completion evidence.

**Exit evidence:** checked-in acceptance ledger for one candidate commit; reproducible offline journeys and failure recovery; measured cloud policy; preserved navigation/runtime behavior; signed two-device collaboration evidence. Production deployment/release is a separate, explicitly authorized step after the candidate is reviewable.

## Delivery order and review units

| Unit | Depends on | Reviewable result |
| --- | --- | --- |
| A | None | Contracts, consumer inventory, measurement baseline; isolated caller-authority repair |
| B | A | Catalog, migration, typed local/shared mapping and revision bridge |
| C | B | Local shell/sidebar/route opening; offline runtime readiness |
| D | B, C | Local create/import/manage/remove and durable recovery |
| E | A, B, D | Optional shared association and idempotent shared lifecycle |
| F | A | Single presence owner; retain current shared eligibility until the agreed policy can be applied |
| G | C, E, F | Demand-based query/presence policy, local/cloud checkpoint separation and compatibility cleanup |
| H | B–G | Integrated runtime/packaged/two-device acceptance and documentation |

Keep each implementation unit small enough to review; split migration/contracts from UI cutover and split shared create from shared deletion where necessary. Presence consolidation can land early because it addresses a concrete duplication without requiring the complete identity migration. Qualification and targeted regression accompany every unit; H adds the cross-system acceptance gate.

## Remaining design choices and implementation boundaries

- **Confirmed product scope:** local-only creation with cloud association on sharing/publishing; local name/hide by default and explicit shared management. Implementation must not introduce background cloud registration or let opening an ordinary local page perform promotion.
- **Unattached shared discoveries:** keep them in an explicitly opened shared view until the device opens/attaches them. Whether to show these as separate sidebar entries is a presentation decision; they must not block or replace the durable local list.
- **Presence outside sessions:** recommended default is off. An additional shared-project presence feature needs an explicit activation/visibility policy and its own measured budget.
- **Deployment/migration constraints:** implementation touches Electron main/auth and may change the Convex schema; those areas require the repository's implementation approval when the concrete changes are ready. This request authorizes the plan, not those edits or production writes. Do not reset existing device identity data or migrate/delete production project data as part of local catalog backfill.
- **Unchanged architecture constraints:** attached-source protection, dedicated session workspaces, authenticated device principals, encrypted durable collaboration, one browser host, separate process lifetimes, provider-native execution and immutable installed DevApp versions remain acceptance requirements throughout.

## Coverage of the examination

| Finding / unfinished boundary | Plan coverage |
| --- | --- |
| Unused local project cache; cloud-only sidebar/name/lifecycle | Phases 2–4 |
| Cached route works differently from same-folder import | Phases 3–4 |
| Cold launch/cloud configuration/principal runtime gates | Phase 3 |
| Project IDs spread across routes, markers, runtime and cloud callers | Phases 1–2, 5 |
| Separate catalog/projectd stores and binding updates | Phase 2 |
| Fresh create duplicates/partial folder; retry token loss; provisioning finalization | Phase 4; Phase 5 promotion |
| Delete timeout/late success and local/cloud split | Phases 4–5 |
| Folder ownership, repair, duplicates and removal safety | Phases 2, 4, 7 |
| Duplicate presence, metadata overwrite, cleanup/hidden-window behavior | Phase 6; early unit F |
| Share/publication/invite details and retained subscriptions | Phase 6 |
| Local HEAD cloud cleanup and misleading legacy sync/Git paths | Phase 6 |
| Caller-supplied principal endpoint gap | Phase 1; Phase 5 regression |
| Runtime lifetime, sharing, offline outbox/denial and DevApp compatibility | Phases 3–5, 7 |
| No live offline/cost proof; signed two-Mac gate pending | Phases 1, 7 |

The original planning pass changed documentation only. Subsequent implementation and its verification are recorded separately in the ledger above.
