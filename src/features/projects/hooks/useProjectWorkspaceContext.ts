import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { useCachedQueryState } from '@/stores/useQueryCache'

interface UseProjectWorkspaceContextResult {
  organization: Doc<'organizations'> | null | undefined
  organizationId: Id<'organizations'> | null
  isLoading: boolean
  isRefreshing: boolean
  isPersonalWorkspace: boolean
  isOrganizationWorkspace: boolean
}

export function useProjectWorkspaceContext(
  project: Doc<'projects'> | null | undefined,
): UseProjectWorkspaceContextResult {
  const { convexOrg, convexOrganizationId, personalScoped } = useScopedAppContext()
  const activeWorkspaceMatchesProject =
    Boolean(project?.organizationId) && convexOrganizationId === project?.organizationId

  const freshOrganization = useQuery(
    api.organizations.get,
    project?.organizationId && !activeWorkspaceMatchesProject
      ? { id: project.organizationId }
      : 'skip',
  )
  const organizationState = useCachedQueryState(
    `project-workspace-${project?.organizationId ?? 'none'}`,
    freshOrganization,
  )

  return useMemo(() => {
    const resolvedOrganization =
      activeWorkspaceMatchesProject && convexOrg ? convexOrg : organizationState.data
    const isLoading =
      project === undefined ||
      (
        Boolean(project) &&
        !activeWorkspaceMatchesProject &&
        organizationState.data === undefined &&
        !organizationState.hasResolved
      )
    const organizationId = project?.organizationId ?? null
    const isPersonalWorkspace = activeWorkspaceMatchesProject
      ? personalScoped
      : Boolean(resolvedOrganization?.workosId?.startsWith('personal:'))

    return {
      organization: resolvedOrganization,
      organizationId,
      isLoading,
      isRefreshing: organizationState.isRefreshing,
      isPersonalWorkspace,
      isOrganizationWorkspace: Boolean(organizationId) && !isPersonalWorkspace,
    }
  }, [
    activeWorkspaceMatchesProject,
    convexOrg,
    organizationState.data,
    organizationState.hasResolved,
    organizationState.isRefreshing,
    personalScoped,
    project,
  ])
}
