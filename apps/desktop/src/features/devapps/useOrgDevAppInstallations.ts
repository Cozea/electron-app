import { useCallback, useEffect, useState } from "react"

import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"

export function useOrgDevAppInstallations(): {
  installations: OrgDevAppInstallation[]
  loading: boolean
  refresh: () => Promise<void>
} {
  const [installations, setInstallations] = useState<OrgDevAppInstallation[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.orgDevApp.listInstallations()
    if (result.success) setInstallations(result.installations)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.orgDevApp.listInstallations().then((result) => {
      if (!cancelled && result.success) setInstallations(result.installations)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    const unsubscribe = window.electronAPI.orgDevApp.onInstallationsChanged((next) => {
      if (!cancelled) setInstallations(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { installations, loading, refresh }
}
