import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RepoIdentity } from '@shared/workspaceTypes';
import { type DemandKind, type KeyedResource } from './keyedResource';
import {
  getProjectLaneResource, getWorkspaceResolutionResource, invalidateProjectWorkspaceResolution,
  startReconciliationScheduler,
} from './workspaceResources';

const emptySubscribe = () => () => undefined;
function useResourceSnapshot<T>(resource: KeyedResource<T> | null) {
  const subscribe = useCallback((listener: () => void) => resource ? resource.subscribe(listener) : emptySubscribe(), [resource]);
  // Presentation subscribes to data and meaningful loading/error outcomes, not
  // each background refreshing=true/false publication of unchanged data.
  const data = useSyncExternalStore(subscribe, useCallback(() => {
    const state = resource?.read();
    return state?.status === 'ready' ? state.data : undefined;
  }, [resource]), () => undefined);
  const error = useSyncExternalStore(subscribe, useCallback(() => {
    const state = resource?.read();
    return state?.status === 'error' || state?.status === 'ready' ? state.error : null;
  }, [resource]), () => null);
  const isLoading = useSyncExternalStore(subscribe, useCallback(() => {
    const state = resource?.read();
    return state?.status === 'empty' || state?.status === 'loading';
  }, [resource]), () => false);
  return { data, error, isLoading };
}
function useResourceDemand<T>(resource: KeyedResource<T> | null, demand: DemandKind | null): void {
  useEffect(() => {
    if (!resource || !demand) return;
    startReconciliationScheduler();
    const release = resource.acquireDemand(demand);
    void resource.ensure('navigation').catch(() => undefined);
    return release;
  }, [resource, demand]);
}

export function useSharedWorkspaceResolution(
  projectId: string | null | undefined,
  projectSlug?: string | null,
  expectedRepo?: RepoIdentity | null,
  preferredWorkspaceId?: string | null,
  options?: { allowCandidateScan?: boolean; demand?: DemandKind | null },
) {
  const repoSignature = expectedRepo ? JSON.stringify(expectedRepo) : null;
  const resource = useMemo(() => projectId ? getWorkspaceResolutionResource(projectId, preferredWorkspaceId,
    projectSlug, expectedRepo, options?.allowCandidateScan ?? false) : null,
  [projectId, preferredWorkspaceId, projectSlug, repoSignature, options?.allowCandidateScan]);
  const { data, error, isLoading } = useResourceSnapshot(resource);
  useResourceDemand(resource, options?.demand === undefined ? 'foreground' : options.demand);
  const refresh = useCallback(() => {
    if (!projectId || !resource) return;
    invalidateProjectWorkspaceResolution(projectId);
    void resource.ensure('navigation').catch(() => undefined);
  }, [projectId, resource]);
  return { result: data ?? null, refresh, error, isLoading };
}

export function useSharedProjectLaneState(
  projectId: string | null, workspaceId: string | null, collabBranch: string | null,
  isDemanded = true, demand: DemandKind = 'foreground',
) {
  const resource = useMemo(() => projectId && workspaceId ? getProjectLaneResource(projectId, workspaceId, collabBranch) : null,
    [projectId, workspaceId, collabBranch]);
  const { data, error, isLoading } = useResourceSnapshot(resource);
  useResourceDemand(resource, isDemanded ? demand : null);
  const laneState = data ?? null;
  const activeLane = useMemo(() => laneState?.lanes.find((lane) => lane.id === laneState.activeLaneId) ?? null, [laneState]);
  const collabLane = useMemo(() => laneState?.lanes.find((lane) => lane.id === laneState.collabLaneId) ?? null, [laneState]);
  const refreshLaneState = useCallback(async () => { if (resource) await resource.ensure('refresh'); }, [resource]);
  return { laneState, activeLane, collabLane, isLoading, error, refreshLaneState };
}
