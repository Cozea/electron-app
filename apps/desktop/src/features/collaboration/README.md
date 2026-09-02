# Collaboration feature

Owns renderer-side collaboration state and presentation that is independent of project CRUD and workspace mechanics.

- `model/collaborationActivityStore.ts`: AI typing and agent activity indicators.
- `model/connectionStatusModel.ts`: distinct assistant transport, data-sync, and Git-remote status presentation.

Encryption transport and Yjs internals remain in their existing bounded modules until their own migration phase.
