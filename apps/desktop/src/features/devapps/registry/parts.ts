import type { DevAppPackage } from "@shared/devAppPackage"
import type { DevAppParts, DevAppViewPart } from "@shared/devAppParts"

export {
  derivableSurfaces,
  type DevAppParts,
  type DevAppServicePart,
  type DevAppRuntimeLocation,
  type DevAppRuntimePart,
  type DevAppStateScope,
  type DevAppSurface,
  type DevAppViewPart,
  type DevAppViewSource,
  type DevAppWorkerPart,
} from "@shared/devAppParts"

import type { DevAppLaunchSpec } from "@/features/devapps/registry/types"

/**
 * A DevApp described as composable parts rather than as one of a fixed set of kinds.
 *
 * `DevAppLaunchSpec` multiplies four independent concerns into a single closed union —
 * what the app is, where it runs, how it is presented, and what it exposes — so every new
 * combination costs a variant, a renderer switch case, and store fields. Parts separate
 * those concerns so combinations compose instead.
 *
 * Surface discovery dispatches on this model. Built-in and machine-local compatibility
 * surfaces can still be expressed from their launch spec. Published release parts come
 * only from their immutable Convex record.
 */

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
        service: { runtimeKind: "node", singleton: true },
      }

    case "llama":
      return {
        view: NATIVE_VIEW("llama"),
        service: { runtimeKind: "node", singleton: true },
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
      throw new Error("Published DevApp parts must come from the immutable release record")

    case "developmentDevApp":
      throw new Error("Development DevApp parts must come from the authored package")

    case "projectDevApp":
      return {
        view: { source: "package" },
        service: { runtimeKind: "node", singleton: true },
      }
  }
}

/**
 * Expresses an authored package as parts.
 *
 * This is what keeps development honest. A package loaded from a local path and the same
 * package once published both become `DevAppParts`, so surface availability, the worker
 * host, and the capability gate see one shape. "Works in dev, fails on publish" needs
 * the two paths to differ somewhere, and this is the join that stops them from differing
 * here.
 */
export function partsForPackage(manifest: DevAppPackage): DevAppParts {
  const hasExecutablePart = Boolean(manifest.worker || manifest.service?.runtimeKind === "node")
  return {
    // Authored views are always package-sourced. `native` is reserved for components
    // compiled into Cozea, which a published package can never become.
    ...(manifest.view || hasExecutablePart ? { view: { source: "package" as const } } : {}),
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
      ? {
          service: {
            runtimeKind: manifest.service.runtimeKind,
          },
        }
      : {}),
    ...(hasExecutablePart
      ? {
          runtime: {
            kind: "development" as const,
            location: "device" as const,
            // Development is always local. Organization state becomes device-scoped test
            // state until the exact package is published into its declared hosted runtime.
            state: manifest.runtime?.state === "none" ? ("none" as const) : ("device" as const),
          },
        }
      : {}),
  }
}
