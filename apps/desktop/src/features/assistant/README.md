# Assistant feature

Owns chat composition, timeline rendering, provider presentation, approvals, artifacts, transport state, orchestration projection, and assistant-specific state.

- `chat/`: chat surface, composer, timeline, and message presentation.
- `artifacts/`: thread artifact presentation and media loading.
- `hooks/`: assistant runtime/transport hooks.
- `lib/`: assistant-only domain helpers.
- `model/`: transport, normalized state, thread details, provider model rules, and orchestration projection.
- `services/`: assistant-owned workflows such as deletion and worktree cleanup.
- `ui/`: assistant-owned primitives.
