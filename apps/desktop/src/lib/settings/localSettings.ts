import { useEffect, useSyncExternalStore } from 'react'
import type { AppSettings } from '@shared/electronApiTypes'
import { createLocalSnapshot } from '@/lib/localSnapshot'

export type LocalAppSettings = AppSettings & {
  computerUseAllowGlobalPointerFallbacks?: boolean
}

export const localSettings = createLocalSnapshot<LocalAppSettings>({
  read: () => window.electronAPI.settings.get(),
  connect: () => {
    const refresh = () => { void localSettings.refresh().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  },
})

let writes: Promise<unknown> = Promise.resolve()
export function saveLocalSettings(patch: Partial<LocalAppSettings>): Promise<{ success: boolean }> {
  const save = async () => {
    const current = await localSettings.ensure()
    // The main-process settings handler already uses the Computer Use tool-list
    // field as its policy-change signal. Include the unchanged list when the
    // advanced pointer gate changes so existing macOS state and Windows/Linux
    // workers are revoked and recreated under the new upstream environment.
    const outboundPatch: Partial<LocalAppSettings> =
      patch.computerUseAllowGlobalPointerFallbacks !== undefined &&
      patch.disabledComputerUseTools === undefined
        ? {
            ...patch,
            disabledComputerUseTools: current.disabledComputerUseTools ?? [],
          }
        : patch
    const result = await window.electronAPI.settings.set(outboundPatch)
    if (!result.success) throw new Error('Unable to save local settings.')
    localSettings.publish({ ...(localSettings.getSnapshot().data ?? current), ...outboundPatch })
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
