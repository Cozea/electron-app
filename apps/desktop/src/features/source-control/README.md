# Source control feature

Owns changes, diffs, checkpoint presentation, branch-scoped Git state, remote-status caching, and the changes sidebar model.

## Layout

- `pages/ChangesPage.tsx`: route-capable changes surface.
- `components/changes/`: changes tree, diff worker, headers, and sidebar integration.
- `model/`: Git snapshots, branch sessions, diff trees, remote state, query caches, sizing rules, and sidebar preferences.
- `syncFeedSeen.ts`: source-control activity read marker.

The former project and global-store compatibility facades have been removed. Import from `@/features/source-control/...`.
