# Project Memory feature

Owns renderer-side project-memory graph state, layout, relevance rules, update events, and controls. The Electron `ProjectMemoryService` reads agent-generated `graphify-out/graph.json`; agents receive the managed Project Memory skill and provider-specific instructions.

Workbench files host the visual tile, while graph interpretation and update state remain feature-owned here.
