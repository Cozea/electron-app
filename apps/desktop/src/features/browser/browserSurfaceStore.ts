import { create } from "zustand";

import { APP_LAYERS } from "@/lib/appLayers";
import { recordInteractionCounter } from "@/lib/performance/interactionCounters";
import {
  clearBrowserSurfaceGeometryOwner,
  getBrowserSurfaceContent,
  getBrowserSurfaceRect,
  registerBrowserSurfaceGeometryOwner,
  setBrowserSurfaceContent,
  setBrowserSurfaceRect,
  type BrowserSurfaceContentPresentation,
  type BrowserSurfaceRect,
} from "./browserSurfaceGeometryRuntime";

export type { BrowserSurfaceContentPresentation, BrowserSurfaceRect };

export interface BrowserSurfacePresentation {
  readonly visible: boolean;
  readonly fittedSourceContent: BrowserSurfaceContentPresentation | null;
  readonly fitSourceContent: boolean;
  readonly borderRadius: string;
  readonly stackingLayer: number;
  readonly updatedAt: number;
  readonly owner: symbol | null;
}

interface BrowserSurfaceStoreState {
  readonly byTabId: Record<string, BrowserSurfacePresentation>;
  readonly claim: (tabId: string, owner: symbol, fitSourceContent: boolean) => void;
  readonly present: (
    tabId: string,
    owner: symbol,
    visible: boolean,
    borderRadius: string,
    stackingLayer: number,
  ) => void;
  readonly presentContent: (tabId: string, content: BrowserSurfaceContentPresentation) => void;
  readonly release: (tabId: string, owner: symbol) => void;
}

export interface BrowserSurfaceLease {
  readonly present: (
    rect: BrowserSurfaceRect,
    visible: boolean,
    borderRadius?: string,
    stackingLayer?: number,
  ) => boolean;
  readonly release: () => void;
}

export function resolveBrowserSurfacePanelRect(
  _byTabId: Readonly<Record<string, BrowserSurfacePresentation>>,
  tabId: string,
): BrowserSurfaceRect | null {
  return getBrowserSurfaceRect(tabId);
}

export const useBrowserSurfaceStore = create<BrowserSurfaceStoreState>()((set) => ({
  byTabId: {},
  claim: (tabId, owner, fitSourceContent) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner === owner) return state;
      const content = getBrowserSurfaceContent(tabId);
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            visible: false,
            fittedSourceContent: fitSourceContent ? (current?.fittedSourceContent ?? content) : null,
            fitSourceContent,
            borderRadius: current?.borderRadius ?? "0",
            stackingLayer: current?.stackingLayer ?? APP_LAYERS.browserDocked,
            updatedAt: Date.now(),
            owner,
          },
        },
      };
    }),
  present: (tabId, owner, visible, borderRadius, stackingLayer) => {
    recordInteractionCounter("browserPresentationStoreWrites");
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner !== owner) return state;
      if (
        current.visible === visible &&
        current.borderRadius === borderRadius &&
        current.stackingLayer === stackingLayer
      ) {
        return state;
      }
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            visible,
            borderRadius,
            stackingLayer,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },
  presentContent: (tabId, content) => {
    setBrowserSurfaceContent(tabId, content);
    set((state) => {
      const current = state.byTabId[tabId];
      if (!current) {
        return {
          byTabId: {
            ...state.byTabId,
            [tabId]: {
              visible: false,
              fittedSourceContent: null,
              fitSourceContent: false,
              borderRadius: "0",
              stackingLayer: APP_LAYERS.browserDocked,
              updatedAt: Date.now(),
              owner: null,
            },
          },
        };
      }
      if (current.fitSourceContent && current.fittedSourceContent === null) {
        return {
          byTabId: {
            ...state.byTabId,
            [tabId]: {
              ...current,
              fittedSourceContent: content,
              updatedAt: Date.now(),
            },
          },
        };
      }
      return state;
    });
  },
  release: (tabId, owner) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner !== owner) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            visible: false,
            fittedSourceContent: null,
            fitSourceContent: false,
            updatedAt: Date.now(),
            owner: null,
          },
        },
      };
    }),
}));

export function acquireBrowserSurface(
  tabId: string,
  fitSourceContent = false,
): BrowserSurfaceLease {
  const owner = Symbol(`browser-surface:${tabId}`);
  let released = false;
  useBrowserSurfaceStore.getState().claim(tabId, owner, fitSourceContent);
  registerBrowserSurfaceGeometryOwner(tabId, owner);

  return {
    present: (
      rect,
      visible,
      borderRadius = "0",
      stackingLayer = APP_LAYERS.browserDocked,
    ) => {
      if (released) return false;
      if (useBrowserSurfaceStore.getState().byTabId[tabId]?.owner !== owner) return false;
      const setSuccess = setBrowserSurfaceRect(tabId, owner, rect);
      if (!setSuccess) return false;
      useBrowserSurfaceStore
        .getState()
        .present(tabId, owner, visible, borderRadius, stackingLayer);
      return true;
    },
    release: () => {
      if (released) return;
      released = true;
      clearBrowserSurfaceGeometryOwner(tabId, owner);
      useBrowserSurfaceStore.getState().release(tabId, owner);
    },
  };
}
