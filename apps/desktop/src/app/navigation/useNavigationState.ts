/**
 * Narrow Subscription Hooks for Navigation State
 * Conforms to Section 3.2 of docs/perf/navigation-runtime-plan.md
 */

import { useWorkbenchPresentationStore } from '@/features/workbench/model/workbenchPresentationStore';

export function useActiveWorkbenchPresentation() {
  const activeIdentity = useWorkbenchPresentationStore((s) => s.activeIdentity);
  const activeInstanceKey = useWorkbenchPresentationStore((s) => s.activeInstanceKey);
  const isWorkbenchVisible = Boolean(activeInstanceKey);

  return {
    activeIdentity,
    activeInstanceKey,
    isWorkbenchVisible,
  };
}
