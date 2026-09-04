import { beforeEach, describe, expect, it } from "vitest";

import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import {
  buildWorkbenchLaneSidebarSummary,
  selectProjectLaneWorkbenches,
  selectProjectWorkbench,
  selectVisibleActiveWorkbenchTileId,
  useProjectWorkbenchStore,
} from "@/features/workbench/model/workbenchStore"

describe("workbench store selectors", () => {
  beforeEach(() => {
    useProjectWorkbenchStore.setState({ workbenches: {} });
  });

  it("keeps the visible active tile null while the empty selection tile is active", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");

    const selector = selectVisibleActiveWorkbenchTileId("project-1", "collab");

    expect(selector(useProjectWorkbenchStore.getState())).toBeNull();
    expect(selector(useProjectWorkbenchStore.getState())).toBeNull();
  });

  it("removes every lane and workspace workbench for only the deleted project", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "workspace-1");
    actions.ensureWorkbench("project-1", "feature", "workspace-1");
    actions.ensureWorkbench("project-2", "collab", "workspace-2");

    actions.removeProject("project-1");

    expect(
      Object.values(useProjectWorkbenchStore.getState().workbenches).map(
        (workbench) => workbench.projectId,
      ),
    ).toEqual(["project-2"]);
  });

  it("returns the active non-selection tile id for sidebar highlighting", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");
    const assistantTileId = actions.addTile("project-1", "collab", "assistantChat", {
      title: "Planner",
    });

    const selector = selectVisibleActiveWorkbenchTileId("project-1", "collab");

    expect(selector(useProjectWorkbenchStore.getState())).toBe(assistantTileId);
  });

  it("persists an assistant tile view independently from its bound thread", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");
    const assistantTileId = actions.addTile("project-1", "collab", "assistantChat", {
      title: "Designer",
      threadId: "thread-1",
    });

    actions.updateAssistantTile("project-1", "collab", assistantTileId, {
      viewMode: "artifacts",
    });

    const workbench = selectProjectWorkbench(
      "project-1",
      "collab",
    )(useProjectWorkbenchStore.getState());
    expect(workbench?.tiles[assistantTileId]).toMatchObject({
      type: "assistantChat",
      threadId: "thread-1",
      viewMode: "artifacts",
    });
  });

  it("does not persist an invalid active tile id", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");
    const assistantTileId = actions.addTile("project-1", "collab", "assistantChat", {
      title: "Planner",
    });

    actions.setActiveTile("project-1", "collab", "missing-tile");

    const selector = selectVisibleActiveWorkbenchTileId("project-1", "collab");
    expect(selector(useProjectWorkbenchStore.getState())).toBe(assistantTileId);
  });

  it("falls back to the most recently used workspace-scoped workbench when no workspace id is available", async () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "ws-a");
    actions.addTile("project-1", "collab", "terminal", { title: "Older shell" }, "ws-a");
    await new Promise((resolve) => setTimeout(resolve, 2));
    actions.ensureWorkbench("project-1", "collab", "ws-b");
    const latestTileId = actions.addTile(
      "project-1",
      "collab",
      "assistantChat",
      { title: "Latest agent" },
      "ws-b",
    );

    const workbench = selectProjectWorkbench(
      "project-1",
      "collab",
    )(useProjectWorkbenchStore.getState());

    expect(workbench?.workspaceId).toBe("ws-b");
    expect(workbench?.activeTileId).toBe(latestTileId);
  });

  it("uses the most recently used workbench for lane summaries when workspace ids differ", async () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "ws-a");
    actions.addTile("project-1", "collab", "terminal", { title: "Older shell" }, "ws-a");
    await new Promise((resolve) => setTimeout(resolve, 2));
    actions.ensureWorkbench("project-1", "collab", "ws-b");
    const latestTileId = actions.addTile(
      "project-1",
      "collab",
      "assistantChat",
      { title: "Latest agent" },
      "ws-b",
    );

    const byLane = selectProjectLaneWorkbenches("project-1")(useProjectWorkbenchStore.getState());

    expect(byLane.collab?.workspaceId).toBe("ws-b");
    expect(byLane.collab?.activeTileId).toBe(latestTileId);
  });

  it("builds lane summaries without leaking selection tiles into sidebar rows", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");
    const assistantTileId = actions.addTile("project-1", "collab", "assistantChat", {
      title: "Planner",
      threadId: "thread-1",
    });
    const terminalTileId = actions.addTile("project-1", "collab", "terminal", { title: "Shell" });

    const workbench =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey("project-1", "collab")
      ]!;

    expect(buildWorkbenchLaneSidebarSummary(workbench)).toEqual({
      laneId: "collab",
      activeTileId: workbench.activeTileId,
      agents: [
        {
          id: assistantTileId,
          type: "assistantChat",
          title: "Planner",
          provider: undefined,
          threadId: "thread-1",
        },
      ],
      surfaces: [
        {
          id: terminalTileId,
          type: "terminal",
          title: "Shell",
          favicon: null,
        },
      ],
    });
  });

  it("keeps a published DevApp logo in its sidebar summary", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab");
    const devAppTileId = actions.addTile("project-1", "collab", "orgDevApp", {
      title: "Customer portal",
      orgDevAppPublicationId: "publication-1",
      orgDevAppOrganizationId: "organization-1",
      orgDevAppContentHash: "content-hash-1",
      orgDevAppEntryPath: "index.html",
      orgDevAppLogoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });

    const workbench =
      useProjectWorkbenchStore.getState().workbenches[
        buildWorkbenchScopeKey("project-1", "collab")
      ]!;

    expect(buildWorkbenchLaneSidebarSummary(workbench).surfaces).toEqual([
      {
        id: devAppTileId,
        type: "orgDevApp",
        title: "Customer portal",
        favicon: null,
        devAppId: "publication-1",
        logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ]);
  });

  it("preserves browser-backed tile metadata during the rendering blackout", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "workspace-1");
    const browserTileId = actions.addTile(
      "project-1",
      "collab",
      "browser",
      {
        title: "Reference",
        url: "https://example.com/docs",
        storageScope: "workspace",
      },
      "workspace-1",
    );
    const devServerTileId = actions.addTile(
      "project-1",
      "collab",
      "devServer",
      { title: "Dev Server" },
      "workspace-1",
    );
    actions.updateRuntimePreviewTile(
      "project-1",
      "collab",
      devServerTileId,
      { previewOverrideUrl: "http://127.0.0.1:4173/account" },
      "workspace-1",
    );
    const projectDevAppTileId = actions.addTile(
      "project-1",
      "collab",
      "devServer",
      {
        title: "Project DevApp",
        devAppId: "publication-1",
        devAppReleaseId: "release-3",
        devAppReleaseVersion: 3,
        devAppCommand: "bun run dev",
        devAppPort: 5173,
      },
      "workspace-1",
    );
    const orgDevAppTileId = actions.addTile(
      "project-1",
      "collab",
      "orgDevApp",
      {
        title: "Org DevApp",
        url: `cozea-devapp://${"a".repeat(64)}.release/index.html`,
        devAppRef: "cozea-devapp:organization-1/publication-2@3",
        orgDevAppPublicationId: "publication-2",
        orgDevAppOrganizationId: "organization-1",
        orgDevAppContentHash: "a".repeat(64),
        orgDevAppEntryPath: "index.html",
        orgDevAppRuntimeKind: "service",
        storageScope: "orgDevApp",
      },
      "workspace-1",
    );

    const workbench = selectProjectWorkbench(
      "project-1",
      "collab",
      "workspace-1",
    )(useProjectWorkbenchStore.getState());

    expect(workbench?.tiles[browserTileId]).toMatchObject({
      id: browserTileId,
      title: "Reference",
      url: "https://example.com/docs",
      storageScope: "workspace",
    });
    expect(workbench?.tiles[devServerTileId]).toMatchObject({
      id: devServerTileId,
      previewOverrideUrl: "http://127.0.0.1:4173/account",
    });
    expect(workbench?.tiles[projectDevAppTileId]).toMatchObject({
      id: projectDevAppTileId,
      devAppId: "publication-1",
      devAppReleaseId: "release-3",
      devAppReleaseVersion: 3,
      devAppCommand: "bun run dev",
      devAppPort: 5173,
    });
    expect(workbench?.tiles[orgDevAppTileId]).toMatchObject({
      id: orgDevAppTileId,
      devAppRef: "cozea-devapp:organization-1/publication-2@3",
      publicationId: "publication-2",
      organizationId: "organization-1",
      contentHash: "a".repeat(64),
      entryPath: "index.html",
      runtimeKind: "service",
      storageScope: "orgDevApp",
    });
  });

  it("replaces singleton DevApp metadata and clears it when the built-in Dev Server opens", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    const firstTileId = actions.openSingletonTile(
      "project-1",
      "collab",
      "devServer",
      {
        title: "Customer portal",
        devAppId: "devapp-1",
        devAppReleaseId: "release-1",
        devAppReleaseVersion: 1,
        devAppProjectId: "source-project-1",
        devAppWorkspaceId: "source-workspace-1",
        devAppLaneId: "source-lane-1",
        devAppFramework: "vite-react",
        devAppCommand: "bun run dev",
        devAppPort: 5173,
        autoStart: true,
      },
      "workspace-1",
    );

    const reusedTileId = actions.openSingletonTile(
      "project-1",
      "collab",
      "devServer",
      {
        title: "Customer portal",
        devAppId: "devapp-1",
        devAppReleaseId: "release-2",
        devAppReleaseVersion: 2,
        devAppProjectId: "source-project-1",
        devAppWorkspaceId: "source-workspace-2",
        devAppLaneId: "source-lane-2",
        devAppFramework: "nextjs",
        devAppCommand: "bun run preview",
        devAppPort: 4173,
        autoStart: true,
      },
      "workspace-1",
    );

    expect(reusedTileId).toBe(firstTileId);
    let workbench = selectProjectWorkbench(
      "project-1",
      "collab",
      "workspace-1",
    )(useProjectWorkbenchStore.getState());
    expect(workbench?.tiles[firstTileId]).toMatchObject({
      title: "Customer portal",
      devAppId: "devapp-1",
      devAppReleaseId: "release-2",
      devAppReleaseVersion: 2,
      devAppProjectId: "source-project-1",
      devAppWorkspaceId: "source-workspace-2",
      devAppLaneId: "source-lane-2",
      devAppFramework: "nextjs",
      devAppCommand: "bun run preview",
      devAppPort: 4173,
      autoStart: true,
    });
    expect(buildWorkbenchLaneSidebarSummary(workbench!).surfaces).toEqual([
      expect.objectContaining({
        id: firstTileId,
        title: "Customer portal",
        devAppId: "devapp-1",
      }),
    ]);

    actions.openSingletonTile("project-1", "collab", "devServer", undefined, "workspace-1");
    workbench = selectProjectWorkbench(
      "project-1",
      "collab",
      "workspace-1",
    )(useProjectWorkbenchStore.getState());
    const builtInTile = workbench?.tiles[firstTileId];

    expect(builtInTile).toMatchObject({ title: "Dev Server", type: "devServer" });
    expect(builtInTile).not.toHaveProperty("devAppId");
    expect(builtInTile).not.toHaveProperty("devAppReleaseId");
    expect(builtInTile).not.toHaveProperty("devAppReleaseVersion");
    expect(builtInTile).not.toHaveProperty("devAppProjectId");
    expect(builtInTile).not.toHaveProperty("devAppWorkspaceId");
    expect(builtInTile).not.toHaveProperty("devAppLaneId");
    expect(builtInTile).not.toHaveProperty("devAppFramework");
    expect(builtInTile).not.toHaveProperty("devAppCommand");
    expect(builtInTile).not.toHaveProperty("devAppPort");
    expect(builtInTile).not.toHaveProperty("autoStart");
  });

  it("clears a consumed auto-start flag so a remount cannot restart a stopped server", () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "workspace-1");
    const tileId = actions.addTile(
      "project-1",
      "collab",
      "devServer",
      {
        devAppId: "local-devapp-publication:one",
        devAppCommand: "bun run dev",
        autoStart: true,
      },
      "workspace-1",
    );

    const readTile = () =>
      selectProjectWorkbench(
        "project-1",
        "collab",
        "workspace-1",
      )(useProjectWorkbenchStore.getState())?.tiles[tileId];

    expect(readTile()).toMatchObject({ autoStart: true });

    actions.updateRuntimePreviewTile(
      "project-1",
      "collab",
      tileId,
      { autoStart: false },
      "workspace-1",
    );

    expect(readTile()).not.toHaveProperty("autoStart");
  });
});
