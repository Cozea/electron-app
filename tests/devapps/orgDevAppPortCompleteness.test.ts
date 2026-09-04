import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDockComponentName,
  getPanelConstraintsForTile,
  getPanelRendererForTile,
  resolveTabGroupPreset,
} from "@/features/projects/lib/workbenchDockview";

const tileSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "apps/desktop/src/features/workbench/WorkbenchOrgDevAppTile.tsx",
  ),
  "utf8",
);

describe("Org DevApp T3 surface completeness", () => {
  it("keeps the dedicated always-mounted dock component", () => {
    expect(getDockComponentName("orgDevApp")).toBe("orgDevApp");
    expect(getPanelRendererForTile("orgDevApp")).toBe("always");
    expect(getPanelConstraintsForTile("orgDevApp")).toEqual({
      minimumWidth: 320,
      minimumHeight: 220,
    });
    expect(resolveTabGroupPreset("orgDevApp")).toEqual({
      label: "Preview",
      color: "preview",
    });
  });

  it("keeps an assistant mounted while a background Dev Server tab is active", () => {
    expect(getPanelRendererForTile("assistantChat")).toBe("always");
  });

  it("keeps artifact, trust, environment, lease, logs, and restart flows independent of rendering", () => {
    for (const operation of [
      "prepareArtifact",
      "getRuntimeEnvironment",
      "setRuntimeEnvironment",
      "getRuntimeTrust",
      "approveRuntime",
      "startRuntime",
      "releaseRuntime",
      "getRuntimeState",
      "stopRuntime",
    ]) {
      expect(tileSource).toMatch(new RegExp(`orgDevApp\\s*\\.\\s*${operation}`));
    }
    expect(tileSource).toContain("<BrowserSurfaceSlot");
    expect(tileSource).toContain("useHostedBrowserSurface(browserSurfaceDescriptor)");
    expect(tileSource).toContain('storageScope: "orgDevApp"');
    expect(tileSource).toContain('kind: "orgDevApp"');
    expect(tileSource).toContain("contentHash: artifact.contentHash");
    expect(tileSource).toContain("runtimeGeneration");
    expect(tileSource).toContain("setPreparedOrigin(null)");
    expect(tileSource).not.toContain("<BrowserUnavailableSurface");
    expect(tileSource).toContain("runtimeState?.logs");
    expect(tileSource).not.toContain("shell.openExternal");
    expect(tileSource).not.toContain("electronAPI.shell.openExternal");
  });
});
