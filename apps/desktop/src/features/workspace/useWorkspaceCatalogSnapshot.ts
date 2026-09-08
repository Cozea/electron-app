import { useSyncExternalStore } from 'react'
import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes'
import { workspaceCatalogResource } from '@/app/resources/workspaceCatalogResource'

export function useWorkspaceSnapshotEntry(projectId: string | null | undefined): WorkspaceCatalogSnapshotEntry | null {
  return useSyncExternalStore(
    workspaceCatalogResource.subscribe,
    () => projectId ? workspaceCatalogResource.read()?.entries[projectId] ?? null : null,
    () => null,
  )
}

export function useWorkspaceCatalogSnapshot(): WorkspaceCatalogSnapshot | null {
  return useSyncExternalStore(workspaceCatalogResource.subscribe, workspaceCatalogResource.read, () => null)
}
