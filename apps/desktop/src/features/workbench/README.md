# Workbench feature

This directory owns renderer-side workbench composition, tiles, Dockview integration, lane/session presentation, and persisted workbench state.

## Layout

- root components: workbench shell and tile adapters.
- `assistant/`: workbench-specific integration with the assistant feature.
- `branch-control/`: branch controls embedded in the workbench shell.
- `model/`: persisted workbench state, selectors, migrations, and tile metadata.

The assistant, browser, terminal, DevApp, and source-control features own their domain behavior. Files here adapt those capabilities to workbench tiles and sessions.

## Compatibility

The former component path `@/features/projects/components/workbench/...` and store path `@/stores/useProjectWorkbenchStore` remain temporary compatibility surfaces. New code should import from `@/features/workbench/...`.
