# Dev server feature

Owns renderer-side dev-server run state, lifecycle transitions, command selection, preview failure presentation, and preview-surface coordination.

- `model/`: lifecycle and preview-domain rules.
- root modules: run store, controllers, and view coordination.

Workbench tiles integrate this feature; they do not own the process lifecycle. New imports should use `@/features/dev-server/...`.
