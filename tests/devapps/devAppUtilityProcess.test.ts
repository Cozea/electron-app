import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEV_APP_WORKER_PROTOCOL_MIN_VERSION,
  DEV_APP_WORKER_PROTOCOL_VERSION,
  createDevAppWorkerViewPortBootstrap,
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
  let temporaryRoot = ""
  let packageRoot = ""
  let entrypoint = ""
  let dataDir = ""

  beforeEach(() => {
    electronMocks.childPostMessage.mockClear()
    electronMocks.fork.mockClear()
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-worker-test-"))
    packageRoot = path.join(temporaryRoot, "package")
    entrypoint = path.join(packageRoot, "worker.js")
    dataDir = path.join(temporaryRoot, "data")
    fs.mkdirSync(packageRoot)
    fs.mkdirSync(dataDir)
    fs.writeFileSync(entrypoint, "export {}\n", "utf8")
  })

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it("states the selected protocol and host range when it transfers the port", () => {
    const spawn = createUtilityProcessSpawn(
      ({ entrypoint: selectedEntrypoint, packageRoot: selectedPackageRoot, publicationId }) => ({
        packageRoot: selectedPackageRoot,
        entrypoint: selectedEntrypoint,
        publicationId,
        dataDir,
      }),
    )

    spawn({
      entrypoint,
      packageRoot,
      publicationId: "pub_1",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })
    const realPackageRoot = fs.realpathSync.native(packageRoot)
    const realEntrypoint = fs.realpathSync.native(entrypoint)
    const realDataDir = fs.realpathSync.native(dataDir)

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
    expect(electronMocks.fork).toHaveBeenCalledWith(
      realEntrypoint,
      [],
      expect.objectContaining({
        cwd: realPackageRoot,
        serviceName: "cozea-devapp-pub_1",
        env: {
          NODE_ENV: "production",
          COZEA_DEVAPP_DATA_DIR: realDataDir,
        },
        execArgv: [
          "--max-old-space-size=512",
          "--permission",
          `--allow-fs-read=${realPackageRoot}`,
          `--allow-fs-read=${realDataDir}`,
          `--allow-fs-write=${realDataDir}`,
        ],
      }),
    )
  })

  it("transfers a main-issued view port to the existing utility process", () => {
    const spawn = createUtilityProcessSpawn(({ publicationId }) => ({
      packageRoot,
      entrypoint,
      publicationId,
      dataDir,
    }))
    const process = spawn({
      entrypoint,
      packageRoot,
      publicationId: "pub_1",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })
    const bootstrap = createDevAppWorkerViewPortBootstrap("view_1", DEV_APP_WORKER_PROTOCOL_VERSION)
    const viewPort = { name: "view-worker-port" }

    process.attachViewPort(bootstrap, viewPort)

    expect(electronMocks.childPostMessage).toHaveBeenLastCalledWith(bootstrap, [viewPort])
  })

  it("rejects an entrypoint that resolves outside its package", () => {
    const outsideEntrypoint = path.join(temporaryRoot, "outside.js")
    fs.writeFileSync(outsideEntrypoint, "export {}\n", "utf8")
    const spawn = createUtilityProcessSpawn(({ publicationId }) => ({
      packageRoot,
      entrypoint: outsideEntrypoint,
      publicationId,
      dataDir,
    }))
    expect(() =>
      spawn({
        entrypoint,
        packageRoot,
        publicationId: "pub_1",
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
      }),
    ).toThrow(/outside its package/)
    expect(electronMocks.fork).not.toHaveBeenCalled()
  })
})
