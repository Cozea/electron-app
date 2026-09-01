import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8")

describe("DevApp view/worker bridge architecture", () => {
  it("ships a DevApp-only preload that keeps the T3 picker and exposes no Electron IPC", () => {
    const config = read("apps/desktop/electron.vite.config.ts")
    const preload = read("apps/desktop/electron/preloads/devAppPreviewPickPreload.ts")
    const ordinaryPicker = read("vendor/t3code/apps/desktop/src/preview-pick-preload.ts")

    expect(config).toContain("'devapp-preview-pick-preload'")
    expect(config).toContain("sandboxedPreloadBundlesPlugin()")
    expect(config).toContain("inlineDynamicImports: true")
    expect(config).toContain("fileName: 'devapp-preview-pick-preload.cjs'")
    expect(preload).toContain("vendor/t3code/apps/desktop/src/preview-pick-preload.ts")
    expect(ordinaryPicker).not.toContain("cozeaDevApp")
    expect(preload).toContain('Object.defineProperty(window, "cozeaDevApp"')
    expect(preload).toContain("DEV_APP_VIEW_WORKER_PORT_CHANNEL")
    expect(preload).not.toContain("ipcRenderer.invoke")
    expect(preload).not.toContain("ipcRenderer.send")
    expect(preload).not.toContain("contextBridge.exposeInMainWorld")
  })

  it("lets only prepared development or published DevApps receive the bridge preload", () => {
    const surfaceService = read("apps/desktop/electron/services/T3BrowserSurfaceService.ts")
    expect(surfaceService).toContain('descriptor.kind === "devAppPreview"')
    expect(surfaceService).toContain('descriptor.kind === "orgDevApp"')
    expect(surfaceService).toContain("this.options.devAppPickPreloadPath")
    expect(surfaceService).toContain("DEV_APP_VIEW_WORKER_PORT_CHANNEL")
    expect(surfaceService).toContain("guest.postMessage")
    expect(surfaceService).toContain("workerConnection(descriptor.devSourceId)")
    expect(surfaceService).toContain("publishedDevAppRuntimeService.workerConnection")
    expect(surfaceService).toContain("detachDevAppViewBridge")
  })

  it("keeps host capability traffic on the original gated worker port", () => {
    const host = read("apps/desktop/electron/services/DevAppWorkerHost.ts")
    const utility = read("apps/desktop/electron/services/devAppUtilityProcess.ts")
    const broker = read("apps/desktop/electron/services/DevAppViewBridge.ts")

    expect(host).toContain("authorizeWorkerMethod(message.method, worker.grant)")
    expect(utility).toContain("channel.port1.postMessage(message)")
    expect(utility).toContain("child.postMessage(bootstrap")
    expect(broker).not.toContain("authorizeWorkerMethod")
    expect(broker).not.toContain("DevAppWorkerMethodHandler")
  })
})
