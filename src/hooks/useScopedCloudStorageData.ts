import { useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { convex } from '@/lib/convex'
import { getUsageLimitsCacheKey } from '@/lib/queryCacheKeys'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { useCachedQuery, useQueryCache } from '@/stores/useQueryCache'

interface UseScopedCloudStorageDataOptions {
  route?: string
}

export type ClearableStorageCategory =
  | 'collaborationData'
  | 'aiHistory'
  | 'buildCache'
  | 'snapshots'

const bytesToGB = (bytes: number): number => bytes / (1024 * 1024 * 1024)
const CLOUD_STORAGE_CACHE_MAX_AGE_MS = 2 * 60 * 1000

export async function prewarmCloudStorageData(
  organizationId?: Id<'organizations'> | null
): Promise<void> {
  if (!organizationId || !convex) return

  const cacheKey = getUsageLimitsCacheKey(organizationId)
  const cachedUsageLimits = useQueryCache
    .getState()
    .get(cacheKey, CLOUD_STORAGE_CACHE_MAX_AGE_MS)

  if (cachedUsageLimits !== undefined) {
    return
  }

  try {
    const usageLimits = await convex.query(api.organizations.getUsageLimits, {
      orgId: organizationId,
    })
    if (usageLimits !== undefined) {
      useQueryCache.getState().set(cacheKey, usageLimits)
    }
  } catch {
    // Ignore prewarm failures and allow the page query to resolve normally.
  }
}

export function useScopedCloudStorageData(options: UseScopedCloudStorageDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'cloudStorage',
  })
  const { user, logout, convexUserId } = useAuth()
  const convexOrgId = settingsPage.workspaceAccess.convexOrg?._id as Id<'organizations'> | undefined
  const canLoadCloudStorageData = !settingsPage.isWorkspaceAccessDenied

  const clearStorageMutation = useMutation(api.organizations.clearStorageCategory)
  const freshUsageLimits = useQuery(
    api.organizations.getUsageLimits,
    convexOrgId && canLoadCloudStorageData ? { orgId: convexOrgId } : 'skip',
  )
  const usageLimits = useCachedQuery(
    getUsageLimitsCacheKey(convexOrgId),
    freshUsageLimits,
    CLOUD_STORAGE_CACHE_MAX_AGE_MS,
  )

  const totalUsed = (() => {
    if (usageLimits?.storage.currentBytes) {
      return bytesToGB(usageLimits.storage.currentBytes)
    }

    if (!usageLimits?.storage.breakdown) {
      return 0
    }

    return Object.values(usageLimits.storage.breakdown).reduce(
      (sum, value) => sum + bytesToGB(value ?? 0),
      0,
    )
  })()
  const totalLimit = usageLimits?.storage.limitGB ?? 1
  const isUnlimited = usageLimits?.storage.isUnlimited ?? false

  const clearStorageCategory = useCallback(async (category: ClearableStorageCategory) => {
    if (!convexOrgId || !convexUserId) return

    await clearStorageMutation({
      orgId: convexOrgId,
      userId: convexUserId,
      category,
    })
  }, [clearStorageMutation, convexOrgId, convexUserId])

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    convexOrgId,
    usageLimits,
    totalUsed,
    totalLimit,
    isUnlimited,
    clearStorageCategory,
  }
}
