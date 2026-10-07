# Local project management and solo cloud use

Follow-up source examination on 2026-10-01, commit `31798bde5cb1c3b9cd4ae4a8681bc3b3a0cbb4d4`. This continues [the project system study](project-system-study.md). Findings below are source-derived; no live offline simulation, production API calls or billing measurements were performed.

The migration establishes local folder and execution authority, but the project discovery/management layer still starts with a Convex project and a cloud-ready principal. An offline project list is therefore a missing product path, not merely a slow query. The subsequent [completion plan](project-system-completion-plan.md) covers these findings, migration, recovery, cloud policy and qualification.

## Local records and discovery

The local workspace catalog already persists stable folder bindings, ownership, verification, repository evidence, active workspace selection and lanes. Its pushed snapshot exposes active workspace entries keyed by project ID, including a workspace label and verification state. Local workbench presentation, terminal binding and filesystem resolution do not inherently need a Convex project lookup.

However, `ProjectSidebar` constructs every project row from `projects.listSummariesForCurrentUser`. The local snapshot helps existing rows find their workspace; it does not create rows. Sidebar persistence stores only project ordering and expanded IDs. When the principal is unavailable, the query is skipped and the UI can show the ordinary create-to-get-started empty state despite recorded local folders.

There is a `local_projects_cache` SQLite table and an `upsertProjectsCache` service method. A repository search found its schema, writer implementation, interface and export, but no product callers or readers. It also has no renderer IPC in `registerWorkspaceHandlers`/preload. This is unused scaffolding, not a working offline project catalog. The general query cache is a separate bounded display cache and does not supply sidebar rows.

The practical requirement for offline discovery is a durable local project view with sufficient identity, name and lifecycle information, available before cloud authentication. Merely wrapping the current sidebar query in a short-lived cache would improve warm display but would not provide local creation, durable management or recovery.

Sources: [ProjectSidebar](../../apps/desktop/src/features/projects/ui/ProjectSidebar.tsx), [sidebar persistence](../../apps/desktop/src/features/projects/ui/sidebar/projectSidebarState.ts), [catalog schema](../../apps/desktop/electron/workspaces/Migrations/001_InitialSchema.ts), [WorkspaceCatalog](../../apps/desktop/electron/workspaces/WorkspaceCatalog.ts), [snapshot contract](../../shared/workspaceTypes.ts).

## Offline paths differ

| Scenario | Current source path | Implication |
| --- | --- | --- |
| Returning device, stable-ID route, known valid folder, cloud unavailable | Cached device presentation admits the shell; route ID resolves through local catalog IPC | Local workbench presentation can restore before cloud metadata |
| Same device opens the project list | Sidebar waits for cloud summaries or has no rows while principal is absent | Local folders are not independently discoverable there |
| Same known folder selected through Open Existing | Hook requires principal and queries cloud access before reuse | Opening the folder through this entry point has a stronger dependency than route restoration |
| New local folder/project | UI requests a Convex project ID before local creation | Local creation remains cloud-dependent |
| Existing unbound folder | Local inspection, then cloud provisioning, then local attachment | Attachment primitive is local; ordinary UI import is not |
| Known project with missing/moved folder | Repair screen can locate/attach or create a local folder via IPC | Repair can perform local work; cloning also needs repository information/access |
| Rename/archive/restore | Convex mutation and cloud-principal guard | No independent local metadata operation |
| Close workspace | Local session teardown, forget binding, navigate to repair | Local operation, although its usual sidebar entry depends on cloud-derived rows |
| Delete project | Cloud deletion first, local cleanup afterward | Remote failure prevents this UI's local cleanup path |
| Device lacks a valid cached bootstrap session | App waits for cloud device-session initialization, then recovery if it fails | Existing cryptographic keys/folders alone do not admit the ordinary app shell |
| Build lacks Convex configuration | Root provider shows Configuration required instead of app tree | Configured-but-offline differs from a cloud-free app build |

`AuthContext` correctly treats cached presentation as distinct from cloud authorization. This should be preserved. A local desktop capability boundary can be independent of cloud readiness while shared records and actions still require verified device tokens.

The terminal path provides a concrete example: `useWorkbenchSessionTerminal` uses the resolved workspace and a local workbench session key to allocate/bind a PTY through IPC. Its main-process presentation authority checks the committed local catalog row, not Convex membership. `ProjectSyncProvider` still waits for project/principal readiness for its separate context, so losing that context does not by itself prove terminal presentation must fail. Whole-app runtime behavior still needs offline qualification.

Sources: [AuthContext](../../apps/desktop/src/contexts/AuthContext.tsx), [App](../../apps/desktop/src/App.tsx), [ConvexProvider](../../apps/desktop/src/contexts/ConvexProvider.tsx), [local import](../../apps/desktop/src/features/projects/hooks/useLocalProjectImport.ts), [workspace actions](../../apps/desktop/src/features/workspace/hooks/useProjectWorkspaceActions.ts), [terminal hook](../../apps/desktop/src/features/terminal/useWorkbenchSessionTerminal.ts), [presentation IPC](../../apps/desktop/electron/ipc/registerWorkbenchSessionHandlers.ts).

## Duplicate presence ownership

An ordinary authenticated project view mounts two presence owners when the presence header group is rendered:

1. `ProjectLayout` calls `useProjectPresence` to derive online principal IDs.
2. `ProjectPresenceHeaderAddon` calls the same hook to render avatars and report active file/route.

`UnifiedHeader` renders that addon as a leading group when there is no active live-session control. The addon calls the hook before returning null for an empty roster. Having no other users therefore does not suppress its timer. The responsive header's collapsed layout does not park this leading group in its trailing overflow popup.

Each hook instance owns a thirty-second timer and immediate/activity/visibility heartbeat effects. With both mounted, the source-derived steady timer rate is four mutation attempts per minute rather than two, before transition effects. Successful calls write the same `(projectId, authenticated principal)` row. This is not a measured production rate, and identical reactive queries may be deduplicated by the client; that does not merge the two mutation timers.

The payloads also differ. The layout owner supplies no active file/route, while the header owner may supply them. `projectPresence.heartbeat` patches those fields directly from the optional arguments. The installed Convex serializer preserves top-level undefined values for patch semantics, and its database API documents that fields set to undefined are removed. The layout writer can therefore clear metadata reported by the header; the visible effect still needs reproduction. Each hook's cleanup also calls `leave` for the shared row rather than releasing a shared publisher reference.

The hook sends another heartbeat on becoming visible, but it does not pause its interval while hidden. Ordinary macOS window Close hides the window and preserves the renderer. Presence while the window is hidden is consequently a separate policy question from active collaboration's intended background lifetime.

A single project/device presence publisher with read-only UI subscribers would remove duplicated ownership. Whether to publish at all for solo projects, without an explicit session, and while the window is hidden should be decided separately.

Sources: [ProjectLayout](../../apps/desktop/src/features/projects/layouts/ProjectLayout.tsx), [presence hook](../../apps/desktop/src/hooks/useProjectPresence.ts), [UnifiedHeader](../../apps/desktop/src/features/projects/layouts/UnifiedHeader.tsx), [responsive header](../../apps/desktop/src/features/projects/layouts/unified-header/ResponsiveHeaderRow.tsx), [presence backend](../../convex/projectPresence.ts), [window lifecycle](../../apps/desktop/electron/registerAppLifecycle.ts). Installed Convex inspected locally: `node_modules/convex/src/values/value.ts`, `server/database.ts` and `server/impl/database_impl.ts`; no dependency changes.

## Other cloud activity during solo use

| Trigger | Cloud activity | Assessment |
| --- | --- | --- |
| Authenticated app shell | Current device profile query | Shared presentation/preferences dependency; not project file execution |
| Sidebar mounted | Project summaries, publisher status when enabled, three incoming-invite queries | Some useful global notifications; publication detail could have a narrower activation policy |
| Resolved authenticated project | Project detail, project session list, presence reads/writes | Ordinary local work still observes shared metadata |
| Share button mounted in normal-width workbench | Member roster, member role, join-link state; pending enrollments for managers | Queries start without opening Share; permission/display needs should be separated from dialog detail |
| Changes button hover/focus/pointer-down with displayable diff | Prefetch up to 100 cloud activity records, with thirty-second cache check | User-triggered prefetch, not idle polling |
| Local clean HEAD change observed by a hosted sync runtime | `activity.clearEphemeralChanges` plus local checkpoint-ref cleanup | Local commit/checkout can still trigger a cloud mutation outside an explicit session |
| Previously visited retained ordinary page is hidden | Its reactive queries are intentionally held through no-op subscribers until reveal/eviction | Tradeoff: faster return retains cloud interest in hidden pages |
| Explicit session remains joined while presentation is idle | Daemon relay, encrypted durable updates and coordination | Intentional background sharing; different from unrequested solo traffic |

The retained-page behavior is deliberate and covered by tests. It should not be treated as an accidental leak or removed wholesale: each page's benefit and cloud interest need a policy/budget. Likewise, mounting `useMutation` alone does not send a request; only the effects/actions invoking it do. No exact billable operation count follows from counting hook declarations.

The compatibility `ProjectSyncProviderRuntime.triggerSync` currently updates local progress/last-sync display and reports Local branch mode. It does not itself upload files or perform Git synchronization. The surviving sync names/status fields should not be mistaken for the retired cloud file transport.

Sources: [incoming invites](../../apps/desktop/src/hooks/useIncomingInvites.ts), [project team](../../apps/desktop/src/hooks/useProjectTeam.ts), [Share header](../../apps/desktop/src/features/projects/layouts/unified-header/HeaderProjectShareButton.tsx), [Changes header](../../apps/desktop/src/features/projects/layouts/unified-header/HeaderProjectChangesButton.tsx), [checkpoint cleanup](../../apps/desktop/src/features/source-control/hooks/useProjectCheckpointCleanup.ts), [retained queries](../../apps/desktop/src/app/navigation/retainedPageQueries.ts), [compatibility sync runtime](../../apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx).

## Interrupted project management

Three source paths need stronger recovery evidence:

- **Fresh create:** the cloud project is created without a provisioning status or creation token, then local effects run. Failure can leave a draft cloud project and/or folder. Re-submission starts another create attempt.
- **Import:** the backend supports idempotency for a supplied token, but the UI generates the token inside each import invocation and does not persist it. Transport retries of the same call can reuse it; a new user attempt/restart cannot rely on that token. After attachment succeeds, activation failure is reported without compensation. Reopening that bound folder takes the accessible-project early return and does not finalize its provisioning status. The separate relink action attempts such finalization, but this is not the normal same-folder import retry.
- **Delete:** the sidebar races cloud deletion against a thirty-second timeout. The helper does not cancel or journal the underlying operation. If that operation later succeeds after the timeout, the original handler has already entered its error path, so it does not proceed to local cleanup. This is a possible cloud/local split after an ambiguous outcome; it was not induced against production.

These are reasons to persist operation intent and reconcile outcomes if the lifecycle is made more local. They are not reasons to copy, discard or automatically delete attached folders. Filesystem ownership protections remain valid and should be retained.

Sources: [create dialog](../../apps/desktop/src/features/projects/ui/CreateProjectDialog.tsx), [import hook](../../apps/desktop/src/features/projects/hooks/useLocalProjectImport.ts), [Convex project creation](../../convex/projects.ts), [mutation timeout](../../apps/desktop/src/features/projects/lib/projectMutationTimeout.ts), [sidebar deletion](../../apps/desktop/src/features/projects/ui/ProjectSidebar.tsx).

## Next component boundary

For the stated local-default direction, the next substantive component is **local project management**: a durable device-owned project entry that can be discovered and bound before shared metadata is available, with an optional authenticated cloud association. Existing cloud project IDs are used widely in routes/contracts; introducing a local entry requires an explicit identity model rather than casting arbitrary local IDs to Convex IDs.

Before implementing that boundary, distinguish these product operations:

- Device-local discovery, open, create, repair and forget versus shared project access/enrollment.
- A personal display alias/hide preference versus renaming/archiving the shared project for collaborators.
- Removing a project from this device, optionally trashing a proven managed folder, versus deleting the shared cloud project.
- Temporary cloud unavailability versus an explicit denial of shared access. Local presence/cache must never become credentials for remote actions.

A sensible work order is local discovery/metadata and offline entry points, then durable creation/import/deletion reconciliation, then one presence owner and demand-gated shared detail subscriptions. This is a proposed review/implementation sequence, not authorization to change schema, authentication or Electron handlers.

## Verification boundary

Additional tests read include `desktopFirstLoadingPolicy`, `desktopBootstrapRoute`, `desktopBootstrapStore`, `retainedPageQueries`, import naming and checkpoint cleanup decisions. Several architecture/UI tests assert source strings; they do not demonstrate a complete offline create/open/list/manage journey. No focused presence timer test was found in the searched test paths. A subsequent runtime pass should cover cold versus returning launch, both known-folder entry points, absent cloud metadata, interrupted create/activation, ambiguous deletion and one-versus-two presence owners.

This pass changed documentation and continuity only. No application tests/builds, remote calls, schema/auth/runtime edits, installs or deployments were performed.
