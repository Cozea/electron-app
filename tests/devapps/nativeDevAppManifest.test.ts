import { describe, expect, it } from "vitest"

import {
  NATIVE_DEV_APP_MANIFEST_VERSION,
  defaultNativeDevAppSurface,
  parseNativeDevAppManifest,
  requestedNativeDevAppGrant,
} from "../../shared/nativeDevAppManifest"

function nativeManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: NATIVE_DEV_APP_MANIFEST_VERSION,
    id: "com.example.inspector",
    name: "Inspector",
    version: "1.0.0",
    engines: { cozea: ">=0.3.0 <0.4.0", nativeApi: 1 },
    rendererModules: {
      main: {
        entry: "src/renderer.tsx",
        output: "dist/renderer.mjs",
        styles: { entry: "src/styles.css", output: "dist/renderer.css" },
      },
    },
    contributes: {
      surfaces: [
        {
          id: "main",
          title: "Inspector",
          default: true,
          renderer: { kind: "native-react", module: "main", component: "MainSurface" },
        },
      ],
    },
    ...overrides,
  }
}

describe("native DevApp manifest v3", () => {
  it("accepts a native React surface and resolves its default contribution", () => {
    const parsed = parseNativeDevAppManifest(nativeManifest())
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.manifest).not.toBeNull()
    expect(defaultNativeDevAppSurface(parsed.manifest!)).toMatchObject({
      id: "main",
      renderer: { kind: "native-react", module: "main", component: "MainSurface" },
    })
  })

  it("supports a hybrid package with native and web-backed surfaces", () => {
    const parsed = parseNativeDevAppManifest(
      nativeManifest({
        webApplications: {
          dashboard: {
            entry: "web/dist/index.html",
            dev: { url: "http://127.0.0.1:5173" },
          },
        },
        contributes: {
          surfaces: [
            {
              id: "overview",
              title: "Overview",
              default: true,
              renderer: { kind: "native-react", module: "main", component: "MainSurface" },
            },
            {
              id: "dashboard",
              title: "Dashboard",
              renderer: { kind: "web-app", application: "dashboard" },
            },
          ],
        },
      }),
    )
    expect(parsed.manifest?.contributes.surfaces).toHaveLength(2)
    expect(parsed.diagnostics).toEqual([])
  })

  it("normalizes extension permissions into the approval grant", () => {
    const parsed = parseNativeDevAppManifest(
      nativeManifest({
        extension: {
          entry: "src/extension.ts",
          output: "dist/extension.mjs",
          protocolVersion: 1,
          capabilities: ["project.read", "project.metadata", "project.read"],
          tools: [],
          agentInvocable: true,
        },
      }),
    )
    expect(requestedNativeDevAppGrant(parsed.manifest!)).toEqual({
      capabilities: ["project.metadata", "project.read"],
      agentInvocable: true,
    })
  })

  it("rejects old web-only manifests instead of silently adapting them", () => {
    const parsed = parseNativeDevAppManifest({
      manifestVersion: 2,
      name: "Legacy",
      view: { entry: "dist/index.html" },
    })
    expect(parsed.manifest).toBeNull()
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "manifest-version-unsupported" }),
    )
  })

  it("rejects missing renderer references and path traversal", () => {
    const parsed = parseNativeDevAppManifest(
      nativeManifest({
        rendererModules: {
          main: {
            entry: "../renderer.tsx",
            output: "dist/renderer.mjs",
          },
        },
        contributes: {
          surfaces: [
            {
              id: "main",
              title: "Inspector",
              renderer: { kind: "native-react", module: "missing", component: "main" },
            },
          ],
        },
      }),
    )
    expect(parsed.manifest).toBeNull()
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["manifest-path-escapes-package", "manifest-reference-missing"]),
    )
  })
})
