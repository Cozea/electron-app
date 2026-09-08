/**
 * Router to Navigation Controller Bridge
 * Conforms to Section 5.3 of docs/perf/navigation-runtime-plan.md
 */

import { useEffect } from 'react';
import { useLocation } from '@/lib/router';
import { useWorkbenchPresentationStore } from '@/features/workbench/model/workbenchPresentationStore';
import { navigationController } from './navigationController';
import type { ResolvedWorkbenchIdentity } from '@shared/navigationRuntimeTypes';

function extractWorkbenchRouteParams(pathname: string): { projectId: string } | null {
  const match = pathname.match(/^\/projects\/p\/([^/]+)\/workbench/);
  if (match && match[1]) {
    return { projectId: match[1] };
  }
  return null;
}

export function NavigationRouteBridge() {
  const location = useLocation();
  const activate = useWorkbenchPresentationStore((s) => s.actions.activate);
  const deactivate = useWorkbenchPresentationStore((s) => s.actions.deactivateActive);
  const activeIdentity = useWorkbenchPresentationStore((s) => s.activeIdentity);

  useEffect(() => {
    void navigationController.init();
  }, []);

  useEffect(() => {
    const workbenchParams = extractWorkbenchRouteParams(location.pathname);

    if (workbenchParams) {
      const { projectId } = workbenchParams;
      // If already active for this project, no-op
      if (activeIdentity && activeIdentity.projectId === projectId) {
        return;
      }

      const target: ResolvedWorkbenchIdentity = {
        projectId,
        workspaceId: 'default',
        workspaceRevision: 1,
        laneId: 'collab',
      };

      activate(target);
      void navigationController.setPresentation(target);
    } else {
      // Ordinary non-workbench route: deactivate active presentation without evicting resident sessions
      if (activeIdentity !== null) {
        deactivate();
        void navigationController.setPresentation(null);
      }
    }
  }, [location.pathname, activeIdentity, activate, deactivate]);

  return null;
}
