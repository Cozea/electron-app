import { useCallback, useSyncExternalStore } from 'react';
import type { WorkspaceCatalogSnapshot, WorkspaceCatalogSnapshotEntry } from '@shared/workspaceTypes';
import { workspaceCatalogMirror } from '@/app/resources/workspaceCatalogMirror';

export function useWorkspaceSnapshotEntry(projectId: string | null | undefined): WorkspaceCatalogSnapshotEntry | null {
  const getSnapshot = useCallback(() => projectId ? workspaceCatalogMirror.getEntry(projectId) : null, [projectId]);
  return useSyncExternalStore(workspaceCatalogMirror.subscribe, getSnapshot, () => null);
}
export function useWorkspaceCatalogSnapshot(): WorkspaceCatalogSnapshot | null {
  return useSyncExternalStore(workspaceCatalogMirror.subscribe, workspaceCatalogMirror.getSnapshot, () => null);
}
