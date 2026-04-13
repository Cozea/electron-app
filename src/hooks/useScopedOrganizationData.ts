import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useCachedQueryState } from '@/stores/useQueryCache'
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
  const orgByIdState = useCachedQueryState(
    `scoped-org-id-${scopedConvexOrganizationId ?? 'none'}`,
    freshOrgById,
  )

  const freshOrgByWorkosId = useQuery(
    api.organizations.getByWorkosId,
    shouldResolveOrganization && !orgByIdState.data && scopedOrganizationId
      ? { workosId: scopedOrganizationId }
      : 'skip',
  )
  const orgByWorkosIdState = useCachedQueryState(
    `scoped-org-workos-${scopedOrganizationId ?? 'none'}`,
    freshOrgByWorkosId,
  )
  const convexOrg = orgByIdState.data ?? orgByWorkosIdState.data ?? null
  const hasResolvedOrganization =
    !shouldResolveOrganization ||
    convexOrg !== null ||
    orgByIdState.hasResolved ||
    orgByWorkosIdState.hasResolved
  const isRefreshingOrganization =
    shouldResolveOrganization &&
    (orgByIdState.isRefreshing || orgByWorkosIdState.isRefreshing)

  return {
    organizationScoped: shouldResolveOrganization,
    scopedOrganizationId,
    scopedConvexOrganizationId,
    convexOrg,
    hasResolvedOrganization,
    isRefreshingOrganization,
  }
}
