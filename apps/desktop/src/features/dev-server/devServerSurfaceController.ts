import { buildWorkbenchScopeKey } from "@/features/workbench/model/workbenchStore"

const DEFAULT_LEASE_TTL_MS = 45_000

export interface DevServerSurfaceLease {
  token: string
  tileId: string
  ownerId: string
  expiresAt: number
}

export interface EnsureDevServerSurfaceRequest {
  projectId: string
  laneId: string
  workspaceId: string | null
  assistantTileId: string
  ownerId: string
  focus?: boolean
  preferredTileId?: string
  forceNew?: boolean
}

export interface DevServerSurfaceHandle {
  scopeKey: string
  tileId: string
  leaseToken: string
  created: boolean
  focused: boolean
}

export interface DevServerSurfaceController {
  ensureSurface: (
    request: EnsureDevServerSurfaceRequest,
  ) => Promise<DevServerSurfaceHandle>
  focusSurface: (tileId: string) => boolean
}

interface DevServerSurfaceRuntime {
  controllers: Map<string, DevServerSurfaceController>
  leases: Map<string, DevServerSurfaceLease>
  userInterruptions: Map<string, number>
}

const RUNTIME_KEY = Symbol.for("cozea.devServerSurfaceRuntime")
const runtimeHost = globalThis as { [RUNTIME_KEY]?: DevServerSurfaceRuntime }
const runtime: DevServerSurfaceRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  controllers: new Map(),
  leases: new Map(),
  userInterruptions: new Map(),
})

function createLeaseToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `devserver-lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function readLiveLease(tileId: string, now = Date.now()): DevServerSurfaceLease | null {
  const lease = runtime.leases.get(tileId)
  if (!lease) return null
  if (lease.expiresAt > now) return lease
  runtime.leases.delete(tileId)
  return null
}

export function registerDevServerSurfaceController(
  scopeKey: string,
  controller: DevServerSurfaceController,
): () => void {
  runtime.controllers.set(scopeKey, controller)
  return () => {
    if (runtime.controllers.get(scopeKey) === controller) {
      runtime.controllers.delete(scopeKey)
    }
  }
}

export async function ensureDevServerSurface(
  request: EnsureDevServerSurfaceRequest,
): Promise<DevServerSurfaceHandle> {
  const scopeKey = buildWorkbenchScopeKey(
    request.projectId,
    request.laneId,
    request.workspaceId,
  )
  const controller = runtime.controllers.get(scopeKey)
  if (!controller) {
    throw new Error("The requested project workbench is not available for preview automation.")
  }
  return await controller.ensureSurface(request)
}

export function focusDevServerSurface(scopeKey: string, tileId: string): boolean {
  return runtime.controllers.get(scopeKey)?.focusSurface(tileId) ?? false
}

export function claimDevServerSurface(
  tileIds: readonly string[],
  ownerId: string,
  ttlMs = DEFAULT_LEASE_TTL_MS,
): DevServerSurfaceLease | null {
  const now = Date.now()
  for (const tileId of tileIds) {
    const interruptedUntil = runtime.userInterruptions.get(tileId) ?? 0
    if (interruptedUntil > now) continue
    if (interruptedUntil > 0) runtime.userInterruptions.delete(tileId)
    const current = readLiveLease(tileId, now)
    if (current && current.ownerId !== ownerId) continue

    const lease: DevServerSurfaceLease = {
      token: current?.token ?? createLeaseToken(),
      tileId,
      ownerId,
      expiresAt: now + ttlMs,
    }
    runtime.leases.set(tileId, lease)
    return lease
  }
  return null
}

export function renewDevServerSurfaceLease(
  tileId: string,
  token: string,
  ttlMs = DEFAULT_LEASE_TTL_MS,
): boolean {
  const lease = readLiveLease(tileId)
  if (!lease || lease.token !== token) return false
  runtime.leases.set(tileId, { ...lease, expiresAt: Date.now() + ttlMs })
  return true
}

export function releaseDevServerSurfaceLease(tileId: string, token?: string): boolean {
  const lease = readLiveLease(tileId)
  if (!lease || (token && lease.token !== token)) return false
  runtime.leases.delete(tileId)
  return true
}

/** A direct user interaction always takes precedence over an agent lease. */
export function interruptDevServerSurfaceLease(tileId: string): void {
  runtime.leases.delete(tileId)
  runtime.userInterruptions.set(tileId, Date.now() + 15_000)
}

export function isDevServerSurfaceLeased(tileId: string): boolean {
  return readLiveLease(tileId) !== null
}
