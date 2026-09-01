import { describe, expect, it, vi } from "vitest"

import {
  createDevAppViewBridge,
  type DevAppViewBridgePort,
} from "../../apps/desktop/electron/services/DevAppViewBridge"
import { DEV_APP_WORKER_PROTOCOL_VERSION } from "../../shared/devAppWorkerProtocol"

class FakePort implements DevAppViewBridgePort {
  readonly sent: unknown[] = []
  started = false
  closed = false
  private readonly messageListeners = new Set<(event: { data: unknown }) => void>()
  private readonly closeListeners = new Set<() => void>()

  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  on(event: "message", listener: (event: { data: unknown }) => void): unknown
  on(event: "close", listener: () => void): unknown
  on(
    event: "message" | "close",
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): unknown {
    if (event === "message") {
      this.messageListeners.add(listener as (event: { data: unknown }) => void)
    } else {
      this.closeListeners.add(listener as () => void)
    }
    return this
  }
  start(): void {
    this.started = true
  }
  close(): void {
    this.closed = true
  }
  receive(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data })
  }
  disconnect(): void {
    for (const listener of this.closeListeners) listener()
  }
}

const request = (id: string, method = "inventory.lookup") => ({
  kind: "request",
  protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
  id,
  method,
  params: { sku: "A-1" },
})

describe("DevApp view/worker broker", () => {
  it("forwards package-private requests, matching responses, and events", () => {
    const view = new FakePort()
    const worker = new FakePort()
    const bridge = createDevAppViewBridge({
      viewPort: view,
      workerPort: worker,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })

    view.receive(request("1"))
    expect(worker.sent).toEqual([request("1")])
    const response = {
      kind: "response",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      id: "1",
      result: { stock: 4 },
    }
    worker.receive(response)
    expect(view.sent).toEqual([response])

    const event = {
      kind: "event",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      topic: "inventory.changed",
      payload: { sku: "A-1" },
    }
    worker.receive(event)
    expect(view.sent.at(-1)).toEqual(event)
    expect(view.started).toBe(true)
    expect(worker.started).toBe(true)
    bridge.close()
  })

  it("drops malformed, cross-version, and unsolicited response messages", () => {
    const view = new FakePort()
    const worker = new FakePort()
    const bridge = createDevAppViewBridge({
      viewPort: view,
      workerPort: worker,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })

    view.receive({ nope: true })
    view.receive({ ...request("1"), protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION + 1 })
    worker.receive({
      kind: "response",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      id: "not-pending",
      result: "spoofed",
    })
    expect(view.sent).toEqual([])
    expect(worker.sent).toEqual([])
    bridge.close()
  })

  it("bounds concurrent requests and rejects duplicate ids", () => {
    const view = new FakePort()
    const worker = new FakePort()
    const bridge = createDevAppViewBridge({
      viewPort: view,
      workerPort: worker,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })

    for (let index = 0; index < 17; index += 1) view.receive(request(`r${index}`))
    view.receive(request("r0"))
    expect(worker.sent).toHaveLength(16)
    expect(view.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "response",
          error: expect.objectContaining({ code: "internal-error" }),
        }),
        expect.objectContaining({
          kind: "response",
          id: "r0",
          error: expect.objectContaining({ code: "invalid-message" }),
        }),
      ]),
    )
    bridge.close()
  })

  it("times out a request instead of leaving the view hanging", () => {
    const view = new FakePort()
    const worker = new FakePort()
    let timeout = () => {}
    createDevAppViewBridge({
      viewPort: view,
      workerPort: worker,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      setTimer: (callback) => {
        timeout = callback
        return 1
      },
      clearTimer: vi.fn(),
    })
    view.receive(request("1"))
    timeout()
    expect(view.sent.at(-1)).toMatchObject({
      kind: "response",
      id: "1",
      error: { code: "worker-unavailable" },
    })
  })

  it("revokes both sides and settles pending work when either process closes", () => {
    const view = new FakePort()
    const worker = new FakePort()
    const onClose = vi.fn()
    createDevAppViewBridge({
      viewPort: view,
      workerPort: worker,
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      onClose,
    })
    view.receive(request("1"))
    worker.disconnect()
    expect(view.sent.at(-1)).toMatchObject({
      id: "1",
      error: { code: "worker-unavailable" },
    })
    expect(view.closed).toBe(true)
    expect(worker.closed).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
