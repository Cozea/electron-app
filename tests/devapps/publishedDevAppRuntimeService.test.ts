import { afterEach, describe, expect, it, vi } from "vitest"

import { PublishedDevAppRuntimeService } from "../../apps/desktop/electron/services/PublishedDevAppRuntimeService"
import type { DeviceContainedDevAppRuntimeService } from "../../apps/desktop/electron/services/ContainedDevAppRuntimeService"
import type { OrgDevAppInstallationService } from "../../apps/desktop/electron/services/OrgDevAppInstallationService"
import type { DevAppWorkerHost } from "../../apps/desktop/electron/services/DevAppWorkerHost"
import type { OrgDevAppInstallation } from "../../shared/orgDevAppInstallation"
import type {
  DevAppContainedRuntimeStartRequest,
  DevAppContainedRuntimeState,
} from "../../shared/devAppContainedRuntime"

function installation(): OrgDevAppInstallation {
  const manifestDigest = `sha256:${"d".repeat(64)}`
  const platforms = [
    { platform: "linux/arm64" as const, digest: `sha256:${"e".repeat(64)}` },
    { platform: "linux/amd64" as const, digest: `sha256:${"f".repeat(64)}` },
  ]
  return {
    ref: "cozea-devapp:publication/org_1/pub_1@1",
    organizationId: "org_1",
    organizationName: "Test org",
    publicationId: "pub_1",
    name: "Runtime test",
    description: null,
    logoDataUrl: null,
    active: true,
    installedAt: 1,
    lastUsedAt: 1,
    sizeBytes: 1,
    activeRelease: {
      id: "release_1",
      version: 1,
      framework: "bun",
      entryPath: "index.html",
      contentHash: "a".repeat(64),
      runtimeKind: "static",
      manifestVersion: 2,
      platform: null,
      arch: null,
      permissionSetHash: null,
      publisherIdentityKey: null,
      publisherDeviceLabel: null,
      runtimeSourceDigest: "b".repeat(64),
      packageManifestDigest: `sha256:${"c".repeat(64)}`,
      parts: {
        worker: { protocolVersion: 1, capabilities: [], tools: [] },
        runtime: { kind: "container", location: "device", state: "device" },
      },
      runtimeImage: {
        reference: `ghcr.io/cozea/devapps@${manifestDigest}`,
        manifestDigest,
        platforms,
        signature: "signature",
        attestationDigest: `sha256:${"1".repeat(64)}`,
        attestation: {
          version: 1,
          builderId: "cozea-devapp-builder/v1",
          sourceDigest: "b".repeat(64),
          packageManifestDigest: `sha256:${"c".repeat(64)}`,
          manifestDigest,
          platforms,
          materials: [],
          builtAt: 1,
          reproducible: true,
        },
      },
    },
  }
}

function installedService(value: OrgDevAppInstallation): OrgDevAppInstallationService {
  return { resolve: (ref: string) => ref === value.ref ? value : null } as unknown as OrgDevAppInstallationService
}

function runningState(request: DevAppContainedRuntimeStartRequest): DevAppContainedRuntimeState {
  return {
    runtimeId: request.runtimeId,
    status: "running",
    location: request.location,
    state: request.state,
    publicationId: request.identity.publicationId,
    releaseId: request.identity.releaseId,
    imageDigest: request.image.manifestDigest,
    guestAddress: "192.168.64.2",
    servicePort: null,
    startedAt: 1,
    exitedAt: null,
    exitCode: null,
    error: null,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("published DevApp runtime coordination", () => {
  it("coalesces duplicate starts and refuses two simultaneous mounts of publication state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      scheme: "bearer",
      token: "pull-token",
      expiresAt: Date.now() + 60_000,
    })))
    let releaseStart!: () => void
    const start = vi.fn((request: DevAppContainedRuntimeStartRequest) =>
      new Promise<DevAppContainedRuntimeState>((resolve) => {
        releaseStart = () => resolve(runningState(request))
      }),
    )
    const listeners = new Map<string, Set<(event: never) => void>>()
    const runtime = {
      start,
      stop: vi.fn(async (runtimeId: string) => ({ runtimeId, status: "stopped" })),
      delete: vi.fn(async () => null),
      sendMessage: vi.fn(async () => undefined),
      on: (event: string, listener: (event: never) => void) => {
        const values = listeners.get(event) ?? new Set()
        values.add(listener)
        listeners.set(event, values)
        return () => values.delete(listener)
      },
    } as unknown as DeviceContainedDevAppRuntimeService
    const release = installation()
    const service = new PublishedDevAppRuntimeService(installedService(release), runtime)
    const base = {
      ref: release.ref,
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace_1",
      leaseId: "tile_1",
      gatewayBaseUrl: "https://gateway.example",
      accessToken: "device-token",
    }

    const first = service.start(base)
    const joined = service.start({ ...base, leaseId: "tile_2" })
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    releaseStart()
    const [active, same] = await Promise.all([first, joined])
    expect(same).toBe(active)
    expect(active.leases).toEqual(new Set(["tile_1", "tile_2"]))

    await expect(service.start({
      ...base,
      workspaceId: "workspace_2",
      workspaceRoot: "/tmp/workspace_2",
      leaseId: "tile_3",
    })).rejects.toThrow("already mounted in another workspace")
    await service.dispose()
  })

  it("invokes only an exact declared tool in the exact running workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      scheme: "bearer",
      token: "pull-token",
      expiresAt: Date.now() + 60_000,
    })))
    const runtime = {
      start: vi.fn(async (request: DevAppContainedRuntimeStartRequest) => runningState(request)),
      stop: vi.fn(async (runtimeId: string) => ({ runtimeId, status: "stopped" })),
      delete: vi.fn(async () => null),
      sendMessage: vi.fn(async () => undefined),
      on: vi.fn(() => () => undefined),
    } as unknown as DeviceContainedDevAppRuntimeService
    const release = installation()
    release.activeRelease.parts.worker!.tools = [
      {
        name: "search_records",
        description: "Search records.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string", minLength: 1 } },
        },
      },
    ]
    const invoke = vi.fn(async () => ({ records: [1] }))
    const workerHost = {
      invoke,
      getState: vi.fn(() => ({
        publicationId: "runtime",
        protocolVersion: 1,
        status: "ready",
        restarts: 0,
        lastError: null,
        logs: [],
      })),
      onStateChange: vi.fn(() => () => undefined),
      stop: vi.fn(),
      dispose: vi.fn(),
    } as unknown as DevAppWorkerHost
    const service = new PublishedDevAppRuntimeService(installedService(release), runtime)
    service.setWorkerHost(workerHost)
    const active = await service.start({
      ref: release.ref,
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace_1",
      leaseId: "tile_1",
      gatewayBaseUrl: "https://gateway.example",
      accessToken: "device-token",
    })

    await expect(service.invokeTool({
      ref: release.ref,
      workspaceId: "workspace_1",
      name: "search_records",
      input: { query: "Ada" },
    })).resolves.toEqual({ records: [1] })
    expect(invoke).toHaveBeenCalledWith(active.key, "search_records", { query: "Ada" }, undefined)

    await expect(service.invokeTool({
      ref: release.ref,
      workspaceId: "workspace_1",
      name: "search_records",
      input: { query: "" },
    })).rejects.toThrow(/too short/)
    await expect(service.invokeTool({
      ref: release.ref,
      workspaceId: "workspace_other",
      name: "search_records",
      input: { query: "Ada" },
    })).rejects.toThrow(/not running/)
    await expect(service.invokeTool({
      ref: release.ref,
      workspaceId: "workspace_1",
      name: "delete_records",
      input: {},
    })).rejects.toThrow(/did not declare/)
    expect(invoke).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
})
