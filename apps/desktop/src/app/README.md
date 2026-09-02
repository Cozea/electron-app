# Renderer application layer

Owns application-wide composition and infrastructure that is not a product capability.

- `model/autoUpdateStore.ts`: desktop updater state.
- `model/queryCache.ts`: cross-feature cached-query infrastructure.

Feature behavior must not be added here. Application code may compose features, providers, routing, and platform clients.
