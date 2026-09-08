/**
 * Workbench Presentation Residency Store
 * Conforms to Section 7.1 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Pure presentation residency state; no service authority
 * - Up to 3 ordinary resident sessions by default (Section 7.1, Invariant I01)
 * - Monotonic recency and activation sequence counters
 * - Bounded LRU eviction of oldest ordinary inactive unpinned session (U11)
 */

import { create } from 'zustand';
import {
  type ResolvedWorkbenchIdentity,
  buildPresentationInstanceKey,
} from '@shared/navigationRuntimeTypes';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

export interface ResidentWorkbenchRecord {
  instanceKey: string;
  identity: ResolvedWorkbenchIdentity;
  lastForegroundSequence: number;
  isPinned: boolean;
  isHydrated: boolean;
}

interface WorkbenchPresentationState {
  residents: Record<string, ResidentWorkbenchRecord>;
  residentOrder: string[]; // LRU order, most recent at end
  activeInstanceKey: string | null;
  activeIdentity: ResolvedWorkbenchIdentity | null;
  activationSequence: number;

  actions: {
    activate: (identity: ResolvedWorkbenchIdentity) => void;
    deactivateActive: () => void;
    setPinned: (instanceKey: string, isPinned: boolean) => void;
    markHydrated: (instanceKey: string) => void;
  };
}

const MAX_ORDINARY_RESIDENTS = 3;

export const useWorkbenchPresentationStore = create<WorkbenchPresentationState>((set, get) => ({
  residents: {},
  residentOrder: [],
  activeInstanceKey: null,
  activeIdentity: null,
  activationSequence: 0,

  actions: {
    activate: (identity: ResolvedWorkbenchIdentity) => {
      const instanceKey = buildPresentationInstanceKey(identity);
      const state = get();
      const nextSequence = state.activationSequence + 1;

      // Update or create resident entry
      const existing = state.residents[instanceKey];
      const nextRecord: ResidentWorkbenchRecord = {
        instanceKey,
        identity,
        lastForegroundSequence: nextSequence,
        isPinned: existing?.isPinned ?? false,
        isHydrated: existing?.isHydrated ?? false,
      };

      const nextResidents = { ...state.residents, [instanceKey]: nextRecord };

      // Update resident order (move to end)
      const nextOrder = state.residentOrder.filter((k) => k !== instanceKey);
      nextOrder.push(instanceKey);

      // Enforce ordinary resident bounds (<= 3 ordinary residents) (U11, Section 7.5)
      const unpinned = nextOrder.filter((k) => !nextResidents[k].isPinned && k !== instanceKey);
      while (unpinned.length >= MAX_ORDINARY_RESIDENTS) {
        const evictedKey = unpinned.shift();
        if (evictedKey) {
          delete nextResidents[evictedKey];
          const orderIdx = nextOrder.indexOf(evictedKey);
          if (orderIdx !== -1) nextOrder.splice(orderIdx, 1);
          navigationMetrics.increment('ordinaryEvictions');
        }
      }

      set({
        residents: nextResidents,
        residentOrder: nextOrder,
        activeInstanceKey: instanceKey,
        activeIdentity: identity,
        activationSequence: nextSequence,
      });

      navigationMetrics.setGauge('residentDescriptors', nextOrder.length);
      navigationMetrics.setGauge('visibleSessions', 1);
    },

    deactivateActive: () => {
      set({
        activeInstanceKey: null,
        activeIdentity: null,
      });
      navigationMetrics.setGauge('visibleSessions', 0);
    },

    setPinned: (instanceKey: string, isPinned: boolean) => {
      const state = get();
      const record = state.residents[instanceKey];
      if (!record) return;

      set({
        residents: {
          ...state.residents,
          [instanceKey]: { ...record, isPinned },
        },
      });

      if (isPinned) {
        navigationMetrics.increment('pins');
      }
    },

    markHydrated: (instanceKey: string) => {
      const state = get();
      const record = state.residents[instanceKey];
      if (!record) return;

      set({
        residents: {
          ...state.residents,
          [instanceKey]: { ...record, isHydrated: true },
        },
      });
    },
  },
}));
