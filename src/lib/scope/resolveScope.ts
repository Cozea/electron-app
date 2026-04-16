import type { PersonalWorkspaceMembership } from "@shared/types"

export type ScopeKind = "personal"
export type RouteScopeKind = "personal-settings" | "neutral"

export interface ResolveScopeInput {
  routePath?: string | null
  personalWorkspace: PersonalWorkspaceMembership | null
}

export interface ResolvedScope {
  routePath: string
  routeScopeKind: RouteScopeKind
  activeWorkspace: PersonalWorkspaceMembership | null
  currentOrganizationWorkspace: null
  currentPersonalWorkspace: PersonalWorkspaceMembership | null
  personalWorkspace: PersonalWorkspaceMembership | null
  activeScopeKind: ScopeKind | null
  scopedWorkspace: PersonalWorkspaceMembership | null
  scopedScopeKind: ScopeKind | null
  isOrganizationWorkspace: false
  isPersonalWorkspace: boolean
  workspaceScoped: false
  personalScoped: boolean
  organizationScoped: false
  activeOrganizationId: string | null
  scopedOrganizationId: string | null
}

function normalizeRoutePath(value?: string | null): string {
  if (!value) return "/"
  const [path] = value.split("?")
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`
  return withLeadingSlash.replace(/\/+$/, "") || "/"
}

export function getRouteScopeKind(routePath?: string | null): RouteScopeKind {
  const normalizedRoute = normalizeRoutePath(routePath)
  const unprefixedRoute = normalizedRoute.startsWith("/projects/")
    ? `/${normalizedRoute.slice("/projects/".length)}`
    : normalizedRoute

  if (unprefixedRoute.startsWith("/settings/")) {
    return "personal-settings"
  }

  return "neutral"
}

export function resolveScope(input: ResolveScopeInput): ResolvedScope {
  const routePath = normalizeRoutePath(input.routePath)
  const routeScopeKind = getRouteScopeKind(routePath)
  const activeWorkspace = input.personalWorkspace
  const activeScopeKind = activeWorkspace ? "personal" : null
  const personalScoped = routeScopeKind === "personal-settings"
  const scopedWorkspace = personalScoped ? input.personalWorkspace : activeWorkspace
  const scopedScopeKind = scopedWorkspace ? "personal" : null

  return {
    routePath,
    routeScopeKind,
    activeWorkspace,
    currentOrganizationWorkspace: null,
    currentPersonalWorkspace: input.personalWorkspace,
    personalWorkspace: input.personalWorkspace,
    activeScopeKind,
    scopedWorkspace,
    scopedScopeKind,
    isOrganizationWorkspace: false,
    isPersonalWorkspace: activeScopeKind === "personal",
    workspaceScoped: false,
    personalScoped,
    organizationScoped: false,
    activeOrganizationId: activeWorkspace?.organizationId ?? null,
    scopedOrganizationId: scopedWorkspace?.organizationId ?? null,
  }
}
