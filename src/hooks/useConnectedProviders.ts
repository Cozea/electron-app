import { useCallback, useEffect, useState } from 'react'
import type { ProviderAuthProvider, ProviderAuthStatus } from '@shared/electronApiTypes'

export type ConnectedProvider = Extract<ProviderAuthProvider, 'anthropic' | 'openai' | 'google'>

export const CONNECTED_PROVIDER_ORDER: ConnectedProvider[] = ['anthropic', 'openai', 'google']

export const isConnectedProvider = (value: string): value is ConnectedProvider =>
  value === 'anthropic' || value === 'openai' || value === 'google'

export const CONNECTED_PROVIDER_DISPLAY_NAME: Record<ConnectedProvider, 'Anthropic' | 'OpenAI' | 'Google'> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function useConnectedProviders() {
  const [connectedProviders, setConnectedProviders] = useState<ConnectedProvider[]>([])
  const [providerStatuses, setProviderStatuses] = useState<Partial<Record<ConnectedProvider, ProviderAuthStatus>>>({})
  const [providerAuthAvailable, setProviderAuthAvailable] = useState<boolean>(
    Boolean(window.electronAPI?.providerAuth)
  )
  const [providerStatusLoaded, setProviderStatusLoaded] = useState(false)

  const refreshConnectedProviders = useCallback(async () => {
    if (!window.electronAPI?.providerAuth) {
      setProviderAuthAvailable(false)
      setConnectedProviders([])
      setProviderStatuses({})
      setProviderStatusLoaded(true)
      return
    }

    setProviderAuthAvailable(true)
    try {
      const statuses = await window.electronAPI.providerAuth.getStatus()
      const now = Date.now()
      const nextStatuses: Partial<Record<ConnectedProvider, ProviderAuthStatus>> = {}
      const connectedSet = new Set<ConnectedProvider>()

      for (const status of statuses) {
        if (!isConnectedProvider(status.provider)) continue
        nextStatuses[status.provider] = status
        if (!status.connected) continue
        if (typeof status.expiresAt === 'number' && status.expiresAt <= now) continue
        connectedSet.add(status.provider)
      }

      setProviderStatuses(nextStatuses)
      setConnectedProviders(
        CONNECTED_PROVIDER_ORDER.filter((provider) => connectedSet.has(provider))
      )
    } catch (error) {
      console.warn('Failed to load provider connection status:', error)
      setConnectedProviders([])
      setProviderStatuses({})
    } finally {
      setProviderStatusLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshConnectedProviders()
  }, [refreshConnectedProviders])

  useEffect(() => {
    const handleFocus = () => {
      void refreshConnectedProviders()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [refreshConnectedProviders])

  return {
    connectedProviders,
    providerStatuses,
    providerAuthAvailable,
    providerStatusLoaded,
    refreshConnectedProviders,
  }
}
