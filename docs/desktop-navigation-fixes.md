# Desktop navigation fixes

Implementation follows `desktop-navigation-audit.md`. Preserve local ownership, explicit installation, cloud authorization and existing user edits.

## Apply now

- [x] Share local snapshots across Skills, Builds, Store and DevApp Settings; coalesce concurrent reads and reject stale responses after a mutation/event.
- [x] Stop scanning Skills twice on entry and stop treating an unresolved Builds snapshot as empty.
- [x] Make display discovery yield between skill records so large inventories do not monopolize Electron's main loop; retain mutation serialization and synchronous internal compatibility.
- [x] Show Settings chrome immediately, load sections independently, and retain section view state across navigation without running hidden effects.
- [x] Share saved local settings and show unresolved controls honestly.
- [x] Coalesce Tooling prewarm/refresh and run independent health checks concurrently.
- [x] Warm common local routes once and on intent without restarting warmup on every navigation.
- [x] Remove screenshot transitions from ordinary navigation.
- [x] Keep Store filtering immediate while synchronizing restorable URL state separately.
- [x] Add local-navigation measurement hooks and meaningful cache/concurrency regression tests.
- [x] Run typecheck, lint, relevant tests, build and available live checks; document results and limits.

## Separate architecture / measurement work

- Workbench retention across routes needs a persistent surface owner plus inactive context/overlay control; do not merely leave hidden route effects running.
- Offline shell authentication and local-first project provisioning require a separate identity/reconciliation design. No cloud authorization or provisioning changes in this patch.
- Move remaining synchronous per-file skill I/O off the main thread if sliced-scan measurements warrant it; display scheduling alone does not make synchronous file reads asynchronous.
- Change cache persistence storage only after measuring serialization/write cost.

Status and verification are updated as work completes.
