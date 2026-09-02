# Dev server feature

Owns renderer-side dev-server run state, lifecycle coordination, command selection, and preview-surface control.

Workbench tiles integrate this feature; they do not own the process lifecycle. New imports should use `@/features/dev-server/...`.
