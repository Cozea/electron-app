# Assistant feature

This directory owns the renderer-side assistant experience: chat composition, timeline rendering, provider presentation, approvals, artifacts, and assistant-specific UI primitives.

## Ownership

- `chat/`: chat surface, composer, timeline, and message presentation.
- `artifacts/`: thread artifact presentation and media loading.
- `lib/`: assistant-only domain helpers.
- `ui/`: assistant-owned primitives that have not yet been promoted to shared UI.

Workbench-specific adapters do not belong here. They remain in the workbench feature and consume this feature through imports from `@/features/assistant/...`.

## Migration compatibility

The former path `@/features/projects/components/assistant/...` is temporarily mapped to this directory while remaining call sites are migrated. New code must use `@/features/assistant/...`.
