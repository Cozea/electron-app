import type { WorkspaceCatalogSnapshotEntry } from "@shared/workspaceTypes"

/** Project labels/visibility and verification timestamps do not change a binding. */
export function workspaceSnapshotBindingChanged(
  previous: WorkspaceCatalogSnapshotEntry | undefined,
  next: WorkspaceCatalogSnapshotEntry | undefined,
): boolean {
  if (!previous || !next) return previous !== next
  const normalize = (entry: WorkspaceCatalogSnapshotEntry) => {
    const { verifiedAt: _verifiedAt, updatedAt: _updatedAt, lastOpenedAt: _lastOpenedAt, ...workspace } = entry.workspace
    const lane = entry.lane
      ? (() => {
          const { updatedAt: _updatedAt, lastOpenedAt: _lastOpenedAt, ...value } = entry.lane
          return value
        })()
      : null
    return { ...entry, workspace, lane }
  }
  return JSON.stringify(normalize(previous)) !== JSON.stringify(normalize(next))
}
