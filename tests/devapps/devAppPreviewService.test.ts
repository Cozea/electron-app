import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Session } from "electron"

import { DevAppPreviewService } from "../../apps/desktop/electron/services/DevAppPreviewService"
import type { DevAppWatch } from "../../apps/desktop/electron/services/DevAppPreviewWatcher"
import type { DevAppPreviewStatus } from "../../shared/devAppPreviewTypes"

/**
 * Exercises the real filesystem adapter, the real path joining, and the real preflight.
 * Only the watcher is faked, so the test does not depend on inotify semantics.
 */

let root: string
let workspaceRoot: string
let sourcePath: string

const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({
  manifestVersion: 1,
  name: "Inventory",
  view: { entry: "dist/index.html" },
  ...extra,
})

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
  const worker = {
    start: vi.fn((input: { publicationId: string }) => ({
      publicationId: input.publicationId,
      status: "ready" as const,
      restarts: 0,
      lastError: null,
      logs: [],
    })),
    stop: vi.fn(),
    release: vi.fn(),
    getState: vi.fn(() => null),
  }
  const service = new DevAppPreviewService({
    worker,
    broadcast: (sourceId, status) => { broadcasts.push({ sourceId, status }) },
    watch,
  })
  return { service, broadcasts, worker, touch: (rel: string) => emitters.get(sourcePath)?.(rel) }
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

    service.close(status.sourceId)
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
    service.close(sourceId)
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
      manifest({ worker: { entry: "worker.js", capabilities: ["project.read"] } }),
    )
    const { service, worker } = makeService()
    const status = open(service)
    expect(status.status).toBe("needsApproval")
    expect(worker.start).not.toHaveBeenCalled()

    const sourceId = status.status === "needsApproval" ? status.sourceId : ""
    const approved = service.approve(sourceId)
    expect(approved?.status).toBe("running")
    expect(worker.start).toHaveBeenCalledOnce()
    service.dispose()
  })

  it("refuses to approve a preview that was never opened", () => {
    const { service } = makeService()
    expect(service.approve("0".repeat(32))).toBeNull()
    service.dispose()
  })
})
