import type { DevAppCapability } from "./devAppCapabilities"
import type { DevAppPackage, DevAppPackageToolSpec } from "./devAppPackage"

/** How a tile's content is produced. Views never hold host capabilities. */
export type DevAppViewSource = "native" | "package"

export interface DevAppViewPart {
  source: DevAppViewSource
  /** For native views, the renderer compiled into Cozea. */
  rendererId?: string
}

/** Privileged development code running in Cozea's managed worker host. */
export interface DevAppWorkerPart {
  capabilities: DevAppCapability[]
  protocolVersion?: number
  tools?: DevAppPackageToolSpec[]
}

/** A long-lived or static service reached through a managed origin. */
export interface DevAppServicePart {
  runtimeKind: "static" | "node"
  singleton?: boolean
}

/** Where third-party executable code is allowed to run. */
export type DevAppRuntimeLocation = "device" | "hosted"

/** Who owns state created by the executable package runtime. */
export type DevAppStateScope = "none" | "device" | "organization"

/**
 * The execution boundary is independent from the workload inside it.
 *
 * `development` is intentionally powerful, user-approved code from a local project.
 * `container` is the only valid boundary for published worker or service code.
 */
export interface DevAppRuntimePart {
  kind: "development" | "container"
  location: DevAppRuntimeLocation
  state: DevAppStateScope
}

export interface DevAppParts {
  view?: DevAppViewPart
  worker?: DevAppWorkerPart
  service?: DevAppServicePart
  runtime?: DevAppRuntimePart
}

export type DevAppSurface = "tile" | "agentTool" | "backgroundService"

export function derivableSurfaces(parts: DevAppParts): DevAppSurface[] {
  const surfaces: DevAppSurface[] = []
  if (parts.view) surfaces.push("tile")
  if ((parts.worker?.tools?.length ?? 0) > 0) surfaces.push("agentTool")
  if (parts.worker || (parts.service && parts.service.runtimeKind !== "static")) {
    surfaces.push("backgroundService")
  }
  return surfaces
}

/** The parts produced by Cozea's current static/service artifact publisher. */
export function partsForPublishedRuntimeKind(runtimeKind: "static" | "service"): DevAppParts {
  return {
    view: { source: "package" },
    ...(runtimeKind === "service"
      ? {
          service: { runtimeKind: "node" as const },
          runtime: {
            kind: "container" as const,
            location: "device" as const,
            state: "device" as const,
          },
        }
      : {}),
  }
}

/**
 * Converts the exact authored manifest into immutable published release parts.
 *
 * Development and publication deliberately share the same workload description, but not the
 * execution boundary. Published executable code always uses the contained adapter and retains
 * the manifest's explicit placement/state contract.
 */
export function partsForPublishedPackage(manifest: DevAppPackage): DevAppParts {
  const executable = Boolean(manifest.worker || manifest.service?.runtimeKind === "node")
  if (executable && !manifest.runtime) {
    throw new Error("Executable DevApps require an explicit runtime contract.")
  }
  return {
    ...(manifest.view ? { view: { source: "package" as const } } : {}),
    ...(manifest.worker
      ? {
          worker: {
            capabilities: manifest.worker.capabilities,
            protocolVersion: manifest.worker.protocolVersion,
            ...(manifest.worker.tools.length > 0 ? { tools: manifest.worker.tools } : {}),
          },
        }
      : {}),
    ...(manifest.service
      ? { service: { runtimeKind: manifest.service.runtimeKind } }
      : {}),
    ...(executable
      ? {
          runtime: {
            kind: "container" as const,
            location: manifest.runtime!.location,
            state: manifest.runtime!.state,
          },
        }
      : {}),
  }
}
