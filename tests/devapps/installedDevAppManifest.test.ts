import { describe, expect, it } from "vitest";

import { buildInstalledDevAppManifests } from "@/features/devapps/installedDevAppManifest";
import { resolveWorkbenchSelectionLaunchRequest } from "@/features/workbench/model/workbenchSelectionLaunch";
import type { DevAppInstallationV3 } from "@shared/devAppInstallationV3";

const installation: DevAppInstallationV3 = {
  installationId: "0123456789abcdef0123456789abcdef",
  appId: "com.example.counter",
  name: "Counter",
  description: "A native counter",
  source: { kind: "development", workspaceId: "workspace-1", relativePath: "devapps/counter" },
  installedAt: 1,
  updatedAt: 1,
  activeReleaseId: "a".repeat(64),
  releases: [
    {
      releaseId: "a".repeat(64),
      appVersion: "1.0.0",
      installedAt: 1,
      sizeBytes: 10,
      manifest: {
        releaseManifestVersion: 1,
        appId: "com.example.counter",
        appVersion: "1.0.0",
        nativeApi: 1,
        rendererModules: {
          main: { entry: "renderer/main.mjs", contentHash: "b".repeat(64) },
        },
        permissions: { required: [], optional: [] },
        contributes: {
          surfaces: [
            {
              id: "main",
              title: "Counter",
              default: true,
              renderer: { kind: "native-react", module: "main", component: "CounterTile" },
            },
          ],
        },
      },
    },
  ],
};

describe("installed DevApp launcher adapter", () => {
  it("turns installed surface contributions into generic workbench launch requests", () => {
    const [manifest] = buildInstalledDevAppManifests([installation]);
    expect(manifest?.launch.kind).toBe("installedDevApp");
    const resolved = resolveWorkbenchSelectionLaunchRequest({
      appId: manifest!.id,
      installedDevApp: manifest!.launch.kind === "installedDevApp" ? manifest!.launch : undefined,
    });
    expect(resolved).toEqual({
      action: "addTile",
      tileType: "devApp",
      options: {
        title: "Counter",
        devAppInstallationId: installation.installationId,
        installedDevAppId: installation.appId,
        installedDevAppVersion: "1.0.0",
        installedDevAppReleaseId: installation.activeReleaseId,
        installedDevAppSurfaceId: "main",
      },
    });
  });
});
