/**
 * Persistent Workbench Presentation Host
 * Conforms to Section 3.1, 7.1, & Invariant I01 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Exactly one persistent workbench presentation host per main window epoch
 * - Renders all resident sessions (up to 3) in stable DOM slots with canonical keys (Invariant I03)
 * - Retains inactive sessions across route departures (e.g. A -> Store -> A)
 */

import { useWorkbenchPresentationStore } from './model/workbenchPresentationStore';
import { WorkbenchSessionBoundary } from './WorkbenchSessionBoundary';
import { WorkbenchSessionSurface } from './WorkbenchSessionSurface';

export function WorkbenchPresentationHost() {
  const residents = useWorkbenchPresentationStore((state) => state.residents);
  const residentOrder = useWorkbenchPresentationStore((state) => state.residentOrder);
  const activeInstanceKey = useWorkbenchPresentationStore((state) => state.activeInstanceKey);

  return (
    <div
      data-testid="workbench-presentation-host"
      className="relative h-full w-full min-h-0 min-w-0 overflow-hidden"
    >
      {residentOrder.map((key) => {
        const resident = residents[key];
        if (!resident) return null;
        const isActive = resident.instanceKey === activeInstanceKey;

        return (
          <WorkbenchSessionBoundary
            key={resident.instanceKey}
            identity={resident.identity}
            isActive={isActive}
          >
            <WorkbenchSessionSurface
              identity={resident.identity}
              isActive={isActive}
            />
          </WorkbenchSessionBoundary>
        );
      })}
    </div>
  );
}
