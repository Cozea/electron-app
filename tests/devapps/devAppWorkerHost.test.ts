import { describe, expect, it, vi } from "vitest"

import { normalizeGrant, type DevAppCapability } from "../../shared/devAppCapabilities"
import {
  DEV_APP_WORKER_PROTOCOL_VERSION,
  type DevAppWorkerResponse,
  type DevAppWorkerViewPortBootstrap,
} from "../../shared/devAppWorkerProtocol"
import {
  DevAppWorkerHost,
  type DevAppWorkerBinding,
  type DevAppWorkerProcess,
  type DevAppWorkerTransferablePort,
} from "../../apps/desktop/electron/services/DevAppWorkerHost"

const BINDING: DevAppWorkerBinding = {
  workspaceId: "ws_1",
  workspaceRoot: "/Users/admin/proj",
  dataDir: "/Users/admin/data/pub_1",
}
const PACKAGE_ROOT = "/package"
const ENTRYPOINT = `${PACKAGE_ROOT}/worker.js`

/** A worker process standing in for utilityProcess, so supervision is testable alone. */
class FakeWorker implements DevAppWorkerProcess {
  readonly sent: unknown[] = []
  readonly attachedViews: Array<{
    bootstrap: DevAppWorkerViewPortBootstrap
    port: DevAppWorkerTransferablePort
  }> = []
  killed = false
  private messageListener: ((message: unknown) => void) | null = null
  private exitListener: ((code: number | null) => void) | null = null
  private logListener: ((line: string) => void) | null = null

  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  attachViewPort(
    bootstrap: DevAppWorkerViewPortBootstrap,
    port: DevAppWorkerTransferablePort,
  ): void {
    this.attachedViews.push({ bootstrap, port })
  }
  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener
  }
  onExit(listener: (code: number | null) => void): void {
    this.exitListener = listener
  }
  onLog(listener: (line: string) => void): void {
    this.logListener = listener
  }
  kill(): void {
    this.killed = true
  }

  /** Drives a message from worker to host. */
  send(message: unknown): void {
    this.messageListener?.(message)
  }
  crash(code = 1): void {
    this.exitListener?.(code)
  }
  log(line: string): void {
    this.logListener?.(line)
  }
  get responses(): DevAppWorkerResponse[] {
    return this.sent as DevAppWorkerResponse[]
  }
}

function makeHost(
  options: {
    capabilities?: DevAppCapability[]
    handler?: (method: string) => Promise<unknown>
    now?: () => number
    authorizationExpiresAt?: number | null
  } = {},
) {
  const spawned: FakeWorker[] = []
  const handlers = {
    "project.readFile": async () =>
      options.handler ? options.handler("project.readFile") : "contents",
    "project.writeFile": async () =>
      options.handler ? options.handler("project.writeFile") : true,
    "fs.readFile": async () => "machine-wide",
  }
  const host = new DevAppWorkerHost(
    () => {
      const worker = new FakeWorker()
      spawned.push(worker)
      return worker
    },
    handlers,
    options.now,
  )

  const state = host.start({
    publicationId: "pub_1",
    entrypoint: ENTRYPOINT,
    packageRoot: PACKAGE_ROOT,
    protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    grant: normalizeGrant({ capabilities: options.capabilities ?? ["project.read"] }),
    authorizationExpiresAt: options.authorizationExpiresAt ?? null,
    binding: BINDING,
    leaseId: "tile_1",
  })
  return { host, spawned, state, current: () => spawned[spawned.length - 1]! }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("Worker host — the gate runs on every request", () => {
  it("serves a request the grant permits", async () => {
    const { current } = makeHost({ capabilities: ["project.read"] })
    current().send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    expect(current().responses[0]).toEqual({
      kind: "response",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      id: "1",
      result: "contents",
    })
  })

  it("denies a request the grant does not permit, without killing the worker", async () => {
    // An over-broad manifest should be a fixable mistake, not an outage.
    const { host, current } = makeHost({ capabilities: ["project.read"] })
    current().send({ kind: "request", id: "1", method: "project.writeFile" })
    await flush()
    const response = current().responses[0]!
    expect(response.error?.code).toBe("capability-denied")
    expect(response.error?.requiredCapability).toBe("project.write")
    expect(current().killed).toBe(false)
    expect(host.getState("pub_1")?.status).toBe("ready")
  })

  it("denies a machine-scope request that protocol v1 does not implement", async () => {
    const { current } = makeHost({ capabilities: ["project.read"] })
    current().send({ kind: "request", id: "1", method: "fs.readFile" })
    await flush()
    expect(current().responses[0]!.error?.code).toBe("unknown-method")
  })

  it("refuses a method with no handler even when the capability is held", async () => {
    const { current } = makeHost({ capabilities: ["shell.open"] })
    current().send({ kind: "request", id: "1", method: "shell.open" })
    await flush()
    expect(current().responses[0]!.error?.code).toBe("unknown-method")
  })

  it("drops a malformed message rather than answering it", async () => {
    const { host, current } = makeHost()
    current().send({ nonsense: true })
    current().send(null)
    await flush()
    expect(current().responses).toHaveLength(0)
    expect(host.getState("pub_1")?.logs.join(" ")).toContain("malformed")
  })

  it("drops a message that targets a different protocol version", async () => {
    const { host, current } = makeHost()
    current().send({
      kind: "request",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION + 1,
      id: "1",
      method: "project.readFile",
    })
    await flush()
    expect(current().responses).toHaveLength(0)
    expect(host.getState("pub_1")?.logs.join(" ")).toContain("malformed")
  })

  it("does not leak host internals when a handler throws", async () => {
    const { host, current } = makeHost({
      capabilities: ["project.read"],
      handler: async () => {
        throw new Error("ENOENT: /Users/admin/.ssh/id_rsa")
      },
    })
    current().send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    const response = current().responses[0]!
    expect(response.error?.code).toBe("internal-error")
    expect(response.error?.message).toBe("The host could not complete this request.")
    expect(response.error?.message).not.toContain("/Users/admin/.ssh/id_rsa")
    expect(response.error).not.toHaveProperty("stack")
    expect(host.getState("pub_1")?.logs.join(" ")).toContain("ENOENT: /Users/admin/.ssh/id_rsa")
  })

  it("expires authorization on every request and stops the worker", async () => {
    let now = 1_000
    const { host, current } = makeHost({
      capabilities: ["project.read"],
      now: () => now,
      authorizationExpiresAt: 2_000,
    })
    const worker = current()
    now = 2_001
    worker.send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    expect(worker.responses[0]?.error?.code).toBe("authorization-expired")
    expect(worker.killed).toBe(true)
    expect(host.getState("pub_1")).toBeNull()
  })

  it("stops at authorization expiry even when the worker sends no requests", () => {
    let now = 1_000
    let expire = () => {}
    const timers = {
      set: vi.fn((callback: () => void) => {
        expire = callback
        return 1
      }),
      clear: vi.fn(),
    }
    const spawned: FakeWorker[] = []
    const host = new DevAppWorkerHost(
      () => {
        const worker = new FakeWorker()
        spawned.push(worker)
        return worker
      },
      {},
      () => now,
      timers,
    )
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: [] }),
      authorizationExpiresAt: 2_000,
      binding: BINDING,
      leaseId: "tile_1",
    })
    now = 2_000
    expire()
    expect(spawned[0]?.killed).toBe(true)
    expect(host.getState("pub_1")).toBeNull()
  })

  it("keeps malformed-message logs bounded", async () => {
    const { host, current } = makeHost()
    for (let index = 0; index < 500; index += 1) current().send({ malformed: index })
    await flush()
    expect(host.getState("pub_1")?.logs).toHaveLength(200)
  })
})

describe("Worker host — lifecycle", () => {
  it("stays starting until an asynchronous contained adapter is ready", async () => {
    let resolveReady = () => {}
    class StartingWorker extends FakeWorker {
      ready = new Promise<void>((resolve) => { resolveReady = resolve })
    }
    const worker = new StartingWorker()
    const host = new DevAppWorkerHost(() => worker, {})
    const initial = host.start({
      publicationId: "pub_async",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: [] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "tile_1",
    })
    expect(initial.status).toBe("starting")
    resolveReady()
    await flush()
    expect(host.getState("pub_async")?.status).toBe("ready")
  })

  it("transfers a version-bound view port only to the live worker", () => {
    const { host, current } = makeHost()
    const port = {}
    const bootstrap = host.attachViewPort("pub_1", "view_1", DEV_APP_WORKER_PROTOCOL_VERSION, port)
    expect(bootstrap).toEqual({
      kind: "cozea-devapp-view-port",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      supportedProtocolVersions: {
        min: DEV_APP_WORKER_PROTOCOL_VERSION,
        max: DEV_APP_WORKER_PROTOCOL_VERSION,
      },
      connectionId: "view_1",
    })
    expect(current().attachedViews).toEqual([{ bootstrap, port }])
    host.detachViewPort("pub_1", "view_1")
  })

  it("refuses a view port with a mismatched protocol or stopped worker", () => {
    const { host } = makeHost()
    expect(() =>
      host.attachViewPort("pub_1", "view_1", DEV_APP_WORKER_PROTOCOL_VERSION + 1, {}),
    ).toThrow(/protocol versions/)
    host.stop("pub_1")
    expect(() =>
      host.attachViewPort("pub_1", "view_1", DEV_APP_WORKER_PROTOCOL_VERSION, {}),
    ).toThrow(/unavailable/)
  })

  it("publishes crash, replacement-ready, and stop lifecycle changes", () => {
    const spawned: FakeWorker[] = []
    const host = new DevAppWorkerHost(() => {
      const worker = new FakeWorker()
      spawned.push(worker)
      return worker
    }, {})
    const statuses: string[] = []
    host.onStateChange(({ state }) => statuses.push(state.status))
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: [] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "tile_1",
    })
    spawned[0]!.crash(1)
    host.stop("pub_1")
    expect(statuses).toEqual(["ready", "crashed", "ready", "stopped"])
  })

  it("joins an already-running worker rather than spawning a second", () => {
    const { host, spawned } = makeHost()
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: ["project.read"] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "agent_1",
    })
    expect(spawned).toHaveLength(1)
  })

  it("keeps running while any lease is held", () => {
    const { host, current } = makeHost()
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: ["project.read"] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "agent_1",
    })
    host.release("pub_1", "tile_1")
    expect(current().killed).toBe(false)
    expect(host.getState("pub_1")?.status).toBe("ready")
  })

  it("stops when the last lease is released", () => {
    const { host, current } = makeHost()
    host.release("pub_1", "tile_1")
    expect(current().killed).toBe(true)
    expect(host.getState("pub_1")).toBeNull()
  })

  it("restarts a crashed worker while a lease is still held", () => {
    // The stated exit criterion: a killed worker comes back without taking down its tile.
    const { host, spawned, current } = makeHost()
    current().crash(1)
    expect(spawned).toHaveLength(2)
    expect(host.getState("pub_1")?.status).toBe("ready")
    expect(host.getState("pub_1")?.restarts).toBe(1)
  })

  it("carries recent logs across a restart so a crash loop is diagnosable", () => {
    const { host, current } = makeHost()
    current().log("listening on port 4000")
    current().crash(1)
    expect(host.getState("pub_1")?.logs.join(" ")).toContain("listening on port 4000")
  })

  it("gives up after repeated crashes rather than looping forever", () => {
    const { host, spawned, current } = makeHost()
    for (let attempt = 0; attempt < 6; attempt += 1) current().crash(1)
    expect(spawned.length).toBeLessThanOrEqual(4)
    expect(host.getState("pub_1")?.status).toBe("crashed")
  })

  it("does not restart a worker that was stopped deliberately", () => {
    const { host, spawned, current } = makeHost()
    host.stop("pub_1")
    current().crash(0)
    expect(spawned).toHaveLength(1)
  })

  it("bounds the log buffer", () => {
    const { host, current } = makeHost()
    for (let i = 0; i < 500; i += 1) current().log(`line ${i}`)
    const logs = host.getState("pub_1")!.logs
    expect(logs.length).toBeLessThanOrEqual(200)
    expect(logs[logs.length - 1]).toBe("line 499")
  })

  it("stops every worker on dispose", () => {
    const { host, current } = makeHost()
    host.dispose()
    expect(current().killed).toBe(true)
    expect(host.getState("pub_1")).toBeNull()
  })

  it("replaces a worker when its approved grant narrows", async () => {
    const { host, spawned } = makeHost({ capabilities: ["project.read", "project.write"] })
    const first = spawned[0]!
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: ["project.read"] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "agent_1",
    })
    const replacement = spawned[1]!
    expect(first.killed).toBe(true)
    replacement.send({ kind: "request", id: "1", method: "project.writeFile" })
    await flush()
    expect(replacement.responses[0]?.error?.code).toBe("capability-denied")
  })

  it("rejects an expired authorization before spawning code", () => {
    const spawn = vi.fn(() => new FakeWorker())
    const host = new DevAppWorkerHost(spawn, {}, () => 2_000)
    expect(() =>
      host.start({
        publicationId: "pub_1",
        entrypoint: ENTRYPOINT,
        packageRoot: PACKAGE_ROOT,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
        grant: normalizeGrant({ capabilities: [] }),
        authorizationExpiresAt: 1_999,
        binding: BINDING,
        leaseId: "tile_1",
      }),
    ).toThrow(/expired/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("rejects a binding change for a running publication", () => {
    const { host } = makeHost()
    expect(() =>
      host.start({
        publicationId: "pub_1",
        entrypoint: ENTRYPOINT,
        packageRoot: PACKAGE_ROOT,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
        grant: normalizeGrant({ capabilities: ["project.read"] }),
        authorizationExpiresAt: null,
        binding: { ...BINDING, workspaceId: "ws_other" },
        leaseId: "tile_2",
      }),
    ).toThrow(/workspace bindings/)
  })

  it("ignores messages from a worker after it was stopped", async () => {
    const { host, current } = makeHost()
    const worker = current()
    host.stop("pub_1")
    worker.send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    expect(worker.responses).toHaveLength(0)
  })
})

describe("Worker host — request pressure", () => {
  it("refuses once too many requests are in flight", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { current } = makeHost({
      capabilities: ["project.read"],
      handler: async () => {
        await gate
        return "ok"
      },
    })

    for (let i = 0; i < 70; i += 1) {
      current().send({ kind: "request", id: `r${i}`, method: "project.readFile" })
    }
    await flush()

    const refusals = current().responses.filter((r) => r.error?.code === "internal-error")
    expect(refusals.length).toBeGreaterThan(0)
    release()
  })
})

describe("Worker host — spawn wiring", () => {
  it("passes the entrypoint and publication through to the process", () => {
    const spawn = vi.fn(() => new FakeWorker())
    const host = new DevAppWorkerHost(spawn, {})
    host.start({
      publicationId: "pub_9",
      entrypoint: `${PACKAGE_ROOT}/server/worker.js`,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: [] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "tile_1",
    })
    expect(spawn).toHaveBeenCalledWith({
      entrypoint: `${PACKAGE_ROOT}/server/worker.js`,
      packageRoot: PACKAGE_ROOT,
      publicationId: "pub_9",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })
    expect(host.getState("pub_9")?.protocolVersion).toBe(DEV_APP_WORKER_PROTOCOL_VERSION)
  })

  it("refuses an unsupported protocol before spawning code", () => {
    const spawn = vi.fn(() => new FakeWorker())
    const host = new DevAppWorkerHost(spawn, {})
    expect(() =>
      host.start({
        publicationId: "pub_9",
        entrypoint: `${PACKAGE_ROOT}/server/worker.js`,
        packageRoot: PACKAGE_ROOT,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION + 1,
        grant: normalizeGrant({ capabilities: [] }),
        authorizationExpiresAt: null,
        binding: BINDING,
        leaseId: "tile_1",
      }),
    ).toThrow(/Unsupported DevApp worker protocol/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it("refuses identities and entrypoints outside the package", () => {
    const spawn = vi.fn(() => new FakeWorker())
    const host = new DevAppWorkerHost(spawn, {})
    const valid = {
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: [] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "tile_1",
    }
    expect(() => host.start({ ...valid, publicationId: "../escape" })).toThrow(/identity/)
    expect(() => host.start({ ...valid, leaseId: "" })).toThrow(/lease/)
    expect(() => host.start({ ...valid, entrypoint: "/outside/worker.js" })).toThrow(
      /inside its package/,
    )
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe("Worker host — the binding reaches handlers", () => {
  it("hands handlers the binding the worker started with", async () => {
    const seen: DevAppWorkerBinding[] = []
    const spawned: FakeWorker[] = []
    const host = new DevAppWorkerHost(
      () => {
        const w = new FakeWorker()
        spawned.push(w)
        return w
      },
      {
        "project.readFile": async (_r, ctx) => {
          seen.push(ctx.binding)
          return "ok"
        },
      },
    )
    host.start({
      publicationId: "pub_1",
      entrypoint: ENTRYPOINT,
      packageRoot: PACKAGE_ROOT,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      grant: normalizeGrant({ capabilities: ["project.read"] }),
      authorizationExpiresAt: null,
      binding: BINDING,
      leaseId: "tile_1",
    })
    spawned[0]!.send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    expect(seen[0]).toEqual(BINDING)
  })
})
