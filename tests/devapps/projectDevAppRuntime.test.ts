import { describe, expect, it } from "vitest";

import type { WorkbenchDevServerTile } from "@/lib/workbenchTileContract"
import { resolveProjectDevAppRuntimeTarget } from "@/features/devapps/model/projectDevAppRuntime";

function tile(overrides: Partial<WorkbenchDevServerTile> = {}): WorkbenchDevServerTile {
  return {
    id: "dev-server-1",
    type: "devServer",
    title: "Dev Server",
    createdAt: 1,
    ...overrides,
  };
}

const host = {
  projectId: "project-host",
  laneId: "lane-host",
  workspaceId: "workspace-host",
};

describe("project DevApp runtime target", () => {
  it("runs a cross-project DevApp from its source workspace and lane", () => {
    expect(
      resolveProjectDevAppRuntimeTarget(
        tile({
          devAppId: "publication-1",
          devAppProjectId: "project-source",
          devAppWorkspaceId: "workspace-source",
          devAppLaneId: "lane-source",
        }),
        host,
      ),
    ).toEqual({
      projectId: "project-source",
      laneId: "lane-source",
      workspaceId: "workspace-source",
      usesProjectDevAppSource: true,
    });
  });

  it("fails closed instead of using the host workspace when a foreign source is missing", () => {
    expect(
      resolveProjectDevAppRuntimeTarget(
        tile({
          devAppId: "publication-1",
          devAppProjectId: "project-source",
        }),
        host,
      ),
    ).toEqual({
      projectId: "project-source",
      laneId: "collab",
      workspaceId: null,
      usesProjectDevAppSource: true,
    });
  });

  it("keeps built-ins and legacy same-project DevApps on the host runtime", () => {
    expect(resolveProjectDevAppRuntimeTarget(tile(), host)).toEqual({
      ...host,
      usesProjectDevAppSource: false,
    });
    expect(
      resolveProjectDevAppRuntimeTarget(
        tile({ devAppId: "legacy", devAppProjectId: "project-host" }),
        host,
      ),
    ).toEqual({ ...host, usesProjectDevAppSource: false });
  });
});
