import { afterEach, describe, expect, it, vi } from "vitest";

import { publishNativeDevAppProgrammatically } from "../../apps/desktop/src/features/devapps/devAppAuthoringPublish";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow;
  else Reflect.deleteProperty(globalThis, "window");
});

function installWindow() {
  const buildAndUpload = vi.fn().mockResolvedValue({
    success: true,
    storageId: "storage_a",
    contentHash: "a".repeat(64),
    runtimeKind: "static",
    framework: "native",
    entryPath: "dist/index.html",
    manifestVersion: 1,
  });
  globalThis.window = {
    electronAPI: {
      devAppAuthoring: {
        inspectWorkspace: vi.fn().mockResolvedValue({
          success: true,
          inspection: {
            status: "valid",
            diagnostics: [],
            source: {
              manifest: {
                manifestVersion: 1,
                name: "Programmatic App",
                description: "Published without a dialog.",
                view: { entry: "dist/index.html" },
              },
            },
          },
        }),
      },
      orgDevApp: {
        buildAndUpload,
        cancelBuild: vi.fn().mockResolvedValue({ cancelled: false }),
      },
    },
  } as unknown as Window & typeof globalThis;
  return { buildAndUpload };
}

describe("programmatic native DevApp publishing", () => {
  it("publishes an existing publication without opening a dialog", async () => {
    const { buildAndUpload } = installWindow();
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({
        reservationId: "reservation_a",
        uploadUrl: "https://upload.invalid",
      })
      .mockResolvedValueOnce({ registered: true })
      .mockResolvedValueOnce({});
    const convex = {
      query: vi.fn().mockResolvedValue({ _id: "publication_a" }),
      mutation,
    };

    await publishNativeDevAppProgrammatically({
      convex: convex as never,
      projectId: "project_a" as never,
      workspaceId: "workspace_a",
    });

    expect(buildAndUpload).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledTimes(3);
  });

  it("requires a logo for the first publication before building", async () => {
    const { buildAndUpload } = installWindow();
    const convex = {
      query: vi.fn().mockResolvedValue(null),
      mutation: vi.fn(),
    };

    await expect(
      publishNativeDevAppProgrammatically({
        convex: convex as never,
        projectId: "project_a" as never,
        workspaceId: "workspace_a",
      }),
    ).rejects.toThrow(/first publication requires/i);
    expect(buildAndUpload).not.toHaveBeenCalled();
  });
});
