import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDevelopmentDevAppManifest } from "../../apps/desktop/src/features/devapps/developmentDevAppManifest";
import { resolveWorkbenchSelectionLaunchRequest } from "@/features/workbench/model/workbenchSelectionLaunch";
import { DEV_APP_PACKAGE_JSON_SCHEMA } from "../../shared/devAppPackage";

describe("native DevApp authoring contract", () => {
  it("keeps generated public schemas synchronized with the runtime contract", () => {
    for (const relativePath of [
      "packages/devapp-api/schema/cozea-devapp.schema.json",
      "apps/desktop/public/cozea-devapp.schema.json",
    ]) {
      const schema = JSON.parse(readFileSync(path.resolve(relativePath), "utf8"));
      expect(schema).toEqual(DEV_APP_PACKAGE_JSON_SCHEMA);
    }

    for (const filename of [
      "devAppCapabilities.ts",
      "devAppPackage.ts",
      "devAppViewBridge.ts",
      "devAppWorkerProtocol.ts",
    ]) {
      expect(readFileSync(path.resolve("packages/devapp-api/src/shared", filename), "utf8")).toBe(
        readFileSync(path.resolve("shared", filename), "utf8"),
      );
    }

    const packageJson = JSON.parse(
      readFileSync(path.resolve("packages/devapp-api/package.json"), "utf8"),
    );
    expect(packageJson.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(readFileSync(path.resolve("packages/devapp-api/src/index.ts"), "utf8")).not.toContain(
      "../../../shared",
    );
  });

  it("launches a device-local development ref as a cross-project preview tile", () => {
    const manifest = buildDevelopmentDevAppManifest({
      sourceId: "0123456789abcdef0123456789abcdef",
      ref: "cozea-devapp:dev/0123456789abcdef0123456789abcdef",
      projectId: "source_project",
      workspaceId: "source_workspace",
      relativePath: ".",
      name: "Local Inspector",
      description: null,
      manifest: {
        manifestVersion: 1,
        name: "Local Inspector",
        view: { entry: "dist/index.html" },
      },
    });

    const launch = resolveWorkbenchSelectionLaunchRequest({
      appId: manifest.id,
      developmentDevApp: manifest.launch.kind === "developmentDevApp" ? manifest.launch : undefined,
    });

    expect(launch).toMatchObject({
      action: "addTile",
      tileType: "devAppPreview",
      options: {
        title: "Local Inspector",
        devAppPreviewSourceProjectId: "source_project",
        devAppPreviewSourceWorkspaceId: "source_workspace",
        devAppPreviewRelativePath: ".",
      },
    });
  });
});
