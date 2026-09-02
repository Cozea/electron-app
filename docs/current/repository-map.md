# Repository map

Status: current

## Renderer

```text
apps/desktop/src/
  app/                  application composition target
  features/
    assistant/          chat, timeline, artifacts, transport, orchestration and state
    browser/            embedded browser, annotations, recording, viewport state
    dev-server/         dev-server runs, commands, and preview coordination
    devapps/            DevApp authoring, catalog, publication, installation, preview
    native-preview/     simulator preview presentation, selection and session state
    projects/           project identity, lifecycle, access, navigation
    source-control/     changes, diffs, checkpoints, branch state and sidebar model
    terminal/           views, session binding, groups, output buffers and panel state
    workbench/          tiles, layout, command palette, and persisted workbench model
    workspace/          workspace identity, resolution, repair, and runtime hosting
  platform/desktop/     typed Electron bridge clients migration target
  shared/               renderer-only shared UI and utilities migration target
  stores/               compatibility facades plus genuinely app-global state only
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

Existing code is moved from those locations in bounded stages. Files left in `src/stores` after a move are explicitly marked compatibility facades.
