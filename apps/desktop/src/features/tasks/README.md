# Tasks feature

Owns task listing, filtering, focus-overlay presentation, and task-to-workbench navigation payloads.

- `pages/TasksPage.tsx`: main task surface.
- `ui/TaskFocusOverlay.tsx`: task focus presentation for overlay and embedded contexts.
- `model/taskFocusOverlay.ts`: route/location payload parsing and task-focus state rules.

Workbench hosts task tiles and routes task intents, but task behavior belongs here.
