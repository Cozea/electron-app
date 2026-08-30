import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewAutomationOperation, PreviewAutomationRequest } from "@cozea/contracts/t3";

import { __t3PreviewAutomationHostTestUtils } from "../../apps/desktop/src/substrate/t3PreviewAutomationHost";

const unavailableOperations = [
  "open",
  "navigate",
  "snapshot",
  "click",
  "type",
  "press",
  "scroll",
  "waitFor",
] as const satisfies readonly PreviewAutomationOperation[];

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(operation: PreviewAutomationOperation): PreviewAutomationRequest {
  return {
    requestId: `request-${operation}`,
    threadId: "thread-blackout" as PreviewAutomationRequest["threadId"],
    operation,
    input: {},
    timeoutMs: 60_000,
  };
}

describe("T3 preview blackout host", () => {
  it.each(unavailableOperations)(
    "rejects %s immediately without browser IPC or a timer",
    async (operation) => {
      const setTimeout = vi.fn(() => {
        throw new Error("Blackout operations must not wait.");
      });
      vi.stubGlobal("window", {
        setTimeout,
        electronAPI: new Proxy(
          {},
          {
            get: () => {
              throw new Error("Blackout operations must not invoke Electron IPC.");
            },
          },
        ),
      });

      await expect(
        __t3PreviewAutomationHostTestUtils.runRequest(request(operation)),
      ).rejects.toMatchObject({
        tag: "PreviewAutomationUnavailableError",
        message: expect.stringContaining("embedded browser is unavailable"),
      });
      expect(setTimeout).not.toHaveBeenCalled();
    },
  );

  it("reports an unavailable surface while preserving headless process status", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        devServer: {
          getState: vi.fn(async () => ({
            running: true,
            ready: true,
            port: 4173,
            runId: "run-1",
            phase: "running" as const,
          })),
        },
      },
    });

    const status = await __t3PreviewAutomationHostTestUtils.readDevServerStatus(
      {
        projectId: "project-1",
        laneId: "collab",
        workspaceId: "workspace-1",
        assistantTileId: "assistant-1",
      },
      null,
      true,
    );

    expect(status).toMatchObject({
      running: true,
      ready: true,
      port: 4173,
      headless: true,
      reusedProcess: true,
      surface: {
        available: false,
        visible: false,
        tabId: null,
      },
    });
  });
});
