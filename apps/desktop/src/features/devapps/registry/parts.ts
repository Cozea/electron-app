import type { DevAppCapability } from "@shared/devAppCapabilities"

import type { DevAppLaunchSpec } from "@/features/devapps/registry/types"

/**
 * A DevApp described as composable parts rather than as one of a fixed set of kinds.
 *
 * `DevAppLaunchSpec` multiplies four independent concerns into a single closed union —
 * what the app is, where it runs, how it is presented, and what it exposes — so every new
 * combination costs a variant, a renderer switch case, and store fields. Parts separate
 * those concerns so combinations compose instead.
 *
 * This module is descriptive only. Nothing dispatches on it yet: the launch spec remains
 * the runtime path, and `partsForLaunchSpec` proves the model expresses everything that
 * ships today before any consumer depends on it.
 */

/** How a tile's content is produced. Views are never privileged. */
export type DevAppViewSource =
  /** Rendered by a component compiled into Cozea. */
  | "native"
  /** Web content carried in an installed package, served from a per-release origin. */
  | "package"

export interface DevAppViewPart {
  source: DevAppViewSource
  /** For native views, the renderer this resolves to. */
  rendererId?: string
}

/**
 * Privileged code running in a Cozea-managed host, holding the capabilities the manifest
 * declared and the user approved.
 *
 * Capabilities are drawn from the settled vocabulary in `@shared/devAppCapabilities`,
 * which is deliberately scoped: `project.read` is bounded to the granting workspace and
 * is a different capability from machine-wide `fs.read`.
 */
export interface DevAppWorkerPart {
  capabilities: ReadonlyArray<DevAppCapability>
  /** Whether the worker exposes operations agents may call. */
  exposesTools?: boolean
}

/** An unprivileged long-lived server reached over an origin. */
export interface DevAppServicePart {
  runtimeKind: "static" | "node" | "container"
  location: "device" | "hosted"
  /** True when at most one instance may exist for its owning scope. */
  singleton?: boolean
}

export interface DevAppParts {
  view?: DevAppViewPart
  worker?: DevAppWorkerPart
  service?: DevAppServicePart
}

/**
 * Where a DevApp may appear. Derived from its parts, never declared by its author — so
 * adding a surface later is one resolver rather than an edit to every manifest and every
 * release already published.
 */
export type DevAppSurface = "tile" | "agentTool" | "backgroundService"

export function derivableSurfaces(parts: DevAppParts): DevAppSurface[] {
  const surfaces: DevAppSurface[] = []
  if (parts.view) surfaces.push("tile")
  if (parts.worker?.exposesTools) surfaces.push("agentTool")
  // Anything with a long-lived process can outlive the tile that opened it. A static
  // service is only files, so it has nothing to keep running.
  if (parts.worker || (parts.service && parts.service.runtimeKind !== "static")) {
    surfaces.push("backgroundService")
  }
  return surfaces
}

const NATIVE_VIEW = (rendererId: string): DevAppViewPart => ({ source: "native", rendererId })

/**
 * Expresses a shipping launch spec as parts.
 *
 * Every variant in the union must map, which is the point: if a real DevApp cannot be
 * described as parts, the model is wrong and this is where that shows up — before any
 * consumer, published release, or granted approval depends on it.
 */
export function partsForLaunchSpec(launch: DevAppLaunchSpec): DevAppParts {
  switch (launch.kind) {
    case "browser":
      return { view: NATIVE_VIEW("browser") }

    case "terminal":
      // A terminal is the clearest example of the split: native chrome over a
      // privileged pty.
      return {
        view: NATIVE_VIEW("terminal"),
        worker: { capabilities: ["terminal.spawn"] },
      }

    case "devServer":
      return {
        view: NATIVE_VIEW("devServer"),
        worker: { capabilities: ["process.spawn", "project.read"] },
        service: { runtimeKind: "node", location: "device", singleton: true },
      }

    case "llama":
      return {
        view: NATIVE_VIEW("llama"),
        service: { runtimeKind: "node", location: "device", singleton: true },
      }

    case "mobileSimulator":
      return {
        view: NATIVE_VIEW("mobileSimulator"),
        worker: { capabilities: ["process.spawn"] },
      }

    case "assistantChat":
      return {
        view: NATIVE_VIEW("assistantChat"),
        worker: { capabilities: ["project.read", "project.write", "process.spawn"] },
      }

    case "publishedDevApp":
      return {
        view: { source: "package" },
        ...(launch.runtimeKind === "service"
          ? { service: { runtimeKind: "node" as const, location: "device" as const } }
          : {}),
      }

    case "projectDevApp":
      return {
        view: { source: "package" },
        service: { runtimeKind: "node", location: "device", singleton: true },
      }
  }
}
