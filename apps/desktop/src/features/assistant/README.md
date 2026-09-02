# Assistant feature

This directory owns the renderer-side assistant experience: chat composition, timeline rendering, provider presentation, approvals, artifacts, transport, orchestration projection, and assistant-specific state.

## Ownership

- `chat/`: chat surface, composer, timeline, and message presentation.
- `artifacts/`: thread artifact presentation and media loading.
- `lib/`: assistant-only domain helpers.
- `model/`: transport, normalized state, thread details, provider model rules, and orchestration projection.
- `ui/`: assistant-owned primitives that have not yet been promoted to shared UI.

Workbench-specific adapters do not belong here. They remain in the workbench feature and consume this feature through imports from `@/features/assistant/...`.

## Migration compatibility

Historical paths under `features/projects/components/assistant` and `src/stores` are temporarily mapped or re-exported while call sites migrate. New code must use `@/features/assistant/...`.
