import { useEffect, useSyncExternalStore } from 'react'
import type { OrgDevAppInstallation } from '@shared/orgDevAppInstallation'
import { createLocalSnapshot } from '@/lib/localSnapshot'

const EMPTY_INSTALLATIONS: OrgDevAppInstallation[] = []
export const orgDevAppInstallations = createLocalSnapshot<OrgDevAppInstallation[]>({
  read: async () => {
    const result = await window.electronAPI.orgDevApp.listInstallations()
    if (!result.success) throw new Error('Unable to load installed DevApps.')
    return result.installations
  },
  connect: (publish) => window.electronAPI.orgDevApp.onInstallationsChanged(publish),
})

const refresh = async () => { await orgDevAppInstallations.refresh() }

export function useOrgDevAppInstallations() {
  const state = useSyncExternalStore(orgDevAppInstallations.subscribe, orgDevAppInstallations.getSnapshot)
  useEffect(() => { void orgDevAppInstallations.ensure().catch(() => undefined) }, [])
  return {
    installations: state.data ?? EMPTY_INSTALLATIONS,
    loading: state.data === null && state.error === null,
    error: state.error,
    refresh,
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => orgDevAppInstallations.dispose())
