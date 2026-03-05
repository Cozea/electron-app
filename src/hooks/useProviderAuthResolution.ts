import { useEffect, useMemo, useState } from 'react'

import {
  buildEncodedProviderAuthHeader,
  inferProviderFromModelId,
  isManagedProvider,
} from '@/lib/ai/providerAuth'

export interface UseProviderAuthResolutionArgs {
  organizationId?: string | null
  modelId: string
  preferredProvider?: string | null
  retries?: number
  retryDelayMs?: number
  resolveWhenUnavailable?: boolean
  refreshKey?: string | number | null | undefined
}

export interface UseProviderAuthResolutionResult {
  provider: string | null
  requiresLocalAuth: boolean
  managedProvider: boolean
  header: string | null
  loading: boolean
  resolved: boolean
  error: string | null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function useProviderAuthResolution(
  args: UseProviderAuthResolutionArgs
): UseProviderAuthResolutionResult {
  const {
    organizationId,
    modelId,
    preferredProvider,
    retries = 1,
    retryDelayMs = 250,
    resolveWhenUnavailable = false,
    refreshKey,
  } = args

  const provider = useMemo(() => {
    const explicit = typeof preferredProvider === 'string' ? preferredProvider.trim().toLowerCase() : ''
    if (explicit) {
      return explicit
    }
    return inferProviderFromModelId(modelId)
  }, [modelId, preferredProvider])

  const managedProvider = Boolean(provider && isManagedProvider(provider))
  const requiresLocalAuth = Boolean(provider && !managedProvider)
  const [header, setHeader] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const normalizedOrgId = typeof organizationId === 'string' ? organizationId.trim() : ''
    const attempts = Math.max(1, Math.floor(retries))
    const baseDelay = Math.max(50, Math.floor(retryDelayMs))

    if (!normalizedOrgId) {
      setHeader(null)
      setLoading(false)
      setResolved(false)
      setError(null)
      return
    }

    if (!provider) {
      setHeader(null)
      setLoading(false)
      setResolved(false)
      setError(null)
      return
    }

    if (managedProvider) {
      setHeader(null)
      setLoading(false)
      setResolved(true)
      setError(null)
      return
    }

    setHeader(null)
    setLoading(true)
    setResolved(false)
    setError(null)

    void (async () => {
      let finalError = 'Provider authentication is not ready on this device.'
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = await buildEncodedProviderAuthHeader({
          provider,
          modelId,
          organizationId: normalizedOrgId,
        })
        if (cancelled) return

        if (result.header) {
          setHeader(result.header)
          setLoading(false)
          setResolved(true)
          setError(null)
          return
        }

        finalError = result.error || finalError
        if (attempt < attempts - 1) {
          await wait(baseDelay * (attempt + 1))
          if (cancelled) return
        }
      }

      if (cancelled) return
      setHeader(null)
      setLoading(false)
      setResolved(resolveWhenUnavailable)
      setError(finalError)
    })()

    return () => {
      cancelled = true
    }
  }, [
    organizationId,
    modelId,
    provider,
    managedProvider,
    retries,
    retryDelayMs,
    resolveWhenUnavailable,
    refreshKey,
  ])

  return {
    provider,
    requiresLocalAuth,
    managedProvider,
    header,
    loading,
    resolved,
    error,
  }
}
