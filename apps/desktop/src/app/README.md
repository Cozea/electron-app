# Renderer application layer

Owns application-wide composition and infrastructure that is not a product capability.

- `hooks/useAutoUpdater.ts`: desktop updater event orchestration.
- `model/autoUpdateStore.ts`: desktop updater state.
- `model/queryCache.ts`: cross-feature cached-query infrastructure.
- `shell/`: persistent application shell primitives.

Feature behavior must not be added here. Application code may compose features, providers, routing, and platform clients.
