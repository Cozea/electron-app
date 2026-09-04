# Repository architecture

Cozea is organized by deployable application at the repository root and by product capability inside each application.

## Repository roots

- `apps/desktop`: Electron main process, preload, and renderer.
- `apps/server`: portable server runtime.
- `packages`: reusable workspace packages and contracts.
- `shared`: cross-process contracts that are not owned by one application process.
- `convex`: backend schema and functions.
- `cloudflare`: collaboration and hosted DevApp worker.
- `native`: app-owned native helpers.
- `vendor`: pinned upstream substrate.

## Renderer dependency direction

```text
app composition -> product features -> shared UI and utilities
                              \-----> platform clients
```

Product code belongs in `apps/desktop/src/features/<capability>`. A feature may contain `api`, `model`, `services`, `ui`, `routes`, and `integrations` as needed. Generic folders such as `src/lib`, `src/hooks` and `src/contexts` are reserved for genuinely application-wide code; feature-specific additions belong with their feature.

Features compose downward — the workbench builds tiles out of assistant, browser, devapps and terminal; projects composes the workbench — and the direction only holds if a hosted capability never has to import its host. What breaks it is ambient state: which project am I in, which workspace, which bench is on screen. That is nobody's feature, so it lives on neutral ground:

- `contexts/project`: route params, sync state, project access, the active bench scope.
- `contexts/workspace`: which local workspace a surface is bound to.
- `lib/workbenchStore`, `lib/workspaceRuntimeStore`: the state those scopes key into.
- `lib/workbenchTileContract`: tile shapes, so naming a tile costs no import.

Nothing here may import from `features/`. The exceptions that remain are pinned in `tests/architecture/neutralGround.test.ts` with what makes each survivable, and the list may only shrink.

## Current capability roots

`assistant`, `browser`, `collaboration`, `dev-server`, `devapps`,
`native-preview`, `project-memory`, `projects`, `settings`, `source-control`,
`tasks`, `terminal`, `workbench`, `workspace`.

## Boundary rules

1. A feature must not import from application bootstrap code.
2. Cross-feature imports should target the owning feature, not a historical nesting path.
3. Renderer components should access Electron through typed platform clients rather than introducing new direct global bridge calls.
4. Compatibility aliases and re-export shims are not a layer. The last of them are gone; a new one must document the commit that removes it.
5. Persisted keys, route paths, IPC channel names, and Convex public module names do not change during structure-only moves.
6. Large moves and behavioral refactors are committed separately so regressions remain attributable.

Rule 2 is enforced, not aspirational: `tests/architecture/featureDependencyGraph.test.ts` measures every cross-feature import and fails on any mutual dependency outside the pinned set. The list may only shrink — a new cycle fails as a regression, and a resolved one fails until it is deleted from the pins.

See `docs/current/repository-map.md` for the working migration map.
