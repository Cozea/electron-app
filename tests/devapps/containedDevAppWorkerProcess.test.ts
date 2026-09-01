import { describe, expect, it, vi } from "vitest"

import { createContainedDevAppWorkerSpawn } from "../../apps/desktop/electron/services/containedDevAppWorkerProcess"
import type { DeviceContainedDevAppRuntimeService } from "../../apps/desktop/electron/services/ContainedDevAppRuntimeService"
import type {
  DevAppContainedRuntimeStartRequest,
  DevAppContainedRuntimeTransportEnvelope,
} from "../../shared/devAppContainedRuntime"

const request = {
  runtimeId: "pub_runtime",
  identity: {
    organizationId: "org_1",
    publicationId: "pub_1",
    releaseId: "release_1",
    releaseVersion: 1,
    contentHash: "a".repeat(64),
    sourceDigest: "b".repeat(64),
    packageManifestDigest: `sha256:${"c".repeat(64)}`,
  },
  location: "device",
  state: "device",
  image: {
    reference: `ghcr.io/cozea/devapps@sha256:${"d".repeat(64)}`,
    manifestDigest: `sha256:${"d".repeat(64)}`,
    platformDigest: `sha256:${"e".repeat(64)}`,
    platform: "linux/arm64",
    signature: "signature",
    attestationDigest: `sha256:${"f".repeat(64)}`,
    attestation: {} as never,
  },
  registryAuth: { scheme: "bearer", token: "pull-only", expiresAt: Date.now() + 60_000 },
  command: ["bun", "/cozea/runtime/index.ts"],
  environment: {},
  workingDirectory: "/cozea/package",
  network: false,
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 * 1024,
    rootfsBytes: 1024 * 1024 * 1024,
    writableLayerBytes: 512 * 1024 * 1024,
  },
  folderGrants: [],
} satisfies DevAppContainedRuntimeStartRequest

describe("contained DevApp worker adapter", () => {
  it("uses the same living runtime for host and view traffic", async () => {
    const listeners = new Map<string, Set<(event: never) => void>>()
    const sent: DevAppContainedRuntimeTransportEnvelope[] = []
    const runtime = {
      start: vi.fn(async () => ({ status: "running" })),
      stop: vi.fn(async () => ({ status: "stopped" })),
      delete: vi.fn(async () => null),
      sendMessage: vi.fn(async (_runtimeId: string, envelope: DevAppContainedRuntimeTransportEnvelope) => {
        sent.push(envelope)
      }),
      on: (event: string, listener: (value: never) => void) => {
        const set = listeners.get(event) ?? new Set()
        set.add(listener)
        listeners.set(event, set)
        return () => set.delete(listener)
      },
    } as unknown as DeviceContainedDevAppRuntimeService
    const emit = (event: string, value: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value as never)
    }
    const spawn = createContainedDevAppWorkerSpawn(runtime, () => request)
    const process = spawn({
      entrypoint: "/cozea/package/worker",
      packageRoot: "/cozea/package",
      publicationId: "pub_runtime",
      protocolVersion: 1,
    })
    emit("message", {
      runtimeId: request.runtimeId,
      transport: {
        channel: "host",
        message: { kind: "event", protocolVersion: 1, topic: "runtime.ready" },
      },
    })
    await process.ready

    const workerMessages: unknown[] = []
    process.onMessage((message) => workerMessages.push(message))
    process.postMessage({ kind: "response", id: "host" })
    await Promise.resolve()
    expect(sent).toContainEqual({ channel: "host", message: { kind: "response", id: "host" } })
    emit("message", {
      runtimeId: request.runtimeId,
      transport: { channel: "host", message: { kind: "request", id: "worker" } },
    })
    expect(workerMessages).toEqual([{ kind: "request", id: "worker" }])

    const portMessages: unknown[] = []
    let portInput: ((event: { data: unknown }) => void) | null = null
    const port = {
      postMessage: (message: unknown) => portMessages.push(message),
      on: (event: string, listener: (event: { data: unknown }) => void) => {
        if (event === "message") portInput = listener
      },
      start: vi.fn(),
      close: vi.fn(),
    }
    process.attachViewPort(
      {
        kind: "cozea-devapp-view-port",
        protocolVersion: 1,
        supportedProtocolVersions: { min: 1, max: 1 },
        connectionId: "view_1",
      },
      port,
    )
    const receive = portInput as ((event: { data: unknown }) => void) | null
    receive?.({ data: { kind: "request", id: "view" } })
    await Promise.resolve()
    expect(sent).toContainEqual({
      channel: "view",
      connectionId: "view_1",
      message: { kind: "request", id: "view" },
    })
    emit("message", {
      runtimeId: request.runtimeId,
      transport: { channel: "view", connectionId: "view_1", message: { ok: true } },
    })
    expect(portMessages).toEqual([{ ok: true }])
  })
})
