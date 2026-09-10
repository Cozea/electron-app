import { useCallback, useSyncExternalStore } from "react";

import type { BrowserSurfacePlaceholder } from "@shared/browserSurfaceTypes";

import { browserSurfaceModels, type BrowserSurfaceModel } from "./browserSurfaceModel";

/**
 * The one owner of native-surface occlusion and native stacking order.
 *
 * A main-owned WebContentsView paints above the entire renderer, so no CSS
 * z-index can put Cozea UI over it (INV-009). Whenever application UI covers a
 * native surface, the live view is taken off screen and a DOM placeholder takes
 * its place in the slot -- underneath that UI, in ordinary CSS order -- until
 * the UI goes away and the same live page comes back.
 *
 * Tiles do not special-case overlays: overlays declare themselves, slots
 * register themselves, and this module decides. Native order is derived here
 * as well, because it is the same question asked the other way round -- which
 * surface is nearer the user where two of them overlap (INV-011).
 */

export type BrowserSurfaceOcclusionReason =
  | "dialog"
  | "menu"
  | "popover"
  | "tooltip"
  | "notification"
  | "tutorial"
  | "drag"
  | "floating"
  | "unknown";

/** Most significant first: what a surface reports when several things cover it. */
const REASON_PRIORITY: ReadonlyArray<BrowserSurfaceOcclusionReason> = [
  "dialog",
  "menu",
  "popover",
  "tooltip",
  "notification",
  "tutorial",
  "drag",
  "floating",
  "unknown",
];

/** Reasons an overlay may declare for itself; `floating` is Dockview's alone. */
const DECLARABLE_REASONS: ReadonlySet<string> = new Set([
  "dialog",
  "menu",
  "popover",
  "tooltip",
  "notification",
  "tutorial",
  "drag",
]);

export const DECLARED_OVERLAY_ATTRIBUTE = "data-cozea-overlay";
const FLOATING_GROUP_SELECTOR = ".dv-resize-container";

/**
 * Every category of UI that can cover a native surface, and how each is found.
 *
 * Cozea's own overlays declare themselves with `data-cozea-overlay="<reason>"`
 * on the element that is actually painted. Layers Cozea does not render itself
 * are matched by their own stable class names. Native Electron context menus
 * are absent on purpose: the OS draws them above every view already.
 */
export const BROWSER_SURFACE_OVERLAY_SOURCES = [
  {
    selector: `[${DECLARED_OVERLAY_ATTRIBUTE}]`,
    reason: null,
    covers:
      "Cozea dialogs, alert dialogs, sheets, the command palette, dropdown menus and submenus, " +
      "selects, comboboxes, popovers (including the header overflow), tooltips, toasts, the " +
      "update notice, the tile split chooser and body-portal modals",
  },
  { selector: FLOATING_GROUP_SELECTOR, reason: "floating", covers: "Dockview floating groups" },
  {
    selector: ".dv-drop-target-anchor, .dv-drop-target-dropzone",
    reason: "drag",
    covers: "Dockview drag-and-drop targets",
  },
  { selector: ".dv-popover-anchor > *", reason: "menu", covers: "Dockview tab overflow list" },
  {
    selector: ".driver-overlay, .cozea-tour-popover",
    reason: "tutorial",
    covers: "Product tour backdrop and popover",
  },
] as const satisfies ReadonlyArray<{
  readonly selector: string;
  readonly reason: BrowserSurfaceOcclusionReason | null;
  readonly covers: string;
}>;

const OVERLAY_SELECTOR = BROWSER_SURFACE_OVERLAY_SOURCES.map((source) => source.selector).join(
  ", ",
);

export interface OcclusionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface OcclusionSurface {
  readonly runtimeTabId: string;
  readonly rect: OcclusionRect;
  /** Dockview floating level of the group holding the surface; null when docked. */
  readonly floatingLevel: number | null;
}

export interface OcclusionOverlay {
  readonly reason: BrowserSurfaceOcclusionReason;
  readonly rect: OcclusionRect;
  /** Surfaces inside this overlay. Nothing covers what it contains. */
  readonly containedSurfaces: ReadonlySet<string>;
  /** Set for Dockview floating groups, which cover only what lies beneath them. */
  readonly floatingLevel?: number;
}

/**
 * Overlaps thinner than this are drop shadows and hairline borders touching the
 * surface's edge, not cover. Hiding a live page for them would flicker it every
 * time a menu opened beside it.
 */
export const MIN_OCCLUDING_OVERLAP_PX = 2;

export function rectsOverlap(
  a: OcclusionRect,
  b: OcclusionRect,
  minimum = MIN_OCCLUDING_OVERLAP_PX,
): boolean {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width >= minimum && height >= minimum;
}

function hasArea(rect: OcclusionRect): boolean {
  return rect.right > rect.left && rect.bottom > rect.top;
}

function covers(overlay: OcclusionOverlay, surface: OcclusionSurface): boolean {
  if (overlay.containedSurfaces.has(surface.runtimeTabId)) return false;
  if (!hasArea(surface.rect) || !rectsOverlap(overlay.rect, surface.rect)) return false;
  if (overlay.floatingLevel === undefined) return true;
  // A floating group covers docked surfaces, and floating ones only when
  // Dockview has placed it nearer the front.
  return surface.floatingLevel === null || overlay.floatingLevel > surface.floatingLevel;
}

/**
 * Which surfaces are covered, and by what. A covered surface is hidden whole:
 * a native view cannot be clipped by DOM, and punching native holes around an
 * overlay is not worth its complexity (plan 24.3).
 */
export function computeBrowserSurfaceOcclusion(
  surfaces: ReadonlyArray<OcclusionSurface>,
  overlays: ReadonlyArray<OcclusionOverlay>,
): Map<string, BrowserSurfaceOcclusionReason | null> {
  const result = new Map<string, BrowserSurfaceOcclusionReason | null>();
  for (const surface of surfaces) {
    let reason: BrowserSurfaceOcclusionReason | null = null;
    for (const overlay of overlays) {
      if (!covers(overlay, surface)) continue;
      if (
        reason === null ||
        REASON_PRIORITY.indexOf(overlay.reason) < REASON_PRIORITY.indexOf(reason)
      ) {
        reason = overlay.reason;
      }
    }
    result.set(surface.runtimeTabId, reason);
  }
  return result;
}

/**
 * Native order, back to front, following Dockview's own floating order.
 *
 * Docked surfaces never overlap one another, so they keep a stable order
 * beneath every floating surface; floating surfaces follow Dockview's level,
 * nearest last. Ties keep the order the slots were registered in.
 */
export function computeNativeSurfaceOrder(
  surfaces: ReadonlyArray<Pick<OcclusionSurface, "runtimeTabId" | "floatingLevel">>,
): string[] {
  return surfaces
    .map((surface, index) => ({ surface, index }))
    .sort(
      (a, b) =>
        (a.surface.floatingLevel ?? -1) - (b.surface.floatingLevel ?? -1) || a.index - b.index,
    )
    .map(({ surface }) => surface.runtimeTabId);
}

/** What the coordinator reads from an element; a DOM Element satisfies it. */
export interface OcclusionElement {
  getBoundingClientRect(): OcclusionRect;
  getAttribute(name: string): string | null;
  closest(selector: string): OcclusionElement | null;
  /** Typed loosely so a DOM `Element`, whose `contains` takes any `Node`, satisfies it. */
  contains(other: unknown): boolean;
  matches(selector: string): boolean;
}

export interface OcclusionWatch {
  /** Follow these overlay elements for movement and resizing; replaces the previous set. */
  track(elements: ReadonlyArray<OcclusionElement>): void;
  dispose(): void;
}

/** The document, behind an interface so the decision logic runs without one. */
export interface OcclusionDom {
  queryAll(selector: string): ReadonlyArray<OcclusionElement>;
  /** False for `display: none` and `visibility: hidden`. */
  isPainted(element: OcclusionElement): boolean;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** Notify when overlays mount or unmount, and when tracked ones move. */
  watch(onChange: () => void): OcclusionWatch;
}

interface OcclusionModels {
  setOrder(orderedRuntimeTabIds: ReadonlyArray<string>): void;
  has(runtimeTabId: string): boolean;
}

type OccludableModel = Pick<BrowserSurfaceModel, "setOccluded" | "capturePlaceholder" | "isVisible">;

export interface BrowserSurfaceOcclusionState {
  readonly blocked: boolean;
  readonly reason: BrowserSurfaceOcclusionReason | null;
  /** The latest still of the page, kept across overlays; null until one exists. */
  readonly placeholder: BrowserSurfacePlaceholder | null;
}

const UNBLOCKED: BrowserSurfaceOcclusionState = { blocked: false, reason: null, placeholder: null };

function readFloatingLevel(element: OcclusionElement): number {
  const level = Number.parseInt(element.getAttribute("aria-level") ?? "", 10);
  return Number.isFinite(level) ? Math.max(0, level) : 0;
}

function classifyOverlay(element: OcclusionElement): BrowserSurfaceOcclusionReason | null {
  const declared = element.getAttribute(DECLARED_OVERLAY_ATTRIBUTE);
  if (declared !== null) {
    // A misspelt declaration still covers the page; it just says less about why.
    return DECLARABLE_REASONS.has(declared)
      ? (declared as BrowserSurfaceOcclusionReason)
      : "unknown";
  }
  for (const source of BROWSER_SURFACE_OVERLAY_SOURCES) {
    if (source.reason !== null && element.matches(source.selector)) return source.reason;
  }
  return null;
}

function sameOrder(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class BrowserSurfaceOcclusionCoordinator {
  /** Insertion order is registration order, the stable tie-breaker for native order. */
  private readonly registrations = new Map<
    string,
    { readonly element: OcclusionElement; readonly model: OccludableModel }
  >();
  /** Slots that went away; resolved on the next pass unless a slot claims them again. */
  private readonly detached = new Map<string, OccludableModel>();
  private readonly states = new Map<string, BrowserSurfaceOcclusionState>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly createDom: () => OcclusionDom;
  private readonly models: OcclusionModels;
  private dom: OcclusionDom | null = null;
  private watch: OcclusionWatch | null = null;
  private frame: number | null = null;
  private lastOrder: ReadonlyArray<string> = [];

  constructor(options: { createDom: () => OcclusionDom; models: OcclusionModels }) {
    this.createDom = options.createDom;
    this.models = options.models;
  }

  /** Claim occlusion handling for a native surface's slot element. */
  register(runtimeTabId: string, element: OcclusionElement, model: OccludableModel): () => void {
    const registration = { element, model };
    // A slot remounting in the same tick -- a Dockview move -- takes over from
    // the one that just left, without an unoccluded frame in between.
    this.detached.delete(runtimeTabId);
    this.registrations.delete(runtimeTabId);
    this.registrations.set(runtimeTabId, registration);
    this.startWatching();
    this.scheduleRecompute();
    return () => {
      if (this.registrations.get(runtimeTabId) !== registration) return;
      this.registrations.delete(runtimeTabId);
      this.detached.set(runtimeTabId, model);
      this.scheduleRecompute();
    };
  }

  /** Coalesce to one pass per frame, however many signals arrive. */
  scheduleRecompute(): void {
    const dom = this.dom;
    if (!dom || this.frame !== null) return;
    this.frame = dom.requestFrame(() => {
      this.frame = null;
      this.recompute();
    });
  }

  recompute(): void {
    const dom = this.dom;
    if (!dom) return;

    // A slot that left without being replaced takes its cover with it; its
    // model must not stay occluded for a presentation that no longer exists.
    for (const [runtimeTabId, model] of this.detached) {
      const state = this.getState(runtimeTabId);
      if (!state.blocked) continue;
      void model.setOccluded(false);
      this.setState(runtimeTabId, { ...state, blocked: false, reason: null });
    }
    this.detached.clear();

    const entries = Array.from(this.registrations);
    const surfaces: OcclusionSurface[] = entries.map(([runtimeTabId, { element }]) => {
      const floatingGroup = element.closest(FLOATING_GROUP_SELECTOR);
      return {
        runtimeTabId,
        rect: element.getBoundingClientRect(),
        floatingLevel: floatingGroup ? readFloatingLevel(floatingGroup) : null,
      };
    });

    const candidates = entries.length > 0 ? dom.queryAll(OVERLAY_SELECTOR) : [];
    this.watch?.track(candidates);
    const overlays: OcclusionOverlay[] = [];
    for (const element of candidates) {
      const reason = classifyOverlay(element);
      if (reason === null || !dom.isPainted(element)) continue;
      overlays.push({
        reason,
        rect: element.getBoundingClientRect(),
        containedSurfaces: new Set(
          entries
            .filter(([, registration]) => element.contains(registration.element))
            .map(([runtimeTabId]) => runtimeTabId),
        ),
        ...(reason === "floating" ? { floatingLevel: readFloatingLevel(element) } : {}),
      });
    }

    const occlusion = computeBrowserSurfaceOcclusion(surfaces, overlays);
    for (const [runtimeTabId, { model }] of entries) {
      this.apply(runtimeTabId, model, occlusion.get(runtimeTabId) ?? null);
    }

    const order = computeNativeSurfaceOrder(surfaces);
    if (!sameOrder(order, this.lastOrder)) {
      this.lastOrder = order;
      if (order.length > 0) this.models.setOrder(order);
    }

    this.prune();
    if (this.registrations.size === 0) this.stopWatching();
  }

  /**
   * Refresh the still of an uncovered surface, so the next overlay can swap to
   * a current picture at once rather than a blank. Called on navigation and on
   * return to the screen -- never on a timer.
   */
  refreshPlaceholder(runtimeTabId: string): void {
    const registration = this.registrations.get(runtimeTabId);
    if (!registration || this.getState(runtimeTabId).blocked || !registration.model.isVisible) {
      return;
    }
    void registration.model.capturePlaceholder().then((placeholder) => {
      if (placeholder) this.storePlaceholder(runtimeTabId, placeholder);
    });
  }

  getState(runtimeTabId: string): BrowserSurfaceOcclusionState {
    return this.states.get(runtimeTabId) ?? UNBLOCKED;
  }

  subscribe(runtimeTabId: string, listener: () => void): () => void {
    let bucket = this.listeners.get(runtimeTabId);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(runtimeTabId, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) this.listeners.delete(runtimeTabId);
    };
  }

  private apply(
    runtimeTabId: string,
    model: OccludableModel,
    reason: BrowserSurfaceOcclusionReason | null,
  ): void {
    const previous = this.getState(runtimeTabId);
    const blocked = reason !== null;
    if (previous.blocked === blocked && previous.reason === reason) return;
    // Blocked state is published before main is asked to hide, so the slot
    // shows the latest still (or a neutral fill) in the same frame (plan 13.4).
    this.setState(runtimeTabId, { blocked, reason, placeholder: previous.placeholder });
    if (previous.blocked === blocked) return;

    const pending = model.setOccluded(blocked);
    if (!blocked) return;
    void pending.then((placeholder) => {
      // A still that lands after the overlay has gone is still the latest
      // picture of the page, so it is kept for the next one.
      if (placeholder) this.storePlaceholder(runtimeTabId, placeholder);
    });
  }

  private storePlaceholder(runtimeTabId: string, placeholder: BrowserSurfacePlaceholder): void {
    const current = this.getState(runtimeTabId);
    if (current.placeholder && current.placeholder.capturedAt > placeholder.capturedAt) return;
    this.setState(runtimeTabId, { ...current, placeholder });
  }

  private setState(runtimeTabId: string, state: BrowserSurfaceOcclusionState): void {
    this.states.set(runtimeTabId, state);
    for (const listener of this.listeners.get(runtimeTabId) ?? []) listener();
  }

  /** Stills are a cache for live surfaces; a closed surface's is dropped. */
  private prune(): void {
    for (const runtimeTabId of Array.from(this.states.keys())) {
      if (this.registrations.has(runtimeTabId) || this.models.has(runtimeTabId)) continue;
      this.states.delete(runtimeTabId);
      for (const listener of this.listeners.get(runtimeTabId) ?? []) listener();
    }
  }

  private startWatching(): void {
    if (this.dom) return;
    this.dom = this.createDom();
    this.watch = this.dom.watch(() => this.scheduleRecompute());
  }

  private stopWatching(): void {
    if (this.frame !== null) this.dom?.cancelFrame(this.frame);
    this.frame = null;
    this.watch?.dispose();
    this.watch = null;
    this.dom = null;
    this.lastOrder = [];
  }
}

function sameElements(
  left: ReadonlyArray<OcclusionElement>,
  right: ReadonlyArray<OcclusionElement>,
): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

/**
 * The real document. Observers only report that something changed; the frame
 * pass then reads rectangles. There is no polling: an idle workbench does no
 * work here at all (plan 24.1).
 */
function createDocumentOcclusionDom(): OcclusionDom {
  return {
    queryAll: (selector) => Array.from(document.querySelectorAll(selector)),
    isPainted: (element) => {
      const style = window.getComputedStyle(element as unknown as Element);
      return style.display !== "none" && style.visibility !== "hidden";
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    watch: (onChange) => {
      // Mounts and unmounts anywhere, plus the attributes that change what an
      // element means: Dockview's floating order, and an overlay declaration.
      const structure = new MutationObserver(onChange);
      structure.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-level", DECLARED_OVERLAY_ATTRIBUTE],
      });
      // Movement is watched only on the overlays themselves, not the document:
      // positioned popups and floating groups move by style.
      const resize = new ResizeObserver(onChange);
      let movement = new MutationObserver(onChange);
      let tracked: ReadonlyArray<OcclusionElement> = [];
      window.addEventListener("resize", onChange);
      return {
        track: (elements) => {
          if (sameElements(tracked, elements)) return;
          for (const element of tracked) {
            if (!elements.includes(element)) resize.unobserve(element as unknown as Element);
          }
          for (const element of elements) {
            if (!tracked.includes(element)) resize.observe(element as unknown as Element);
          }
          movement.disconnect();
          movement = new MutationObserver(onChange);
          for (const element of elements) {
            movement.observe(element as unknown as Element, {
              attributes: true,
              attributeFilter: ["style", "class", "hidden"],
            });
          }
          tracked = elements;
        },
        dispose: () => {
          structure.disconnect();
          resize.disconnect();
          movement.disconnect();
          window.removeEventListener("resize", onChange);
        },
      };
    },
  };
}

export const browserSurfaceOcclusion = new BrowserSurfaceOcclusionCoordinator({
  createDom: createDocumentOcclusionDom,
  models: {
    setOrder: (order) => browserSurfaceModels.setOrder(order),
    has: (runtimeTabId) => browserSurfaceModels.get(runtimeTabId) !== undefined,
  },
});

export function useBrowserSurfaceOcclusion(runtimeTabId: string): BrowserSurfaceOcclusionState {
  const subscribe = useCallback(
    (listener: () => void) => browserSurfaceOcclusion.subscribe(runtimeTabId, listener),
    [runtimeTabId],
  );
  return useSyncExternalStore(subscribe, () => browserSurfaceOcclusion.getState(runtimeTabId));
}
