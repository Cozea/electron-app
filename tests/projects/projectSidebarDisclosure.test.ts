import { describe, expect, it } from "vitest";

import { hasProjectSidebarChildren } from "@/features/projects/ui/sidebar/projectSidebarShared";
import type { WorkbenchLaneSidebarSummary } from "@/lib/workbenchStore";

function createSummary(
  overrides: Partial<WorkbenchLaneSidebarSummary> = {},
): WorkbenchLaneSidebarSummary {
  return {
    laneId: "main",
    activeTileId: null,
    agents: [],
    surfaces: [],
    ...overrides,
  };
}

describe("project sidebar disclosure", () => {
  it("does not offer disclosure when a project has no sidebar tiles", () => {
    expect(hasProjectSidebarChildren(null, false)).toBe(false);
    expect(hasProjectSidebarChildren(createSummary(), false)).toBe(false);
  });

  it("offers disclosure for agent tiles", () => {
    expect(
      hasProjectSidebarChildren(
        createSummary({
          agents: [
            {
              id: "agent-1",
              type: "assistantChat",
              title: "Agent",
              threadId: null,
            },
          ],
        }),
        false,
      ),
    ).toBe(true);
  });

  it("offers disclosure for surface tiles", () => {
    expect(
      hasProjectSidebarChildren(
        createSummary({
          surfaces: [
            {
              id: "terminal-1",
              type: "terminal",
              title: "Terminal",
            },
          ],
        }),
        false,
      ),
    ).toBe(true);
  });

  it("offers disclosure for a running headless Dev Server", () => {
    expect(hasProjectSidebarChildren(createSummary(), true)).toBe(true);
  });
});
