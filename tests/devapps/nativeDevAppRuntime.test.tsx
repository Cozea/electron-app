import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  defineNativeDevApp,
  useDevAppContext,
  type NativeDevAppHostClient,
} from "../../packages/devapp-api/src/native"
import { NativeDevAppSurfaceFrame } from "@/features/devapps/native-runtime/NativeDevAppSurfaceHost"
import {
  activateNativeDevAppDefinition,
  loadNativeDevAppDefinition,
} from "@/features/devapps/native-runtime/nativeDevAppModuleLoader"
import {
  buildNativeDevAppModuleUrl,
  parseNativeDevAppModuleUrl,
} from "@shared/nativeDevAppModuleProtocol"
import {
  NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY,
  nativeDevAppRuntimeProxySource,
  nativeDevAppRuntimeVirtualId,
} from "@shared/nativeDevAppRuntime"

const moduleUrl = buildNativeDevAppModuleUrl({
  registrationId: "0123456789abcdef0123456789abcdef",
  generation: "build-1",
  assetPath: "renderer/main.mjs",
})

function hostClient(): NativeDevAppHostClient {
  return {
    identity: {
      appId: "dev.cozea.tests.runtime",
      version: "1.0.0",
      installationId: "installation-1",
    },
    surface: {
      surfaceId: "main",
      instanceId: "instance-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      laneId: "lane-1",
    },
    locale: "en",
    commands: { execute: vi.fn() },
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    theme: {
      colorScheme: "dark",
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    request: vi.fn(),
  }
}

describe("native DevApp host runtime", () => {
  it("round-trips confined module URLs", () => {
    expect(parseNativeDevAppModuleUrl(moduleUrl)).toEqual({
      registrationId: "0123456789abcdef0123456789abcdef",
      generation: "build-1",
      assetPath: "renderer/main.mjs",
    })
    expect(parseNativeDevAppModuleUrl("https://example.com/devapp.mjs")).toBeNull()
    expect(
      parseNativeDevAppModuleUrl(
        "cozea-native-devapp://0123456789abcdef0123456789abcdef/%2e%2e/private.mjs?generation=1",
      ),
    ).toBeNull()
  })

  it("generates tiny runtime proxies instead of bundling React", () => {
    const virtualId = nativeDevAppRuntimeVirtualId("react")
    const source = nativeDevAppRuntimeProxySource(virtualId!)
    expect(source).toContain(NATIVE_DEV_APP_RUNTIME_BRIDGE_KEY)
    expect(source).toContain("export const useState = api.useState")
    expect(source).not.toContain("function useState")
    expect(nativeDevAppRuntimeVirtualId("@cozea/devapp-api/ui")).toContain("native-runtime:ui")
  })

  it("loads and validates a native module using the trusted module address", async () => {
    const definition = defineNativeDevApp({
      components: { Main: () => null },
    })
    await expect(
      loadNativeDevAppDefinition({
        moduleUrl,
        importer: vi.fn(async () => ({ default: definition })),
      }),
    ).resolves.toBe(definition)
    await expect(
      loadNativeDevAppDefinition({
        moduleUrl: "file:///tmp/devapp.mjs",
        importer: vi.fn(),
      }),
    ).rejects.toThrow("invalid or untrusted")
  })

  it("provides the exact host context to a native surface", () => {
    const host = hostClient()
    function Surface() {
      const context = useDevAppContext()
      return <span>{`${context.identity.appId}:${context.surface.instanceId}`}</span>
    }
    const markup = renderToStaticMarkup(
      <NativeDevAppSurfaceFrame
        appId={host.identity.appId}
        host={host}
        component={Surface}
      />,
    )
    expect(markup).toContain("dev.cozea.tests.runtime:instance-1")
    expect(markup).toContain('data-cozea-devapp="dev.cozea.tests.runtime"')
  })

  it("disposes activation resources in reverse registration order", async () => {
    const events: string[] = []
    const definition = defineNativeDevApp({
      components: { Main: () => null },
      activate(context) {
        context.subscriptions.add(() => {
          events.push("first")
        })
        context.subscriptions.add({
          dispose() {
            events.push("second")
          },
        })
        return {
          dispose() {
            events.push("activation")
          },
        }
      },
      deactivate() {
        events.push("deactivate")
      },
    })
    const lease = await activateNativeDevAppDefinition(definition, hostClient())
    await lease.dispose()
    await lease.dispose()
    expect(events).toEqual(["activation", "second", "first", "deactivate"])
  })
})
