import type { DevAppCapability } from "./devAppCapabilities"
import type { DevAppPackageToolSpec } from "./devAppPackage"

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
  runtimeKind: "static" | "node" | "container"
  location: "device" | "hosted"
  singleton?: boolean
}

export interface DevAppParts {
  view?: DevAppViewPart
  worker?: DevAppWorkerPart
  service?: DevAppServicePart
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
      ? { service: { runtimeKind: "node" as const, location: "device" as const } }
      : {}),
  }
}
