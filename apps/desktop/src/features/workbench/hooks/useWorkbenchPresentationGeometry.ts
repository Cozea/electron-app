/**
 * Visible-Slot Geometry & Reactivation Layout Protocol
 * Conforms to Section 8.2 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Observes dimensions ONLY for visible presentation slot (Invariant I12)
 * - Skips all layout/fit calls when hidden or when dimensions are zero (U06, U07)
 * - Performs exactly one necessary layout pass upon activation (Section 8.2)
 */

import { useEffect, useRef, useCallback } from 'react';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

interface UseWorkbenchPresentationGeometryOptions {
  isActive: boolean;
  onLayout: (width: number, height: number) => void;
}

export function useWorkbenchPresentationGeometry({
  isActive,
  onLayout,
}: UseWorkbenchPresentationGeometryOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const triggerLayout = useCallback(
    (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      if (
        lastDimensionsRef.current.width === width &&
        lastDimensionsRef.current.height === height
      ) {
        return; // No geometry drift if unchanged (U07)
      }
      lastDimensionsRef.current = { width, height };

      if (isActive) {
        onLayout(width, height);
      } else {
        navigationMetrics.increment('hiddenLayoutCalls');
      }
    },
    [isActive, onLayout]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isActive) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        triggerLayout(Math.round(width), Math.round(height));
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [isActive, triggerLayout]);

  return { containerRef, triggerLayout };
}
