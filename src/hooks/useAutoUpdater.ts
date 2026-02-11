import { useEffect, useRef } from 'react'
import { useAutoUpdateStore } from '@/stores/useAutoUpdateStore'
import type { UpdateState } from '@/types/electron'

interface UseAutoUpdaterOptions {
  enabled?: boolean
}

export function useAutoUpdater(options?: UseAutoUpdaterOptions) {
  const enabled = options?.enabled ?? true
  const applyUpdateState = useAutoUpdateStore((s) => s.applyUpdateState)
  const installMode = useAutoUpdateStore((s) => s.installMode)
  const status = useAutoUpdateStore((s) => s.status)
  const installTriggeredRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (!window.electronAPI?.updates) return

    let isMounted = true

    window.electronAPI.updates.getState().then((state: UpdateState) => {
      if (isMounted) applyUpdateState(state)
    })

    const unsubscribe = window.electronAPI.updates.onStatus((state: UpdateState) => {
      applyUpdateState(state)
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [applyUpdateState, enabled])

  useEffect(() => {
    if (!enabled) return
    if (!window.electronAPI?.updates) return

    if (status === 'downloaded' && installMode === 'now' && !installTriggeredRef.current) {
      installTriggeredRef.current = true
      void window.electronAPI.updates.install()
      return
    }

    if (status !== 'downloaded') {
      installTriggeredRef.current = false
    }
  }, [enabled, installMode, status])
}
