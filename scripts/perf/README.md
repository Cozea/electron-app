# Interaction-performance harness

Regression gate for the 2026-06 render-performance work. It attaches to a
running dev instance over CDP, installs a React-commit tracer, drives real
interactions, and asserts budgets.

## Run

```bash
bun run dev:chrome-devtools   # exposes the debug port on 127.0.0.1:9222
bun run perf:interactions     # in another shell
```

Exit code 1 on any budget violation.

## Budgets (and where they come from)

| Scenario | Budget | Rationale |
| --- | --- | --- |
| tileSwitch | ≤2 commits, no navigation | Tile focus is a store write, not a route change (`ProjectSidebar.openLaneWorkbench` bypass). Was ~30 commits + 2-3 router transitions. |
| sameTileReclick | ≤1 commit | Store actions no-op on unchanged input. Was a full broadcast. |
| warmProjectSwitch | ≤300ms blocked | Terminal keep-alive parks xterm instances across project switches and assistant-store resync is content-fingerprinted. The executable harness is authoritative; ratchet this budget down as remaining dev-mode route/GC work is removed. |
| returnNavigation | ≤34 commits | Route transition + post-nav settle storms. Ratchet DOWN as the sidebar post-navigation storm (~12 commits at t≈1s) and the intent-system migration land — never up without a named cause. |
| ipcPerNavigation | ≤4 session broadcasts | `WorkbenchSessionManager.emitState` coalesces per tick and dedupes content (timestamps excluded). Was 16 per navigation. |

## When a budget fails

Don't raise the budget first — find the new emitter. Techniques that found
every regression so far:

1. **Commit tracing** (what re-rendered, per commit): this harness's hook —
   add `entries` logging in `lib.mjs`, look at the *top* (root) components of
   each commit. Roots are subscribers; everything else is cascade.
2. **Emission counting** (who broadcast): subscribe to
   `window.__workbenchStore`, `window.__workspaceRuntimeStore`,
   `window.electronAPI.workbenchSession.onStateChanged`, and
   `window.__appRouter` during the interaction and count.
3. **CPU profile** (what burned the time): `Profiler.start/stop` over the
   interaction; group samples by function name.

Known architecture rules these budgets encode:

- Dockview re-pushes **every** tab/panel portal root whenever
  `WorkbenchDockviewCanvas` renders — keep it memoized with primitive props.
- Store snapshots crossing IPC lose identity; compare content, never rely on
  reference equality across the boundary.
- The dock runtime context must only change identity when the session itself
  changes (sessionKey), not on lifecycle/timestamp churn.
- Anything polled (`useProjectLaneState` runs every 5s in **every** sidebar
  tree item plus the layout) must preserve object identity for unchanged
  content and must not flip `isLoading` on background refreshes — a careless
  `setState({...})` there is a layout-wide re-render metronome.
- `useProjectWorkspaceResolution` is stale-while-revalidate: revisits render
  the cached resolution synchronously (no spinner) and revalidation preserves
  identity on equal content. Mutating bindings must call
  `invalidateProjectWorkspaceResolution(projectId)` (or the hook's `refresh`,
  which invalidates its own key).
- ProjectLayout must not subscribe to `location.href`, navigation state it
  doesn't render, presence, or page-context objects — those live in
  null-rendering/leaf siblings (`PendingTeamSetupEffect`,
  `ProjectPresenceHeaderAddon`).

## Fixture requirements

- `tileSwitch` needs the first project (sidebar order) to have **two or more
  tiles** in its lane; it SKIPs otherwise. Keep a chat tile + terminal tile in
  the first project of your dev profile.
- `warmProjectSwitch` needs **two projects**.
