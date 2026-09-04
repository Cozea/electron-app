import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.has(key) ? this.values.get(key)! : null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function layout(orientation: "VERTICAL" | "HORIZONTAL") {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          { type: "leaf", data: { views: ["a"], activeView: "a", id: "1" }, size: 300 },
          { type: "leaf", data: { views: ["b"], activeView: "b", id: "2" }, size: 300 },
        ],
      },
      width: 800,
      height: 600,
      orientation,
    },
    panels: { a: { id: "a" }, b: { id: "b" } },
  } as never;
}

let storage: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage, addEventListener: vi.fn() };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function loadPersistence() {
  return await import("../../apps/desktop/src/features/workbench/model/workbenchLayoutPersistence");
}

/**
 * A layout snapshot is taken, then queued behind an animation frame and a
 * 400ms debounce before it is written. The workbench scope settles from a
 * transient boot value to the real one during startup, so reading the scope at
 * write time filed the boot workbench's layout under the settled workbench's
 * key — replacing a saved vertical split with whatever the transient dock held.
 */
describe("a queued layout write belongs to the scope it was captured in", () => {
  it("rejects a snapshot whose scope settled to a different workbench", async () => {
    const { isWorkbenchLayoutWriteStillValid } = await loadPersistence();

    const captured = { scopeKey: "proj::collab", layoutResetKey: 7 };
    expect(
      isWorkbenchLayoutWriteStillValid(captured, {
        scopeKey: "proj::collab::lws_settled::v1",
        layoutResetKey: 7,
      }),
    ).toBe(false);
  });

  it("rejects a snapshot taken before the layout was reset", async () => {
    const { isWorkbenchLayoutWriteStillValid } = await loadPersistence();

    expect(
      isWorkbenchLayoutWriteStillValid(
        { scopeKey: "proj::collab", layoutResetKey: 7 },
        { scopeKey: "proj::collab", layoutResetKey: 8 },
      ),
    ).toBe(false);
  });

  it("accepts a snapshot the workbench is still showing", async () => {
    const { isWorkbenchLayoutWriteStillValid } = await loadPersistence();

    expect(
      isWorkbenchLayoutWriteStillValid(
        { scopeKey: "proj::collab", layoutResetKey: 7 },
        { scopeKey: "proj::collab", layoutResetKey: 7 },
      ),
    ).toBe(true);
  });

  it("never treats a missing scope as a match", async () => {
    const { isWorkbenchLayoutWriteStillValid } = await loadPersistence();

    expect(
      isWorkbenchLayoutWriteStillValid(
        { scopeKey: "", layoutResetKey: 7 },
        { scopeKey: null, layoutResetKey: 7 },
      ),
    ).toBe(false);
  });

  it("files the boot workbench's layout under its own key, not the settled one", async () => {
    const persistence = await loadPersistence();
    const transientScope = "proj::collab";
    const settledScope = "proj::collab::lws_settled::v1";
    persistence.ensureWorkbenchLayoutPersistenceReady();
    persistence.writePersistedWorkbenchLayout(settledScope, 7, layout("VERTICAL"));

    // Queued while the scope was still transient, flushed after it settled.
    // The write carries its own identity, so it cannot land on the settled key.
    const pending = {
      scopeKey: transientScope,
      layoutResetKey: 7,
      layout: layout("HORIZONTAL"),
    };
    persistence.writePersistedWorkbenchLayout(
      pending.scopeKey,
      pending.layoutResetKey,
      pending.layout,
    );

    const settled = persistence.peekPersistedWorkbenchLayout(settledScope, 7) as unknown as {
      grid: { orientation: string };
    };
    const transient = persistence.peekPersistedWorkbenchLayout(transientScope, 7) as unknown as {
      grid: { orientation: string };
    };

    expect(settled?.grid.orientation).toBe("VERTICAL");
    expect(transient?.grid.orientation).toBe("HORIZONTAL");
  });
});
