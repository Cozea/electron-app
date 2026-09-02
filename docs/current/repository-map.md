# Repository map

Status: current

## Renderer

```text
apps/desktop/src/
  app/                  application composition, updater state, shared query cache
  features/
    assistant/          chat, timeline, artifacts, transport, orchestration and state
    browser/            embedded browser, annotations, recording, viewport and page context
    collaboration/      collaboration-specific renderer state and presentation
    dev-server/         dev-server runs, commands, and preview coordination
    devapps/            DevApp authoring, catalog, publication, installation, preview
    native-preview/     simulator preview presentation, selection and session state
    projects/           identity, lifecycle, access, navigation, dialog and header state
    settings/           settings navigation and settings-domain preferences
    source-control/     changes, diffs, checkpoints, branch state and sidebar model
    terminal/           views, session binding, groups, output buffers and panel state
    workbench/          tiles, layout, command palette, and persisted workbench model
    workspace/          workspace identity, resolution, repair, and runtime hosting
  platform/desktop/     typed Electron bridge clients migration target
  shared/               renderer-only shared UI and utilities migration target
  stores/               compatibility re-export facades only
```

Existing route URLs, persistence keys, IPC names, backend API names, and runtime behavior remain stable while ownership moves.

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

Existing code is moved from those locations in bounded stages. `src/stores` is now intentionally facade-only.
