# Collaboration feature

Owns renderer-side collaboration sessions, collaboration state, and presentation independent of project CRUD and workspace mechanics.

- `hooks/useCollabSession.ts`: authenticated collaboration gateway session lifecycle.
- `model/collaborationActivityStore.ts`: AI typing and agent activity indicators.
- `model/connectionStatusModel.ts`: assistant transport, data-sync, and Git-remote status presentation.

Encryption transport and Yjs internals remain in their existing bounded modules until their own migration phase.
