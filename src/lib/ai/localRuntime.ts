import { useEffect, useState } from 'react'

export interface LocalAiRuntimeStatus {
  enabled: boolean
  running: boolean
  endpoint?: string
}

export function useLocalAiRuntimeStatus(shouldCheck: boolean): LocalAiRuntimeStatus {
  const [status, setStatus] = useState<LocalAiRuntimeStatus>({
    enabled: false,
    running: false,
  })

  useEffect(() => {
    let cancelled = false

    if (!shouldCheck || !window.electronAPI?.localAiRuntime?.getStatus) {
      setStatus({ enabled: false, running: false })
      return
    }

    void window.electronAPI.localAiRuntime
      .getStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ enabled: false, running: false })
        }
      })

    return () => {
      cancelled = true
    }
  }, [shouldCheck])

  return status
}
