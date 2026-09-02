# Workbench feature

Owns renderer-side workbench composition, Dockview orchestration, lane/session state, tiles, command palette, navigation intents, selection/launch rules, and persisted workbench state.

## Layout

- root components: workbench shell and tile adapters.
- `assistant/`: workbench-specific integration with the assistant feature.
- `branch-control/`: branch controls embedded in the workbench shell.
- `command-palette/`: workbench command discovery and execution.
- `hooks/`: Dockview runtime, lane state, URL synchronization, and session lifecycle.
- `model/`: tile registry, Dockview policy, persistence, intents, selection rules, and Zustand state.

The assistant, browser, terminal, DevApp, and source-control features own their domain behavior. Files here adapt those capabilities to workbench tiles and sessions.
