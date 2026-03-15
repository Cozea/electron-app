import type { Id } from "../../../convex/_generated/dataModel"
import type {
  OrganizationWorkspaceMembership,
  PersonalWorkspaceMembership,
  WorkspaceMembership,
} from "@shared/types"

export type ScopeKind = "personal" | "workspace"
export type RouteScopeKind =
  | "personal-settings"
  | "workspace-settings"
  | "workspace-team"
  | "neutral"

export interface ResolveScopeInput {
  routePath?: string | null
  currentOrganizationWorkspace: OrganizationWorkspaceMembership | null
  currentPersonalWorkspace: PersonalWorkspaceMembership | null
  personalWorkspace: PersonalWorkspaceMembership | null
}

export interface ResolvedScope {
  routePath: string
  routeScopeKind: RouteScopeKind
  activeWorkspace: WorkspaceMembership | null
  currentOrganizationWorkspace: OrganizationWorkspaceMembership | null
  currentPersonalWorkspace: PersonalWorkspaceMembership | null
  personalWorkspace: PersonalWorkspaceMembership | null
  activeScopeKind: ScopeKind | null
  scopedWorkspace: WorkspaceMembership | null
  scopedScopeKind: ScopeKind | null
  isOrganizationWorkspace: boolean
  isPersonalWorkspace: boolean
  workspaceScoped: boolean
  personalScoped: boolean
  organizationScoped: boolean
  activeOrganizationId: string | null
  activeConvexOrganizationId: Id<"organizations"> | undefined
  scopedOrganizationId: string | null
  scopedConvexOrganizationId: Id<"organizations"> | undefined
}

function normalizeRoutePath(value?: string | null): string {
  if (!value) return "/"
  const [path] = value.split("?")
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`
  return withLeadingSlash.replace(/\/+$/, "") || "/"
}

function mapWorkspaceTypeToScopeKind(
  workspaceType?: WorkspaceMembership["workspaceType"] | null
): ScopeKind | null {
  if (workspaceType === "organization") {
    return "workspace"
  }

  if (workspaceType === "personal") {
    return "personal"
  }

  return null
}

export function getRouteScopeKind(routePath?: string | null): RouteScopeKind {
  const normalizedRoute = normalizeRoutePath(routePath)

  if (normalizedRoute.startsWith("/settings/")) {
    return "personal-settings"
  }

  if (normalizedRoute.startsWith("/workspace/")) {
    return "workspace-settings"
  }

  if (normalizedRoute === "/teams" || normalizedRoute.startsWith("/teams/")) {
    return "workspace-team"
  }

  return "neutral"
}

export function resolveScope(input: ResolveScopeInput): ResolvedScope {
  const routePath = normalizeRoutePath(input.routePath)
  const routeScopeKind = getRouteScopeKind(routePath)
  const activeWorkspace = input.currentOrganizationWorkspace ?? input.currentPersonalWorkspace ?? null
  const activeScopeKind = mapWorkspaceTypeToScopeKind(activeWorkspace?.workspaceType ?? null)

  const workspaceScoped =
    routeScopeKind === "workspace-settings" || routeScopeKind === "workspace-team"
  const personalScoped = routeScopeKind === "personal-settings"
  const organizationScoped = workspaceScoped

  const scopedWorkspace = personalScoped
    ? input.personalWorkspace
    : organizationScoped
      ? input.currentOrganizationWorkspace
      : activeWorkspace

  const scopedScopeKind = mapWorkspaceTypeToScopeKind(scopedWorkspace?.workspaceType ?? null)

  return {
    routePath,
    routeScopeKind,
    activeWorkspace,
    currentOrganizationWorkspace: input.currentOrganizationWorkspace,
    currentPersonalWorkspace: input.currentPersonalWorkspace,
    personalWorkspace: input.personalWorkspace,
    activeScopeKind,
    scopedWorkspace,
    scopedScopeKind,
    isOrganizationWorkspace: activeScopeKind === "workspace",
    isPersonalWorkspace: activeScopeKind === "personal",
    workspaceScoped,
    personalScoped,
    organizationScoped,
    activeOrganizationId: activeWorkspace?.organizationId ?? null,
    activeConvexOrganizationId:
      (activeWorkspace?.convexOrgId as Id<"organizations"> | undefined) ?? undefined,
    scopedOrganizationId: scopedWorkspace?.organizationId ?? null,
    scopedConvexOrganizationId:
      (scopedWorkspace?.convexOrgId as Id<"organizations"> | undefined) ?? undefined,
  }
}
