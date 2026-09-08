/**
 * Narrow React Subscription Hooks for Workspace & Lane Resources
 * Conforms to Section 6 of docs/perf/navigation-runtime-plan.md
 */

import { useSyncExternalStore, useEffect, useCallback, useMemo } from 'react';
import type { ResolveProjectWorkspaceResult, RepoIdentity } from '@shared/workspaceTypes';
import type { ProjectLaneDescriptor, ProjectLaneState } from '@shared/electronApiTypes';
import {
  getWorkspaceResolutionResource,
  getProjectLaneResource,
} from './workspaceResources';
import type { ResourceSnapshot } from './keyedResource';

const EMPTY_LANE_SNAPSHOT: ResourceSnapshot<ProjectLaneState | null> = {
  status: 'empty',
  generation: 0,
};

export function useSharedWorkspaceResolution(
  projectId: string | null | undefined,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  preferredWorkspaceId?: string | null,
  options?: { allowCandidateScan?: boolean }
): { result: ResolveProjectWorkspaceResult | null; refresh: () => void } {
  const resource = useMemo(() => {
    if (!projectId) return null;
    return getWorkspaceResolutionResource(
      projectId,
      preferredWorkspaceId,
      projectSlug,
      expectedRepo,
      options?.allowCandidateScan ?? false
    );
  }, [projectId, preferredWorkspaceId, projectSlug, expectedRepo, options?.allowCandidateScan]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!resource) return () => {};
      return resource.subscribe(onStoreChange);
    },
    [resource]
  );

  const getSnapshot = useCallback(() => {
    if (!resource) return null;
    const snap = resource.read();
    if (snap.status === 'ready') return snap.data;
    return null;
  }, [resource]);

  const result = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (resource) {
      void resource.ensure('navigation').catch(() => {});
    }
  }, [resource]);

  const refresh = useCallback(() => {
    if (resource) {
      resource.invalidate('manual refresh');
      void resource.ensure('refresh').catch(() => {});
    }
  }, [resource]);

  return { result, refresh };
}

export function useSharedProjectLaneState(
  projectId: string | null,
  workspaceId: string | null,
  collabBranch: string | null,
  isDemanded = true
): {
  laneState: ProjectLaneState | null;
  activeLane: ProjectLaneDescriptor | null;
  collabLane: ProjectLaneDescriptor | null;
  isLoading: boolean;
  refreshLaneState: () => Promise<void>;
} {
  const resource = useMemo(() => {
    if (!projectId) return null;
    return getProjectLaneResource(projectId, workspaceId, collabBranch);
  }, [projectId, workspaceId, collabBranch]);

  // Acquire demand when demanded (F04, N07)
  useEffect(() => {
    if (!resource || !isDemanded) return;
    const release = resource.acquireDemand('foreground');
    return release;
  }, [resource, isDemanded]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!resource) return () => {};
      return resource.subscribe(onStoreChange);
    },
    [resource]
  );

  const getSnapshot = useCallback(() => {
    return resource?.read() ?? EMPTY_LANE_SNAPSHOT;
  }, [resource]);

  const resourceSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const laneState = resourceSnapshot.status === 'ready' ? resourceSnapshot.data : null;

  useEffect(() => {
    if (resource && isDemanded) {
      void resource.ensure('navigation').catch(() => {});
    }
  }, [resource, isDemanded]);

  const refreshLaneState = useCallback(async () => {
    if (resource) {
      await resource.ensure('refresh').catch(() => null);
    }
  }, [resource]);

  const activeLane = useMemo(
    () => laneState?.lanes.find((l) => l.id === laneState.activeLaneId) ?? null,
    [laneState]
  );

  const collabLane = useMemo(
    () => laneState?.lanes.find((l) => l.isCollab) ?? null,
    [laneState]
  );

  const isLoading =
    resourceSnapshot.status === 'loading' ||
    (resourceSnapshot.status === 'ready' && resourceSnapshot.refreshing);

  return {
    laneState,
    activeLane,
    collabLane,
    isLoading,
    refreshLaneState,
  };
}
