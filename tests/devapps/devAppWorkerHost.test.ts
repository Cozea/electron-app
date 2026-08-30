import { describe, expect, it, vi } from "vitest"

import { normalizeGrant } from "../../shared/devAppCapabilities"
import type { DevAppWorkerResponse } from "../../shared/devAppWorkerProtocol"
import {
  DevAppWorkerHost,
  type DevAppWorkerProcess,
} from "../../apps/desktop/electron/services/DevAppWorkerHost"

/** A worker process standing in for utilityProcess, so supervision is testable alone. */
class FakeWorker implements DevAppWorkerProcess {
  readonly sent: unknown[] = []
  killed = false
  private messageListener: ((message: unknown) => void) | null = null
  private exitListener: ((code: number | null) => void) | null = null
  private logListener: ((line: string) => void) | null = null

  postMessage(message: unknown): void {
    this.sent.push(message)
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

function makeHost(options: {
  capabilities?: string[]
  handler?: (method: string) => Promise<unknown>
} = {}) {
  const spawned: FakeWorker[] = []
  const handlers = {
    "project.readFile": async () => (options.handler ? options.handler("project.readFile") : "contents"),
    "project.writeFile": async () => (options.handler ? options.handler("project.writeFile") : true),
    "fs.readFile": async () => "machine-wide",
  }
  const host = new DevAppWorkerHost(() => {
    const worker = new FakeWorker()
    spawned.push(worker)
    return worker
  }, handlers)

  const state = host.start({
    publicationId: "pub_1",
    entrypoint: "worker.js",
    grant: normalizeGrant({ capabilities: options.capabilities ?? ["project.read"] }),
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
    expect(current().responses[0]).toEqual({ kind: "response", id: "1", result: "contents" })
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

  it("denies a machine-scope request from a project-scoped grant", async () => {
    const { current } = makeHost({ capabilities: ["project.read"] })
    current().send({ kind: "request", id: "1", method: "fs.readFile" })
    await flush()
    expect(current().responses[0]!.error?.requiredCapability).toBe("fs.read")
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

  it("does not leak host internals when a handler throws", async () => {
    const { current } = makeHost({
      capabilities: ["project.read"],
      handler: async () => {
        throw new Error("ENOENT: /Users/admin/.ssh/id_rsa")
      },
    })
    current().send({ kind: "request", id: "1", method: "project.readFile" })
    await flush()
    const response = current().responses[0]!
    expect(response.error?.code).toBe("internal-error")
    // The message is surfaced, but as an error code the caller can branch on rather
    // than a thrown host stack.
    expect(response.error).not.toHaveProperty("stack")
  })
})

describe("Worker host — lifecycle", () => {
  it("joins an already-running worker rather than spawning a second", () => {
    const { host, spawned } = makeHost()
    host.start({
      publicationId: "pub_1",
      entrypoint: "worker.js",
      grant: normalizeGrant({ capabilities: ["project.read"] }),
      leaseId: "agent_1",
    })
    expect(spawned).toHaveLength(1)
  })

  it("keeps running while any lease is held", () => {
    const { host, current } = makeHost()
    host.start({
      publicationId: "pub_1",
      entrypoint: "worker.js",
      grant: normalizeGrant({ capabilities: ["project.read"] }),
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
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { current } = makeHost({
      capabilities: ["project.read"],
      handler: async () => { await gate; return "ok" },
    })

    for (let i = 0; i < 70; i += 1) {
      current().send({ kind: "request", id: `r${i}`, method: "project.readFile" })
    }
    await flush()

    const refusals = current().responses.filter((r) => r.error?.code === "internal-error")
    expect(refusals.length).toBeGreaterThan(0)
    release?.()
  })
})

describe("Worker host — spawn wiring", () => {
  it("passes the entrypoint and publication through to the process", () => {
    const spawn = vi.fn(() => new FakeWorker())
    const host = new DevAppWorkerHost(spawn, {})
    host.start({
      publicationId: "pub_9",
      entrypoint: "server/worker.js",
      grant: normalizeGrant({ capabilities: [] }),
      leaseId: "tile_1",
    })
    expect(spawn).toHaveBeenCalledWith({ entrypoint: "server/worker.js", publicationId: "pub_9" })
  })
})
