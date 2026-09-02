# Repository map

Status: current

## Renderer

```text
apps/desktop/src/
  app/                  application composition target
  features/
    assistant/          assistant chat, timeline, artifacts, provider UI
    browser/            embedded browser, annotations, recording, viewport state
    dev-server/         dev-server runs, commands, and preview coordination
    devapps/            DevApp authoring, catalog, publication, installation, preview
    native-preview/     native simulator preview presentation
    projects/           project identity, lifecycle, access, navigation
    terminal/           terminal views and workbench-session terminal binding
    workbench/          tiles, layout, command palette, and persisted workbench model
    workspace/          workspace identity, resolution, repair, and runtime hosting
    source-control/     changes, diffs, checkpoints, branch UI migration target
  platform/desktop/     typed Electron bridge clients migration target
  shared/               renderer-only shared UI and utilities migration target
```

The migration is intentionally incremental. Existing route URLs, persistence keys, IPC names, backend API names, and runtime behavior remain stable while ownership moves.

## Naming rules

- Use product nouns for feature roots: `assistant`, `workbench`, `source-control`.
- Use `model` for state, selectors, migrations, and pure rules.
- Use `services` for workflows and side-effect coordination.
- Use `ui` for React presentation.
- Use `integrations/<feature>` for adapters that embed another feature.
- Use `compat` only for code with a documented deletion condition.

## Deprecated placement

Do not add feature-specific code to these historical dumping grounds:

- `apps/desktop/src/stores`
- `apps/desktop/src/hooks`
- `apps/desktop/src/lib`
- `apps/desktop/src/features/projects/lib`
- `apps/desktop/src/features/projects/components`

Existing code is moved from those locations in bounded stages.
