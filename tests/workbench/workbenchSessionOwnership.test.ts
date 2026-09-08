import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/cozea-workbench-session-test",
    once: vi.fn(),
  },
  BrowserWindow: class {},
}));

import {
  __workbenchSessionTestUtils,
  WorkbenchSessionManager,
} from "../../apps/desktop/electron/services/WorkbenchSessionManager";

describe("workbench session ownership", () => {
  it("builds session keys from opaque workspace ids without path hashing", () => {
    expect(
      __workbenchSessionTestUtils.buildSessionKey("project-a", "collab", " workspace-123 "),
    ).toBe("project-a::collab::workspace-123::v1");
  });

  it("isolates the same workspace path across binding revisions", () => {
    const first = __workbenchSessionTestUtils.buildSessionKey(
      "project-a", "collab", "workspace-123", 1,
    );
    const rebound = __workbenchSessionTestUtils.buildSessionKey(
      "project-a", "collab", "workspace-123", 2,
    );

    expect(rebound).not.toBe(first);
    expect(rebound).toBe("project-a::collab::workspace-123::v2");
  });

  it("resolves omitted revisions to the newest live workspace binding", () => {
    const makeRecord = (workspaceRevision: number, lastFocusedAt: number) => ({
      projectId: "project-a",
      laneId: "collab",
      workspaceId: "workspace-123",
      workspaceRevision,
      lifecycle: "backgroundWarm" as const,
      pinned: false,
      openedAt: lastFocusedAt,
      lastFocusedAt,
      lastBackgroundedAt: lastFocusedAt,
      terminalBindings: {},
      nativePreviewLocator: null,
    });
    const sessions = new Map([
      ["project-a::collab::workspace-123::v1", makeRecord(1, 200)],
      ["project-a::collab::workspace-123::v2", makeRecord(2, 100)],
    ]);

    expect(
      __workbenchSessionTestUtils.findCurrentSessionRevision(sessions.entries(), {
        projectId: "project-a",
        laneId: "collab",
        workspaceId: "workspace-123",
      }),
    ).toBe(2);
  });

  it("repairs persisted records into canonical opaque workspace keys", () => {
    const canonicalKey = __workbenchSessionTestUtils.buildSessionKey(
      "repair-project",
      "collab",
      "workspace-a",
    );
    const staleKey = "repair-project::collab::old-path-derived-key";
    const state = {
      version: 1 as const,
      sessions: {
        [staleKey]: {
          projectId: "repair-project",
          laneId: "collab",
          workspaceId: " workspace-a ",
          lifecycle: "backgroundFrozen" as const,
          pinned: false,
          openedAt: 100,
          lastFocusedAt: 100,
          lastBackgroundedAt: 100,
        },
      },
    };

    const changed = __workbenchSessionTestUtils.repairPersistedSessionState(state);

    expect(changed).toBe(true);
    expect(Object.keys(state.sessions)).toEqual([canonicalKey]);
    expect(state.sessions[canonicalKey]?.workspaceId).toBe("workspace-a");
    expect(state.sessions[canonicalKey]?.workspaceRevision).toBe(1);
  });

  it("collapses duplicate persisted workspace records by latest focus time", () => {
    const canonicalKey = __workbenchSessionTestUtils.buildSessionKey(
      "repair-project",
      "collab",
      "workspace-a",
    );
    const state = {
      version: 1 as const,
      sessions: {
        [canonicalKey]: {
          projectId: "repair-project",
          laneId: "collab",
          workspaceId: "workspace-a",
          lifecycle: "backgroundFrozen" as const,
          pinned: false,
          openedAt: 100,
          lastFocusedAt: 100,
          lastBackgroundedAt: 100,
        },
        "repair-project::collab::duplicate": {
          projectId: "repair-project",
          laneId: "collab",
          workspaceId: " workspace-a ",
          lifecycle: "backgroundFrozen" as const,
          pinned: false,
          openedAt: 200,
          lastFocusedAt: 200,
          lastBackgroundedAt: 200,
        },
      },
    };

    const changed = __workbenchSessionTestUtils.repairPersistedSessionState(state);

    expect(changed).toBe(true);
    expect(Object.keys(state.sessions)).toEqual([canonicalKey]);
    expect(state.sessions[canonicalKey]?.lastFocusedAt).toBe(200);
  });

  it("selects every duplicate session for project-lane close calls", () => {
    const sessions = new Map([
      ["target-a", { projectId: "close-project", laneId: "collab" }],
      ["target-b", { projectId: "close-project", laneId: "collab" }],
      ["other-lane", { projectId: "close-project", laneId: "branch:main" }],
      ["other-project", { projectId: "other-project", laneId: "collab" }],
    ]);

    expect(
      __workbenchSessionTestUtils.findSessionKeysByProjectLane(sessions.entries(), {
        projectId: "close-project",
        laneId: "collab",
      }),
    ).toEqual(["target-a", "target-b"]);
  });

  it("waits for persisted registry hydration before closing superseded revisions", async () => {
    let finishHydration: () => void = () => {};
    const manager = Object.create(WorkbenchSessionManager.prototype) as any;
    manager.registryHydration = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    manager.sessions = new Map();
    manager.closeSessionByKey = vi.fn(async () => true);
    manager.persist = vi.fn();

    const closing = manager.closeSupersededBindingSessions({
      projectId: "project-a",
      laneId: "collab",
      workspaceId: "workspace-123",
      workspaceRevision: 2,
    });
    manager.sessions.set("project-a::collab::workspace-123::v1", {
      projectId: "project-a",
      laneId: "collab",
      workspaceId: "workspace-123",
      workspaceRevision: 1,
    });
    await Promise.resolve();
    expect(manager.closeSessionByKey).not.toHaveBeenCalled();

    finishHydration();
    await expect(closing).resolves.toEqual(["project-a::collab::workspace-123::v1"]);
    expect(manager.closeSessionByKey).toHaveBeenCalledWith("project-a::collab::workspace-123::v1");
  });
});
