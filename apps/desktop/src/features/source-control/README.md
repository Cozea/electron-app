# Source control feature

Owns changes, diffs, checkpoint presentation, branch-scoped Git state, and the changes sidebar model.

## Layout

- `pages/ChangesPage.tsx`: route-capable changes surface.
- `components/changes/`: changes tree, diff worker, headers, and sidebar integration.
- `model/`: renderer state for Git snapshots and changes-sidebar preferences.
- `syncFeedSeen.ts`: source-control activity read marker.

The historical project page and global store modules are compatibility facades. New code should import from `@/features/source-control/...`.
