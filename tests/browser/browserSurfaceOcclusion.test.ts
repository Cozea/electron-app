import { describe, expect, it, vi } from "vitest";

import {
  BrowserSurfaceOcclusionCoordinator,
  computeBrowserSurfaceOcclusion,
  computeNativeSurfaceOrder,
  rectsOverlap,
  type OcclusionDom,
  type OcclusionElement,
  type OcclusionOverlay,
  type OcclusionRect,
  type OcclusionSurface,
} from "../../apps/desktop/src/features/browser/browserSurfaceOcclusion";
import type { BrowserSurfacePlaceholder } from "../../shared/browserSurfaceTypes";

/**
 * A native view paints above every piece of DOM, so Cozea UI can only appear
 * over a browser if the browser gets out of its way (INV-009). These pin down
 * who gets out of whose way, and the native order that must follow Dockview's
 * own floating order (INV-011).
 */

const rect = (left: number, top: number, width: number, height: number): OcclusionRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

const surface = (
  runtimeTabId: string,
  at: OcclusionRect,
  floatingLevel: number | null = null,
): OcclusionSurface => ({ runtimeTabId, rect: at, floatingLevel });

const overlay = (
  reason: OcclusionOverlay["reason"],
  at: OcclusionRect,
  extra: Partial<OcclusionOverlay> = {},
): OcclusionOverlay => ({ reason, rect: at, containedSurfaces: new Set(), ...extra });

describe("which surfaces application UI covers", () => {
  const page = rect(100, 100, 600, 400);

  it("covers a surface a dialog lies over", () => {
    const result = computeBrowserSurfaceOcclusion(
      [surface("rt_a", page)],
      [overlay("dialog", rect(200, 200, 300, 200))],
    );
    expect(result.get("rt_a")).toBe("dialog");
  });

  it("leaves a surface alone for UI beside it, even touching its edge", () => {
    const touching = rect(700, 100, 200, 100);
    const hairline = rect(699, 100, 200, 100);
    expect(computeBrowserSurfaceOcclusion([surface("rt_a", page)], [overlay("menu", touching)]).get("rt_a")).toBeNull();
    // A drop shadow grazing the edge is not cover; hiding the page for it
    // would flicker the browser whenever a menu opened beside it.
    expect(computeBrowserSurfaceOcclusion([surface("rt_a", page)], [overlay("menu", hairline)]).get("rt_a")).toBeNull();
    expect(rectsOverlap(page, rect(698, 100, 200, 100))).toBe(true);
  });

  it("reports the most significant of several covers", () => {
    const result = computeBrowserSurfaceOcclusion(
      [surface("rt_a", page)],
      [overlay("tooltip", rect(150, 150, 40, 20)), overlay("dialog", rect(0, 0, 2000, 2000))],
    );
    expect(result.get("rt_a")).toBe("dialog");
  });

  it("never lets an overlay cover a surface it contains", () => {
    const result = computeBrowserSurfaceOcclusion(
      [surface("rt_a", page)],
      [overlay("dialog", rect(0, 0, 2000, 2000), { containedSurfaces: new Set(["rt_a"]) })],
    );
    expect(result.get("rt_a")).toBeNull();
  });

  it("ignores a surface with no area, such as one on a hidden tab", () => {
    const result = computeBrowserSurfaceOcclusion(
      [surface("rt_a", rect(0, 0, 0, 0))],
      [overlay("dialog", rect(0, 0, 2000, 2000))],
    );
    expect(result.get("rt_a")).toBeNull();
  });
});

describe("Dockview floating groups over native surfaces", () => {
  const left = rect(0, 0, 500, 500);
  const right = rect(500, 0, 500, 500);

  it("keeps two docked surfaces live and in a stable order", () => {
    const surfaces = [surface("rt_a", left), surface("rt_b", right)];
    const result = computeBrowserSurfaceOcclusion(surfaces, []);
    expect([...result.values()]).toEqual([null, null]);
    expect(computeNativeSurfaceOrder(surfaces)).toEqual(["rt_a", "rt_b"]);
  });

  it("hides a docked surface under a floating group, but not the browser inside it", () => {
    const floatingBox = rect(300, 100, 400, 300);
    const surfaces = [surface("rt_docked", left), surface("rt_floating", rect(300, 130, 400, 270), 0)];
    const floatingGroup = overlay("floating", floatingBox, {
      floatingLevel: 0,
      containedSurfaces: new Set(["rt_floating"]),
    });

    const result = computeBrowserSurfaceOcclusion(surfaces, [floatingGroup]);

    expect(result.get("rt_docked")).toBe("floating");
    expect(result.get("rt_floating")).toBeNull();
    expect(computeNativeSurfaceOrder(surfaces)).toEqual(["rt_docked", "rt_floating"]);
  });

  it("hides the lower of two overlapping floating browsers, and swaps when the other is raised", () => {
    const boxA = rect(100, 100, 400, 300);
    const boxB = rect(300, 200, 400, 300);
    const layout = (levelA: number, levelB: number) => ({
      surfaces: [surface("rt_a", boxA, levelA), surface("rt_b", boxB, levelB)],
      overlays: [
        overlay("floating", boxA, { floatingLevel: levelA, containedSurfaces: new Set(["rt_a"]) }),
        overlay("floating", boxB, { floatingLevel: levelB, containedSurfaces: new Set(["rt_b"]) }),
      ],
    });

    const bOnTop = layout(0, 1);
    const first = computeBrowserSurfaceOcclusion(bOnTop.surfaces, bOnTop.overlays);
    expect(first.get("rt_a")).toBe("floating");
    expect(first.get("rt_b")).toBeNull();
    expect(computeNativeSurfaceOrder(bOnTop.surfaces)).toEqual(["rt_a", "rt_b"]);

    // Bring A to front: Dockview raises its level, and the roles reverse.
    const aOnTop = layout(1, 0);
    const second = computeBrowserSurfaceOcclusion(aOnTop.surfaces, aOnTop.overlays);
    expect(second.get("rt_a")).toBeNull();
    expect(second.get("rt_b")).toBe("floating");
    expect(computeNativeSurfaceOrder(aOnTop.surfaces)).toEqual(["rt_b", "rt_a"]);
  });

  it("keeps a floating browser live over docked non-browser content", () => {
    // Docked tiles are ordinary layout, not overlays: nothing covers the float.
    const result = computeBrowserSurfaceOcclusion([surface("rt_floating", rect(200, 200, 300, 300), 0)], []);
    expect(result.get("rt_floating")).toBeNull();
  });

  it("hides a floating browser under application UI all the same", () => {
    const result = computeBrowserSurfaceOcclusion(
      [surface("rt_floating", rect(200, 200, 300, 300), 3)],
      [overlay("dialog", rect(0, 0, 2000, 2000))],
    );
    expect(result.get("rt_floating")).toBe("dialog");
  });

  it("orders docked surfaces beneath every floating one, floats by level", () => {
    const order = computeNativeSurfaceOrder([
      surface("rt_float_high", left, 4),
      surface("rt_docked_1", left),
      surface("rt_float_low", left, 1),
      surface("rt_docked_2", right),
    ]);
    expect(order).toEqual(["rt_docked_1", "rt_docked_2", "rt_float_low", "rt_float_high"]);
  });
});

// ---- The coordinator, against a document stand-in -------------------------

class FakeElement implements OcclusionElement {
  rect: OcclusionRect;
  attributes: Record<string, string>;
  selectors: ReadonlyArray<string>;
  parent: FakeElement | null;
  painted = true;

  constructor(init: {
    rect: OcclusionRect;
    attributes?: Record<string, string>;
    selectors?: ReadonlyArray<string>;
    parent?: FakeElement | null;
  }) {
    this.rect = init.rect;
    this.attributes = init.attributes ?? {};
    this.selectors = init.selectors ?? [];
    this.parent = init.parent ?? null;
  }

  getBoundingClientRect(): OcclusionRect {
    return this.rect;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  closest(selector: string): OcclusionElement | null {
    if (this.matches(selector)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }

  contains(other: OcclusionElement): boolean {
    for (let node = other as FakeElement | null; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  matches(selector: string): boolean {
    return selector
      .split(",")
      .map((part) => part.trim())
      .some((part) =>
        part.startsWith("[") ? part.slice(1, -1) in this.attributes : this.selectors.includes(part),
      );
  }
}

const makeHarness = () => {
  const elements: FakeElement[] = [];
  const frames: Array<() => void> = [];
  let onChange: (() => void) | null = null;
  const dispose = vi.fn();
  const dom: OcclusionDom = {
    queryAll: (selector) => elements.filter((element) => element.matches(selector)),
    isPainted: (element) => (element as FakeElement).painted,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: () => undefined,
    watch: (listener) => {
      onChange = listener;
      return { track: () => undefined, dispose };
    },
  };
  const live = new Set<string>();
  const models = { setOrder: vi.fn(), has: (runtimeTabId: string) => live.has(runtimeTabId) };
  const coordinator = new BrowserSurfaceOcclusionCoordinator({ createDom: () => dom, models });
  return {
    coordinator,
    elements,
    models,
    live,
    dispose,
    /** Something in the document changed; run the frame it schedules. */
    settle: () => {
      onChange?.();
      while (frames.length > 0) frames.shift()!();
    },
  };
};

const makeModel = (still: BrowserSurfacePlaceholder | null = null) => ({
  setOccluded: vi.fn(async (_occluded: boolean) => still),
  capturePlaceholder: vi.fn(async () => still),
  isVisible: true,
});

const slot = (at: OcclusionRect, parent: FakeElement | null = null) => new FakeElement({ rect: at, parent });
const declared = (reason: string, at: OcclusionRect) =>
  new FakeElement({ rect: at, attributes: { "data-cozea-overlay": reason } });
const floatingGroup = (level: number, at: OcclusionRect) =>
  new FakeElement({ rect: at, attributes: { "aria-level": String(level) }, selectors: [".dv-resize-container"] });

const still = (capturedAt: number): BrowserSurfacePlaceholder => ({
  dataUrl: `data:image/jpeg;base64,${capturedAt}`,
  capturedAt,
});

describe("BrowserSurfaceOcclusionCoordinator", () => {
  const page = rect(0, 0, 800, 600);

  it("takes a surface off screen while a dialog covers it, and returns the same page after", () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel();
    coordinator.register("rt_a", slot(page), model);
    settle();
    expect(model.setOccluded).not.toHaveBeenCalled();

    const dialog = declared("dialog", rect(200, 150, 400, 300));
    elements.push(dialog);
    settle();
    expect(model.setOccluded).toHaveBeenLastCalledWith(true);
    expect(coordinator.getState("rt_a")).toMatchObject({ blocked: true, reason: "dialog" });

    elements.splice(elements.indexOf(dialog), 1);
    settle();
    expect(model.setOccluded).toHaveBeenLastCalledWith(false);
    expect(coordinator.getState("rt_a").blocked).toBe(false);
  });

  it("keeps main's still for the placeholder, and shows it at once on the next cover", async () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel(still(1));
    coordinator.register("rt_a", slot(page), model);
    const menu = declared("menu", rect(10, 10, 100, 100));

    elements.push(menu);
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.getState("rt_a").placeholder).toEqual(still(1));

    elements.splice(0, 1);
    settle();
    // Kept after the overlay goes: it is still the latest picture of the page.
    expect(coordinator.getState("rt_a")).toMatchObject({ blocked: false, placeholder: still(1) });

    model.setOccluded.mockImplementation(() => new Promise(() => undefined));
    elements.push(menu);
    settle();
    // Before main has answered, the slot already has a picture rather than a blank.
    expect(coordinator.getState("rt_a")).toMatchObject({ blocked: true, placeholder: still(1) });
  });

  it("does not let an older still replace a newer one", async () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel(still(5));
    coordinator.register("rt_a", slot(page), model);
    elements.push(declared("dialog", page));
    settle();
    await Promise.resolve();
    await Promise.resolve();

    model.capturePlaceholder.mockResolvedValueOnce(still(2));
    elements.length = 0;
    settle();
    coordinator.refreshPlaceholder("rt_a");
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.getState("rt_a").placeholder).toEqual(still(5));
  });

  it("does not flash a covered surface uncovered while its tile moves", () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel();
    const unregister = coordinator.register("rt_a", slot(page), model);
    elements.push(declared("dialog", page));
    settle();

    // Dockview moves the tile: the old slot unmounts and a new one claims the
    // same surface in the same tick.
    unregister();
    coordinator.register("rt_a", slot(page), model);
    settle();

    expect(model.setOccluded).toHaveBeenCalledTimes(1);
    expect(model.setOccluded).toHaveBeenCalledWith(true);
  });

  it("uncovers a surface whose slot left for good", () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel();
    const unregister = coordinator.register("rt_a", slot(page), model);
    elements.push(declared("dialog", page));
    settle();

    unregister();
    settle();

    expect(model.setOccluded).toHaveBeenLastCalledWith(false);
  });

  it("ignores an overlay that is mounted but not painted", () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel();
    coordinator.register("rt_a", slot(page), model);
    const hidden = declared("drag", page);
    hidden.painted = false;
    elements.push(hidden);

    settle();

    expect(model.setOccluded).not.toHaveBeenCalled();
  });

  it("treats a misspelt declaration as cover of an unknown kind", () => {
    const { coordinator, elements, settle } = makeHarness();
    coordinator.register("rt_a", slot(page), makeModel());
    elements.push(declared("dialgo", page));

    settle();

    expect(coordinator.getState("rt_a")).toMatchObject({ blocked: true, reason: "unknown" });
  });

  it("follows Dockview when a floating browser is brought to front", () => {
    const { coordinator, elements, models, settle } = makeHarness();
    const groupA = floatingGroup(0, rect(100, 100, 400, 300));
    const groupB = floatingGroup(1, rect(300, 200, 400, 300));
    elements.push(groupA, groupB);
    const modelA = makeModel();
    const modelB = makeModel();
    coordinator.register("rt_a", slot(rect(100, 130, 400, 270), groupA), modelA);
    coordinator.register("rt_b", slot(rect(300, 230, 400, 270), groupB), modelB);

    settle();
    expect(coordinator.getState("rt_a").reason).toBe("floating");
    expect(coordinator.getState("rt_b").blocked).toBe(false);
    expect(models.setOrder).toHaveBeenLastCalledWith(["rt_a", "rt_b"]);

    groupA.attributes["aria-level"] = "1";
    groupB.attributes["aria-level"] = "0";
    settle();
    expect(coordinator.getState("rt_a").blocked).toBe(false);
    expect(coordinator.getState("rt_b").reason).toBe("floating");
    expect(models.setOrder).toHaveBeenLastCalledWith(["rt_b", "rt_a"]);
  });

  it("reads Dockview placement from the layout anchor, not the slot's own ancestry", () => {
    // The live structure: Dockview's always-rendered panels draw their content
    // in an overlay layer outside the group, so the slot is not inside its own
    // floating container. Only the group element is.
    const { coordinator, elements, models, settle } = makeHarness();
    const terminalFloat = floatingGroup(0, rect(100, 100, 700, 400));
    const browserFloat = floatingGroup(1, rect(300, 150, 320, 280));
    elements.push(terminalFloat, browserFloat);
    const browserGroup = new FakeElement({ rect: rect(300, 150, 320, 280), parent: browserFloat });
    const renderLayer = new FakeElement({ rect: rect(301, 180, 318, 250) });
    coordinator.register("rt_browser", slot(rect(301, 180, 318, 250), renderLayer), makeModel(), {
      resolveLayoutAnchor: () => browserGroup,
    });
    coordinator.register("rt_docked", slot(rect(0, 0, 1000, 700)), makeModel());

    settle();
    // The floating browser is Dockview's front-most group: nothing covers it.
    expect(coordinator.getState("rt_browser").blocked).toBe(false);
    expect(coordinator.getState("rt_docked").reason).toBe("floating");
    expect(models.setOrder).toHaveBeenLastCalledWith(["rt_docked", "rt_browser"]);

    // Bring the terminal forward: now it covers the floating browser.
    terminalFloat.attributes["aria-level"] = "2";
    settle();
    expect(coordinator.getState("rt_browser").reason).toBe("floating");
  });

  it("publishes native order only when it changes", () => {
    const { coordinator, models, settle } = makeHarness();
    coordinator.register("rt_a", slot(rect(0, 0, 400, 400)), makeModel());
    coordinator.register("rt_b", slot(rect(400, 0, 400, 400)), makeModel());

    settle();
    settle();
    settle();

    // Re-adding native children for an unchanged order churns the compositor.
    expect(models.setOrder).toHaveBeenCalledTimes(1);
    expect(models.setOrder).toHaveBeenCalledWith(["rt_a", "rt_b"]);
  });

  it("refreshes a still only for an uncovered surface that is on screen", () => {
    const { coordinator, elements, settle } = makeHarness();
    const model = makeModel();
    coordinator.register("rt_a", slot(page), model);
    settle();

    coordinator.refreshPlaceholder("rt_a");
    expect(model.capturePlaceholder).toHaveBeenCalledTimes(1);

    elements.push(declared("dialog", page));
    settle();
    coordinator.refreshPlaceholder("rt_a");
    // Covered, the view is off screen: there is nothing current to capture.
    expect(model.capturePlaceholder).toHaveBeenCalledTimes(1);
  });

  it("stops watching the document when no surface remains, and forgets closed surfaces", async () => {
    const { coordinator, elements, dispose, live, settle } = makeHarness();
    live.add("rt_a");
    const unregister = coordinator.register("rt_a", slot(page), makeModel(still(3)));
    elements.push(declared("dialog", page));
    settle();
    await Promise.resolve();
    await Promise.resolve();

    unregister();
    settle();
    expect(dispose).toHaveBeenCalledTimes(1);
    // The surface is still alive elsewhere, so its still is kept.
    expect(coordinator.getState("rt_a").placeholder).toEqual(still(3));

    live.delete("rt_a");
    coordinator.register("rt_b", slot(page), makeModel());
    settle();
    expect(coordinator.getState("rt_a").placeholder).toBeNull();
  });
});
