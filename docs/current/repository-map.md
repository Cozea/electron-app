# Repository map

Status: current

## Renderer

```text
apps/desktop/src/
  app/                  application composition target
  features/
    assistant/          assistant chat, timeline, artifacts, provider UI
    devapps/            DevApp authoring, catalog, publication, installation
    projects/           project identity, lifecycle, access, navigation
    source-control/     changes, diffs, checkpoints, branch UI target
    workbench/          tiles, layout, session UI and persisted model target
  platform/desktop/     typed Electron bridge clients target
  shared/               renderer-only shared UI and utilities target
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
