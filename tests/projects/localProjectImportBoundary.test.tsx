import { renderToStaticMarkup } from "react-dom/server";
import { ConvexReactClient } from "convex/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudClientContext } from "@/lib/cloudQueries";
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport";
import { localOutcome } from "./localProjectFixtures";

const spies = vi.hoisted(() => ({ navigate: vi.fn(), ensure: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useNavigateTo: () => spies.navigate }));
vi.mock("@/lib/appToast", () => ({ appToast: { error: spies.error } }));
vi.mock("@/lib/workbenchStore", () => ({
  useProjectWorkbenchStore: { getState: () => ({ actions: { ensureWorkbench: spies.ensure } }) },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(client: ConvexReactClient) {
  let hook: ReturnType<typeof useLocalProjectImport> | undefined;
  function Screen() {
    hook = useLocalProjectImport();
    return <p>Open folder</p>;
  }
  renderToStaticMarkup(
    <CloudClientContext value={client}>
      <Screen />
    </CloudClientContext>,
  );
  return hook!;
}

describe("local folder import cloud boundary", () => {
  it("reuses the returned local identity and workspace without probing or cleaning cloud state", async () => {
    const open = vi.fn(async () => ({
      success: true as const,
      value: { ...localOutcome, reusedExisting: true },
    }));
    const inspectFolder = vi.fn(async () => ({
      success: true,
      inspection: { status: "missing", diagnostics: [] },
    }));
    const forget = vi.fn(() => {
      throw new Error("must preserve binding");
    });
    vi.stubGlobal("window", {
      electronAPI: {
        workspace: { projects: { open }, forget },
        devAppAuthoring: { inspectFolder },
      },
    });
    const client = new ConvexReactClient("http://127.0.0.1:3210");
    const query = vi.spyOn(client, "query"),
      mutation = vi.spyOn(client, "mutation"),
      watch = vi.spyOn(client, "watchQuery");
    const hook = mount(client);
    expect(await hook.importPickedLocalFolder("/tmp/source", "Chosen name")).toBe("imported");
    expect(open).toHaveBeenCalledWith({
      operationId: expect.any(String),
      name: "Chosen name",
      slug: "chosen-name",
      folderPath: "/tmp/source",
    });
    expect(spies.ensure).toHaveBeenCalledWith(
      localOutcome.project.projectId,
      "collab",
      localOutcome.workspace.workspaceId,
    );
    expect(spies.navigate.mock.calls[0][0]).toEqual({
      to: "workbench",
      projectId: localOutcome.project.projectId,
    });
    expect(spies.navigate.mock.calls[0][1].state).toMatchObject({
      projectId: localOutcome.project.projectId,
      preferredWorkspaceId: localOutcome.workspace.workspaceId,
      workbenchIntent: { laneId: "collab", ensureTile: "assistantChat" },
    });
    expect(forget).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    await client.close();
  });

  it("rejects an invalid DevApp manifest before changing the local catalog", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", {
      electronAPI: {
        workspace: { projects: { open } },
        devAppAuthoring: {
          inspectFolder: vi.fn(async () => ({
            success: true,
            inspection: { status: "invalid", diagnostics: [{ message: "Invalid manifest" }] },
          })),
        },
      },
    });
    const client = new ConvexReactClient("http://127.0.0.1:3210");
    expect(
      await mount(client).importPickedLocalFolder("/tmp/source", "Source", { requireDevApp: true }),
    ).toBe("error");
    expect(open).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Invalid manifest" }),
    );
    await client.close();
  });
});
