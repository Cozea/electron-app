export interface ProjectRouteNavigationState {
  projectId?: string | null
  projectSlug?: string | null
  projectName?: string | null
  /** Catalog workspace UUID (phase 4+) or filesystem path hint (legacy). */
  preferredWorkspaceId?: string | null
}

interface ResolveTrustedProjectRouteNavigationStateArgs {
  state: unknown
  routeProjectId?: string | null
  routeProjectSlug?: string | null
  resolvedProjectId?: string | null
  resolvedProjectSlug?: string | null
}

function normalizeNavigationText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readProjectRouteNavigationState(
  state: unknown,
): ProjectRouteNavigationState | null {
  if (!state || typeof state !== "object") {
    return null
  }

  const typedState = state as Partial<ProjectRouteNavigationState>
  const projectId = normalizeNavigationText(typedState.projectId)
  const projectSlug = normalizeNavigationText(typedState.projectSlug)
  const projectName = normalizeNavigationText(typedState.projectName)
  const preferredWorkspaceId = normalizeNavigationText(typedState.preferredWorkspaceId)

  if (!projectId && !projectSlug && !projectName && !preferredWorkspaceId) {
    return null
  }

  return {
    projectId,
    projectSlug,
    projectName,
    preferredWorkspaceId,
  }
}

function matchesProjectRouteState(args: {
  state: ProjectRouteNavigationState
  routeProjectId?: string | null
  routeProjectSlug?: string | null
  resolvedProjectId?: string | null
  resolvedProjectSlug?: string | null
}): boolean {
  const candidateProjectIds = new Set(
    [
      normalizeNavigationText(args.routeProjectId),
      normalizeNavigationText(args.resolvedProjectId),
    ].filter((value): value is string => Boolean(value)),
  )
  const candidateProjectSlugs = new Set(
    [
      normalizeNavigationText(args.routeProjectSlug),
      normalizeNavigationText(args.resolvedProjectSlug),
    ].filter((value): value is string => Boolean(value)),
  )

  if (args.state.projectId) {
    return candidateProjectIds.has(args.state.projectId)
  }

  if (args.state.projectSlug) {
    return candidateProjectSlugs.has(args.state.projectSlug)
  }

  return false
}

export function resolveTrustedProjectRouteNavigationState(
  args: ResolveTrustedProjectRouteNavigationStateArgs,
): ProjectRouteNavigationState | null {
  const navigationState = readProjectRouteNavigationState(args.state)
  if (!navigationState) {
    return null
  }

  return matchesProjectRouteState({
    state: navigationState,
    routeProjectId: args.routeProjectId,
    routeProjectSlug: args.routeProjectSlug,
    resolvedProjectId: args.resolvedProjectId,
    resolvedProjectSlug: args.resolvedProjectSlug,
  })
    ? navigationState
    : null
}

export function buildProjectRouteNavigationState<
  TExtras extends Record<string, unknown> = Record<never, never>,
>(
  input: ProjectRouteNavigationState,
  extras?: TExtras,
): ProjectRouteNavigationState & TExtras {
  const state = { ...extras } as ProjectRouteNavigationState & TExtras
  const projectId = normalizeNavigationText(input.projectId)
  const projectSlug = normalizeNavigationText(input.projectSlug)
  const projectName = normalizeNavigationText(input.projectName)
  const preferredWorkspaceId = normalizeNavigationText(input.preferredWorkspaceId)

  if (projectId) {
    state.projectId = projectId
  }
  if (projectSlug) {
    state.projectSlug = projectSlug
  }
  if (projectName) {
    state.projectName = projectName
  }
  if (preferredWorkspaceId) {
    state.preferredWorkspaceId = preferredWorkspaceId
  }

  return state
}
