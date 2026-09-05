# Desktop-first architecture implementation plan

Status: active
Baseline: `main` at `40fb561f198a09c36457a5a4d2101d4f4a23c7bd`
Branch: `codex/desktop-first-architecture`

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
- **desktop bootstrap ready**: secure cached device session and last workbench locator are read from
  local machine state only.
- **UI interactive**: the previous route/project/workbench shell is rendered from local state.
- **cloud validated**: device auth, Convex data, permissions, collaboration and provider state are
  refreshed in parallel.

Levels 1-3 must not normally wait for level 4.

## Work phases

### Phase 0 — measurement and guards

- Keep the existing interaction-performance harness as the regression gate.
- Correct documentation drift: executable warm-project-switch budget is 300 ms blocked time.
- Add temporary feature flags for desktop bootstrap, shell-first auth, common-route prewarm and
  demand-loaded renderer hosts.
- Record new behavior in this plan and the performance runbook.

### Phase 1 — secure local bootstrap

- Add a versioned `DesktopBootstrapSnapshot` shared contract.
- Persist the last issued device session through Electron `safeStorage` under `userData`.
- Persist the last workbench locator atomically under `userData`.
- Expose bootstrap read/write through a narrow preload bridge.
- Corrupt state falls back to missing state; it must never block application launch.

### Phase 2 — shell-first authentication

- Hydrate AuthContext synchronously from the local bootstrap snapshot when present.
- Keep `isLoading` false for returning users while device auth revalidates in the background.
- Seed Convex auth from the cached access token, then replace it with the fresh token when available.
- Logout clears both in-memory and encrypted cached session state.
- Network/revalidation failure keeps local UI visible but does not enable unauthorized mutations.

### Phase 3 — instant last-workbench restore

- Migrate `cozea.lastWorkbenchRoute.v1` into the main-owned bootstrap locator without deleting the
  legacy key in the migration commit.
- Before React mounts, replace `/` with the previous workbench route when local bootstrap state
  contains a valid locator.
- `ProjectsLaunchPage` no longer waits for Convex merely to navigate to a locally known project.
- `ProjectLayout` remains responsible for authoritative project-access correction after Convex
  resolves.

### Phase 4 — remove visible local code-loading from common paths

- Remove the nested `ProjectWorkbenchPage -> lazy(ProjectWorkbenchSurface)` boundary.
- Prewarm common project/workbench code on restore and on project hover/focus.
- Keep visible route-loading fallbacks only for genuinely uncommon/cold/token-dependent routes.

### Phase 5 — workspace shell-first resolution

- Do not replace the persistent project shell with a centered spinner while local workspace
  resolution is pending.
- Let `WorkbenchKeepAliveHost` keep the previous hosted session visible while the new workspace
  settles.
- Show repair UI only after resolution returns an actionable repair state.

### Phase 6 — demand-load heavyweight renderer hosts

- Replace unconditional `TerminalViewHost` mounting with a lightweight gate that imports xterm only
  when terminal views exist.
- Replace unconditional `ElectronBrowserHost` mounting with a lightweight registry gate that imports
  the existing T3 `<webview>` host only when browser-backed surfaces exist.
- Prewarm a heavy host immediately when restored workbench state requires it.

### Phase 7 — main-process startup and lifecycle

- Introduce a minimal main/preload wrapper entry so bootstrap handlers and process-entry timing can
  exist independently from feature implementation code.
- Where safe, register lightweight IPC facades that demand-load feature services rather than making
  every implementation boot-critical.
- Do not destabilize the existing T3/browser/security registration order.

### Phase 8 — macOS runtime lifetime

- Last-window close on macOS detaches UI but preserves genuine user work: running terminals, Dev
  Servers, agents and required sync activity.
- Dock activation recreates the main window and reconnects to existing process/session state.
- Explicit Quit and controlled updater restart perform bounded, ordered shutdown and leave no owned
  orphan processes.

### Phase 9 — persistence consolidation

- Shell-critical state migrates from renderer-only persistence to versioned desktop snapshots using
  read-old -> dual-write -> switch-read -> later-cleanup sequencing.
- UI-only preferences may remain renderer-local.

## Verification matrix

The branch is not ready to merge until these cases are covered by automated tests or explicit
packaged QA where automation is impossible:

- first launch online;
- returning user online;
- returning user offline;
- expired cached token;
- revoked/invalid remote authorization;
- valid/deleted/revoked last project;
- valid/moved/deleted local workspace;
- restored terminal and browser-backed workbench;
- rapid project switching;
- close/reopen last macOS window with running terminal and Dev Server;
- explicit Quit and controlled update teardown;
- corrupt bootstrap files;
- unavailable secure storage.

## Definition of done

A returning-user launch shows the real previous project/workbench shell without a full-screen auth
loader or visible `/projects` intermediate page; known workspace resolution does not blank the shell;
ordinary workbench navigation does not expose local JavaScript loading; terminal/browser renderer
implementations are initialized only when needed; existing interaction budgets remain green; and on
macOS active user runtimes survive last-window close but terminate on explicit application quit.
