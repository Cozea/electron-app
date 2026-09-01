import { afterEach, describe, expect, it, vi } from "vitest"

import { PublishedDevAppRuntimeService } from "../../apps/desktop/electron/services/PublishedDevAppRuntimeService"
import type { DeviceContainedDevAppRuntimeService } from "../../apps/desktop/electron/services/ContainedDevAppRuntimeService"
import type {
  HostedContainedDevAppRuntimeService,
  HostedContainedRuntimeStartRequest,
} from "../../apps/desktop/electron/services/HostedContainedDevAppRuntimeService"
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
  return {
    resolve: (ref: string) => (ref === value.ref ? value : null),
  } as unknown as OrgDevAppInstallationService
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
  it("routes hosted releases to Cloudflare without registry tokens or local folder grants", async () => {
    const release = installation()
    release.activeRelease.parts.runtime = {
      kind: "container",
      location: "hosted",
      state: "organization",
    }
    release.activeRelease.parts.worker!.capabilities = ["net.outbound"]
    const device = {
      start: vi.fn(),
      stop: vi.fn(),
      delete: vi.fn(),
      sendMessage: vi.fn(),
      on: vi.fn(() => () => undefined),
    } as unknown as DeviceContainedDevAppRuntimeService
    const hostedStart = vi.fn(async (request: HostedContainedRuntimeStartRequest) => ({
      runtimeId: request.runtimeId,
      status: "running" as const,
      location: "hosted" as const,
      state: request.state,
      publicationId: request.identity.publicationId,
      releaseId: request.identity.releaseId,
      imageDigest: `sha256:${"f".repeat(64)}`,
      guestAddress: null,
      servicePort: null,
      startedAt: 1,
      exitedAt: null,
      exitCode: null,
      error: null,
    }))
    const hosted = {
      start: hostedStart,
      serviceUrl: vi.fn(() => null),
      serviceToken: vi.fn(() => null),
      stop: vi.fn(async () => ({ status: "stopped" })),
      delete: vi.fn(async () => null),
      sendMessage: vi.fn(async () => undefined),
      on: vi.fn(() => () => undefined),
    } as unknown as HostedContainedDevAppRuntimeService
    const service = new PublishedDevAppRuntimeService(installedService(release), device, hosted)
    const options = {
      ref: release.ref,
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace_1",
      leaseId: "tile_1",
      gatewayBaseUrl: "https://gateway.example",
      accessToken: "device-token",
    }

    const active = await service.start(options)
    expect(active.state.location).toBe("hosted")
    expect(hostedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "hosted",
        state: "organization",
        gatewayBaseUrl: "https://gateway.example",
      }),
    )
    expect(device.start).not.toHaveBeenCalled()
    expect(hostedStart.mock.calls[0]?.[0]).not.toHaveProperty("registryAuth")
    expect(hostedStart.mock.calls[0]?.[0]).not.toHaveProperty("folderGrants")
    await expect(
      service.start({
        ...options,
        workspaceId: "workspace_2",
        leaseId: "tile_2",
        folderGrants: [
          {
            grantId: "grant_1",
            publicationId: "pub_1",
            releaseId: "release_1",
            canonicalHostPath: "/tmp/local",
            guestPath: "/cozea/grants/grant_1",
            access: "read",
            expiresAt: Date.now() + 60_000,
          },
        ],
      }),
    ).rejects.toThrow("cannot mount or browse folders")
    await service.dispose()
  })

  it("coalesces duplicate starts and refuses two simultaneous mounts of publication state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          scheme: "bearer",
          token: "pull-token",
          expiresAt: Date.now() + 60_000,
        }),
      ),
    )
    let releaseStart!: () => void
    const start = vi.fn(
      (request: DevAppContainedRuntimeStartRequest) =>
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

    await expect(
      service.start({
        ...base,
        workspaceId: "workspace_2",
        workspaceRoot: "/tmp/workspace_2",
        leaseId: "tile_3",
      }),
    ).rejects.toThrow("already mounted in another workspace")
    await service.dispose()
  })

  it("stops and deletes a runtime after its last surface lease is released", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          scheme: "bearer",
          token: "pull-token",
          expiresAt: Date.now() + 60_000,
        }),
      ),
    )
    const runtime = {
      start: vi.fn(async (request: DevAppContainedRuntimeStartRequest) => runningState(request)),
      stop: vi.fn(async (runtimeId: string) => ({ runtimeId, status: "stopped" })),
      delete: vi.fn(async () => null),
      sendMessage: vi.fn(async () => undefined),
      on: vi.fn(() => () => undefined),
    } as unknown as DeviceContainedDevAppRuntimeService
    const release = installation()
    const service = new PublishedDevAppRuntimeService(installedService(release), runtime)
    const active = await service.start({
      ref: release.ref,
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace_1",
      leaseId: "tile_1",
      gatewayBaseUrl: "https://gateway.example",
      accessToken: "device-token",
    })

    expect(service.releaseFor(release.ref, "workspace_1", "tile_1")).toBe(true)
    await vi.waitFor(() => expect(runtime.stop).toHaveBeenCalledWith(active.key))
    await vi.waitFor(() => expect(runtime.delete).toHaveBeenCalledWith(active.key))
    expect(service.get(active.key)).toBeNull()
    await service.dispose()
  })

  it("invokes only an exact declared tool in the exact running workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          scheme: "bearer",
          token: "pull-token",
          expiresAt: Date.now() + 60_000,
        }),
      ),
    )
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

    await expect(
      service.invokeTool({
        ref: release.ref,
        workspaceId: "workspace_1",
        name: "search_records",
        input: { query: "Ada" },
      }),
    ).resolves.toEqual({ records: [1] })
    expect(invoke).toHaveBeenCalledWith(active.key, "search_records", { query: "Ada" }, undefined)

    await expect(
      service.invokeTool({
        ref: release.ref,
        workspaceId: "workspace_1",
        name: "search_records",
        input: { query: "" },
      }),
    ).rejects.toThrow(/too short/)
    await expect(
      service.invokeTool({
        ref: release.ref,
        workspaceId: "workspace_other",
        name: "search_records",
        input: { query: "Ada" },
      }),
    ).rejects.toThrow(/not running/)
    await expect(
      service.invokeTool({
        ref: release.ref,
        workspaceId: "workspace_1",
        name: "delete_records",
        input: {},
      }),
    ).rejects.toThrow(/did not declare/)
    expect(invoke).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it.runIf(process.platform === "darwin" && process.arch === "arm64")(
    "removes exact device images and publication state during final uninstall",
    async () => {
      const cleanup = vi.fn(async () => undefined)
      const runtime = {
        cleanup,
        stop: vi.fn(),
        delete: vi.fn(),
        sendMessage: vi.fn(),
        on: vi.fn(() => () => undefined),
      } as unknown as DeviceContainedDevAppRuntimeService
      const release = installation()
      const service = new PublishedDevAppRuntimeService(installedService(release), runtime)

      await service.prepareInstallationRemoval([release], true)

      expect(cleanup).toHaveBeenNthCalledWith(1, {
        imageReference: release.activeRelease.runtimeImage!.reference,
      })
      expect(cleanup).toHaveBeenNthCalledWith(2, { publicationId: release.publicationId })
      await service.dispose()
    },
  )
})
