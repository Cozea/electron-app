# Desktop-first architecture implementation plan

Status: implementation complete — packaged macOS acceptance QA pending
Baseline: `main` at `40fb561f198a09c36457a5a4d2101d4f4a23c7bd`
Branch: `codex/desktop-first-architecture`
PR: `#143`

## Objective

Make Cozea behave like a persistent desktop IDE rather than a browser SPA packaged in Electron.
The first useful frame for a returning user is derived from durable local state. Remote auth,
Convex, collaboration, and provider state validate and refresh that local state afterward.

This is an architectural migration, not a React rewrite or visual redesign. Existing routes,
recovery data, unpublished work, project/workspace ownership rules, IPC contracts, and backend
authorization remain authoritative.

## Invariants

1. Cached local state may paint UI but never grants current cloud authority.
2. No unpublished assistant, collaboration, DevApp, workspace, terminal, or source-control state is
   deleted by this migration.
3. Existing performance budgets may only move downward unless a named regression is demonstrated.
4. Feature owners keep owning feature state; desktop bootstrap aggregates only shell-critical data.
5. The renderer-wide T3 `<webview>` host remains the browser architecture as required by `AGENTS.md`.
6. On macOS, window visibility and application lifetime are separate from explicit application quit.

## Target startup contract

Returning-user startup has four readiness levels:

- **native window ready**: theme, bounds, titlebar and essential Electron state are available.
- **desktop bootstrap ready**: secure cached local identity/profile metadata and the last workbench
  locator are read from local machine state.
- **UI interactive**: the previous project/workbench shell is restored from local state.
- **cloud validated**: a fresh device session, Convex identity/permissions, collaboration and
  provider state are established in parallel.

Levels 1–3 do not normally wait for level 4.

A security refinement landed during implementation: the encrypted cached session is used for local
identity/shell paint, but its cached access token and Convex user ID are not treated as current cloud
authority. Fresh device-session revalidation establishes those values before cloud-backed operations
are enabled.

## Completed implementation

### 0. Measurement and guards

- Kept the existing interaction-performance harness as the regression gate.
- Corrected warm-project-switch documentation to the executable 300 ms blocked-time budget.
- Added rollout flags for desktop bootstrap, shell-first auth, common-route prewarm and lazy renderer
  hosts.
- Added true process-entry timing before the Electron main feature graph and emit
  process-entry → app-ready and process-entry → main-window-created measurements.

### 1. Secure local bootstrap

- Added versioned desktop bootstrap/session/navigation contracts.
- Persisted the last successful device session through Electron `safeStorage` under `userData`.
- Persisted the last workbench locator atomically under `userData` while dual-writing the legacy
  renderer key during migration.
- Corrupt files and unavailable secure storage fail closed to missing bootstrap state; no plaintext
  credential fallback is introduced.

### 2. Shell-first authentication

- Returning-user identity/profile state paints immediately from encrypted local bootstrap.
- Fresh cloud identity and token state are established by background device challenge/revalidation.
- Cached credentials cannot grant Convex/cloud mutation authority.
- Logout and local identity reset clear encrypted cached session state before claiming completion.
- Network/revalidation failure leaves local workspace state visible instead of replacing the app
  with a global authentication loader.

### 3. Instant last-workbench restoration

- Migrated `cozea.lastWorkbenchRoute.v1` into the main-owned bootstrap locator without destructive
  legacy cleanup.
- Applied the previous workbench route before React/router mount, including packaged `file://`
  launches.
- Removed the Convex round trip as a prerequisite for entering a locally known last project.
- Authoritative missing/revoked project responses invalidate the stale restore target before
  redirecting, preventing restore loops.

### 4. Common local route loading

- Removed the nested `ProjectWorkbenchPage -> lazy(ProjectWorkbenchSurface)` boundary.
- Prewarm restored workbench code before the first workbench frame.
- Project hover/focus prefetch now warms executable workbench code together with project/workspace/
  lane state.
- `RouteLoading` remains visibly blocking only for token-bound invite flows. Ordinary Projects,
  Workbench, Tasks and Settings code waits preserve the desktop shell instead of showing a
  browser-style loading page.

### 5. Workspace shell-first resolution

- Resolve local workspace identity from the stable route project ID before cloud project data is
  available.
- Keep the route/workbench tree mounted while local resolution is pending and show only a small
  reconnect status.
- Show repair UI only after an actionable missing/broken/ambiguous result is known.
- Presence, collaboration and cloud sync remain gated on the authoritative project entity.

### 6. Demand-loaded heavy renderer hosts

- Put the long-lived Terminal host behind a lightweight registry gate; xterm implementation code is
  not initialized in sessions that never need it.
- Put the existing renderer-wide T3 `<webview>` host behind a lightweight browser-surface gate.
- Prewarm required Terminal/Dev Server/browser-backed host chunks when the restored workbench already
  contains those tile types.

### 7. Main-process boot graph

- Added a minimal main entry mark, early lifecycle registration, desktop-bootstrap main bridge and
  preload wrapper.
- The built Electron main graph aliases cold Integration, Agent Tool and Agent Skill services to
  startup-safe facades.
- IPC channel names remain registered synchronously, while repository tooling, OAuth implementation,
  agent CLI discovery/login and skill provider/filesystem code are dynamically imported on first
  use.
- Agent-skill seeding/migration starts asynchronously through the lazy facade after app-ready instead
  of making the whole skill implementation boot-critical.
- Auth-critical collaboration, Terminal/workbench ownership and T3 browser/security ordering remain
  eager to avoid lifecycle and permission races.

### 8. macOS application/window lifetime

- Explicit application quit is tracked independently from ordinary window close.
- On macOS, closing the ordinary main window now hides/preserves that BrowserWindow instead of
  destroying the renderer and triggering the legacy `window-all-closed` app-service teardown.
- Dock/application activation resurfaces and focuses the same main shell; its workbench, renderer
  state and app-level services were never destroyed.
- Running Terminal and Dev Server processes therefore continue naturally while the window is hidden.
- `Cmd+Q` and controlled update shutdown mark the application as quitting first, allow the main
  window to really close, and execute registered runtime cleanup.
- The workbench runtime client becomes terminally disposed during teardown so repeated Windows/Linux
  cleanup cannot fork a replacement PTY runtime while the process is exiting.

### 9. Persistence consolidation

- Security-sensitive session bootstrap and shell-critical last-workbench navigation are main-owned,
  versioned desktop state.
- Legacy navigation persistence uses read-old → dual-write → new-read sequencing rather than a
  destructive cutover.
- Renderer query/workbench caches remain feature-owned convenience persistence; they are not turned
  into a second global desktop database.

## Regression coverage added

The branch adds architecture/unit coverage for:

- encrypted bootstrap round-trip and absence of plaintext token persistence;
- corrupt bootstrap files and secure-storage unavailability;
- strict persisted session validation;
- dev and packaged bootstrap-route recognition;
- stale project-restore invalidation;
- cached local identity versus fresh cloud authority;
- route-first local workspace resolution;
- persistent shell during workspace revalidation;
- restored Terminal/browser host prewarming and lazy host gates;
- common-route visible-loader policy;
- main-process lazy-service aliases and dynamic IPC implementations;
- macOS shell retention versus explicit-quit behavior;
- application-quit cleanup ordering;
- prevention of workbench-runtime respawn after disposal.

## Packaged macOS acceptance QA

This is the remaining operator verification before merge/release. CircleCI is not a gate for this PR.

1. **Returning launch, online**
   - Open a project/workbench, quit Cozea, relaunch.
   - Expected: the previous workbench is the first product surface; no global auth spinner or visible
     `/projects` intermediate page.
   - Fresh cloud state reconnects afterward.

2. **Returning launch, offline**
   - With a known local project open, quit, disconnect networking, relaunch.
   - Expected: local shell/workbench and local workspace remain coherent; cloud-backed actions remain
     unavailable/reconnecting instead of inheriting cached authority.

3. **Revoked/deleted project correction**
   - Restore a locator whose project was deleted or whose access was revoked.
   - Expected: optimistic local state may paint, then the authoritative response clears the locator
     and returns to Projects exactly once; no redirect loop.

4. **Workspace movement/repair**
   - Move/remove the bound local workspace and reopen the project.
   - Expected: shell remains mounted while resolution runs; actionable repair UI appears only after
     the missing/broken binding is known.

5. **Heavy host behavior**
   - Launch a workbench with no Terminal/browser-backed tiles, then restore workbenches containing
     Terminal, Dev Server and Browser tiles.
   - Expected: unused hosts stay cold; required restored hosts appear without a route-loading page.

6. **macOS close/reopen**
   - Start a long-running Terminal command and a Dev Server.
   - Close the main Cozea window without quitting the application.
   - Verify the work continues.
   - Click Cozea in the Dock and verify the same desktop shell returns immediately with runtime state
     intact.

7. **Explicit quit**
   - Repeat with running Terminal/Dev Server work and use `Cmd+Q`.
   - Expected: Cozea-owned runtime children terminate cleanly and repeated teardown does not spawn a
     replacement workbench runtime.

8. **Update/restart path**
   - Exercise the controlled update/restart path on a suitable build.
   - Expected: explicit application-quit cleanup executes and conversation continuation remains
     governed by the existing update contract.

9. **Interaction regression**
   - Exercise rapid project switching, same-tile re-click, Terminal project switching and common
     Settings/Tasks navigation.
   - Expected: no browser-style route loader on common local routes and no regression from existing
     interaction budgets.

## Definition of done

The code implementation is complete when a returning-user launch restores the previous local
project/workbench shell without waiting for remote authentication; known workspace resolution does
not blank the shell; ordinary common-route navigation does not expose local JavaScript loading;
heavy renderer hosts and optional main-process services load only when needed or are deliberately
prewarmed for restore; ordinary macOS close preserves the desktop shell and active work; and explicit
application quit terminates owned runtimes without respawn.

Merge readiness additionally requires the packaged macOS acceptance checklist above to pass on the
intended release hardware.
