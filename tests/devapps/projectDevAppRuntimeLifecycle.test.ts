import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeTerminal: vi.fn(),
  stopDevServerRun: vi.fn(async () => undefined),
}));

vi.mock("@/features/projects/devserver/devServerRunStore", () => ({
  buildDevServerRunKey: (workspaceId: string, laneId: string) => `${workspaceId}::${laneId}`,
  stopDevServerRun: mocks.stopDevServerRun,
}));

vi.mock("@/stores/useTerminalStore", () => ({
  useTerminalStore: {
    getState: () => ({
      actions: { removeTerminal: mocks.removeTerminal },
    }),
  },
}));

import { releaseProjectDevAppRuntimeTarget } from "@/features/projects/lib/projectDevAppRuntimeLifecycle";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Project DevApp runtime cleanup without a browser host", () => {
  it("stops the source Dev Server and releases its terminal binding", async () => {
    const ensureSession = vi.fn(async () => ({ sessionKey: "session-1" }));
    const releaseTerminal = vi.fn(async () => ({ terminalId: "terminal-1" }));
    vi.stubGlobal("window", {
      electronAPI: {
        workbenchSession: new Proxy(
          { ensureSession, releaseTerminal },
          {
            get(target, property) {
              if (property in target) return target[property as keyof typeof target];
              throw new Error(`Unexpected session API: ${String(property)}`);
            },
          },
        ),
      },
    });

    await releaseProjectDevAppRuntimeTarget(
      {
        projectId: "source-project",
        laneId: "collab",
        workspaceId: "source-workspace",
        usesProjectDevAppSource: true,
      },
      "devapp-tile",
    );

    expect(mocks.stopDevServerRun).toHaveBeenCalledWith("source-workspace::collab");
    expect(ensureSession).toHaveBeenCalledWith({
      projectId: "source-project",
      laneId: "collab",
      workspaceId: "source-workspace",
    });
    expect(releaseTerminal).toHaveBeenCalledWith({
      sessionKey: "session-1",
      projectId: "source-project",
      laneId: "collab",
      tileId: "devapp-tile",
      close: true,
    });
    expect(mocks.removeTerminal).toHaveBeenCalledWith("terminal-1");
  });

  it("does nothing for a host-workbench runtime", async () => {
    vi.stubGlobal("window", { electronAPI: {} });

    await releaseProjectDevAppRuntimeTarget(
      {
        projectId: "host-project",
        laneId: "collab",
        workspaceId: "host-workspace",
        usesProjectDevAppSource: false,
      },
      "dev-server-tile",
    );

    expect(mocks.stopDevServerRun).not.toHaveBeenCalled();
  });
});
