import { useEffect } from 'react'

import { useOrganization } from '@/contexts/OrganizationContext'

interface UseHydrateWorkspaceMembersOptions {
  workspaceOrganizationId?: string | null
  enabled: boolean
}

const MEMBER_HYDRATION_INTERVAL_MS = 15000

const lastHydratedAtByWorkspace = new Map<string, number>()
const inFlightHydrationByWorkspace = new Map<string, Promise<void>>()

async function hydrateWorkspaceMembers(
  getMembers: (orgId: string) => Promise<unknown>,
  workspaceOrganizationId: string,
  force = false,
) {
  const now = Date.now()
  const lastHydratedAt = lastHydratedAtByWorkspace.get(workspaceOrganizationId) ?? 0

  if (!force && now - lastHydratedAt < MEMBER_HYDRATION_INTERVAL_MS) {
    return
  }

  const existingHydration = inFlightHydrationByWorkspace.get(workspaceOrganizationId)
  if (existingHydration) {
    return existingHydration
  }

  const hydrationPromise = (async () => {
    try {
      await getMembers(workspaceOrganizationId)
      lastHydratedAtByWorkspace.set(workspaceOrganizationId, Date.now())
    } catch (error) {
      console.warn('[WorkspaceMembers] Background hydration failed', {
        workspaceOrganizationId,
        error,
      })
    } finally {
      inFlightHydrationByWorkspace.delete(workspaceOrganizationId)
    }
  })()

  inFlightHydrationByWorkspace.set(workspaceOrganizationId, hydrationPromise)
  return hydrationPromise
}

export function useHydrateWorkspaceMembers(options: UseHydrateWorkspaceMembersOptions) {
  const { workspaceOrganizationId, enabled } = options
  const { getMembers } = useOrganization()

  useEffect(() => {
    if (!enabled || !workspaceOrganizationId) {
      return
    }

    void hydrateWorkspaceMembers(getMembers, workspaceOrganizationId, true)

    const refresh = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      void hydrateWorkspaceMembers(getMembers, workspaceOrganizationId)
    }

    const handleFocus = () => {
      void hydrateWorkspaceMembers(getMembers, workspaceOrganizationId, true)
    }

    const intervalId = window.setInterval(refresh, MEMBER_HYDRATION_INTERVAL_MS)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [enabled, getMembers, workspaceOrganizationId])
}
