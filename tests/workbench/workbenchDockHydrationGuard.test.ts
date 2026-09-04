import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeSource = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/features/workbench/hooks/useWorkbenchDockviewRuntime.ts"),
  "utf8",
);

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * The dockview canvas is keyed by workbench scope and remounts. Each mount is a
 * new, empty dock, but the hydration guard is keyed by scope + layout reset key
 * — neither of which changes on a remount. Without clearing it, the second
 * instance skips its restore, and the reconcile pass then sees an empty grid
 * and re-adds every tile with `direction: "right"`, flattening the user's
 * splits into equal columns and persisting that.
 */
describe("dock hydration runs once per dockview instance, not once per scope", () => {
  it("clears the hydration guard when a new dock reports ready", () => {
    const ready = sourceBetween(
      runtimeSource,
      "const handleDockviewReady = useCallback(",
      "setDockviewReadyScopeKey(",
    );

    expect(ready).toContain("hydratedProjectKeyRef.current = null");
  });

  it("still refuses to rebuild a dock that already holds panels", () => {
    const hydrate = sourceBetween(
      runtimeSource,
      "const hydrateDockviewPanels = useCallback(",
      "api.clear();",
    );

    expect(hydrate).toContain("if (api.totalPanels > 0)");
    expect(hydrate).toContain("return;");
  });

  it("keeps reconcile behind hydration for the current instance", () => {
    expect(runtimeSource).toContain("hydratedProjectKeyRef.current !==");
  });
});
