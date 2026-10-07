import { buildLegacyProjectPath, buildProjectPath } from "./projectRoutes"

/** Keep deep-link intents and URL suffixes while selecting the existing local entry. */
export function canonicalLocalProjectRoute(input: {
  href: string
  routeProjectId?: string | null
  routeSlug?: string | null
  localProjectId: string | null
  state: unknown
}): { href: string; state: unknown } | null {
  if (!input.localProjectId || input.routeProjectId === input.localProjectId) return null
  const oldBase = input.routeProjectId ? buildProjectPath(input.routeProjectId)
    : input.routeSlug ? buildLegacyProjectPath(input.routeSlug) : null
  if (!oldBase || !input.href.startsWith(oldBase) || !["/", "?", "#", ""].includes(input.href.charAt(oldBase.length))) return null
  const state = input.state && typeof input.state === "object" && !Array.isArray(input.state)
    ? input.state as Record<string, unknown> : null
  // A hint for another project remains untrusted after canonicalization.
  const ownsHint = state && (state.projectId ? state.projectId === input.routeProjectId
    : state.projectSlug === input.routeSlug)
  return {
    href: buildProjectPath(input.localProjectId) + input.href.slice(oldBase.length),
    state: ownsHint ? { ...state, projectId: input.localProjectId } : input.state,
  }
}
