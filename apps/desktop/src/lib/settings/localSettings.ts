import { useEffect, useSyncExternalStore } from 'react'
import type { AppSettings } from '@shared/electronApiTypes'
import { createLocalSnapshot } from '@/lib/localSnapshot'

export const localSettings = createLocalSnapshot<AppSettings>({
  read: () => window.electronAPI.settings.get(),
  connect: () => {
    const refresh = () => { void localSettings.refresh().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  },
})

let writes: Promise<unknown> = Promise.resolve()
export function saveLocalSettings(patch: Partial<AppSettings>): Promise<{ success: boolean }> {
  const save = async () => {
    const current = await localSettings.ensure()
    const result = await window.electronAPI.settings.set(patch)
    if (!result.success) throw new Error('Unable to save local settings.')
    localSettings.publish({ ...(localSettings.getSnapshot().data ?? current), ...patch })
    return result
  }
  const next = writes.then(save, save)
  writes = next
  return next
}

export function useLocalSettings() {
  const state = useSyncExternalStore(localSettings.subscribe, localSettings.getSnapshot)
  useEffect(() => { void localSettings.ensure().catch(() => undefined) }, [])
  return state
}

if (import.meta.hot) import.meta.hot.dispose(() => localSettings.dispose())
