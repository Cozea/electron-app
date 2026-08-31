import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runtimePreviewBrowserSurfaceGeneration,
  runtimePreviewBrowserSurfaceKind,
  runtimePreviewBrowserSurfaceTabId,
} from "@/features/projects/browser/runtimePreviewBrowserSurface";
import type { WorkbenchDevServerTile } from "@/stores/useProjectWorkbenchStore";

function devServerTile(overrides: Partial<WorkbenchDevServerTile> = {}): WorkbenchDevServerTile {
  return {
    id: "runtime-preview",
    type: "devServer",
    title: "Dev Server",
    createdAt: 1,
    ...overrides,
  };
}

const identity = {
  projectId: "project",
  laneId: "collab",
  workspaceId: "workspace",
  workbenchSessionKey: "session",
};

describe("T3 runtime preview browser surfaces", () => {
  it("keeps ordinary Dev Servers stable and identifies compatibility Project DevApps by release", () => {
    const devServer = devServerTile();
    const firstRelease = devServerTile({
      devAppId: "publication",
      devAppReleaseId: "release-1",
    });
    const secondRelease = { ...firstRelease, devAppReleaseId: "release-2" };

    expect(runtimePreviewBrowserSurfaceKind(devServer)).toBe("devServer");
    expect(runtimePreviewBrowserSurfaceGeneration(devServer)).toBeNull();
    expect(runtimePreviewBrowserSurfaceKind(firstRelease)).toBe("projectDevApp");
    expect(runtimePreviewBrowserSurfaceGeneration(firstRelease)).toBe("release-1");
    expect(runtimePreviewBrowserSurfaceTabId({ ...identity, tile: firstRelease })).not.toBe(
      runtimePreviewBrowserSurfaceTabId({ ...identity, tile: secondRelease }),
    );
    expect(runtimePreviewBrowserSurfaceTabId({ ...identity, tile: devServer })).toBe(
      runtimePreviewBrowserSurfaceTabId({ ...identity, tile: devServer }),
    );
  });

  it("mounts the shared host with ephemeral storage while process health remains separate", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "apps/desktop/src/features/projects/components/workbench/WorkbenchDevServerTile.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("<BrowserSurfaceSlot");
    expect(source).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
    expect(source).toContain('storageScope: "ephemeral"');
    expect(source).toContain('devServer.status === "ready"');
    expect(source).toContain("The Dev Server process is still managed independently.");
    expect(source).not.toContain("<BrowserUnavailableSurface");
  });

  it("serializes release replacement and clears the final ephemeral partition", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/electron/services/T3BrowserSurfaceService.ts"),
      "utf8",
    );

    expect(source).toContain("runPartitionOperation(partition");
    expect(source).toContain("ephemeralSession.clearStorageData");
    expect(source).toContain("ephemeralSession.clearCache()");
    expect(source).toContain("this.sessionsByPartition.delete(partition)");
  });

  it("commits every address submission through T3 and supports live reload and external HTTP", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "apps/desktop/src/features/projects/components/workbench/WorkbenchDockPanels.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("resolveBrowserAddressSubmission(draftUrl)");
    expect(source).toContain("preview.navigate(runtimeTabId, normalized)");
    expect(source).toContain("preview.refresh(runtimeTabId)");
    expect(source).toContain("isExternallyOpenableBrowserUrl(committedUrl)");
    expect(source).toContain("window.electronAPI.shell.openExternal(committedUrl)");
  });
});
