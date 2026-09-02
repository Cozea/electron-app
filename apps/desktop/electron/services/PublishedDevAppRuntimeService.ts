import { createHash } from "node:crypto"

import {
  selectDevAppRuntimeImage,
  type DevAppContainedRuntimeStartRequest,
  type DevAppContainedRuntimeState,
  type DevAppContainerCleanupRequest,
  type DevAppFolderGrant,
} from "../../../../shared/devAppContainedRuntime"
import { normalizeGrant, type DevAppGrant } from "../../../../shared/devAppCapabilities"
import type { OrgDevAppInstallation } from "../../../../shared/orgDevAppInstallation"
import type {
  DevAppWorkerBinding,
  DevAppWorkerSpawn,
  DevAppWorkerState,
  DevAppWorkerTransferablePort,
  DevAppWorkerHost,
} from "./DevAppWorkerHost"
import { parseWorkerMessage, type DevAppWorkerViewPortBootstrap } from "../../../../shared/devAppWorkerProtocol"
import { createContainedDevAppWorkerSpawn, type ContainedDevAppWorkerRuntime } from "./containedDevAppWorkerProcess"
import type { DeviceContainedDevAppRuntimeService } from "./ContainedDevAppRuntimeService"
import {
  HostedContainedDevAppRuntimeService,
  type HostedContainedRuntimeStartRequest,
} from "./HostedContainedDevAppRuntimeService"
import { requestDevAppRuntimeRegistryAuth } from "./DevAppRuntimeAccessClient"
import type { OrgDevAppInstallationService } from "./OrgDevAppInstallationService"
import { validateDevAppToolInput } from "../../../../shared/devAppToolInputValidation"

const SERVICE_PORT = 8080
const MAX_LOG_LINES = 200

export interface ActivePublishedRuntime {
  key: string
  installation: OrgDevAppInstallation
  workspaceId: string
  request: DevAppContainedRuntimeStartRequest | HostedContainedRuntimeStartRequest
  runtime: ContainedDevAppWorkerRuntime
  serviceUrl: string | null
  serviceToken: string | null
  state: DevAppContainedRuntimeState
  logs: string[]
  leases: Set<string>
}

export interface StartPublishedRuntimeOptions {
  ref: string
  workspaceId: string
  workspaceRoot: string
  leaseId: string
  gatewayBaseUrl: string
  accessToken: string
  environment?: Record<string, string>
  folderGrants?: DevAppFolderGrant[]
}

function runtimeKey(releaseId: string, workspaceId: string): string {
  return `pub_${createHash("sha256").update(`${releaseId}\0${workspaceId}`).digest("hex").slice(0, 32)}`
}

function assertLease(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,192}$/.test(value)) throw new Error("The DevApp runtime lease is invalid.")
}

/** Owns exact installed published runtimes; development workers never enter this service. */
export class PublishedDevAppRuntimeService {
  private readonly installations: OrgDevAppInstallationService
  private readonly deviceRuntime: DeviceContainedDevAppRuntimeService
  private readonly hostedRuntime: HostedContainedDevAppRuntimeService
  private readonly active = new Map<string, ActivePublishedRuntime>()
  private readonly pendingStarts = new Map<string, Promise<ActivePublishedRuntime>>()
  private readonly pendingStateOwners = new Map<string, string>()
  private readonly pendingByWorkerKey = new Map<string, ActivePublishedRuntime>()
  private readonly readyRuntimes = new Set<string>()
  private readonly removeListeners: Array<() => void>
  private workerHost: DevAppWorkerHost | null = null

  constructor(
    installations: OrgDevAppInstallationService,
    deviceRuntime: DeviceContainedDevAppRuntimeService,
    hostedRuntime: HostedContainedDevAppRuntimeService = new HostedContainedDevAppRuntimeService(),
  ) {
    this.installations = installations
    this.deviceRuntime = deviceRuntime
    this.hostedRuntime = hostedRuntime
    const observe = (runtime: ContainedDevAppWorkerRuntime): Array<() => void> => [
      runtime.on("log", (event) => {
        const active = this.active.get(event.runtimeId)
        if (!active) return
        active.logs.push(event.message.slice(0, 2048))
        if (active.logs.length > MAX_LOG_LINES) active.logs.splice(0, active.logs.length - MAX_LOG_LINES)
      }),
      runtime.on("state", (event) => {
        const active = this.active.get(event.runtimeId)
        if (active) active.state = event.state
        if (event.state.status === "stopped" || event.state.status === "failed") {
          this.readyRuntimes.delete(event.runtimeId)
        }
      }),
      runtime.on("message", (event) => {
        if (event.transport.channel !== "host") return
        const parsed = parseWorkerMessage(event.transport.message, 1)
        if (parsed?.kind === "event" && parsed.topic === "runtime.ready") {
          this.readyRuntimes.add(event.runtimeId)
        }
      }),
    ]
    this.removeListeners = [...observe(deviceRuntime), ...observe(hostedRuntime)]
  }

  createWorkerSpawn(): DevAppWorkerSpawn {
    return createContainedDevAppWorkerSpawn(
      ({ publicationId }) => {
        const active = this.pendingByWorkerKey.get(publicationId)
        if (!active) throw new Error("The published DevApp worker has no authorized runtime.")
        return {
          runtimeId: active.key,
          runtime: active.runtime,
          start: async () => active.state,
        }
      },
      (runtimeId) => this.readyRuntimes.has(runtimeId),
      (runtimeId) => this.stop(runtimeId),
    )
  }

  setWorkerHost(workerHost: DevAppWorkerHost): void {
    this.workerHost = workerHost
  }

  async start(options: StartPublishedRuntimeOptions): Promise<ActivePublishedRuntime> {
    assertLease(options.leaseId)
    const installation = this.installations.resolve(options.ref)
    if (!installation) throw new Error("This exact DevApp release is not installed.")
    const release = installation.activeRelease
    const placement = release.parts.runtime
    if (!placement || placement.kind !== "container") {
      throw new Error("This DevApp release has no contained runtime contract.")
    }
    if (!release.runtimeImage || !release.runtimeSourceDigest || !release.packageManifestDigest) {
      throw new Error("This executable DevApp release has no signed runtime image.")
    }
    if (
      placement.location === "hosted" &&
      release.parts.worker?.capabilities.some((capability) => capability !== "net.outbound")
    ) {
      throw new Error("Hosted workers cannot request capabilities that act on this device.")
    }
    if (release.parts.service?.runtimeKind === "node" && release.parts.service.network !== true) {
      throw new Error("This Service DevApp release has no explicit network contract.")
    }
    const key = runtimeKey(release.id, options.workspaceId)
    const existing = this.active.get(key)
    if (existing && existing.state.status === "running") {
      existing.leases.add(options.leaseId)
      return existing
    }
    if (existing) await this.stop(key)
    const pending = this.pendingStarts.get(key)
    if (pending) {
      const active = await pending
      active.leases.add(options.leaseId)
      return active
    }
    if (placement.state === "device") {
      const conflicting = [...this.active.values()].find(
        (candidate) =>
          candidate.key !== key &&
          candidate.installation.publicationId === installation.publicationId &&
          candidate.state.status === "running",
      )
      const pendingOwner = this.pendingStateOwners.get(installation.publicationId)
      if (conflicting || (pendingOwner && pendingOwner !== key)) {
        throw new Error("This DevApp's publication-owned device state is already mounted in another workspace.")
      }
      this.pendingStateOwners.set(installation.publicationId, key)
    }
    const start = this.startNew(options, installation, key).finally(() => {
      this.pendingStarts.delete(key)
      if (this.pendingStateOwners.get(installation.publicationId) === key) {
        this.pendingStateOwners.delete(installation.publicationId)
      }
    })
    this.pendingStarts.set(key, start)
    return await start
  }

  private async startNew(
    options: StartPublishedRuntimeOptions,
    installation: OrgDevAppInstallation,
    key: string,
  ): Promise<ActivePublishedRuntime> {
    const release = installation.activeRelease
    const placement = release.parts.runtime!
    const runtimeImage = release.runtimeImage
    const sourceDigest = release.runtimeSourceDigest
    const packageManifestDigest = release.packageManifestDigest
    if (!runtimeImage || !sourceDigest || !packageManifestDigest) {
      throw new Error("This executable DevApp release has no signed runtime image.")
    }
    const service = release.parts.service?.runtimeKind === "node"
    const network =
      release.parts.service?.network === true || release.parts.worker?.capabilities.includes("net.outbound") === true
    const identity = {
      organizationId: installation.organizationId,
      publicationId: installation.publicationId,
      releaseId: release.id,
      releaseVersion: release.version,
      contentHash: release.contentHash,
      sourceDigest,
      packageManifestDigest,
    }
    const resources = {
      cpus: 2,
      memoryBytes: 1024 * 1024 * 1024,
      rootfsBytes: 4 * 1024 * 1024 * 1024,
      writableLayerBytes: 512 * 1024 * 1024,
    }
    let request: DevAppContainedRuntimeStartRequest | HostedContainedRuntimeStartRequest
    let runtime: ContainedDevAppWorkerRuntime
    if (placement.location === "device") {
      const registryAuth = await requestDevAppRuntimeRegistryAuth({
        gatewayBaseUrl: options.gatewayBaseUrl,
        accessToken: options.accessToken,
        organizationId: installation.organizationId,
        publicationId: installation.publicationId,
        releaseId: release.id,
        manifestDigest: runtimeImage.manifestDigest,
      })
      request = {
        runtimeId: key,
        identity,
        location: "device",
        state: placement.state,
        image: selectDevAppRuntimeImage(runtimeImage, "linux/arm64"),
        registryAuth,
        command: ["bun", "/cozea/runtime/index.ts"],
        environment: {
          ...options.environment,
          COZEA_DEVAPP_PUBLICATION_ID: installation.publicationId,
          COZEA_DEVAPP_RELEASE_ID: release.id,
          COZEA_DEVAPP_DATA_DIR: placement.state === "device" ? "/cozea/state" : "/tmp",
          ...(service ? { HOST: "0.0.0.0", HOSTNAME: "0.0.0.0", PORT: String(SERVICE_PORT) } : {}),
        },
        workingDirectory: "/cozea/package",
        ...(service ? { servicePort: SERVICE_PORT } : {}),
        network,
        resources,
        folderGrants: options.folderGrants ?? [],
      }
      runtime = this.deviceRuntime
    } else {
      if ((options.folderGrants?.length ?? 0) > 0) {
        throw new Error("Hosted DevApps cannot mount or browse folders from this device.")
      }
      if (placement.state !== "none" && placement.state !== "organization") {
        throw new Error("The hosted DevApp state contract is invalid.")
      }
      request = {
        runtimeId: key,
        identity,
        location: "hosted",
        state: placement.state,
        environment: options.environment ?? {},
        ...(service ? { servicePort: SERVICE_PORT } : {}),
        network,
        resources,
        gatewayBaseUrl: options.gatewayBaseUrl,
        accessToken: options.accessToken,
      }
      runtime = this.hostedRuntime
    }
    const state =
      placement.location === "device"
        ? await this.deviceRuntime.start(request as DevAppContainedRuntimeStartRequest)
        : await this.hostedRuntime.start(request as HostedContainedRuntimeStartRequest)
    if (state.status !== "running") {
      throw new Error(state.error ?? "The contained DevApp runtime did not start.")
    }
    const active: ActivePublishedRuntime = {
      key,
      installation,
      workspaceId: options.workspaceId,
      request,
      runtime,
      serviceUrl: placement.location === "hosted" ? this.hostedRuntime.serviceUrl(key) : null,
      serviceToken: placement.location === "hosted" ? this.hostedRuntime.serviceToken(key) : null,
      state,
      logs: [],
      leases: new Set([options.leaseId]),
    }
    this.active.set(key, active)
    return active
  }

  onWorkerStateChange(listener: (workerKey: string, state: DevAppWorkerState) => void): () => void {
    if (!this.workerHost) throw new Error("The published DevApp worker host is unavailable.")
    return this.workerHost.onStateChange(({ publicationId, state }) => {
      listener(publicationId, state)
    })
  }

  startWorker(
    active: ActivePublishedRuntime,
    binding: DevAppWorkerBinding,
    grantInput: DevAppGrant,
    authorizationExpiresAt: number,
    leaseId: string,
  ): { workerKey: string; grant: DevAppGrant; protocolVersion: number } | null {
    const worker = active.installation.activeRelease.parts.worker
    if (!worker) return null
    if (!this.workerHost) throw new Error("The published DevApp worker host is unavailable.")
    const workerKey = active.key
    if (active.workspaceId !== binding.workspaceId) {
      throw new Error("The published DevApp worker workspace binding does not match its runtime.")
    }
    const requested = normalizeGrant({ capabilities: worker.capabilities })
    const grant = normalizeGrant(grantInput)
    if (requested.capabilities.join("\0") !== grant.capabilities.join("\0")) {
      throw new Error("The published DevApp worker approval does not match this release.")
    }
    this.pendingByWorkerKey.set(workerKey, active)
    const protocolVersion = worker.protocolVersion ?? 1
    this.workerHost.start({
      publicationId: workerKey,
      entrypoint: "/cozea/package/runtime-worker",
      packageRoot: "/cozea/package",
      protocolVersion,
      grant,
      authorizationExpiresAt,
      binding,
      leaseId,
      declaredToolNames: worker.tools?.map((tool) => tool.name) ?? [],
    })
    return {
      workerKey,
      grant,
      protocolVersion,
    }
  }

  workerConnection(
    publicationId: string,
    workspaceId: string,
  ): {
    workerKey: string
    protocolVersion: number
  } | null {
    if (!this.workerHost) return null
    const active = [...this.active.values()].find(
      (candidate) =>
        candidate.installation.publicationId === publicationId &&
        candidate.workspaceId === workspaceId &&
        candidate.state.status === "running",
    )
    if (!active) return null
    const state = this.workerHost.getState(active.key)
    return state?.status === "ready" ? { workerKey: active.key, protocolVersion: state.protocolVersion } : null
  }

  workerStateFor(ref: string, workspaceId: string): DevAppWorkerState | null {
    if (!this.workerHost) return null
    const installation = this.installations.resolve(ref)
    if (!installation) return null
    const key = runtimeKey(installation.activeRelease.id, workspaceId)
    const active = this.active.get(key)
    if (!active || active.state.status !== "running") return null
    return this.workerHost.getState(key)
  }

  async invokeTool(options: {
    ref: string
    workspaceId: string
    name: string
    input: unknown
    timeoutMs?: number
  }): Promise<unknown> {
    if (!this.workerHost) throw new Error("The published DevApp worker host is unavailable.")
    const installation = this.installations.resolve(options.ref)
    if (!installation) throw new Error("This exact DevApp release is not installed.")
    const tool = installation.activeRelease.parts.worker?.tools?.find((candidate) => candidate.name === options.name)
    if (!tool) throw new Error("This exact DevApp release did not declare that tool.")
    const inputError = validateDevAppToolInput(tool.inputSchema, options.input)
    if (inputError) throw new Error(inputError)
    const key = runtimeKey(installation.activeRelease.id, options.workspaceId)
    const active = this.active.get(key)
    if (!active || active.state.status !== "running") {
      throw new Error("This exact DevApp release is not running in the requested workspace.")
    }
    return await this.workerHost.invoke(key, tool.name, options.input, options.timeoutMs)
  }

  attachViewPort(
    workerKey: string,
    connectionId: string,
    protocolVersion: number,
    port: DevAppWorkerTransferablePort,
  ): DevAppWorkerViewPortBootstrap {
    if (!this.workerHost) throw new Error("The published DevApp worker host is unavailable.")
    return this.workerHost.attachViewPort(workerKey, connectionId, protocolVersion, port)
  }

  detachViewPort(workerKey: string, connectionId: string): void {
    this.workerHost?.detachViewPort(workerKey, connectionId)
  }

  get(runtimeId: string): ActivePublishedRuntime | null {
    return this.active.get(runtimeId) ?? null
  }

  runtimeState(runtimeId: string): DevAppContainedRuntimeState | null {
    return this.active.get(runtimeId)?.state ?? null
  }

  async stopFor(ref: string, workspaceId: string): Promise<boolean> {
    const installation = this.installations.resolve(ref)
    if (!installation) return false
    const key = runtimeKey(installation.activeRelease.id, workspaceId)
    if (!this.active.has(key) && !this.pendingStarts.has(key)) return false
    const pending = this.pendingStarts.get(key)
    if (pending) await pending.catch(() => undefined)
    await this.stop(key)
    return true
  }

  async prepareInstallationRemoval(
    installations: OrgDevAppInstallation[],
    removePublicationState: boolean,
  ): Promise<void> {
    if (installations.length === 0) return
    const publicationId = installations[0]!.publicationId
    if (installations.some((entry) => entry.publicationId !== publicationId)) {
      throw new Error("DevApp installation cleanup cannot span publications.")
    }
    const releaseIds = new Set(installations.map((entry) => entry.activeRelease.id))
    const activeIds = [...this.active.values()]
      .filter(
        (entry) =>
          entry.installation.publicationId === publicationId &&
          (removePublicationState || releaseIds.has(entry.installation.activeRelease.id)),
      )
      .map((entry) => entry.key)
    await Promise.all(activeIds.map((runtimeId) => this.stop(runtimeId)))

    if (process.platform !== "darwin" || process.arch !== "arm64") return
    const imageReferences = new Set(
      installations.flatMap((entry) =>
        entry.activeRelease.parts.runtime?.location === "device" && entry.activeRelease.runtimeImage?.reference
          ? [entry.activeRelease.runtimeImage.reference]
          : [],
      ),
    )
    // Reclaiming container state is best effort and must never strand the removal
    // that asked for it. The device runtime throws when its signed resources are
    // absent — true of every unpackaged build — and that rejection used to escape
    // to the uninstall handler before the installation was taken out of the
    // registry, so Uninstall could not remove anything at all. Each request is
    // isolated so one failure does not skip the rest.
    const cleanup = async (request: DevAppContainerCleanupRequest): Promise<void> => {
      try {
        await this.deviceRuntime.cleanup(request)
      } catch (error) {
        console.warn(`[DevApp] Container cleanup failed for publication ${publicationId}:`, error)
      }
    }
    for (const imageReference of imageReferences) {
      const usedByRemainingRuntime = [...this.active.values()].some(
        (entry) => entry.installation.activeRelease.runtimeImage?.reference === imageReference,
      )
      if (usedByRemainingRuntime) continue
      await cleanup({ imageReference })
    }
    if (removePublicationState) {
      await cleanup({ publicationId })
    }
  }

  release(runtimeId: string, leaseId: string): boolean {
    const active = this.active.get(runtimeId)
    if (!active) return false
    active.leases.delete(leaseId)
    if (active.leases.size === 0) void this.stop(runtimeId)
    return true
  }

  releaseFor(ref: string, workspaceId: string, leaseId: string): boolean {
    const installation = this.installations.resolve(ref)
    if (!installation) return false
    return this.release(runtimeKey(installation.activeRelease.id, workspaceId), leaseId)
  }

  async stop(runtimeId: string): Promise<void> {
    const active = this.active.get(runtimeId)
    if (!active) return
    this.active.delete(runtimeId)
    this.readyRuntimes.delete(runtimeId)
    this.pendingByWorkerKey.delete(runtimeId)
    this.workerHost?.stop(runtimeId)
    await active.runtime.stop(runtimeId).catch(() => undefined)
    await active.runtime.delete(runtimeId).catch(() => undefined)
  }

  async dispose(): Promise<void> {
    for (const remove of this.removeListeners.splice(0)) remove()
    await Promise.all([...this.active.keys()].map((runtimeId) => this.stop(runtimeId)))
  }
}
