# Terminal feature

Owns renderer-side terminal views, keep-alive behavior, workbench-session terminal binding, terminal groups, output buffers, and panel state.

- `model/terminalStore.ts`: canonical renderer terminal state.
- root files: terminal views and session binding.

The workbench embeds terminal views through adapters. The historical `src/stores/useTerminalStore.ts` module is a compatibility facade; new code should import from `@/features/terminal/...`.
