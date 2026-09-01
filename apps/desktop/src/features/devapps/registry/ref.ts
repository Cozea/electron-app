import { BUILTIN_DEV_APPS } from "@/features/devapps/registry"
import type { DevAppLaunchSpec, DevAppManifest } from "@/features/devapps/registry/types"
import { parseDevAppRef, type DevAppRef } from "@shared/devAppRef"

export {
  DEV_APP_REF_SCHEME,
  devAppRefsEqual,
  devAppRefsSameApp,
  formatDevAppRef,
  parseDevAppRef,
  type DevAppRef,
} from "@shared/devAppRef"

/**
 * Derives a durable ref from a launch spec.
 *
 * Published specs must carry the originating ref so a `latest` reference is never
 * silently rewritten as a pinned one (or vice versa) from materialized release data.
 */
export function refForLaunchSpec(launch: DevAppLaunchSpec): DevAppRef | null {
  if (launch.kind === "publishedDevApp") {
    const ref = parseDevAppRef(launch.ref)
    return ref?.kind === "publication" &&
      ref.organizationId === launch.organizationId &&
      ref.publicationId === launch.publicationId
      ? ref
      : null
  }
  if (launch.kind === "projectDevApp") return null
  if (launch.kind === "developmentDevApp") {
    const ref = parseDevAppRef(launch.ref)
    return ref?.kind === "development" && ref.sourceId === launch.sourceId ? ref : null
  }

  const manifest = BUILTIN_DEV_APPS.find((candidate) => candidate.launch.kind === launch.kind)
  return manifest ? { kind: "builtin", appId: manifest.id } : null
}

/** Resolves the built-in half of a ref. Publications resolve against Convex, not here. */
export function resolveBuiltinRef(ref: DevAppRef): DevAppManifest | null {
  if (ref.kind !== "builtin") return null
  return BUILTIN_DEV_APPS.find((manifest) => manifest.id === ref.appId) ?? null
}
