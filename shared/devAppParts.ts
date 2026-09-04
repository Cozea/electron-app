import type { DevAppCapability } from "./devAppCapabilities"
import type { DevAppPackage, DevAppPackageToolSpec } from "./devAppPackage"
import {
  defaultNativeDevAppSurface,
  rendererModuleForSurface,
  type NativeDevAppManifestV3,
  type NativeDevAppSurfaceContribution,
} from "./nativeDevAppManifest"

/** How a visual surface is produced. */
export type DevAppViewSource = "native" | "package"
export type DevAppViewKind = "host" | "native-react" | "web-app"

export interface DevAppViewPart {
  source: DevAppViewSource
  kind?: DevAppViewKind
  /** For first-party host views compiled into Cozea. */
  rendererId?: string
  /** Immutable package output loaded for native-react or static web surfaces. */
  entryPath?: string
  /** Exported React component for a native module. */
  component?: string
  stylesPath?: string
  applicationId?: string
}

export interface DevAppSurfacePart {
  id: string
  title: string
  default?: boolean
  view: DevAppViewPart
  minimumWidth?: number
  minimumHeight?: number
  group?: "Development" | "Assistant" | "Utility"
}

/** Privileged development code running in Cozea's managed worker host. */
export interface DevAppWorkerPart {
  capabilities: DevAppCapability[]
  protocolVersion?: number
  tools?: DevAppPackageToolSpec[]
  entryPath?: string
  agentInvocable?: boolean
}

/** A long-lived or static service reached through a managed origin. */
export interface DevAppServicePart {
  runtimeKind: "static" | "node"
  singleton?: boolean
  /** Published Node services require an ingress network and disclose outbound reach. */
  network?: boolean
  id?: string
  entryPath?: string
  healthPath?: string
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
  /** Default visual surface retained for existing consumers. */
  view?: DevAppViewPart
  /** Complete installable surface catalog for manifest v3 packages. */
  surfaces?: DevAppSurfacePart[]
  worker?: DevAppWorkerPart
  service?: DevAppServicePart
  runtime?: DevAppRuntimePart
}

export type DevAppSurface = "tile" | "agentTool" | "backgroundService"

export function derivableSurfaces(parts: DevAppParts): DevAppSurface[] {
  const surfaces: DevAppSurface[] = []
  if (parts.view || (parts.surfaces?.length ?? 0) > 0) surfaces.push("tile")
  if ((parts.worker?.tools?.length ?? 0) > 0) surfaces.push("agentTool")
  if (parts.worker || (parts.service && parts.service.runtimeKind !== "static")) {
    surfaces.push("backgroundService")
  }
  return surfaces
}

/** The parts produced by Cozea's compatibility static/service artifact publisher. */
export function partsForPublishedRuntimeKind(runtimeKind: "static" | "service"): DevAppParts {
  return {
    view: { source: "package", kind: "web-app" },
    ...(runtimeKind === "service"
      ? {
          service: { runtimeKind: "node" as const, network: true },
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
 * Converts the former version-2 authoring manifest into immutable published release parts.
 * This remains for release rows produced before the native React cutover.
 */
export function partsForPublishedPackage(manifest: DevAppPackage): DevAppParts {
  const executable = Boolean(manifest.worker || manifest.service?.runtimeKind === "node")
  if (executable && !manifest.runtime) {
    throw new Error("Executable DevApps require an explicit runtime contract.")
  }
  return {
    ...(manifest.view || executable
      ? { view: { source: "package" as const, kind: "web-app" as const, entryPath: manifest.view?.entry } }
      : {}),
    ...(manifest.worker
      ? {
          worker: {
            capabilities: manifest.worker.capabilities,
            protocolVersion: manifest.worker.protocolVersion,
            entryPath: manifest.worker.entry,
            ...(manifest.worker.tools.length > 0 ? { tools: manifest.worker.tools } : {}),
          },
        }
      : {}),
    ...(manifest.service
      ? {
          service: {
            runtimeKind: manifest.service.runtimeKind,
            ...(manifest.service.entry ? { entryPath: manifest.service.entry } : {}),
            ...(manifest.service.runtimeKind === "node" ? { network: true } : {}),
          },
        }
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

function viewForNativeSurface(
  manifest: NativeDevAppManifestV3,
  surface: NativeDevAppSurfaceContribution,
): DevAppViewPart {
  if (surface.renderer.kind === "native-react") {
    const module = rendererModuleForSurface(manifest, surface)
    if (!module) throw new Error(`Native DevApp surface ${surface.id} has no renderer module.`)
    return {
      source: "package",
      kind: "native-react",
      entryPath: module.output,
      component: surface.renderer.component,
      ...(module.styles ? { stylesPath: module.styles.output } : {}),
    }
  }
  const application = manifest.webApplications?.[surface.renderer.application]
  if (!application) throw new Error(`Native DevApp surface ${surface.id} has no web application.`)
  return {
    source: "package",
    kind: "web-app",
    applicationId: surface.renderer.application,
    ...(application.entry ? { entryPath: application.entry } : {}),
  }
}

/** Converts a manifest-v3 app into the immutable surface/runtime model stored with a release. */
export function partsForNativeDevAppManifest(manifest: NativeDevAppManifestV3): DevAppParts {
  const surfaces: DevAppSurfacePart[] = manifest.contributes.surfaces.map((surface) => ({
    id: surface.id,
    title: surface.title,
    ...(surface.default ? { default: true } : {}),
    view: viewForNativeSurface(manifest, surface),
    ...(surface.placement?.minimumWidth
      ? { minimumWidth: surface.placement.minimumWidth }
      : {}),
    ...(surface.placement?.minimumHeight
      ? { minimumHeight: surface.placement.minimumHeight }
      : {}),
    ...(surface.placement?.group ? { group: surface.placement.group } : {}),
  }))
  const defaultSurface = defaultNativeDevAppSurface(manifest)
  const primaryServiceEntry = Object.entries(manifest.services ?? {})[0]
  const primaryService = primaryServiceEntry?.[1]
  const executable = Boolean(manifest.extension || primaryService)
  const runtimeLocation = primaryService?.location ?? "device"
  const runtimeState = primaryService?.state ?? (manifest.extension ? "device" : "none")

  return {
    view: viewForNativeSurface(manifest, defaultSurface),
    surfaces,
    ...(manifest.extension
      ? {
          worker: {
            capabilities: manifest.extension.capabilities,
            protocolVersion: manifest.extension.protocolVersion,
            entryPath: manifest.extension.output,
            agentInvocable: manifest.extension.agentInvocable === true,
            ...(manifest.extension.tools.length > 0
              ? { tools: manifest.extension.tools as DevAppPackageToolSpec[] }
              : {}),
          },
        }
      : {}),
    ...(primaryServiceEntry && primaryService
      ? {
          service: {
            id: primaryServiceEntry[0],
            runtimeKind: "node" as const,
            singleton: true,
            network: true,
            entryPath: primaryService.entry,
            ...(primaryService.healthPath ? { healthPath: primaryService.healthPath } : {}),
          },
        }
      : {}),
    ...(executable
      ? {
          runtime: {
            kind: "container" as const,
            location: runtimeLocation,
            state: runtimeState,
          },
        }
      : {}),
  }
}
