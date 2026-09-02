import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Session } from "electron"

import { DevAppPreviewService } from "../../apps/desktop/electron/services/DevAppPreviewService"
import type { DevAppWatch } from "../../apps/desktop/electron/services/DevAppPreviewWatcher"
import type { DevAppPreviewStatus } from "../../shared/devAppPreviewTypes"
import { DEV_APP_MANIFEST_VERSION } from "../../shared/devAppPackage"
import {
  DEV_APP_WORKER_PROTOCOL_VERSION,
  createDevAppWorkerViewPortBootstrap,
} from "../../shared/devAppWorkerProtocol"
import type {
  DevAppWorkerState,
  DevAppWorkerStateChange,
} from "../../apps/desktop/electron/services/DevAppWorkerHost"

/**
 * Exercises the real filesystem adapter, the real path joining, and the real preflight.
 * Only the watcher is faked, so the test does not depend on inotify semantics.
 */

let root: string
let workspaceRoot: string
let sourcePath: string

const manifest = (extra: Record<string, unknown> = {}) => {
  const worker = extra.worker && typeof extra.worker === "object" && !Array.isArray(extra.worker)
    ? extra.worker as Record<string, unknown>
    : null
  return JSON.stringify({
    manifestVersion: DEV_APP_MANIFEST_VERSION,
    name: "Inventory",
    view: { entry: "dist/index.html" },
    ...extra,
    ...(worker
      ? {
          worker: { protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION, ...worker },
          runtime: { location: "device", state: "device" },
        }
      : {}),
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devapp-preview-"))
  workspaceRoot = path.join(root, "project")
  sourcePath = path.join(workspaceRoot, "apps", "inventory")
  fs.mkdirSync(path.join(sourcePath, "dist"), { recursive: true })
  fs.writeFileSync(path.join(sourcePath, "cozea-devapp.json"), manifest())
  fs.writeFileSync(path.join(sourcePath, "dist", "index.html"), "<html>hello</html>")
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function makeService() {
  const emitters = new Map<string, (relativePath: string) => void>()
  const watch: DevAppWatch = (watched, onChange) => {
    emitters.set(watched, onChange)
    return { close: () => emitters.delete(watched) }
  }
  const broadcasts: { sourceId: string; status: DevAppPreviewStatus }[] = []
  const runningWorkers = new Map<string, DevAppWorkerState>()
  let stateListener: ((change: DevAppWorkerStateChange) => void) | null = null
  const worker = {
    start: vi.fn((input: { publicationId: string }) => {
      const state: DevAppWorkerState = {
        publicationId: input.publicationId,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
        status: "ready",
        restarts: 0,
        lastError: null,
        logs: [],
      }
      runningWorkers.set(input.publicationId, state)
      return state
    }),
    stop: vi.fn((publicationId: string) => runningWorkers.delete(publicationId)),
    release: vi.fn(),
    getState: vi.fn((publicationId: string) => runningWorkers.get(publicationId) ?? null),
    attachViewPort: vi.fn((_publicationId: string, connectionId: string, protocolVersion: number) =>
      createDevAppWorkerViewPortBootstrap(connectionId, protocolVersion),
    ),
    detachViewPort: vi.fn(),
    onStateChange: vi.fn((listener: (change: DevAppWorkerStateChange) => void) => {
      stateListener = listener
      return () => {
        stateListener = null
      }
    }),
  }
  const service = new DevAppPreviewService({
    worker,
    broadcast: (sourceId, status) => {
      broadcasts.push({ sourceId, status })
    },
    watch,
  })
  return {
    service,
    broadcasts,
    worker,
    emitWorkerState: (change: DevAppWorkerStateChange) => stateListener?.(change),
    touch: (rel: string) => emitters.get(sourcePath)?.(rel),
  }
}

const open = (service: DevAppPreviewService, relativePath = "apps/inventory") =>
  service.open({ workspaceId: "ws_1", workspaceRoot, relativePath, leaseId: "tile_1" })

describe("Preview service — reads a real package off disk", () => {
  it("opens a package and reports it needs no approval when it asks for nothing", () => {
    const { service } = makeService()
    const status = open(service)
    expect(status.status).toBe("running")
    expect(status.status === "running" && status.name).toBe("Inventory")
    service.dispose()
  })

  it("serves the built output that actually exists", () => {
    const { service } = makeService()
    const status = open(service)
    expect(status.status === "running" && status.view).toEqual({
      kind: "builtOutput",
      entryPath: "dist/index.html",
      url: expect.stringMatching(/^cozea-devapp:\/\/[0-9a-f]{32}\.dev\/dist\/index\.html$/),
    })
    service.dispose()
  })

  it("reports a real preflight verdict rather than a placeholder", () => {
    const { service } = makeService()
    const status = open(service)
    expect(status.status === "running" && typeof status.preflight.framework).toBe("string")
    service.dispose()
  })

  it("starts watching, and says so", () => {
    const { service } = makeService()
    expect(open(service).hotReload).toBe(true)
    service.dispose()
  })

  it("registers one source-bound protocol per isolated preview session", async () => {
    const { service } = makeService()
    const status = open(service)
    expect(status.status).toBe("running")
    if (status.status !== "running") throw new Error("Expected a running preview")

    const captured: { handler?: (request: Request) => Promise<Response> } = {}
    const handle = vi.fn((_scheme: string, next: (request: Request) => Promise<Response>) => {
      captured.handler = next
    })
    const targetSession = { protocol: { handle } } as unknown as Session
    service.registerProtocolForSession(targetSession, status.sourceId)
    service.registerProtocolForSession(targetSession, status.sourceId)

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith("cozea-devapp", expect.any(Function))
    const protocolHandler = captured.handler
    expect(protocolHandler).toBeTypeOf("function")
    if (!protocolHandler) throw new Error("Expected the custom protocol handler")

    const otherSourceId = status.sourceId === "f".repeat(32) ? "e".repeat(32) : "f".repeat(32)
    const crossSource = await protocolHandler(
      new Request(`cozea-devapp://${otherSourceId}.dev/dist/index.html`),
    )
    expect(crossSource.status).toBe(400)

    service.close(status.sourceId, "tile_1")
    const released = await protocolHandler(
      new Request(status.view.kind === "builtOutput" ? status.view.url : ""),
    )
    expect(released.status).toBe(410)
    service.dispose()
  })
})

describe("Preview service — the renderer cannot name a directory", () => {
  it("refuses a relative path that climbs out of the workspace", () => {
    // The renderer only ever sends a relative path; this is what it would have to send
    // to reach outside, and joining still lands it back under scrutiny.
    const { service } = makeService()
    const status = service.open({
      workspaceId: "ws_1",
      workspaceRoot,
      relativePath: "../../../../etc",
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
    service.dispose()
  })

  it("refuses an absolute path smuggled in as the relative one", () => {
    const { service } = makeService()
    const status = service.open({
      workspaceId: "ws_1",
      workspaceRoot,
      relativePath: "/etc",
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
    service.dispose()
  })

  it("refuses a package symlink that resolves outside the workspace", () => {
    const outside = path.join(root, "outside")
    fs.mkdirSync(path.join(outside, "dist"), { recursive: true })
    fs.writeFileSync(path.join(outside, "cozea-devapp.json"), manifest())
    fs.writeFileSync(path.join(outside, "dist", "index.html"), "<html>outside</html>")
    const linked = path.join(workspaceRoot, "linked")
    fs.symlinkSync(outside, linked, "dir")
    const { service } = makeService()
    const status = service.open({
      workspaceId: "ws_1",
      workspaceRoot,
      relativePath: "linked",
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
    service.dispose()
  })

  it("reports a folder with no manifest as a diagnostic", () => {
    const { service } = makeService()
    fs.mkdirSync(path.join(workspaceRoot, "empty"), { recursive: true })
    const status = service.open({
      workspaceId: "ws_1",
      workspaceRoot,
      relativePath: "empty",
      leaseId: "tile_1",
    })
    expect(status.status === "invalid" && status.diagnostics[0]?.code).toBe("manifest-missing")
    service.dispose()
  })

  it("refuses an oversized manifest without reading it into main-process memory", () => {
    fs.writeFileSync(path.join(sourcePath, "cozea-devapp.json"), " ".repeat(1024 * 1024 + 1))
    const { service } = makeService()
    const status = open(service)
    expect(status.status).toBe("invalid")
    service.dispose()
  })
})

describe("Preview service — hot reload", () => {
  it("re-reads the manifest and broadcasts after the tree settles", async () => {
    const { service, broadcasts, touch } = makeService()
    open(service)
    fs.writeFileSync(path.join(sourcePath, "cozea-devapp.json"), manifest({ name: "Renamed" }))
    touch("cozea-devapp.json")

    await vi.waitFor(() => expect(broadcasts.length).toBeGreaterThan(0))
    const last = broadcasts[broadcasts.length - 1]!.status
    expect(last.status === "running" && last.name).toBe("Renamed")
    service.dispose()
  })

  it("reloads when the built output changes", async () => {
    const { service, broadcasts, touch } = makeService()
    open(service)
    fs.writeFileSync(path.join(sourcePath, "dist", "index.html"), "<html>changed</html>")
    touch("dist/index.html")

    await vi.waitFor(() => expect(broadcasts.length).toBeGreaterThan(0))
    const last = broadcasts[broadcasts.length - 1]!.status
    expect(last.status === "running" && last.reloadToken).toBe(1)
    service.dispose()
  })

  it("does not broadcast for a change in an ignored directory", async () => {
    const { service, broadcasts, touch } = makeService()
    open(service)
    touch("node_modules/react/index.js")
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(broadcasts).toEqual([])
    service.dispose()
  })

  it("stops watching once the preview is closed", async () => {
    const { service, broadcasts, touch } = makeService()
    const status = open(service)
    const sourceId = status.status === "running" ? status.sourceId : ""
    service.close(sourceId, "tile_1")
    touch("cozea-devapp.json")
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(broadcasts).toEqual([])
    service.dispose()
  })
})

describe("Preview service — approval", () => {
  it("holds a worker back until approved, then starts it", () => {
    fs.writeFileSync(path.join(sourcePath, "worker.js"), "//")
    fs.writeFileSync(
      path.join(sourcePath, "cozea-devapp.json"),
      manifest({ worker: { entry: "worker.js", capabilities: ["project.read"], tools: [] } }),
    )
    const { service, worker } = makeService()
    const status = open(service)
    expect(status.status).toBe("needsApproval")
    expect(worker.start).not.toHaveBeenCalled()

    if (status.status !== "needsApproval") throw new Error("Expected approval")
    const approved = service.approve(status.sourceId, status.approvalFingerprint)
    expect(approved?.status).toBe("running")
    expect(worker.start).toHaveBeenCalledOnce()

    const port = {}
    const bootstrap = service.attachViewPort(status.sourceId, "view_1", port)
    expect(bootstrap).toMatchObject({
      kind: "cozea-devapp-view-port",
      connectionId: "view_1",
    })
    expect(worker.attachViewPort).toHaveBeenCalledWith(
      `dev:${status.sourceId}`,
      "view_1",
      DEV_APP_WORKER_PROTOCOL_VERSION,
      port,
    )
    service.detachViewPort(status.sourceId, "view_1")
    expect(worker.detachViewPort).toHaveBeenCalledWith(`dev:${status.sourceId}`, "view_1")
    service.dispose()
  })

  it("forwards only development-worker lifecycle events to bridge owners", () => {
    const { service, emitWorkerState } = makeService()
    const changes: Array<{ sourceId: string; status: string }> = []
    service.onWorkerStateChange((sourceId, state) => {
      changes.push({ sourceId, status: state.status })
    })
    const state: DevAppWorkerState = {
      publicationId: `dev:${"a".repeat(32)}`,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      status: "ready",
      restarts: 0,
      lastError: null,
      logs: [],
    }
    emitWorkerState({ publicationId: state.publicationId, state })
    emitWorkerState({ publicationId: "pub_1", state: { ...state, publicationId: "pub_1" } })
    expect(changes).toEqual([{ sourceId: "a".repeat(32), status: "ready" }])
    service.dispose()
  })

  it("refuses to approve a preview that was never opened", () => {
    const { service } = makeService()
    expect(service.approve("0".repeat(32), "v1;;agent=0")).toBeNull()
    service.dispose()
  })

  it("does not approve capabilities added after the prompt was rendered", () => {
    fs.writeFileSync(path.join(sourcePath, "worker.js"), "//")
    fs.writeFileSync(
      path.join(sourcePath, "cozea-devapp.json"),
      manifest({ worker: { entry: "worker.js", capabilities: ["project.read"], tools: [] } }),
    )
    const { service, worker, touch } = makeService()
    const shown = open(service)
    expect(shown.status).toBe("needsApproval")
    if (shown.status !== "needsApproval") throw new Error("Expected approval")

    fs.writeFileSync(
      path.join(sourcePath, "cozea-devapp.json"),
      manifest({
        worker: {
          entry: "worker.js",
          capabilities: ["project.read", "process.spawn"],
          tools: [],
        },
      }),
    )
    touch("cozea-devapp.json")
    const result = service.approve(shown.sourceId, shown.approvalFingerprint)
    expect(result?.status).toBe("needsApproval")
    expect(worker.start).not.toHaveBeenCalled()
    service.dispose()
  })
})
