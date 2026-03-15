import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'

interface UseProjectWorkspaceContextResult {
  organization: Doc<'organizations'> | null | undefined
  organizationId: Id<'organizations'> | null
  isLoading: boolean
  isPersonalWorkspace: boolean
  isOrganizationWorkspace: boolean
}

export function useProjectWorkspaceContext(
  project: Doc<'projects'> | null | undefined,
): UseProjectWorkspaceContextResult {
  const { convexOrg, convexOrganizationId, personalScoped } = useScopedAppContext()
  const activeWorkspaceMatchesProject =
    Boolean(project?.organizationId) && convexOrganizationId === project?.organizationId

  const organization = useQuery(
    api.organizations.get,
    project?.organizationId && !activeWorkspaceMatchesProject
      ? { id: project.organizationId }
      : 'skip',
  )

  return useMemo(() => {
    const resolvedOrganization =
      activeWorkspaceMatchesProject && convexOrg ? convexOrg : organization
    const isLoading =
      project === undefined ||
      (Boolean(project) && !activeWorkspaceMatchesProject && organization === undefined)
    const organizationId = project?.organizationId ?? null
    const isPersonalWorkspace = activeWorkspaceMatchesProject
      ? personalScoped
      : Boolean(resolvedOrganization?.workosId?.startsWith('personal:'))

    return {
      organization: resolvedOrganization,
      organizationId,
      isLoading,
      isPersonalWorkspace,
      isOrganizationWorkspace: Boolean(organizationId) && !isPersonalWorkspace,
    }
  }, [activeWorkspaceMatchesProject, convexOrg, organization, personalScoped, project])
}
