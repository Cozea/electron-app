import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { getModelCatalog, type ModelApiModel } from '@/lib/ai/modelCatalogClient'
import { readScopedJsonValue, writeScopedJsonValue } from '@/lib/settings/scopedLocalState'

interface UseScopedModelSelectionDataOptions {
  route?: string
}

const SAVED_MODELS_STORAGE_PREFIX = 'cozea.settings.modelSelection.savedModels.v1'
const DEFAULT_ALLOWED_PROVIDERS = ['openai', 'anthropic', 'google', 'xai', 'moonshotai'] as const

function loadSavedModelIds(scope: string): string[] {
  const parsed = readScopedJsonValue<unknown>(SAVED_MODELS_STORAGE_PREFIX, scope, [])
  if (!Array.isArray(parsed)) return []

  return Array.from(new Set(
    parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim()),
  ))
}

function saveSavedModelIds(scope: string, modelIds: string[]): void {
  const normalized = Array.from(new Set(
    modelIds
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim()),
  ))

  writeScopedJsonValue(SAVED_MODELS_STORAGE_PREFIX, scope, normalized)
}

export function useScopedModelSelectionData(options: UseScopedModelSelectionDataOptions = {}) {
  const {
    user,
    logout,
    accessToken,
    convexUserId,
  } = useAuth()
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'modelSelection',
  })
  const scopedOrganizationId = settingsPage.resolvedScope.scopedOrganizationId
  const workspaceScoped = settingsPage.workspaceScoped
  const {
    canManageWorkspaceAiModelPolicy,
    convexOrg,
  } = settingsPage.workspaceAccess
  const storageScope = settingsPage.storageScopeKey
  const storageMode = settingsPage.storageMode
  const updateOrganizationAiSettings = useMutation(api.organizations.updateAiSettings)

  const [availableModels, setAvailableModels] = useState<ModelApiModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [savedModelIds, setSavedModelIds] = useState<string[]>([])
  const [isSavingScopedModels, setIsSavingScopedModels] = useState(false)
  const [saveScopedModelsError, setSaveScopedModelsError] = useState<string | null>(null)

  const [prevSavedDeps, setPrevSavedDeps] = useState({ allowedModels: convexOrg?.aiSettings?.allowedModels, storageMode, storageScope })
  if (
    prevSavedDeps.storageMode !== storageMode ||
    prevSavedDeps.storageScope !== storageScope ||
    prevSavedDeps.allowedModels !== convexOrg?.aiSettings?.allowedModels
  ) {
    setPrevSavedDeps({ allowedModels: convexOrg?.aiSettings?.allowedModels, storageMode, storageScope })
    if (storageMode === 'cloud') {
      const allowedModels = convexOrg?.aiSettings?.allowedModels ?? []
      setSavedModelIds(Array.from(new Set(allowedModels)))
    } else {
      setSavedModelIds(loadSavedModelIds(storageScope))
    }
  }

  const [prevAvailableDeps, setPrevAvailableDeps] = useState({ accessToken, scopedOrganizationId, isWorkspaceAccessDenied: settingsPage.isWorkspaceAccessDenied })
  if (
    prevAvailableDeps.accessToken !== accessToken ||
    prevAvailableDeps.scopedOrganizationId !== scopedOrganizationId ||
    prevAvailableDeps.isWorkspaceAccessDenied !== settingsPage.isWorkspaceAccessDenied
  ) {
    setPrevAvailableDeps({ accessToken, scopedOrganizationId, isWorkspaceAccessDenied: settingsPage.isWorkspaceAccessDenied })
    if (!accessToken || !scopedOrganizationId || settingsPage.isWorkspaceAccessDenied) {
      setAvailableModels([])
      setModelsError(null)
      setIsLoadingModels(false)
    }
  }

  const [prevDeps, setPrevDeps] = useState({ accessToken, scopedOrganizationId, isDenied: settingsPage.isWorkspaceAccessDenied })

  if (
    accessToken !== prevDeps.accessToken ||
    scopedOrganizationId !== prevDeps.scopedOrganizationId ||
    settingsPage.isWorkspaceAccessDenied !== prevDeps.isDenied
  ) {
    setPrevDeps({ accessToken, scopedOrganizationId, isDenied: settingsPage.isWorkspaceAccessDenied })
    if (accessToken && scopedOrganizationId && !settingsPage.isWorkspaceAccessDenied) {
      setIsLoadingModels(true)
      setModelsError(null)
    }
  }

  useEffect(() => {
    if (!accessToken || !scopedOrganizationId || settingsPage.isWorkspaceAccessDenied) {
      return
    }

    let cancelled = false

    getModelCatalog({
      organizationId: scopedOrganizationId,
      accessToken,
    })
      .then((data) => {
        if (cancelled) return
        setAvailableModels(Array.isArray(data.models) ? data.models : [])
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error && error.message
          ? error.message
          : 'Failed to load models'
        setModelsError(message)
        setAvailableModels([])
      })
      .finally(() => {
        if (cancelled) return
        setIsLoadingModels(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, scopedOrganizationId, settingsPage.isWorkspaceAccessDenied])

  const persistSavedModelIds = useCallback((next: string[], previous: string[]) => {
    if (storageMode === 'local') {
      saveSavedModelIds(storageScope, next)
      return
    }

    if (!convexOrg?._id || !convexUserId) {
      setSavedModelIds(previous)
      return
    }

    setSaveScopedModelsError(null)
    setIsSavingScopedModels(true)

    void updateOrganizationAiSettings({
      orgId: convexOrg._id,
      userId: convexUserId,
      aiSettings: {
        allowedProviders:
          convexOrg.aiSettings?.allowedProviders && convexOrg.aiSettings.allowedProviders.length > 0
            ? convexOrg.aiSettings.allowedProviders
            : [...DEFAULT_ALLOWED_PROVIDERS],
        allowedModels: next,
        allowProviderTools: convexOrg.aiSettings?.allowProviderTools,
        allowWebSearch: convexOrg.aiSettings?.allowWebSearch,
        maxReasoningDepth: convexOrg.aiSettings?.maxReasoningDepth,
        monthlySpendingCapCents: convexOrg.aiSettings?.monthlySpendingCapCents,
        defaultModelTier: convexOrg.aiSettings?.defaultModelTier,
      },
    })
      .catch((error) => {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Failed to save workspace model selection.'
        setSaveScopedModelsError(message)
        setSavedModelIds(previous)
      })
      .finally(() => {
        setIsSavingScopedModels(false)
      })
  }, [convexOrg, convexUserId, storageMode, storageScope, updateOrganizationAiSettings])

  const toggleSavedModel = useCallback((modelId: string) => {
    const availableSet = new Set(availableModels.map((model) => model.id))

    setSavedModelIds((previous) => {
      if (previous.includes(modelId)) {
        const availableSaved = previous.filter((id) => availableSet.has(id))
        const isLastAvailableSaved =
          availableSaved.length === 1 && availableSaved[0] === modelId
        if (isLastAvailableSaved) {
          return previous
        }
      }

      const next = previous.includes(modelId)
        ? previous.filter((id) => id !== modelId)
        : [...previous, modelId]

      persistSavedModelIds(next, previous)
      return next
    })
  }, [availableModels, persistSavedModelIds])

  return {
    settingsPage,
    user,
    logout,
    accessToken,
    convexUserId,
    scopedOrganizationId,
    workspaceScoped,
    canManageWorkspaceAiModelPolicy,
    convexOrg,
    storageScope,
    storageMode,
    availableModels,
    isLoadingModels,
    modelsError,
    savedModelIds,
    toggleSavedModel,
    isSavingScopedModels,
    saveScopedModelsError,
  }
}
