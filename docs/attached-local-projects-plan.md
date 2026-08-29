# Attached Local Projects Plan

Status: core implementation completed 2026-08-29; compatibility cleanup and the exhaustive
rollout matrix remain

## Implementation outcome

The core ownership and exact-path attachment design is now implemented:

- Local workspace records persist `managed | attached` ownership, their managed-root association,
  and an explicit marker policy through migration 003.
- **Open Existing Folder** preflights and attaches the selected real path in place. Both renderer
  entry points share the same orchestration, reopening an already-bound folder navigates to its
  existing project only after an authenticated current-device access probe. If an identity
  cutover or earlier incomplete cleanup left an inaccessible binding, Cozea removes every
  app-owned projection for that old project, preserves the attached source folder, verifies the
  catalog is detached, and creates a fresh current-device project at the exact same path. The
  compatibility import operation no longer copies or force-binds.
- New projects and clones remain managed. Attached folders are excluded from managed storage and
  can never be selected by project deletion or **Clear all**. Managed deletion resolves a
  workspace ID in Electron and requires ownership, root containment, marker identity, and
  no nested workspace before moving the root to Trash.
- Renderer open flows no longer use cloud `localPath` fields as machine-local authority. Runtime
  integrations continue to resolve verified workspace/lane IDs in Electron.
- Directory-picker read grants are dropped once the workspace is attached, and Git worktrees use
  their private Git directory for markers and common repository configuration for identity.
- Package-manager, lockfile, and dependency inspection now uses catalog-authorized workspace
  directory reads. Attached roots no longer need a persistent global read grant for Dev Server
  launch or Project DevApp command publication.
- Package-manager-specific dev-server port forwarding is covered for npm, pnpm, Bun, and Yarn.
- Project deletion now clears all project-scoped renderer state, workbench/session/runtime state,
  local DevApp records, and the matching T3 project/threads before forgetting workspace bindings.
  Convex marks the project deleted immediately, then performs a bounded two-pass cascade that
  removes all project-owned rows and stored blobs before deleting the project document itself.
  An internal resume mutation is available for legacy soft-deleted records.

Verification completed on 2026-08-29: 835 tests passed with 4 intentional skips, renderer and
Electron typechecks passed, lint passed, the production build passed, and a real Electron
Computer Use flow reopened the selected fixture from its exact inode as an `attached` workspace
without recreating a managed copy or numeric suffix.

Deferred compatibility/rollout work is intentionally non-destructive: add the optional
original-versus-legacy-copy comparison UI, remove the compatibility import API and legacy cloud
path fields only after old-client telemetry permits it, and complete the full cross-feature GUI
matrix (collaboration, DevApps, external volumes, symlinks, and two concurrent project servers).

## Objective

Opening an existing folder must bind Cozea to that exact folder in place. It must not copy,
rename, relocate, or assume ownership of the folder. Cozea-managed storage remains the default
destination only for projects that Cozea creates or clones.

This is a workspace-identity and ownership change, not only an import-dialog change. It affects
project creation, deletion, storage accounting, local authorization, recovery, collaboration,
runtime invalidation, DevApps, and migration of existing copied imports.

## Target ownership model

The product should distinguish four identities:

1. **Project** — shared cloud identity, collaboration scope, metadata, and repository descriptor.
2. **Local workspace** — one device's binding from a project to a filesystem root.
3. **Workspace lane** — the shared branch, task branch, or worktree used by a runtime.
4. **Runtime session** — terminals, assistant, Dev Server, browser preview, and native preview for
   one workspace lane.

Every local workspace must also carry explicit storage ownership:

- `managed`: Cozea created or cloned the root and may offer to move it to Trash.
- `attached`: the user selected an existing root; Cozea never moves or deletes that root.

Path containment is not ownership. An existing user folder selected from inside the configured
Cozea directory is still `attached`. A managed folder moved outside that directory must not become
eligible for deletion merely because of stale metadata.

## Product invariants

- **Open Existing Folder** uses the selected folder's real path and creates no second copy.
- The folder name and location remain unchanged.
- **New Project** and **Clone Repository** continue to materialize managed folders under the
  configured managed-projects directory unless the user chooses another creation root.
- Attached roots are never removed by project deletion, storage cleanup, reset, or uninstall flows.
- A destructive managed-root operation requires both explicit `managed` ownership and a verified
  path inside its recorded managed root.
- Absolute local paths are device-local state. Convex data is never authoritative for a device's
  current workspace path.
- Reopening the same project/folder is idempotent. Opening a folder already bound to another live
  project produces a conflict; it never silently transfers or force-binds it.
- Switching, losing, or rebinding a workspace invalidates the old terminals and previews. A failed
  launch must not leave another project's preview visible.
- Runtime services receive an opaque `workspaceId`/`laneId`; path access is resolved and verified
  in Electron immediately before use.

## Current behavior and gaps

- Both local-folder entry points call `workspace.importExistingFolder`.
- `WorkspaceCatalog.importExistingFolder` copies the selected tree into `projectsDirectory`, finds
  a numeric suffix when the destination exists, then binds the copy with `forceBind: true`.
- The project record may say `workingCopyMode: "attached"` even though the filesystem behavior is
  managed-copy behavior.
- Deleting a project forgets its workspace binding while preserving the copied directory by
  default. Re-import therefore finds the old folder and creates another suffixed copy.
- Deletion currently collects raw paths and relies on a managed-directory containment guard. That
  prevents many external deletions but cannot distinguish a user-owned attached folder located
  inside the configured directory.
- `projects.localPath` and `projectMembers.localPath` are legacy cloud fields for machine-specific
  data. They can become stale across devices and must not select a runtime root.
- Settings storage scans only the configured projects directory. That is appropriate for managed
  source storage, but the UI and labels currently imply it represents all projects.
- The renderer's pre-bind project inspection uses a persisted broad list of approved external read
  roots. Bound workspace operations already have a narrower catalog authorization model.
- Runtime, Git, terminal, assistant, browser automation, and DevApp code primarily use
  `workspaceId` and are structurally compatible with external roots.

## T3 upstream guidance

Reviewed against `pingdotgg/t3code` `origin/main` at
`018d7f2775daabd2ef07898af29586915a0b7f67` (upstream commit dated
2026-08-28T07:54:02-07:00; review performed 2026-08-29T01:47:29+08:00).

### Patterns to adopt

- **Existing folders are exact-path projects.** T3's Add Project flow sends the selected/typed
  normalized path as `workspaceRoot`; it does not copy the directory into an application-managed
  location.
- **Adding the same path is navigation, not duplication.** The client first compares the normalized
  path within the target environment and opens the existing project/thread. The server repeats the
  uniqueness invariant for active projects.
- **Clone is a separate flow.** T3 asks for a repository and explicit destination, displays
  **Clone** or **Create & Clone**, and never disguises cloning/copying as opening a local folder.
- **The base directory is a browsing default.** `addProjectBaseDirectory` chooses where the picker
  starts; it does not relocate an existing folder. Cozea's configured directory should have the
  same role for new projects and clones.
- **Paths belong to an environment.** T3 persists `workspaceRoot` in the local/remote environment
  that can actually access it and groups equivalent project checkouts in the UI. This supports
  Cozea's conclusion that a cloud project and a device-local workspace binding are separate
  identities.
- **Removing a project does not remove its source folder.** T3's settings and confirmation copy
  explicitly say that files on disk are not touched. Project deletion tombstones metadata and
  threads only.
- **Generated worktrees have a separate lifecycle.** When the last thread referencing a worktree is
  deleted, T3 checks that no other thread shares it, asks separately whether to delete it, removes
  it through Git, and reports cleanup failure after the thread deletion. This is the right pattern
  for Cozea-owned derived resources.
- **Runtime cwd has one deterministic fallback.** T3 consistently uses
  `thread.worktreePath ?? project.workspaceRoot`; terminals, VCS, checkpoints, and provider sessions
  derive from the same root rather than reconstructing it from project names.
- **Normalization and filesystem safety live server-side.** Workspace roots are resolved and
  validated as directories before commands enter the event log, and workspace-relative reads
  reject traversal and symlink escapes.

Relevant upstream files:

- `packages/client-runtime/src/operations/projects.ts`
- `packages/client-runtime/src/state/projects.ts`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/settings/ProjectSettingsPanel.tsx`
- `apps/web/src/hooks/useThreadActions.ts`
- `apps/server/src/workspace/WorkspacePaths.ts`
- `apps/server/src/workspace/WorkspaceFileSystem.ts`
- `apps/server/src/orchestration/commandInvariants.ts`
- `apps/server/src/orchestration/decider.ts`

### Patterns to adapt rather than copy

- T3's project record is already scoped to one environment, while Cozea has a shared Convex project
  identity spanning devices. Cozea should therefore keep the T3-style exact local root in
  `local_workspaces`, not move the absolute path into the shared project record.
- T3 treats source folders as externally owned and never deletes them. Cozea additionally creates
  and clones managed roots, so it needs explicit `managed | attached` ownership plus guarded Trash
  operations that T3 does not need for project roots.
- T3 compares normalized path strings. Cozea should retain its stronger realpath plus filesystem
  device/inode/birthtime identity so aliases, symlinks, moves, and mounted volumes do not create
  duplicate or unsafe bindings.
- T3's general Add flow can create a missing typed path. Cozea should keep **Open Existing** and
  **New Project** distinct: attachment requires an existing directory; only the creation flow can
  create a managed root.
- T3 stores a directly addressable cwd in its environment protocol. Cozea should keep the renderer
  on opaque workspace IDs and resolve the verified path in Electron, because Cozea exposes a much
  broader multi-pane filesystem/runtime surface.

The intended Cozea behavior is therefore T3's exact-path and non-destructive project semantics,
combined with Cozea's stronger device-local ownership, authorization, collaboration, and managed
storage model.

## Contract and local data changes

### Local workspace schema

Add a versioned SQLite migration with fields equivalent to:

- `storage_ownership`: `managed | attached`
- `managed_root_id`: nullable; required for newly written managed rows
- `marker_policy`: `required | git_private | none`
- optional migration metadata identifying a legacy copied import without changing its ownership

Expose ownership in `LocalWorkspaceDTO`. Keep `source` as provenance (`create`, `clone`, `import`,
`locate`, and migration variants); do not overload provenance as deletion authority.

Populate `root_id`/`managed_root_id` when `createForProject` and `cloneForProject` bind their target.
The current bind helper drops that association.

### Workspace API

Introduce an explicitly named `attachExistingFolder` operation:

- input: project ID, selected folder, optional nested project root, expected repository identity,
  active-workspace preference
- output: bound workspace and any structured conflicts
- behavior: stat and realpath the selected folder, preflight markers/repository/catalog identity,
  bind the same root with `storage_ownership = attached`, and never copy or force-bind

Keep `importExistingFolder` only as a short compatibility shim while renderer callers migrate, then
remove the copy-oriented request/result fields (`slug`, `rootPathOverride`, `importedFrom`,
`copiedTo`). If a future **Copy into Cozea** action is desired, it must be a separate, explicit user
choice with copy-specific language.

### Cloud metadata

- Treat `projects.localPath` and `projectMembers.localPath` as deprecated lookup hints during one
  compatibility window, never as active-root authority.
- Stop writing absolute paths to Convex from new flows, then remove them from sidebar projections,
  mutations, validators, and schema after old clients age out.
- Treat repository `workingCopyMode` as legacy creation metadata, not per-device workspace state.
  A collaborator may attach on one Mac and clone a managed copy on another.
- Keep repository identity and collaboration scope shared; keep filesystem ownership and path local.

## Flow changes

### Open an existing folder

1. Select the folder.
2. Electron preflights stat, realpath, accessibility, marker identity, catalog collision, nested-root
   selection, and Git metadata before creating cloud state.
3. If the same real path is already bound, ask Convex whether the authenticated device can access
   that project. Open it only when access is confirmed; an auth or transport failure is an error,
   not permission to detach.
4. If the authenticated lookup returns `null`, stop project services, clear renderer/workbench/T3
   projections, forget the device-local workspace record, preserve the attached source folder,
   and re-run preflight. Do not create cloud state unless the stale binding is demonstrably gone.
5. Create/resume a Convex project in `provisioning` with an idempotent creation token.
6. Attach the exact folder locally as `attached`.
7. Mark the cloud project active and navigate using the returned workspace ID.
8. On failure, compensate or leave one recoverable provisioning record; never create duplicate
   cloud projects on retry.

Both `useLocalProjectImport` and local mode in `CreateProjectDialog` must use one shared orchestration
function. Local mode no longer asks for or validates a destination parent directory.

### New project and clone

- Continue selecting an available managed destination.
- Bind with `managed` ownership and the concrete managed-root ID.
- Make suffixing an explicit collision outcome in the UI where practical; never use it to hide a
  stale binding or retry bug.

### Locate or repair

- Locating an arbitrary existing folder creates an `attached` binding.
- Rebinding a known managed folder after a move preserves managed ownership only when the catalog
  can prove it is the same marked workspace and the user confirms the move. Otherwise default to
  `attached`, the safer ownership.
- An unavailable external drive produces a broken binding with locate/clone options, not a new
  managed copy.

### Delete project

- Build and display a local cleanup plan before the cloud mutation.
- Attached workspace: close runtimes, remove the local binding/owned marker, and keep the folder.
  Do not show a control that suggests Cozea can delete it.
- Managed workspace: default to keeping files; optionally offer **Move managed folder to Trash**.
- Replace raw-path `storage:deleteProject` calls with a workspace-ID operation that verifies:
  ownership is `managed`, the workspace marker matches, the real path is within its recorded
  managed root, no other project claims it, and sessions are stopped.
- Keep deletion recoverable through Trash and report local cleanup failures after cloud deletion.
- Stop Dev Servers before closing their workbench sessions or forgetting workspace authorization.
  Close every session/runtime for the project, including legacy unbound sessions.
- Remove persisted workbenches/layouts, assistant drafts and thread detail, sidebar/route/task/feed
  state, terminal and Dev Server mirrors, surface leases, query cache entries, and local Project
  DevApp publications. Delete the corresponding T3 project with `force` so its threads cannot
  restore when the same source folder is attached again; retry a temporarily unavailable T3
  runtime from a small persisted deletion queue.
- Cloud deletion is a real cascade rather than a permanent tombstone: mark deleted to revoke
  access synchronously, purge every direct project-owned table and storage reference in bounded
  scheduled batches, make a second pass for in-flight writes, then delete the project row last.
  Pre-fix soft-deleted projects can be scheduled through the internal-only
  `projects.resumeDeletedProjectPurge` mutation after deployment.

## Marker policy

- Managed roots require a Cozea marker.
- Attached Git roots may use `.git/cozea/workspace.json`, which is device-local and not committed.
- Attached non-Git roots should default to no marker so opening a folder does not add source files.
  Identity comes from the catalog plus device/inode/birthtime and explicit relink. A future optional
  marker can be an informed user choice.
- Verification must understand the policy instead of treating marker absence uniformly.
- Forget removes only a marker whose project/workspace identity exactly matches the binding.

## Filesystem authorization and privacy

- Move preflight Git/framework inspection into workspace/picker-scoped Electron IPC rather than
  giving the renderer durable broad access to every previously selected external root.
- Once bound, use catalog-authorized workspace APIs for all reads and writes. Refactor project
  detection away from `resolveRoot` followed by general `fs:*` calls. Package-manager and
  dependency detection now satisfy this invariant through `project:listDirectory`; keep future
  project inspection on the same scoped API family.
- Garbage-collect obsolete `approvedExternalReadRoots`, or reduce them to short-lived picker grants.
- Do not log full external paths in analytics or cloud events.
- The current notarized macOS build is not App Sandbox-enabled, so direct paths persist across app
  restart. If App Sandbox is adopted later, store security-scoped bookmarks per local workspace.

## Runtime and feature impact

- **Assistant/T3:** pass the attached `projectRootPath` as cwd. The agent will now operate on the
  user's actual files, so UI copy and approval surfaces must make that location clear.
- **Terminal:** resolve cwd from the active workspace/lane; verify `pwd` is the selected root.
- **Git/changes/Yjs:** continue to scope by project/workspace IDs. File writes now affect the
  selected original checkout, which is the intended behavior.
- **Dev Server:** command discovery, ensure/reuse, and port brokerage remain keyed by workspace/lane.
  Fix package-manager-specific forwarded arguments so pnpm does not receive a literal `--` as the
  application directory.
- **Browser/native preview:** clear or detach old content as soon as the workspace becomes missing,
  changes, or launch fails. Never show a prior project's preview under the new project.
- **DevApps:** releases already avoid storing absolute paths. Resolve the current source workspace
  when launching, and show locate/clone recovery when that binding is unavailable.
- **Artifacts and assistant sessions:** remain project/thread scoped and survive view changes; a
  workspace rebind must update runtime cwd without borrowing another project's session.

## Storage settings

- Rename **Projects directory** to **New projects and clones location** (or **Cozea-managed
  projects**) and update all translations/documentation.
- Managed-project source size remains part of Cozea storage.
- External attached source files are not counted as Cozea-owned storage and are never included in
  **Clear all**.
- If attached dependency/build caches are shown, list them separately and delete only known cache
  directories after explicit confirmation through workspace-scoped guards.
- `project:exists` must stop reconstructing `projectsDirectory/slug`; use catalog resolution or
  remove the unused legacy endpoint.

## Legacy copied-import migration

Do not automatically switch old imports back to their recorded source. The managed copy may contain
the user's only or newest work.

Classify existing rows conservatively:

- `create` / `clone`: managed when the row and marker verify under a known managed root
- `workspace.imported.copy`: legacy managed copy; retain in place
- `locate` / `repair` / attached legacy sources: attached
- unknown or ambiguous: attached (safe default; never deletion-eligible)

For a legacy copy with a `workspace.imported.copy` source path:

1. If the source is missing, keep the managed copy.
2. If source and copy are equivalent, offer **Use original folder**; never switch silently.
3. If they differ, show both locations and Git/fingerprint status, and offer to keep the copy or
   inspect differences.
4. Rebinding preserves the old copy until the user separately moves it to Trash.

The migration must be restartable, versioned, and telemetry-safe. It must not delete or overwrite
project data.

## Implementation phases

### Phase 0 — correctness baseline

- Fix pnpm/bun/npm/yarn argument forwarding with package-manager-specific tests.
- Clear stale browser/native previews on workspace change and failed launch.
- Add regression tests for the existing suffix-copy and delete/re-import failure.

### Phase 1 — ownership foundation

- Add the SQLite migration, DTO/contract fields, ownership classifiers, and managed-root linkage.
- Backfill conservatively and expose ownership in catalog snapshots and repair UI.
- Add workspace-ID-based safe-trash preflight; keep the current raw-path deletion API unused.

### Phase 2 — in-place attach flow

- Add `attachExistingFolder` and preflight.
- Unify both renderer entry points and remove destination controls from local mode.
- Use provisioning/idempotency/compensation so failed attachment cannot create cloud twins.
- Update wording to **Open/Attach Existing Folder**, never **Import copy**.

### Phase 3 — deletion, authorization, and storage

- Completed: ownership-aware deletion UI, guarded Trash, full local/T3 state cleanup, and bounded
  Convex cascade are implemented. Attached roots remain ineligible for filesystem deletion.
- Completed: project inspection uses workspace-scoped IPC for Dev Server and DevApp detection.
- Remaining: split optional attached dependency/build caches into explicit storage accounting and
  retire the unused legacy broad-read configuration after compatibility telemetry permits it.

### Phase 4 — path decoupling and runtime hardening

- Stop new Convex `localPath` writes and remove cloud-path authority from all open flows.
- Audit assistant, terminal, Git, Yjs, Dev Server, browser/native preview, DevApps, worktrees, and
  external editors against workspace/lane identity.
- Invalidate all runtime state on missing/replaced workspace revision.

### Phase 5 — legacy migration experience

- Backfill ownership, detect copied imports from events, and add the original-vs-copy decision UI.
- Keep all migration actions recoverable and never delete either side automatically.
- Remove copy-oriented APIs after compatibility telemetry shows no old callers.

### Phase 6 — verification and rollout

- Run unit, integration, typecheck, lint, build, and real Electron GUI tests.
- Roll out with structured local diagnostics that record ownership/source/result but not full paths.
- Update `AGENTS.md`, project creation docs, DevApp docs, storage copy, and translations in the same
  implementation series.

## Required acceptance tests

- Attach Git and non-Git folders outside and inside the managed directory; assert identical real
  path/inode before and after and no new sibling directory.
- Names with spaces, Unicode, symlinks, nested monorepo roots, read-only folders, moved folders, and
  temporarily unavailable external volumes.
- Same folder/same project is idempotent; same folder/different project is blocked without explicit
  transfer; retry after failed cloud activation creates no twin.
- App restart and cold open preserve the exact attached root.
- Terminal `pwd`, assistant cwd, Git status, file edits, Yjs sync, Dev Server launch/reuse/restart,
  browser preview, and DevApp launch all target that root.
- Switching between two projects with active servers never swaps cwd, terminal, URL, screenshot, or
  native preview state.
- Deleting an attached project keeps every source file even when the folder is under the configured
  managed root.
- Deleting a managed project offers keep/Trash and refuses deletion on ownership, root, marker, or
  shared-reference mismatch.
- Storage **Clear all** cannot delete attached roots.
- Legacy copied imports remain usable; equivalent and divergent migration cases preserve both roots
  until a separate user-confirmed Trash action.
- Run the final end-to-end matrix through the real Electron GUI with computer use, not Playwright.

## Release gate

The change is ready only when a folder selected through **Open Existing Folder**:

- opens from the exact selected path after restart,
- creates no managed copy or numeric suffix,
- works end to end across assistant, terminal, Git, Dev Server, preview, collaboration, and DevApps,
- and cannot be deleted by any Cozea cleanup path unless it was explicitly created or cloned as a
  managed workspace.
