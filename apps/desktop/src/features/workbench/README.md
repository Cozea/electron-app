# Workbench feature

This directory owns renderer-side workbench composition, tiles, Dockview integration, lane/session presentation, navigation intents, selection/launch rules, and persisted workbench state.

## Layout

- root components: workbench shell and tile adapters.
- `assistant/`: workbench-specific integration with the assistant feature.
- `branch-control/`: branch controls embedded in the workbench shell.
- `command-palette/`: workbench command discovery and execution.
- `model/`: tile registry, Dockview policy, persistence, intents, selection rules, and Zustand state.

The assistant, browser, terminal, DevApp, and source-control features own their domain behavior. Files here adapt those capabilities to workbench tiles and sessions.

Historical project-nested paths remain compatibility surfaces only. New imports should use `@/features/workbench/...`.
