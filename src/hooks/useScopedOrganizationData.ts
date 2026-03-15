import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useCachedQuery } from '@/stores/useQueryCache'
import { useResolvedScope } from '@/hooks/useResolvedScope'

interface UseScopedOrganizationDataOptions {
  route?: string
  forceOrganizationScope?: boolean
}

export function useScopedOrganizationData(options?: UseScopedOrganizationDataOptions) {
  const { route, forceOrganizationScope = false } = options ?? {}
  const {
    organizationScoped,
    scopedOrganizationId,
    scopedConvexOrganizationId,
  } = useResolvedScope({ route })

  const shouldResolveOrganization =
    forceOrganizationScope || organizationScoped || Boolean(scopedOrganizationId)

  const freshOrgById = useQuery(
    api.organizations.get,
    shouldResolveOrganization && scopedConvexOrganizationId ? { id: scopedConvexOrganizationId } : 'skip',
  )
  const cachedOrgById = useCachedQuery(
    `scoped-org-id-${scopedConvexOrganizationId ?? 'none'}`,
    freshOrgById,
  )

  const freshOrgByWorkosId = useQuery(
    api.organizations.getByWorkosId,
    shouldResolveOrganization && !cachedOrgById && scopedOrganizationId
      ? { workosId: scopedOrganizationId }
      : 'skip',
  )
  const cachedOrgByWorkosId = useCachedQuery(
    `scoped-org-workos-${scopedOrganizationId ?? 'none'}`,
    freshOrgByWorkosId,
  )

  return {
    organizationScoped: shouldResolveOrganization,
    scopedOrganizationId,
    scopedConvexOrganizationId,
    convexOrg: cachedOrgById ?? cachedOrgByWorkosId ?? null,
  }
}
