import { describe, expect, it } from "vitest";

import { DEV_APP_MANIFEST_V3 } from "@shared/devAppManifestV3";
import {
  parseDevAppManifestV3,
  requestedDevAppCapabilitiesV3,
} from "@shared/devAppManifestV3Parser";

const nativeManifest = {
  manifestVersion: DEV_APP_MANIFEST_V3,
  id: "dev.cozea.tests.native",
  name: "Native test",
  version: "1.0.0",
  engines: { cozea: ">=0.3.0 <0.4.0", nativeApi: 1 },
  rendererModules: {
    main: { entry: "src/index.tsx", styles: "src/styles.css" },
  },
  permissions: {
    required: ["project.read", "project.read"],
    optional: ["project.metadata"],
  },
  contributes: {
    surfaces: [
      {
        id: "main",
        title: "Native test",
        default: true,
        renderer: {
          kind: "native-react",
          module: "main",
          component: "MainSurface",
        },
      },
    ],
  },
};

describe("DevApp manifest v3", () => {
  it("accepts a native React application and normalizes requested capabilities", () => {
    const result = parseDevAppManifestV3(JSON.stringify(nativeManifest));
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.contributes.surfaces[0]?.renderer.kind).toBe("native-react");
    expect(requestedDevAppCapabilitiesV3(result.manifest!)).toEqual({
      required: ["project.read"],
      optional: ["project.metadata"],
    });
  });

  it("accepts native and service-backed web surfaces in one application", () => {
    const hybrid = {
      ...nativeManifest,
      id: "dev.cozea.tests.hybrid",
      services: {
        api: {
          runtime: "node",
          entry: "server/dist/index.js",
          location: "device",
          state: "device",
          healthCheck: "/health",
          dev: { command: "bun run dev:server" },
        },
      },
      webApplications: {
        dashboard: { kind: "service", service: "api", path: "/dashboard" },
      },
      contributes: {
        surfaces: [
          nativeManifest.contributes.surfaces[0],
          {
            id: "dashboard",
            title: "Dashboard",
            renderer: { kind: "web-app", application: "dashboard" },
          },
        ],
      },
    };
    const result = parseDevAppManifestV3(JSON.stringify(hybrid));
    expect(result.manifest?.webApplications?.dashboard.kind).toBe("service");
    expect(result.diagnostics).toEqual([]);
  });

  it("fails closed when a surface references an unknown renderer module", () => {
    const invalid = structuredClone(nativeManifest);
    invalid.contributes.surfaces[0]!.renderer.module = "missing";
    const result = parseDevAppManifestV3(JSON.stringify(invalid));
    expect(result.manifest).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "manifest-reference-missing",
        field: "contributes.surfaces[0].renderer.module",
      }),
    );
  });

  it("rejects the retired pre-production manifest format", () => {
    const result = parseDevAppManifestV3(
      JSON.stringify({ manifestVersion: 2, name: "Old web package", view: { entry: "dist/index.html" } }),
    );
    expect(result.manifest).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "manifest-version-unsupported" }),
    );
  });

  it("rejects duplicate surface identities", () => {
    const invalid = {
      ...nativeManifest,
      contributes: {
        surfaces: [
          nativeManifest.contributes.surfaces[0],
          nativeManifest.contributes.surfaces[0],
        ],
      },
    };
    const result = parseDevAppManifestV3(JSON.stringify(invalid));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "manifest-duplicate-contribution" }),
    );
  });
});
