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

Product code belongs in `apps/desktop/src/features/<capability>`. A feature may contain `api`, `model`, `services`, `ui`, `routes`, and `integrations` as needed. Generic folders such as `src/lib`, `src/hooks`, and `src/stores` are reserved for genuinely application-wide code; feature-specific additions belong with their feature.

## Current capability roots

- `features/assistant`
- `features/devapps`
- `features/projects`
- `features/workbench` (migration target)
- `features/source-control` (migration target)
- `features/collaboration` (migration target)
- `features/terminal` (migration target)

## Boundary rules

1. A feature must not import from application bootstrap code.
2. Cross-feature imports should target the owning feature, not a historical nesting path.
3. Renderer components should access Electron through typed platform clients rather than introducing new direct global bridge calls.
4. Compatibility aliases and re-export shims must document their removal condition.
5. Persisted keys, route paths, IPC channel names, and Convex public module names do not change during structure-only moves.
6. Large moves and behavioral refactors are committed separately so regressions remain attributable.

See `docs/current/repository-map.md` for the working migration map.
