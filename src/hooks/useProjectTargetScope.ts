import type { Id } from '../../convex/_generated/dataModel'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'

interface UseProjectTargetScopeOptions {
  route?: string
}

export function useProjectTargetScope(options: UseProjectTargetScopeOptions = {}) {
  const appContext = useScopedAppContext({ route: options.route })

  return {
    ...appContext,
    convexOrganizationId: appContext.convexOrganizationId as Id<'organizations'> | undefined,
    includeTeamStep: !appContext.personalScoped,
    canCreateProjects: appContext.capabilities.canCreateProjects,
    canImportProjects: appContext.capabilities.canImportProjects,
    canInviteAfterCreate: appContext.workspaceScoped,
  }
}

