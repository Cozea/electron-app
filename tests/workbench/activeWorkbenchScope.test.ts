import { describe, expect, it } from "vitest";
import { resolveActiveWorkbenchScope } from "@/contexts/project/useActiveWorkbenchScope";

const folder = {
  projectId: "lpj_folder",
  workspaceId: "lws_folder",
  laneState: null,
  activeLane: null,
  workspaceGitRootPath: null,
  catalogLane: {
    projectId: "lpj_folder",
    workspaceId: "lws_folder",
    laneId: "collab",
    gitRootPath: null,
  },
};

describe("catalog-backed non-Git workbench scope", () => {
  it("opens the recorded folder lane without waiting for a Git branch that cannot exist", () => {
    expect(resolveActiveWorkbenchScope(folder)).toMatchObject({
      projectId: "lpj_folder",
      workspaceId: "lws_folder",
      laneId: "collab",
      laneResolutionPending: false,
    });
  });

  it("holds a Git workspace while its actual branch is unresolved", () => {
    expect(
      resolveActiveWorkbenchScope({ ...folder, workspaceGitRootPath: "/repo" })
        .laneResolutionPending,
    ).toBe(true);
    expect(
      resolveActiveWorkbenchScope({
        ...folder,
        catalogLane: { ...folder.catalogLane, gitRootPath: "/repo" },
      }).laneResolutionPending,
    ).toBe(true);
  });

  it("rejects a missing or stale catalog lane during project/workspace switching", () => {
    expect(
      resolveActiveWorkbenchScope({ ...folder, workspaceGitRootPath: undefined })
        .laneResolutionPending,
    ).toBe(true);
    expect(
      resolveActiveWorkbenchScope({ ...folder, catalogLane: null }).laneResolutionPending,
    ).toBe(true);
    expect(
      resolveActiveWorkbenchScope({
        ...folder,
        catalogLane: { ...folder.catalogLane, projectId: "lpj_previous" },
      }).laneResolutionPending,
    ).toBe(true);
    expect(
      resolveActiveWorkbenchScope({
        ...folder,
        catalogLane: { ...folder.catalogLane, workspaceId: "lws_previous" },
      }).laneResolutionPending,
    ).toBe(true);
  });
});
