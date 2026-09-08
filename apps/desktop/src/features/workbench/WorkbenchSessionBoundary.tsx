/**
 * Workbench Session Context Boundary
 * Conforms to Section 7.2 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Scopes project, workspace, and sync context to this concrete session identity (Invariant I04)
 * - Independent of mutable ambient router params or other sessions' active context
 * - Isolates inert inactive state (no hidden focus steal or dialog leakage) (U05)
 */

import { useMemo, type ReactNode } from 'react';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';
import { ActiveWorkspaceContext } from '@/contexts/workspace/ActiveWorkspaceContext';
import { ProjectRouteContext, type ProjectRouteContextValue } from '@/contexts/project/ProjectRouteContext';
import { useSharedWorkspaceResolution, useSharedProjectLaneState } from '@/app/resources/useWorkspaceResources';

interface WorkbenchSessionBoundaryProps {
  identity: ResolvedWorkbenchIdentity;
  isActive: boolean;
  children: ReactNode;
}

export function WorkbenchSessionBoundary({
  identity,
  isActive,
  children,
}: WorkbenchSessionBoundaryProps) {
  const { projectId, workspaceId, laneId } = identity;

  // Resolve session-scoped workspace data
  const { result: workspaceResolution } = useSharedWorkspaceResolution(
    projectId,
    undefined,
    null,
    workspaceId
  );

  // Resolve session-scoped lane data
  const { laneState, activeLane, collabLane, refreshLaneState } = useSharedProjectLaneState(
    projectId,
    workspaceId,
    laneId,
    isActive
  );

  const activeWorkspaceValue = useMemo(() => {
    if (!workspaceResolution || workspaceResolution.status !== 'ready') {
      return null;
    }
    return {
      projectId,
      projectSlug: projectId,
      projectName: projectId,
      workspace: workspaceResolution.workspace,
      lane: workspaceResolution.lane,
      runtime: workspaceResolution.runtimeIdentity,
      collaborationScopeId: workspaceResolution.collaborationScopeId,
    };
  }, [projectId, workspaceResolution]);

  const projectRouteContextValue = useMemo<ProjectRouteContextValue>(
    () => ({
      project: null,
      projectIdParam: projectId,
      slugParam: projectId,
      workspaceId,
      projectRootPath: workspaceResolution && workspaceResolution.status === 'ready' ? workspaceResolution.workspace.projectRootPath : null,
      gitRootPath: null,
      gitCwd: null,
      projectBasePath: `/projects/p/${projectId}`,
      projectName: projectId,
      collabBranch: 'main',
      laneState,
      activeLane,
      collabLane,
      collaborationEnabled: true,
      refreshLaneState,
    }),
    [projectId, workspaceId, refreshLaneState, workspaceResolution, laneState, activeLane, collabLane]
  );

  return (
    <div
      data-session-key={`${projectId}::${laneId}::${workspaceId}`}
      data-active={isActive ? 'true' : 'false'}
      className={`absolute inset-0 h-full w-full ${isActive ? 'z-10' : 'pointer-events-none z-0'}`}
      style={{
        opacity: isActive ? 1 : 0,
        visibility: isActive ? 'visible' : 'hidden',
      }}
      aria-hidden={!isActive}
    >
      <ProjectRouteContext.Provider value={projectRouteContextValue}>
        <ActiveWorkspaceContext.Provider value={activeWorkspaceValue}>
          {children}
        </ActiveWorkspaceContext.Provider>
      </ProjectRouteContext.Provider>
    </div>
  );
}
