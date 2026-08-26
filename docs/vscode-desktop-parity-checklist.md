# VS Code Desktop Parity Checklist (Cozea)

This checklist is based on direct inspection of a local VS Code clone (`microsoft/vscode`) and maps those patterns to Cozea.

## Goal

Make Cozea feel "desktop-native" like VS Code in steady-state usage:

- static/stable workbench shell
- heavy work off renderer
- local-first reads with async sync
- persistent layout/state restore
- native desktop menus/commands

## Phase 1: Stable Workbench Shell

- [ ] Keep core workbench panes mounted and avoid route-level remounts for editor/sidebar/assistant.
- [ ] Restore last project directly into workbench on launch.
- [ ] Defer non-critical panels/features until idle.

Files:
- `src/App.tsx`
- `src/features/projects/layouts/ProjectLayout.tsx`
- `src/components/layouts/UnifiedHeader.tsx`

Acceptance checks:
- switching between core views does not rebuild editor shell
- app reopens into last project/workbench state
- no visible "loading shell" flash when already initialized

## Phase 2: Local-First Data for Core Flows

- [ ] Read project/workbench metadata from local DB first.
- [ ] Run Convex sync in background and reconcile updates asynchronously.
- [ ] Never block editor/workbench rendering on network paths.

Files:
- `electron/services/DatabaseService.ts`
- `electron/main.ts`
- `src/pages/Projects.tsx`

Acceptance checks:
- project list and open-project flow work offline for cached data
- remote sync failures do not block UI
- sync status is visible but non-blocking

## Phase 3: Thin Renderer, Heavy Main Process

- [ ] Move scans/watchers/git/indexing/pty-heavy work to main process services.
- [ ] Renderer consumes push-based state/events, not direct heavy orchestration.
- [ ] Standardize IPC channels for long-running work (start/progress/complete/error).

Files:
- `electron/ipc/registerProjectHandlers.ts`
- `electron/services/TerminalService.ts`
- `electron/projectWatcher.ts`

Acceptance checks:
- renderer CPU stays low during scans/watch/indexing
- long operations remain responsive while typing/editor interactions continue
- cancellation works for long-running operations

## Phase 4: Persistent Workspace State Everywhere

- [ ] Persist tabs, sidebars, panel visibility, split sizes, per-project layout.
- [ ] Rehydrate state before first full render of workbench.
- [ ] Save state incrementally (debounced), not only on shutdown.

Files:
- `src/stores/useFileTabsStore.ts`
- `src/stores/useAssistantPanelStore.ts`
- `src/features/projects/components/ProjectSidebar.tsx`

Acceptance checks:
- relaunch restores previous layout and open tabs exactly
- per-project layout differs correctly between projects
- no layout "jump" after first paint

## Phase 5: Native Desktop Interaction Parity

- [ ] Expand app menu + context menus + command palette parity.
- [x] Ship workbench command palette + keybindings discovery (`cozea.palette.enabled` / `VITE_FF_COZEA_PALETTE_ENABLED`, default ON). Track A in `docs/t3code-implementation-plan.md`.
- [ ] Add Recent Projects, Reopen Closed Window, Reveal/Open externally.
- [ ] Centralize command IDs and bind them to menu + keyboard + command palette.

Files:
- `electron/menu.ts`
- `electron/ipc/registerContextMenuHandlers.ts`
- `src/features/projects/components/command-palette/`
- `src/components/CommandSearch.tsx` (legacy checklist path; palette lives under command-palette/)

Acceptance checks:
- commands available from keyboard, menu, and command palette consistently
- macOS behaviors (reopen/activate/open-file) feel native
- file reveal/open flows use OS-native integrations

## Phase 6: Runtime Health Parity (Rust/Python/TS)

- [ ] Keep runtime/toolchain detection in main process and expose capabilities to UI.
- [ ] Surface runtime health and capability status in tooling/settings/status bar.

Files:
- `electron/runtime/runtimeTypes.ts`
- `electron/runtime/runtimeResolver.ts`
- `electron/runtime/commandResolver.ts`
- `electron/runtime/capabilityCatalog.ts`
- `electron/ipc/registerRuntimeHandlers.ts`
- `src/pages/settings/Tooling.tsx`
- `src/components/StatusBar.tsx`

Acceptance checks:
- runtime detection is deterministic and cached
- runtime health updates without blocking editor surfaces
- tooling status is visible and actionable from UI

## Phase 7: Continuous Performance Discipline

- [ ] Virtualize all large trees/lists.
- [ ] Cap expensive updates with debounce/throttle where appropriate.
- [ ] Track interaction latency budgets for file tree, tab switching, command palette.

Files:
- `src/features/projects/components/FileTree.tsx`
- `src/features/projects/pages/ProjectPagesPage.tsx`
- `src/components/editor/CollaborativeCodeEditor.tsx`

Acceptance checks:
- no dropped frames in normal editor/file-tree operations on mid-range hardware
- command palette opens/responds instantly under typical load
- repeated workspace events do not trigger redundant rerenders

## Suggested Execution Order

1. Phase 1 + Phase 4 (shell and persistence)
2. Phase 3 (main-process offloading)
3. Phase 2 (local-first sync behavior)
4. Phase 5 (desktop command/menu parity)
5. Phase 6 + Phase 7 (runtime/perf hardening)
