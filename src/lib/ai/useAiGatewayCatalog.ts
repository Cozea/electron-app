import { useEffect, useState } from 'react'

import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import type { ModelOption } from '@/lib/ai/defaultModels'
import type { ToolMetaShape, ToolPolicy, ToolsApiResponse } from '@/lib/ai/toolTypes'

export interface AiModelCapabilities {
  reasoningType?: 'effort' | 'token' | 'budget' | string
  supportsEffortParameter?: boolean
  supportsExtendedThinking?: boolean
  reasoningRange?: unknown
}

interface AiModelApiModel {
  id: string
  displayName: string
  provider: string
  tier: string
  capabilities?: AiModelCapabilities
}

interface AiModelApiResponse {
  models: AiModelApiModel[]
}

interface UseAiGatewayCatalogArgs {
  accessToken: string | null
  organizationId: string | null | undefined
  selectedModelId: string
  initialModels: ModelOption[]
  onModelFallback: (modelId: string) => void
}

interface UseAiGatewayCatalogResult<TToolMeta extends ToolMetaShape> {
  availableModels: ModelOption[]
  availableTools: TToolMeta[]
  toolPolicy: ToolPolicy | null
  modelCapabilities: Record<string, AiModelCapabilities>
  modelsError: string | null
  toolsError: string | null
}

function providerToChef(provider: string): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  return 'Google'
}

export function useAiGatewayCatalog<TToolMeta extends ToolMetaShape>({
  accessToken,
  organizationId,
  selectedModelId,
  initialModels,
  onModelFallback,
}: UseAiGatewayCatalogArgs): UseAiGatewayCatalogResult<TToolMeta> {
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(initialModels)
  const [availableTools, setAvailableTools] = useState<TToolMeta[]>([])
  const [toolPolicy, setToolPolicy] = useState<ToolPolicy | null>(null)
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, AiModelCapabilities>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)

  useEffect(() => {
    if (accessToken && organizationId) return
    setModelsError(null)
    setToolsError(null)
  }, [accessToken, organizationId])

  useEffect(() => {
    if (!accessToken || !organizationId) return

    const controller = new AbortController()

    fetch(`${AI_BASE_URL}/models?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Unauthorized. Please sign in again.')
          }
          throw new Error('Failed to load models')
        }
        return (await res.json()) as AiModelApiResponse
      })
      .then((data) => {
        if (!data?.models) return

        const mapped = data.models.map((item) => ({
          id: item.id,
          name: item.displayName,
          chef: providerToChef(item.provider),
          chefSlug: item.provider,
          tier: item.tier,
          providers: [item.provider],
        }))

        const capabilitiesByModel: Record<string, AiModelCapabilities> = {}
        for (const item of data.models) {
          if (item.capabilities) {
            capabilitiesByModel[item.id] = item.capabilities
          }
        }

        setModelCapabilities(capabilitiesByModel)
        setModelsError(null)

        if (mapped.length > 0) {
          setAvailableModels(mapped)
          if (!mapped.some((entry) => entry.id === selectedModelId)) {
            onModelFallback(mapped[0].id)
          }
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load models'
        setModelsError(message)
        console.warn('Failed to fetch models:', err)
      })

    return () => controller.abort()
  }, [accessToken, organizationId, onModelFallback, selectedModelId])

  useEffect(() => {
    if (!accessToken || !organizationId) return

    const controller = new AbortController()

    fetch(`${AI_BASE_URL}/tools?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Unauthorized. Please sign in again.')
          }
          throw new Error('Failed to load tools')
        }
        return (await res.json()) as ToolsApiResponse<TToolMeta>
      })
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools)
        setToolPolicy(data.policy ?? null)
        setToolsError(null)
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load tools'
        setToolsError(message)
        console.warn('Failed to fetch tools:', err)
      })

    return () => controller.abort()
  }, [accessToken, organizationId])

  return {
    availableModels,
    availableTools,
    toolPolicy,
    modelCapabilities,
    modelsError,
    toolsError,
  }
}
