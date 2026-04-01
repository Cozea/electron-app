# Final Server And Renderer Cleanup

## Scope

This sweep closes the last explicitly documented cleanup items that remained after the local-first and assistant-runtime migration:

1. Remove renderer-side legacy `t3code:*` local-storage migration shims.
2. Split the Fastify control plane into explicit service entrypoints/modules instead of one monolithic bootstrap file.

## Targets

- [x] Remove renderer legacy storage migration helpers and legacy event aliases.
- [x] Keep renderer persistence on Cozea-only keys and events.
- [x] Extract shared server bootstrap/composition helpers.
- [x] Add explicit server service registration modules.
- [x] Add explicit server entrypoints for auth/control, collab/runtime, and git.
- [x] Preserve the current all-in-one composed server entrypoint for compatibility.
- [x] Verify typecheck/build and record final status.

## Execution Log

### Step 0: Initial audit

- Confirmed the only remaining live `t3code:*` references are renderer migration shims in local-storage/state code.
- Confirmed the server still concentrates bootstrap, plugin registration, feature flags, routes, root routes, health, and process startup in [server/src/index.ts](/Users/admin/Downloads/electron-app-main/server/src/index.ts).
- Confirmed [server/src/routes/settings.ts](/Users/admin/Downloads/electron-app-main/server/src/routes/settings.ts) still depends on sibling routes via internal `fastify.inject(...)` calls, so service boundaries need to preserve those relationships.

### Step 1: Renderer cleanup

- Removed the remaining renderer-side `t3code:*` local-storage migration shims from assistant renderer state, terminal state, composer drafts, preferred editor persistence, and same-tab storage-change events.
- Removed the now-unused `createLegacyAwareStorage(...)` helper from both storage helper modules because no live state path depends on legacy key migration anymore.
- Verified the only remaining `LEGACY_*` hits in `src/` are unrelated runtime parsing helpers, not persistence migration debt.

### Step 2: Server split

- Extracted shared Fastify bootstrap into dedicated server modules for core plugin registration, feature/entrypoint definitions, service registration, app composition, and process startup.
- Added explicit service modules for auth-control, collab/runtime, and git, plus dedicated entrypoints:
  - `server/src/entrypoints/auth-control-plane.ts`
  - `server/src/entrypoints/collab-runtime.ts`
  - `server/src/entrypoints/git-service.ts`
- Kept `server/src/index.ts` as the compatibility all-in-one entrypoint by redirecting it to the new composed `all` entrypoint instead of leaving the old monolithic bootstrap in place.
- Added dedicated package scripts for each entrypoint so the control plane can now be run intentionally by role instead of only as one umbrella process.

### Step 3: Verification

- `bun run typecheck` passed at the repo root.
- `cd server && bun run build` passed.
- `cd server && bun run start:all` booted successfully on port `3001`.
- `cd server && bun run start:auth-control` booted successfully on port `3001`.
- `cd server && bun run start:collab-runtime` booted successfully on port `3002`.
- `cd server && bun run start:git-service` booted successfully on port `3003`.
- During the server smoke tests, Redis DNS resolution failed in this environment, so each entrypoint correctly degraded to “configured but not connected” instead of blocking startup.
