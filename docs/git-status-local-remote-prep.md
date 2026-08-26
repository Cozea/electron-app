# Git status local/remote split (Wave 0 Track F prep)

**Status:** Temporary prep for Phase 4c  
**Date:** 2026-08-26  
**Companion:** `docs/t3code-implementation-plan.md` Track F / Phase 4c; upgrade-path §3.8

## Decision

Split the **agent** git status path (`electron/assistant-runtime/git/**`) into:

1. **Local** — working-tree porcelain / numstat; always fast; no network.
2. **Remote** — upstream `fetch` + ahead/behind; slower interval (30s) or **demand-gated** (`force` / invalidation).

Expose a single **`invalidateGitStatus(cwd)`** helper so journal / `GitSyncService` can refresh subscribers in Phase 4c without inventing another bus.

## Non-goals

- Do **not** stand up a permanent second status broadcaster beside `GitChangesBroadcaster`.
- Do **not** add another checkpoint capture stack.
- Do **not** expand `GitChangesBroadcaster` into a forever dual owner of agent status.
- Full `VcsDriver` cutover, deleting `GitCore`, and collab overlay rewrite remain out of scope.

## Collapse plan (Phase 4c)

This prep **collapses into** T3 `VcsStatusBroadcaster.streamStatus` (local/remote stream events + remote poll backoff). When 4c lands:

- Replace unary poll + cadence gate with `subscribeVcsStatus` / fan-in adapter.
- Route journal / sync mutations through substrate `invalidateStatus`.
- Delete or shrink this cadence helper — do not grow it into a long-lived fork.

## Code map

| Piece | Path |
| --- | --- |
| Cadence / invalidation logic | `electron/assistant-runtime/git/status/GitStatusCadence.ts` |
| Cross-service invalidation API | `electron/assistant-runtime/git/status/gitStatusInvalidation.ts` |
| Local-first status + gated remote refresh | `electron/assistant-runtime/git/Layers/GitCore.ts` |
| Agent WS status uses local-first + background remote | `electron/assistant-runtime/git/Layers/GitManager.ts` |
