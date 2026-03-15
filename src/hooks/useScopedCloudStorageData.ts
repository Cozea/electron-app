import { useCallback, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'

interface UseScopedCloudStorageDataOptions {
  route?: string
}

export type ClearableStorageCategory =
  | 'collaborationData'
  | 'aiHistory'
  | 'buildCache'
  | 'snapshots'

const bytesToGB = (bytes: number): number => bytes / (1024 * 1024 * 1024)

export function useScopedCloudStorageData(options: UseScopedCloudStorageDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'cloudStorage',
  })
  const { user, logout, convexUserId } = useAuth()
  const convexOrgId = settingsPage.workspaceAccess.convexOrg?._id as Id<'organizations'> | undefined
  const canLoadCloudStorageData = !settingsPage.isWorkspaceAccessDenied

  const clearStorageMutation = useMutation(api.organizations.clearStorageCategory)
  const usageLimits = useQuery(
    api.organizations.getUsageLimits,
    convexOrgId && canLoadCloudStorageData ? { orgId: convexOrgId } : 'skip',
  )

  const totalUsed = useMemo(() => {
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
  }, [usageLimits?.storage.breakdown, usageLimits?.storage.currentBytes])
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
