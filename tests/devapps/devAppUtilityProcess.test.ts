import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
  DEV_APP_WORKER_PROTOCOL_VERSION,
} from "../../shared/devAppWorkerProtocol"

const electronMocks = vi.hoisted(() => {
  const childPostMessage = vi.fn()
  const fork = vi.fn(() => ({
    postMessage: childPostMessage,
    once: vi.fn(),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }))
  return { childPostMessage, fork }
})

vi.mock("electron", () => ({
  MessageChannelMain: class {
    readonly port1 = {
      postMessage: vi.fn(),
      on: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    }
    readonly port2 = { name: "worker-port" }
  },
  utilityProcess: { fork: electronMocks.fork },
}))

import { createUtilityProcessSpawn } from "../../apps/desktop/electron/services/devAppUtilityProcess"

describe("DevApp utility process protocol bootstrap", () => {
  beforeEach(() => {
    electronMocks.childPostMessage.mockClear()
    electronMocks.fork.mockClear()
  })

  it("states the selected protocol and host range when it transfers the port", () => {
    const spawn = createUtilityProcessSpawn(({ entrypoint, publicationId }) => ({
      entrypoint,
      publicationId,
      dataDir: "/tmp/devapp-data",
    }))

    spawn({
      entrypoint: "/package/worker.js",
      publicationId: "pub_1",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })

    expect(electronMocks.childPostMessage).toHaveBeenCalledWith(
      {
        kind: "cozea-devapp-port",
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
        supportedProtocolVersions: {
          min: DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
          max: DEV_APP_WORKER_PROTOCOL_VERSION,
        },
      },
      [{ name: "worker-port" }],
    )
  })
})
