# Terminal feature

Owns renderer-side terminal rendering, output/exit event binding, keep-alive behavior, workbench-session terminal binding, terminal groups, output buffers, and panel state.

- `model/terminalStore.ts`: canonical renderer terminal state.
- root files: terminal renderer, event bridge, keep-alive, and session binding.

The workbench embeds terminal views through adapters. The former project-component and global-store compatibility facades have been removed; import from `@/features/terminal/...`.
