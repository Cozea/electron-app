/**
 * Session-Scoped Workbench Surface
 * Conforms to Section 3.2 & 7 of docs/perf/navigation-runtime-plan.md
 * 
 * Renders the session-owned Dockview session without ambient route dependency.
 */

import { useMemo } from 'react';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';
import { WorkbenchDockviewSession } from './WorkbenchDockviewSession';
import { buildWorkbenchScopeKey } from '@/lib/workbenchScopeKey';
import type { WorkbenchKeepAliveSession } from './workbenchKeepAlive';
import { useTheme } from '@/contexts/ThemeContext';

interface WorkbenchSessionSurfaceProps {
  identity: ResolvedWorkbenchIdentity;
  isActive: boolean;
}

export function WorkbenchSessionSurface({
  identity,
  isActive,
}: WorkbenchSessionSurfaceProps) {
  const { theme } = useTheme();
  const { projectId, laneId, workspaceId } = identity;

  const sessionDescriptor = useMemo<WorkbenchKeepAliveSession>(() => {
    const scopeKey = buildWorkbenchScopeKey(projectId, laneId, workspaceId);
    return {
      projectId,
      activeLaneId: laneId,
      workspaceId,
      projectRootPath: null,
      gitRootPath: null,
      projectName: projectId,
      framework: null,
      storedDevCommand: null,
      storedDevPort: null,
      workbenchSessionKey: `${projectId}::${laneId}::${workspaceId}`,
      scopeKey,
      layoutResetKey: 0,
      themeScheme: theme === 'light' ? 'light' : 'dark',
      lastActiveAt: Date.now(),
    };
  }, [projectId, laneId, workspaceId, theme]);

  return (
    <WorkbenchDockviewSession
      session={sessionDescriptor}
      isActive={isActive}
      getWorkbenchSession={() => null}
    />
  );
}
