import { useCallback, useEffect, useState } from 'react'
import type { ProviderAuthStatus } from '@shared/electronApiTypes'

export type ConnectedProvider = string

const COZEA_MANAGED_PROVIDERS: ConnectedProvider[] = ['openai', 'anthropic', 'google', 'xai']

export const isConnectedProvider = (value?: string): value is ConnectedProvider =>
  typeof value === 'string' && value.trim().length > 0

export function getProviderDisplayName(providerId: string): string {
  const defaults: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    xai: 'xAI',
    'github-copilot': 'GitHub Copilot',
    gitlab: 'GitLab',
    'amazon-bedrock': 'Amazon Bedrock',
    'google-vertex': 'Google Vertex',
    'google-vertex-anthropic': 'Google Vertex Anthropic',
    azure: 'Azure OpenAI',
    'azure-cognitive-services': 'Azure Cognitive Services',
    'sap-ai-core': 'SAP AI Core',
  }
  if (defaults[providerId]) return defaults[providerId]
  
  // Format custom provider id
  return providerId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
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
        nextStatuses[status.provider] = status
        if (!status.connected) continue
        if (typeof status.expiresAt === 'number' && status.expiresAt <= now) continue
        connectedSet.add(status.provider)
      }

      for (const provider of COZEA_MANAGED_PROVIDERS) {
        connectedSet.add(provider)
      }

      setProviderStatuses(nextStatuses)
      setConnectedProviders(Array.from(connectedSet))
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

  useEffect(() => {
    if (!window.electronAPI?.providerAuth?.onStatusChanged) return
    const unsubscribe = window.electronAPI.providerAuth.onStatusChanged(() => {
      void refreshConnectedProviders()
    })
    return unsubscribe
  }, [refreshConnectedProviders])

  return {
    connectedProviders,
    providerStatuses,
    providerAuthAvailable,
    providerStatusLoaded,
    refreshConnectedProviders,
  }
}
