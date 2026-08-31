import { describe, expect, it, vi } from "vitest"

import {
  createDevAppWorkerHandlers,
  type DevAppHostServices,
} from "../../apps/desktop/electron/services/devAppWorkerHandlers"
import type { DevAppWorkerBinding } from "../../apps/desktop/electron/services/DevAppWorkerHost"
import { DEV_APP_WORKER_PROTOCOL_VERSION } from "../../shared/devAppWorkerProtocol"
import { DEV_APP_METHOD_CAPABILITIES } from "../../shared/devAppWorkerProtocol"

const BINDING: DevAppWorkerBinding = {
  workspaceId: "ws_granted",
  workspaceRoot: "/Users/admin/proj",
  dataDir: "/Users/admin/data/pub_1",
}

function makeHandlers(overrides: Partial<DevAppHostServices> = {}) {
  const services: DevAppHostServices = {
    readProjectFile: vi.fn(async () => "contents"),
    writeProjectFile: vi.fn(async () => undefined),
    listProjectDirectory: vi.fn(async () => ["a.ts"]),
    projectMetadata: vi.fn(async () => ({ name: "proj" })),
    openExternalUrl: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    ...overrides,
  }
  return { handlers: createDevAppWorkerHandlers(services), services }
}

const call = (
  handlers: ReturnType<typeof createDevAppWorkerHandlers>,
  method: string,
  params: unknown,
) => handlers[method]!({
  kind: "request",
  protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
  id: "1",
  method,
  params,
}, {
  publicationId: "pub_1",
  binding: BINDING,
})

describe("Worker handlers — the binding wins over the request", () => {
  it("implements every method protocol v1 advertises, and advertises every handler", () => {
    const { handlers } = makeHandlers()
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(DEV_APP_METHOD_CAPABILITIES).sort())
  })
  // The property that makes the grant mean anything: a worker approved for one
  // workspace must not reach another by asking.
  it("ignores a workspaceId supplied in params", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "project.readFile", { path: "src/a.ts", workspaceId: "ws_someone_else" })
    expect(services.readProjectFile).toHaveBeenCalledWith({
      workspaceId: "ws_granted",
      filePath: "src/a.ts",
    })
  })

  it("ignores a workspaceId on writes too", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "project.writeFile", {
      path: "src/a.ts",
      content: "x",
      workspaceId: "ws_someone_else",
    })
    expect(services.writeProjectFile).toHaveBeenCalledWith({
      workspaceId: "ws_granted",
      filePath: "src/a.ts",
      content: "x",
    })
  })

  it("takes project metadata from the binding, not the request", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "project.metadata", { workspaceId: "ws_someone_else" })
    expect(services.projectMetadata).toHaveBeenCalledWith({ workspaceId: "ws_granted" })
  })
})

describe("Worker handlers — path confinement", () => {
  it("reads a file inside the project", async () => {
    const { handlers } = makeHandlers()
    await expect(call(handlers, "project.readFile", { path: "src/a.ts" })).resolves.toBe("contents")
  })

  it("refuses traversal out of the project", async () => {
    const { handlers, services } = makeHandlers()
    for (const bad of ["../secrets.env", "src/../../.ssh/id_rsa", "../../../etc/passwd"]) {
      await expect(call(handlers, "project.readFile", { path: bad }), bad).rejects.toThrow(/escapes/)
    }
    expect(services.readProjectFile).not.toHaveBeenCalled()
  })

  it("refuses an absolute path rather than reinterpreting it", async () => {
    const { handlers } = makeHandlers()
    await expect(call(handlers, "project.readFile", { path: "/etc/passwd" }))
      .rejects.toThrow(/relative/)
  })

  it("refuses a path containing a null byte", async () => {
    const { handlers } = makeHandlers()
    await expect(call(handlers, "project.readFile", { path: "src/a\0.ts" })).rejects.toThrow()
  })

  it("defaults a directory listing to the project root", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "project.listDirectory", {})
    expect(services.listProjectDirectory).toHaveBeenCalledWith({
      workspaceId: "ws_granted",
      directory: ".",
    })
  })
})

describe("Worker handlers — parameter validation", () => {
  it("requires a path", async () => {
    const { handlers } = makeHandlers()
    for (const params of [{}, { path: "" }, { path: 42 }, null, "nope"]) {
      await expect(call(handlers, "project.readFile", params)).rejects.toThrow()
    }
  })

  it("requires string content on a write", async () => {
    const { handlers } = makeHandlers()
    await expect(call(handlers, "project.writeFile", { path: "a.ts", content: { evil: true } }))
      .rejects.toThrow(/content/)
  })
})

describe("Worker handlers — shell.open is web links only", () => {
  it("opens an allowed link", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "shell.open", { url: "https://example.com" })
    expect(services.openExternalUrl).toHaveBeenCalledWith("https://example.com")
  })

  it("refuses file: and custom schemes", async () => {
    const { handlers, services } = makeHandlers()
    for (const url of ["file:///etc/passwd", "vscode://file/etc", "ssh://host"]) {
      await expect(call(handlers, "shell.open", { url }), url).rejects.toThrow(/https/)
    }
    expect(services.openExternalUrl).not.toHaveBeenCalled()
  })
})

describe("Worker handlers — shell.reveal stays inside its roots", () => {
  it("reveals inside the workspace", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "shell.reveal", { path: "dist" })
    expect(services.revealPath).toHaveBeenCalledWith({
      rootPath: "/Users/admin/proj",
      relativePath: "dist",
    })
  })

  it("reveals inside the app's own data directory when asked", async () => {
    const { handlers, services } = makeHandlers()
    await call(handlers, "shell.reveal", { root: "data", path: "logs" })
    expect(services.revealPath).toHaveBeenCalledWith({
      rootPath: "/Users/admin/data/pub_1",
      relativePath: "logs",
    })
  })

  it("refuses a location outside both roots", async () => {
    const { handlers, services } = makeHandlers()
    await expect(call(handlers, "shell.reveal", { path: "../../.ssh" })).rejects.toThrow(/outside/)
    expect(services.revealPath).not.toHaveBeenCalled()
  })

  it("rejects an unrecognized root rather than guessing", async () => {
    const { handlers, services } = makeHandlers()
    await expect(call(handlers, "shell.reveal", { root: "machine", path: "dist" }))
      .rejects.toThrow(/root/)
    expect(services.revealPath).not.toHaveBeenCalled()
  })
})
