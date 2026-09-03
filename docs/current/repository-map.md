# Repository map

Status: current

## Renderer

```text
apps/desktop/src/
  app/                  application composition, updater state, shared query cache
  features/
    assistant/          chat, timeline, artifacts, transport, orchestration and state
    browser/            embedded browser, annotations, recording, viewport and page context
    collaboration/      collaboration sessions, state and presentation
    dev-server/         dev-server runs, commands, and preview coordination
    devapps/            DevApp authoring, catalog, publication, installation, preview
    native-preview/     simulator preview presentation, selection and session state
    projects/           identity, lifecycle, access, navigation, dialog and header state
    project-memory/     agent-generated code graph state, layout and controls
    settings/           personal/project settings and settings-domain preferences
    source-control/     changes, diffs, checkpoints, branch state and sidebar model
    tasks/              task surfaces, filters and focus-overlay behavior
    terminal/           views, session binding, groups, output buffers and panel state
    workbench/          tiles, layout, command palette, and persisted workbench model
    workspace/          workspace identity, resolution, repair, and runtime hosting
  platform/desktop/     typed Electron bridge clients migration target
  shared/               renderer-only shared UI and utilities migration target
  stores/               compatibility re-export facades only
```

Existing route URLs, persistence keys, IPC names, backend API names, and runtime behavior remain stable while ownership moves.
