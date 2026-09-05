# Desktop-first architecture implementation plan

Status: implementation complete — packaged macOS acceptance QA pending
Baseline: `main` at `40fb561f198a09c36457a5a4d2101d4f4a23c7bd`
Branch: `codex/desktop-first-architecture`
PR: `#143`

## Objective

Make Cozea behave like a persistent desktop IDE rather than a browser SPA packaged in Electron.
The first useful frame for a returning user must be derived from durable local state. Remote auth,
Convex, collaboration, and provider state validate and refresh that local snapshot afterward.

This is an architectural migration, not a React rewrite or visual redesign. Existing routes,
persisted recovery data, unpublished work, project/workspace ownership rules, IPC contracts, and
backend authorization remain authoritative.

## Non-negotiable invariants

1. Cached local state may paint UI but never grants cloud authority. Privileged mutations still
   require current server authorization.
2. No unpublished assistant, collaboration, DevApp, workspace, terminal, or source-control state is
   deleted as part of this migration.
3. Existing render-performance budgets may only move downward unless a named regression is proven.
4. Feature code continues to own feature state. Desktop bootstrap aggregates lightweight snapshots;
   it does not become a new global feature store.
5. The renderer-wide T3 `<webview>` host remains the browser architecture. `AGENTS.md` explicitly
   forbids adding `WebContentsView`, browser-bounds IPC, screenshot substitution, native-surface
   occlusion, or a fallback browser host.
6. On macOS, application lifetime and window lifetime are separate. Active user work should survive
   last-window close, while explicit Quit/update shutdown must terminate owned children cleanly.

## Target startup contract

Returning-user startup has four readiness levels:

- **native window ready**: theme, bounds, titlebar and critical Electron settings are known.
- **desktop bootstrap ready**: secure cached device identity/profile metadata and last workbench
  locator are read from local machine state only.
- **UI interactive**: the previous route/project/workbench shell is rendered from local state.
- **cloud validated**: a fresh device session, Convex identity/permissions, collaboration and
  provider state are established in parallel.

Levels 1-3 must not normally wait for level 4.

A deliberate security refinement landed during implementation: the encrypted cached session is used
for local identity/shell paint, but its cached Convex user ID/access token is not treated as current
cloud authority. Fresh device-session revalidation establishes those values before cloud-backed
operations are enabled.

## Completed work

### Phase 0 — measurement and guards

- Existing interaction-performance harness retained as the regression gate.
- Warm-project-switch documentation corrected to the executable 300 ms blocked-time budget.
- Temporary rollout flags added for desktop bootstrap, shell-first auth, common-route prewarm and
  demand-loaded renderer hosts.
- Process-entry, bootstrap and renderer timing points moved early enough to include startup work that
  was previously invisible to the measurements.

### Phase 1 — secure local bootstrap

- Added versioned `DesktopBootstrapSnapshot` / bridge contracts.
- Device-session bootstrap is encrypted with Electron `safeStorage` under `userData`.
- Last-workbench navigation is atomically persisted under `userData` while the legacy renderer key is
  still dual-written for safe migration.
- Corrupt files and unavailable secure storage fail closed to missing bootstrap state rather than
  plaintext persistence or launch failure.

### Phase 2 — shell-first authentication

- Returning-user identity/profile state can paint immediately from the secure local bootstrap.
- Fresh cloud identity and token state are established by background device-session revalidation.
- A cached credential cannot grant Convex/cloud mutation authority.
- Logout and local identity reset clear the encrypted cached session.
- Revalidation/network failure leaves local workspace state visible instead of replacing the app
  with the global auth loader.

### Phase 3 — instant last-workbench restore

- `cozea.lastWorkbenchRoute.v1` migrates into the main-owned bootstrap locator without destructive
  legacy cleanup.
- The previous workbench route is applied before React/router mount, including packaged `file://`
  launches.
- `ProjectsLaunchPage` no longer requires a Convex round trip merely to enter a locally known
  project.
- Authoritative missing/revoked project responses invalidate stale restore state before redirecting,
  preventing restore loops.

### Phase 4 — remove visible local code-loading from common paths

- Removed the nested `ProjectWorkbenchPage -> lazy(ProjectWorkbenchSurface)` boundary.
- Restored workbench code and required heavy tile hosts are prewarmed before first workbench paint.
- Project-hover/focus prefetch warms executable workbench code together with project/workspace/lane
  data.
- `RouteLoading` now remains visible only for token-bound invite flows; normal local Projects,
  Workbench, Tasks and Settings chunk waits preserve the desktop shell instead of showing a
  browser-style loading page.

### Phase 5 — workspace shell-first resolution

- Local workspace resolution uses the stable route project ID before cloud project data resolves.
- Pending resolution keeps the route/workbench tree mounted and shows only a small non-blocking
  reconnect indicator.
- Repair UI appears only after an actionable resolution result exists.
- Presence/collaboration/cloud sync remain gated on the authoritative project entity.

### Phase 6 — demand-load heavyweight renderer hosts

- Terminal host is behind a lightweight registry gate; xterm implementation code is not initialized
  in sessions that never need a terminal.
- Existing renderer-wide T3 `<webview>` host is behind a lightweight browser-surface gate.
- Restored terminal/Dev Server/browser-backed workbenches prewarm their required host chunks before
  the first workbench frame.

### Phase 7 — main-process startup and lifecycle

- Added a minimal process entry/mark, early lifecycle registration, desktop-bootstrap main handler
  and preload wrapper around the existing main application.
- The built Electron main graph aliases cold Integration, Agent Tool and Agent Skill services to
  startup-safe facades. IPC names remain registered synchronously while repository tooling, CLI
  discovery/login and skill provider/filesystem implementations load on first use.
- Agent-skill seeding/migration also enters through the lazy facade instead of forcing the complete
  skill implementation into process startup.
- Auth-critical collaboration, terminal/session ownership and T3 browser/security initialization
  remain eager rather than risking lifecycle or permission races.

### Phase 8 — macOS runtime lifetime

- Last-window close and application quit are distinct lifecycle states.
- Terminal/Dev Server teardown ignores last-window close on macOS and runs on explicit application
  quit/update shutdown.
- Runtime cleanup registration is itself lightweight and occurs after main bootstrap so process-entry
  lifecycle code does not pull PTY/Dev Server modules forward.
- Dock activation recreates the renderer around the still-running process services.

### Phase 9 — persistence consolidation

- Security-sensitive session bootstrap and shell-critical last-workbench navigation are main-owned,
  versioned desktop state.
- Legacy route persistence is migrated using read-old/dual-write sequencing rather than destructive
  cutover.
- Renderer-local query/workbench caches remain feature-owned convenience persistence; they are not
  promoted into a second global desktop store.

## Automated regression coverage

The branch adds architecture/unit coverage for:

- encrypted bootstrap round-trip and absence of plaintext token storage;
- corrupt bootstrap files;
- secure-storage unavailability;
- strict persisted session validation;
- packaged and dev bootstrap-route recognition;
- stale restore invalidation;
- cached local identity vs fresh cloud authority;
- workspace resolution from route identity;
- persistent shell during workspace revalidation;
- terminal/browser demand-loading and restored-host prewarming;
- common-route visible-loader policy;
- main-process lazy-service aliases/facades;
- macOS windowless-runtime preservation and explicit application-quit cleanup ordering.

## Packaged macOS acceptance QA

This is the remaining operator verification before merge/release. CircleCI is not a gate for this PR.

1. **Returning launch, online**
   - Open a project/workbench, quit Cozea, relaunch.
   - Expected: previous workbench is the first product surface; no global auth spinner or visible
     `/projects` intermediate page.
   - Cloud state reconnects afterward.

2. **Returning launch, offline**
   - With a known local project open, quit, disconnect networking, relaunch.
   - Expected: local shell/workbench and local workspace remain usable/coherent; cloud-backed state
     remains unavailable/reconnecting rather than being implicitly authorized.

3. **Revoked/deleted project correction**
   - Restore a locator whose project has been deleted or whose access is revoked.
   - Expected: optimistic local restore may paint, then authoritative response clears the stale
     locator and returns to Projects exactly once; no redirect loop.

4. **Workspace movement/repair**
   - Move or remove the bound local workspace and reopen the project.
   - Expected: shell remains mounted while resolution runs; actionable repair UI appears only after
     the missing/broken binding is known.

5. **Heavy host behavior**
   - Launch a workbench with no terminal/browser-backed tiles.
   - Then separately restore workbenches containing Terminal, Dev Server and Browser tiles.
   - Expected: unused hosts stay cold; required restored hosts appear without a visible route loader.

6. **macOS last-window lifecycle**
   - Start a long-running terminal command and a Dev Server.
   - Close the last Cozea window without quitting the application.
   - Verify both processes continue.
   - Reactivate Cozea from the Dock and verify the same runtime/session state reconnects.

7. **Explicit quit**
   - Repeat with running Terminal/Dev Server work and use `Cmd+Q`.
   - Expected: owned runtime children shut down and no Cozea-owned PTY/Dev Server process is left
     orphaned.

8. **Update/restart path**
   - On a build where an update can be installed, exercise the controlled restart path.
   - Expected: explicit application-quit cleanup executes; continuation behavior remains governed by
     the existing update-conversation contract.

9. **Interaction regression**
   - Exercise rapid project switching, same-tile re-click, terminal project switching and common
     Settings/Tasks navigation.
   - Expected: no browser-style route loader on common local routes and no regression from the
     existing interaction budgets.

## Definition of done

The code implementation is complete when a returning-user launch shows the previous
project/workbench shell without a full-screen auth loader or visible `/projects` intermediate page;
known workspace resolution does not blank the shell; ordinary workbench/common Settings navigation
does not expose local JavaScript loading; terminal/browser renderer implementations initialize only
when needed or are prewarmed for restore; optional main-process service implementations stay outside
the boot graph until needed; and on macOS active Terminal/Dev Server work survives last-window close
but terminates on explicit application quit.

Merge readiness additionally requires the packaged macOS acceptance checklist above to pass on the
intended release hardware.
