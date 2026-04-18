# Tmux-Inspired Runtime Architecture

## Summary

Cozea should behave like a local runtime host with an attached UI, not like a React app that happens to launch terminals.

The core rule is:

- process lifetime is independent from viewport lifetime

This document defines the architecture that follows from that rule and maps it onto the current codebase.

It is intentionally written as both:

- a target architecture reference
- an implementation contract for the next refactor passes

This work comes before more collaboration fixes because unstable runtime ownership keeps leaking into:

- terminal cwd confusion
- dev-server ownership confusion
- browser/preview lifecycle resets
- lane state leakage between roots
- unnecessary background CPU work

## Product Direction

Cozea is converging on a hybrid of:

- Codex-style persistent local execution
- VS Code-style multi-surface workbench
- tmux-style process retention and detach/reattach

The relevant lesson from tmux is not panes or keyboard shortcuts. It is the ownership model:

- a background server owns live terminals and processes
- clients attach to that server
- switching the visible client does not kill the underlying work

Sources:

- [tmux Getting Started](https://github.com/tmux/tmux/wiki/Getting-Started)
- [tmux Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode)
- [tmux Advanced Use](https://github.com/tmux/tmux/wiki/Advanced-Use)

## Architectural Rule Set

### Rule 1: Runtime Owns Work

The local runtime owns:

- PTYs
- dev servers
- browser sessions
- native preview sessions
- diagnostics workers
- Git-backed local runtime metadata

The renderer never owns those resources directly.

### Rule 2: Sessions Own Local Roots

A project session is the durable owner of one canonical workspace root.

A session may start unbound, but once bound to a verified local root it must not silently drift to another root.

Changing root means one of:

- opening a different session
- closing the old session and creating a new one
- explicit migration with user-visible intent

It must never happen as an incidental side effect of route changes or fallback resolution.

### Rule 3: Lanes Own Execution Intent

A lane is a durable execution context inside a project session.

Examples:

- collaborative lane
- personal branch lane
- worktree lane
- review lane
- agent-specific lane

The lane decides:

- which local root it uses
- which branch/worktree it represents
- which terminals belong to it
- which browser tiles belong to it
- which dev-server state belongs to it

### Rule 4: Surfaces Attach To Lanes

UI surfaces are consumers of lane-owned runtime.

Examples:

- terminal tile
- browser tile
- dev-server tile
- native preview tile
- assistant tile

Unmounting a surface must not kill the lane-owned resource by default.

### Rule 5: Hot-Path Local State Must Be Path-Aware

Any cache or session lookup that influences local execution must include the canonical local root when relevant.

That includes:

- workbench scope keys
- workspace runtime ids
- lane state caches
- browser workspace persistence
- session registry keys

If a cache key omits the local root, it is presumed unsafe for multi-project multitasking.

### Rule 6: Do Not Poll Unless The Feature Requires It

Background runtime logic must be demand-driven whenever possible.

Specific rule for terminals:

- ordinary shell terminals should stream output and retain state
- only workflows that explicitly need subprocess-idle detection may enable subprocess activity tracking

This avoids a constant tax on all terminals just to support one workflow such as dev-server bootstrap settle detection.

## Canonical Concepts

### Runtime Daemon

The runtime daemon is now split into two cooperating local runtime layers:

- Electron main as the orchestration and IPC authority
- a dedicated `workbench-runtime` child process for PTYs and anything launched inside them

Current owning services include:

- `electron/services/WorkbenchSessionManager.ts`
- `electron/services/TerminalService.ts`
- `electron/services/DevServerService.ts`
- `electron/services/WorkbenchRuntimeClient.ts`
- `electron/workbench-runtime/child.ts`
- `electron/services/WorkbenchBrowserService.ts`
- `electron/services/nativePreview/NativePreviewManager.ts`

Electron main keeps browser/native-preview/session ownership. The child runtime owns terminal process lifetime and therefore also owns dev servers, agent shells, and any other background work started inside those PTYs.

### Project Session

A project session is the durable runtime container for:

- one `projectId`
- one `laneId`
- one canonical `projectPath` or `unbound`

Current implementation anchor:

- `electron/services/WorkbenchSessionManager.ts`

Session responsibilities:

- own the canonical local root for a lane
- retain terminal/browser/native-preview bindings
- expose lifecycle transitions
- guard against cross-root rebinding
- emit snapshots back to the renderer

### Lane

A lane is the durable execution identity inside a project.

Current related surfaces:

- `src/features/projects/hooks/useProjectLaneState.ts`
- `src/features/projects/lib/projectBranchSessionStore.ts`
- `src/features/projects/pages/ProjectWorkbenchPage.tsx`

Target lane properties:

- `projectId`
- `laneId`
- `canonical projectPath`
- `collabBranch`
- `activeBranch`
- `worktree metadata`
- `sessionKey`
- `workspaceId`

### Workspace Runtime

The renderer-side workspace runtime is a path-aware subscription record that mirrors attached runtime state and collaboration state.

Current implementation:

- `src/features/projects/workspaces/useWorkspaceRuntimeStore.ts`
- `src/features/projects/workspaces/WorkspaceRuntimeHosts.tsx`

Responsibilities:

- track route attachment
- mirror Yjs and sync contexts
- bind workbench session snapshots
- derive renderer lifecycle hints

The workspace runtime is not the process owner. It is the renderer-side mirror of runtime ownership.

### Surface

A surface is a visible UI endpoint that attaches to a session-owned resource.

Examples:

- `WorkbenchTerminalTile`
- `WorkbenchBrowserTile`
- `WorkbenchDevServerTile`
- `WorkbenchAssistantChatTile`

Surfaces may be:

- visible
- hidden but warm
- hidden and frozen
- detached

But they should not redefine runtime ownership.

## Current Codebase Status

### What Already Exists

The repo is not starting from zero. It already contains the beginnings of the right shape.

Implemented today:

- path-aware workbench scope keys in `useProjectWorkbenchStore`
- Electron-side `WorkbenchSessionManager`
- session lifecycle IPC
- session-owned terminal bindings by `tileId`
- session-owned browser bindings by `tileId`
- path-aware workspace runtime ids
- renderer lifecycle binding via `useWorkbenchSessionLifecycle`
- non-destructive route unmount behavior for workbench sessions

### What Is Still Wrong

The remaining issues are mostly consistency problems.

#### 1. Some cache keys still ignore `projectPath`

Current example:

- `src/features/projects/hooks/useProjectLaneState.ts`

The lane-state cache still keys by project and branch only. That allows state to bleed across different local roots that share branch names.

#### 2. Terminal activity tracking is too expensive and too global

Current path:

- `electron/services/TerminalService.ts`
- `packages/pty/src/lib.rs`

Problem:

- every terminal starts activity polling
- polling calls into `@cozea/pty.checkSubprocessActivity`
- the native implementation refreshes the entire process table for each check

That violates the architecture rule that ordinary terminals should not pay for dev-server-only introspection.

#### 3. Legacy “active project path” semantics still exist in some tile metadata

Current example:

- `laneBinding?: "activeProjectPath" | "threadWorktree"` in `useProjectWorkbenchStore`

That naming is a red flag because runtime ownership should be session-bound, not “whatever path is active right now”.

#### 4. Renderer matching still has some path-agnostic fallback behavior

Current example:

- `useWorkbenchSessionLifecycle`

Once a session key is known, path ambiguity disappears. Before that, the matching logic still relies primarily on `projectId + laneId`.

#### 5. Dev-server state is project-root scoped, not yet a first-class lane resource

Current implementation is keyed by `projectPath`, which is acceptable as long as each lane has a distinct root.

That is enough for now, but the contract should be explicit:

- if two lanes share the same canonical root, they share the same dev-server runtime
- if a lane uses a worktree root, it gets its own dev-server runtime

## Target Ownership Model

### Ownership Hierarchy

1. Runtime daemon
2. Project session
3. Lane resources
4. Attached surfaces

### Stable Identifiers

#### Session Key

Current direction is correct:

- `projectId::laneId::workspaceRootSegment`

This must remain the canonical runtime identity for live resources.

#### Workspace Id

Renderer-side runtime ids must stay path-aware:

- `projectId::laneId::normalizedProjectPath`

If `projectPath` is absent:

- use `unbound`
- do not borrow another path-aware runtime

#### Tile Id

Tiles remain local UI identities, but session bindings map from `tileId` to live runtime resource ids.

That is correct.

## Lifecycle Model

### Session Lifecycle

Current lifecycle vocabulary is acceptable:

- `active`
- `backgroundWarm`
- `backgroundFrozen`
- `closed`

### Surface Lifecycle

Surfaces should follow:

- attach
- hide
- freeze
- reattach

They should not normally perform:

- kill
- recreate
- rebind to another root

### Resource Policy

#### PTYs

- never die on route change
- never die on panel hide
- die only on explicit kill, session close, or app shutdown

#### Dev Servers

- retain while the owning session exists
- may background without losing process
- stop only on explicit user action, root invalidation, or session close

#### Browser Surfaces

- may be warm and visible
- may be hidden and retained
- may be frozen under memory pressure
- ephemeral browser sessions may be trimmed when frozen long enough

#### Collaboration Runtime

- route visibility must not decide PTY or dev-server lifetime
- Yjs interest and sync activity may be reduced when frozen
- local runtime ownership must remain intact even if collaboration transport is paused

## IPC Contract Direction

### Renderer To Runtime

Renderer calls should be phrased as session or lane attachment commands, not global mutations.

Good examples:

- `ensureSession`
- `activateSession`
- `backgroundSession`
- `bindTerminal`
- `bindBrowser`

Bad examples:

- `set current project path`
- `move active runtime to this route`

### Runtime To Renderer

The runtime should publish snapshots and events:

- session state changed
- terminal output
- terminal exit
- browser state changed
- native preview state changed

The renderer should derive UI from those events, not reconstruct runtime ownership locally.

## Browser And Preview Policy

### Browser Storage Scopes

Current scopes are reasonable:

- `global`
- `workspace`
- `ephemeral`

The important rule is:

- workspace browser persistence must key off `workspaceId`, not route identity

That already exists in:

- `electron/services/WorkbenchBrowserService.ts`

### Preview Ownership

Web preview and native preview belong to the owning session.

The visible tile is just one client of that preview state.

That means:

- session backgrounding can keep preview warm
- tile unmount must not destroy the preview
- low-memory policy can freeze or trim the browser view without reassigning the session

## Terminal Policy

### Terminal Retention

Terminals are durable lane resources.

Current direction:

- session binds `tileId -> terminalId`
- terminal tile reattaches when reopened

That is correct and should become universal policy.

### Terminal Activity Tracking

Only these workflows need subprocess activity tracking:

- bootstrap-settle detection
- “is the launched process tree still busy?” checks
- selected task/runner workflows

Normal shell tiles do not need it.

Therefore:

- add explicit terminal activity policy to `TerminalCreateOptions`
- default ordinary terminal tiles to `activityTracking: "off"`
- enable tracking only for dev-server-owned terminals
- keep the native implementation or its fallback behind that explicit opt-in

This is both a performance fix and an architecture fix.

## Lane State Policy

Lane state must be scoped by:

- `projectId`
- logical lane branch/worktree identity
- canonical local root

If the local root changes, a new cache scope must be used.

Anything less is incorrect for:

- imported projects
- relocated projects
- worktree-backed lanes
- multiple projects on the same branch name

## Migration Plan

### Phase 1: Identity Hygiene

- make lane-state caches path-aware
- make all renderer runtime ids path-aware
- remove remaining path-agnostic fallback keys where unsafe

### Phase 2: Explicit Terminal Activity Policy

- extend `TerminalCreateOptions` with activity tracking policy
- stop background subprocess polling for ordinary terminals
- leave dev-server terminals opted in

### Phase 3: Remove “Active Project Path” Semantics

- rename or remove tile metadata that implies a global active-path owner
- replace with session/lane-root terminology

### Phase 4: Strengthen Session Matching

- prefer exact `sessionKey`
- when falling back, include `projectPath` whenever available

### Phase 5: Extend Session Ownership To Remaining Runtime Domains

- diagnostics workers
- agent execution surfaces
- any browser/native preview orphan paths

## Implementation Status After This Pass

This document is being added while the repo already contains:

- `WorkbenchSessionManager`
- path-aware workspace ids
- workbench session lifecycle integration

The implementation now landed in this pass is:

- lane-state caching is path-aware in `useProjectLaneState`
- remembered branch-session state is scoped by `projectId + projectPath`
- workbench session snapshot matching prefers path-aware reconciliation when a session key is not yet known
- terminal activity tracking is opt-in through `TerminalCreateOptions.activityTracking`
- ordinary workbench terminals default to activity tracking off
- dev-server flows enable subprocess tracking only while they need managed runner semantics
- the terminal subprocess checker used by `TerminalService` now uses a lightweight `pgrep`/`ps` path on POSIX instead of the expensive native full-process refresh path
- persisted assistant tile metadata no longer defaults to the old `activeProjectPath` terminology; it now uses `sessionProjectPath`
- PTY ownership has moved out of Electron main into a dedicated `workbench-runtime` child process
- Electron main `TerminalService` is now a cache-and-proxy boundary that preserves the renderer IPC contract while forwarding PTY lifecycle to the child runtime
- dev servers and agent-owned shell work now inherit the same off-main-process ownership because they run inside child-owned PTYs
- the Electron build now emits a dedicated `out/main/workbench-runtime.js` entry for that runtime

The remaining implementation work to fully align the runtime with this document is:

- remove or simplify any leftover assistant/worktree binding semantics that still imply route-driven ownership rather than session-driven ownership
- decide whether the unused native PTY subprocess checker should be rewritten or removed
- make dev-server runtime ownership explicitly lane-scoped in naming and contracts, even where the current implementation is still keyed by `projectPath`
- decide whether `DevServerService` orchestration itself should also move into the child runtime, rather than only the underlying PTY/process ownership

## Non-Goals

This pass does not attempt to:

- replace Electron with a separate daemon binary
- redesign the full workbench UI
- solve the current Cloudflare/Yjs issue
- implement multi-user collaboration semantics beyond runtime isolation

It is focused on establishing correct local runtime ownership first.

## Practical Test Checklist

After the corresponding implementation:

1. Open project A and project B.
2. Start a terminal in each.
3. Switch between them repeatedly.
4. Confirm neither PTY is recreated or rebound.
5. Start a dev server in project A.
6. Switch to project B.
7. Confirm project A’s dev server remains running.
8. Confirm ordinary idle terminals do not generate subprocess-activity polling load.
9. Open a worktree-backed lane and confirm its lane state does not borrow from the base root.
10. Hide and reopen browser and dev-server surfaces and confirm the session reattaches rather than recreates where policy says it should.
