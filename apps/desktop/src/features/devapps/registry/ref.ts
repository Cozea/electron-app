import { BUILTIN_DEV_APPS } from "@/features/devapps/registry"
import type { DevAppLaunchSpec, DevAppManifest } from "@/features/devapps/registry/types"

/**
 * A durable, transportable handle for a DevApp.
 *
 * Built-ins can be addressed by id today, but a published DevApp cannot be addressed at
 * all: it exists only as a fully-materialized `PublishedDevAppLaunchSpec` handed to the
 * launcher, carrying release id, content hash and entry path inline. A caller that does
 * not already hold that payload has no way to name the app — which is precisely why one
 * project cannot reference a DevApp published from another.
 *
 * A ref is the missing name. It survives storage, crosses project boundaries, and is
 * short enough for a person or an agent to write by hand.
 */
export type DevAppRef =
  | { kind: "builtin"; appId: string }
  /**
   * An unpublished package being developed on this machine.
   *
   * Identified by an opaque id derived from its local path rather than by the path
   * itself: refs are persisted in workbench state and handed to agents, and a developer's
   * directory layout does not belong in either. It also keeps the ref grammar tight.
   */
  | { kind: "development"; sourceId: string }
  | {
      kind: "publication"
      organizationId: string
      publicationId: string
      /**
       * Which release this points at. `"latest"` follows the publication's active
       * release; a number pins one. Pinning is meaningless today — every consumer
       * silently follows the active release — but the ref has to be able to express it
       * before installation semantics can offer "update available" rather than a forced
       * jump.
       */
      version: number | "latest"
    }

export const DEV_APP_REF_SCHEME = "cozea-devapp"

/** Refs arrive from stored config and from agents, so the grammar is deliberately tight. */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_REF_LENGTH = 512

function isValidSegment(value: string): boolean {
  return SEGMENT_PATTERN.test(value)
}

export function formatDevAppRef(ref: DevAppRef): string {
  if (ref.kind === "builtin") return `${DEV_APP_REF_SCHEME}:builtin/${ref.appId}`
  if (ref.kind === "development") return `${DEV_APP_REF_SCHEME}:dev/${ref.sourceId}`
  const version = ref.version === "latest" ? "" : `@${ref.version}`
  return `${DEV_APP_REF_SCHEME}:${ref.organizationId}/${ref.publicationId}${version}`
}

/**
 * Parses a ref, returning null rather than throwing on anything malformed.
 *
 * Never assume the input is well-formed or trusted: refs come from persisted workbench
 * state and from agent-authored manifests. `builtin` and `dev` are both reserved as
 * organization segments, so a publication can impersonate neither a first-party app nor
 * an in-development one — the second matters because development trust is provisional and
 * must never be mistaken for approval given to a published release.
 */
export function parseDevAppRef(value: string): DevAppRef | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REF_LENGTH) return null

  const prefix = `${DEV_APP_REF_SCHEME}:`
  if (!value.startsWith(prefix)) return null
  const body = value.slice(prefix.length)

  const slash = body.indexOf("/")
  if (slash <= 0) return null
  const owner = body.slice(0, slash)
  const rest = body.slice(slash + 1)
  if (!rest || rest.includes("/")) return null

  if (owner === "builtin") {
    if (rest.includes("@") || !isValidSegment(rest)) return null
    return { kind: "builtin", appId: rest }
  }

  if (owner === "dev") {
    // No version: an in-development package has no releases to pin.
    if (rest.includes("@") || !isValidSegment(rest)) return null
    return { kind: "development", sourceId: rest }
  }

  if (!isValidSegment(owner)) return null

  const at = rest.lastIndexOf("@")
  if (at === -1) {
    return isValidSegment(rest)
      ? { kind: "publication", organizationId: owner, publicationId: rest, version: "latest" }
      : null
  }

  const publicationId = rest.slice(0, at)
  const versionText = rest.slice(at + 1)
  if (!isValidSegment(publicationId)) return null
  if (!/^[0-9]{1,9}$/.test(versionText)) return null
  const version = Number.parseInt(versionText, 10)
  if (!Number.isSafeInteger(version) || version < 1) return null
  return { kind: "publication", organizationId: owner, publicationId, version }
}

export function devAppRefsEqual(left: DevAppRef, right: DevAppRef): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "builtin" && right.kind === "builtin") return left.appId === right.appId
  if (left.kind === "development" && right.kind === "development") {
    return left.sourceId === right.sourceId
  }
  if (left.kind === "publication" && right.kind === "publication") {
    return (
      left.organizationId === right.organizationId &&
      left.publicationId === right.publicationId &&
      left.version === right.version
    )
  }
  return false
}

/** True when both refs name the same app, disregarding which release they point at. */
export function devAppRefsSameApp(left: DevAppRef, right: DevAppRef): boolean {
  if (left.kind === "builtin" && right.kind === "builtin") return left.appId === right.appId
  // Deliberately not equal to any publication, even the one it is being developed into:
  // "same app" is what trust and installation decisions key on.
  if (left.kind === "development" && right.kind === "development") {
    return left.sourceId === right.sourceId
  }
  if (left.kind === "publication" && right.kind === "publication") {
    return left.organizationId === right.organizationId && left.publicationId === right.publicationId
  }
  return false
}

/**
 * Derives a durable ref from a launch spec.
 *
 * Existing tiles carry launch specs rather than refs, so this is how already-persisted
 * workbench state gains addressable identity without a migration.
 */
export function refForLaunchSpec(launch: DevAppLaunchSpec): DevAppRef | null {
  if (launch.kind === "publishedDevApp") {
    return {
      kind: "publication",
      organizationId: launch.organizationId,
      publicationId: launch.publicationId,
      version: launch.releaseVersion,
    }
  }
  if (launch.kind === "projectDevApp") return null

  const manifest = BUILTIN_DEV_APPS.find((candidate) => candidate.launch.kind === launch.kind)
  return manifest ? { kind: "builtin", appId: manifest.id } : null
}

/** Resolves the built-in half of a ref. Publications resolve against Convex, not here. */
export function resolveBuiltinRef(ref: DevAppRef): DevAppManifest | null {
  if (ref.kind !== "builtin") return null
  return BUILTIN_DEV_APPS.find((manifest) => manifest.id === ref.appId) ?? null
}
