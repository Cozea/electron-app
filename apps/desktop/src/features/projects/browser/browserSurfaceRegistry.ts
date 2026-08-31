import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";
import { useEffect, useRef } from "react";
import { create } from "zustand";

interface BrowserSurfaceRegistryEntry {
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly owners: ReadonlySet<symbol>;
}

interface BrowserSurfaceRegistryState {
  readonly byTabId: Record<string, BrowserSurfaceRegistryEntry>;
  readonly claim: (descriptor: BrowserSurfaceDescriptor, owner: symbol) => void;
  readonly update: (descriptor: BrowserSurfaceDescriptor, owner: symbol) => void;
  readonly release: (tabId: string, owner: symbol) => void;
}

const pendingRemoval = new Map<string, number>();

export const useBrowserSurfaceRegistry = create<BrowserSurfaceRegistryState>()((set) => ({
  byTabId: {},
  claim: (descriptor, owner) =>
    set((state) => {
      const removal = pendingRemoval.get(descriptor.runtimeTabId);
      if (removal !== undefined) {
        window.clearTimeout(removal);
        pendingRemoval.delete(descriptor.runtimeTabId);
      }
      const current = state.byTabId[descriptor.runtimeTabId];
      return {
        byTabId: {
          ...state.byTabId,
          [descriptor.runtimeTabId]: {
            descriptor,
            owners: new Set([...(current?.owners ?? []), owner]),
          },
        },
      };
    }),
  update: (descriptor, owner) =>
    set((state) => {
      const current = state.byTabId[descriptor.runtimeTabId];
      if (!current?.owners.has(owner)) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [descriptor.runtimeTabId]: { ...current, descriptor },
        },
      };
    }),
  release: (tabId, owner) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (!current?.owners.has(owner)) return state;
      const owners = new Set(current.owners);
      owners.delete(owner);
      if (owners.size > 0) {
        return { byTabId: { ...state.byTabId, [tabId]: { ...current, owners } } };
      }
      const removal = window.setTimeout(() => {
        pendingRemoval.delete(tabId);
        useBrowserSurfaceRegistry.setState((latest) => {
          const candidate = latest.byTabId[tabId];
          if (!candidate || candidate.owners.size > 0) return latest;
          const { [tabId]: _removed, ...byTabId } = latest.byTabId;
          return { byTabId };
        });
      }, 0);
      pendingRemoval.set(tabId, removal);
      return { byTabId: { ...state.byTabId, [tabId]: { ...current, owners } } };
    }),
}));

export function useHostedBrowserSurface(descriptor: BrowserSurfaceDescriptor | null): void {
  const ownerRef = useRef(Symbol("hosted-browser-surface"));
  const runtimeTabId = descriptor?.runtimeTabId ?? null;

  useEffect(() => {
    if (!descriptor) return;
    const owner = ownerRef.current;
    useBrowserSurfaceRegistry.getState().claim(descriptor, owner);
    return () => useBrowserSurfaceRegistry.getState().release(descriptor.runtimeTabId, owner);
  }, [runtimeTabId]);

  useEffect(() => {
    if (!descriptor) return;
    useBrowserSurfaceRegistry.getState().update(descriptor, ownerRef.current);
  }, [descriptor]);
}
