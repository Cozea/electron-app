import { useCallback, useEffect, useMemo, useState } from 'react'

import { DashboardLayout } from '@/components/layouts/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { getProviderDisplayName } from '@/hooks/useConnectedProviders'
import { getModelCatalog, type ModelApiModel } from '@/lib/ai/modelCatalogClient'
import { getProviderLogoUrl } from '@/lib/ai/providerLogos'
import { cn } from '@/lib/utils'
import { Brain, ChevronDown, Loader2, Search, Star, X } from 'lucide-react'

interface ModelSelectionProps {
  surface?: 'page' | 'drawer'
}

interface ProviderModelGroup {
  providerId: string
  providerName: string
  models: ModelApiModel[]
}

const SAVED_MODELS_STORAGE_PREFIX = 'cozea.settings.modelSelection.savedModels.v1'

function getProviderSortPriority(providerId: string): number {
  const normalized = providerId.trim().toLowerCase()

  if (normalized === 'openai') return 0
  if (normalized === 'anthropic') return 1
  if (normalized === 'google') return 2 // Gemini models
  if (normalized === 'moonshotai' || normalized === 'moonshot') return 3
  if (
    normalized === 'zhipuai' ||
    normalized === 'zhipuai-coding-plan' ||
    normalized === 'zai' ||
    normalized === 'glm'
  ) {
    return 4
  }

  return Number.POSITIVE_INFINITY
}

function formatTokenLimit(limit: number | undefined): string | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return null
  }
  return `${Math.floor(limit).toLocaleString()} tokens`
}

function modelSupportsThinking(model: ModelApiModel): boolean {
  const capabilities = model.capabilities
  if (!capabilities) return false
  if (capabilities.supportsExtendedThinking) return true

  const reasoningType = typeof capabilities.reasoningType === 'string'
    ? capabilities.reasoningType.trim().toLowerCase()
    : ''
  return reasoningType.length > 0 && reasoningType !== 'none'
}

function getGeminiVersionScore(value: string): number {
  const normalized = value.toLowerCase()
  const match = normalized.match(/gemini[^0-9]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return -1

  const major = Number(match[1] ?? 0)
  const minor = Number(match[2] ?? 0)
  const patch = Number(match[3] ?? 0)
  return major * 1_000_000 + minor * 1_000 + patch
}

function getGeminiVariantScore(value: string): number {
  const normalized = value.toLowerCase()
  if (normalized.includes('ultra')) return 5
  if (normalized.includes('pro')) return 4
  if (normalized.includes('flash')) return 3
  if (normalized.includes('lite')) return 2
  if (normalized.includes('nano')) return 1
  return 0
}

function getModelDateScore(value: string): number {
  const normalized = value.toLowerCase()
  const match = normalized.match(/(20\d{2})[._-]?(0[1-9]|1[0-2])[._-]?([0-2]\d|3[01])/)
  if (!match) return -1

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return -1

  return year * 10_000 + month * 100 + day
}

function getModelVersionScore(value: string): number {
  const normalized = value.toLowerCase()
  const versionPattern = /(?:^|[^\d])(\d{1,2})(?:[._-](\d{1,3}))?(?:[._-](\d{1,3}))?(?=$|[^\d])/g

  let best = -1
  for (const match of normalized.matchAll(versionPattern)) {
    const major = Number(match[1] ?? 0)
    const minor = Number(match[2] ?? 0)
    const patch = Number(match[3] ?? 0)
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) continue

    const score = major * 1_000_000 + minor * 1_000 + patch
    if (score > best) best = score
  }

  return best
}

function getModelRecencyKeywordScore(value: string): number {
  const normalized = value.toLowerCase()
  let score = 0
  if (normalized.includes('latest')) score += 8
  if (normalized.includes('preview')) score += 6
  if (normalized.includes('next')) score += 5
  if (normalized.includes('experimental') || normalized.includes('exp')) score += 4
  if (normalized.includes('beta')) score += 3
  if (normalized.includes('rc')) score += 2
  if (normalized.includes('alpha')) score += 1
  return score
}

function compareModelsByRecency(a: ModelApiModel, b: ModelApiModel): number {
  const aSearch = `${a.id} ${a.displayName}`
  const bSearch = `${b.id} ${b.displayName}`

  const dateDiff = getModelDateScore(bSearch) - getModelDateScore(aSearch)
  if (dateDiff !== 0) return dateDiff

  const versionDiff = getModelVersionScore(bSearch) - getModelVersionScore(aSearch)
  if (versionDiff !== 0) return versionDiff

  const keywordDiff = getModelRecencyKeywordScore(bSearch) - getModelRecencyKeywordScore(aSearch)
  if (keywordDiff !== 0) return keywordDiff

  const contextDiff = (b.limit?.context ?? 0) - (a.limit?.context ?? 0)
  if (contextDiff !== 0) return contextDiff

  return b.displayName.localeCompare(a.displayName)
}

function getDefaultSavedModelId(models: ModelApiModel[]): string | null {
  if (models.length === 0) return null

  const geminiCandidates = models.filter((model) => {
    const providerId = model.provider.trim().toLowerCase()
    const searchable = `${model.id} ${model.displayName}`.toLowerCase()
    return providerId.includes('google') && searchable.includes('gemini')
  })

  if (geminiCandidates.length === 0) {
    return models[0]?.id ?? null
  }

  const ranked = [...geminiCandidates].sort((a, b) => {
    const genericRecencyDiff = compareModelsByRecency(a, b)
    if (genericRecencyDiff !== 0) return genericRecencyDiff

    const aSearch = `${a.id} ${a.displayName}`
    const bSearch = `${b.id} ${b.displayName}`
    const versionDiff = getGeminiVersionScore(bSearch) - getGeminiVersionScore(aSearch)
    if (versionDiff !== 0) return versionDiff
    const variantDiff = getGeminiVariantScore(bSearch) - getGeminiVariantScore(aSearch)
    if (variantDiff !== 0) return variantDiff
    return b.displayName.localeCompare(a.displayName)
  })

  return ranked[0]?.id ?? null
}

function getSavedModelsStorageKey(scope: string): string {
  return `${SAVED_MODELS_STORAGE_PREFIX}:${scope}`
}

function loadSavedModelIds(scope: string): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(getSavedModelsStorageKey(scope))
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return Array.from(new Set(
      parsed
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    ))
  } catch {
    return []
  }
}

function saveSavedModelIds(scope: string, modelIds: string[]): void {
  if (typeof window === 'undefined') return

  try {
    const normalized = Array.from(new Set(
      modelIds
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    ))

    window.localStorage.setItem(getSavedModelsStorageKey(scope), JSON.stringify(normalized))
  } catch {
    // Ignore storage errors to keep UI responsive if localStorage is unavailable.
  }
}

export function ModelSelection({ surface = 'page' }: ModelSelectionProps) {
  const { user, logout, accessToken, currentOrganization } = useAuth()
  const { theme } = useTheme()

  const [availableModels, setAvailableModels] = useState<ModelApiModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [savedModelIds, setSavedModelIds] = useState<string[]>([])
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({})

  const isDarkLikeTheme = useMemo(() => {
    if (theme === 'dark' || theme === 'navy' || theme === 'wine' || theme === 'forest' || theme === 'clay') {
      return true
    }
    if (theme === 'system') {
      if (typeof window === 'undefined') return false
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  }, [theme])

  const providerLogoFilter = isDarkLikeTheme ? 'brightness(0) invert(1)' : 'brightness(0)'

  const storageScope = useMemo(
    () => currentOrganization?.organizationId ?? 'global',
    [currentOrganization?.organizationId]
  )

  useEffect(() => {
    setSavedModelIds(loadSavedModelIds(storageScope))
  }, [storageScope])

  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) {
      setAvailableModels([])
      setModelsError(null)
      setIsLoadingModels(false)
      return
    }

    let cancelled = false
    setIsLoadingModels(true)
    setModelsError(null)

    getModelCatalog({
      organizationId: currentOrganization.organizationId,
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
  }, [accessToken, currentOrganization?.organizationId])

  useEffect(() => {
    if (!currentOrganization?.organizationId || isLoadingModels || modelsError || availableModels.length === 0) {
      return
    }

    setSavedModelIds((previous) => {
      const availableSet = new Set(availableModels.map((model) => model.id))
      const hasAvailableSavedModel = previous.some((modelId) => availableSet.has(modelId))
      if (hasAvailableSavedModel) return previous

      const defaultModelId = getDefaultSavedModelId(availableModels)
      if (!defaultModelId || previous.includes(defaultModelId)) {
        return previous
      }

      const next = [...previous, defaultModelId]
      saveSavedModelIds(storageScope, next)
      return next
    })
  }, [
    availableModels,
    currentOrganization?.organizationId,
    isLoadingModels,
    modelsError,
    storageScope,
  ])

  const requiredSavedModelId = useMemo(() => {
    if (savedModelIds.length === 0 || availableModels.length === 0) return null

    const availableSet = new Set(availableModels.map((model) => model.id))
    const availableSaved = savedModelIds.filter((modelId) => availableSet.has(modelId))
    if (availableSaved.length !== 1) return null
    return availableSaved[0]
  }, [availableModels, savedModelIds])

  const toggleSavedModel = useCallback((modelId: string) => {
    setSavedModelIds((previous) => {
      if (previous.includes(modelId)) {
        const availableSet = new Set(availableModels.map((model) => model.id))
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
      saveSavedModelIds(storageScope, next)
      return next
    })
  }, [availableModels, storageScope])

  const modelById = useMemo(() => (
    new Map(availableModels.map((model) => [model.id, model] as const))
  ), [availableModels])

  const savedModels = useMemo(
    () => savedModelIds
      .map((modelId) => modelById.get(modelId))
      .filter((model): model is ModelApiModel => Boolean(model)),
    [modelById, savedModelIds]
  )

  const unavailableSavedCount = savedModelIds.length - savedModels.length
  const normalizedModelSearchQuery = modelSearchQuery.trim().toLowerCase()

  const groupedModels = useMemo<ProviderModelGroup[]>(() => {
    const grouped = new Map<string, ModelApiModel[]>()

    for (const model of availableModels) {
      const providerId = model.provider.trim().toLowerCase()
      if (!providerId) continue
      const existing = grouped.get(providerId)
      if (existing) {
        existing.push(model)
      } else {
        grouped.set(providerId, [model])
      }
    }

    const groups: ProviderModelGroup[] = Array.from(grouped.entries()).map(([providerId, models]) => ({
      providerId,
      providerName: getProviderDisplayName(providerId),
      models: [...models].sort(compareModelsByRecency),
    }))

    return groups.sort((a, b) => {
      const aPriority = getProviderSortPriority(a.providerId)
      const bPriority = getProviderSortPriority(b.providerId)
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.providerName.localeCompare(b.providerName)
    })
  }, [availableModels])

  const filteredSavedModels = useMemo(() => {
    if (!normalizedModelSearchQuery) return savedModels

    return savedModels.filter((model) => {
      const providerId = model.provider.trim().toLowerCase()
      const providerName = getProviderDisplayName(providerId)
      const searchable = `${model.displayName} ${model.id} ${providerName} ${providerId} ${model.tier}`.toLowerCase()
      return searchable.includes(normalizedModelSearchQuery)
    })
  }, [normalizedModelSearchQuery, savedModels])

  const filteredGroupedModels = useMemo<ProviderModelGroup[]>(() => {
    if (!normalizedModelSearchQuery) return groupedModels

    const filtered: ProviderModelGroup[] = []
    for (const group of groupedModels) {
      const providerSearchable = `${group.providerName} ${group.providerId}`.toLowerCase()
      if (providerSearchable.includes(normalizedModelSearchQuery)) {
        filtered.push(group)
        continue
      }

      const matchedModels = group.models.filter((model) => {
        const searchable = `${model.displayName} ${model.id} ${model.tier}`.toLowerCase()
        return searchable.includes(normalizedModelSearchQuery)
      })
      if (matchedModels.length > 0) {
        filtered.push({
          ...group,
          models: matchedModels,
        })
      }
    }

    return filtered
  }, [groupedModels, normalizedModelSearchQuery])

  useEffect(() => {
    setExpandedProviders((previous) => {
      if (groupedModels.length === 0) {
        return Object.keys(previous).length === 0 ? previous : {}
      }

      const validProviderIds = new Set(groupedModels.map((group) => group.providerId))
      let changed = false
      const next: Record<string, boolean> = {}

      for (const group of groupedModels) {
        if (typeof previous[group.providerId] === 'boolean') {
          next[group.providerId] = previous[group.providerId]
        } else {
          next[group.providerId] = false
          changed = true
        }
      }

      for (const providerId of Object.keys(previous)) {
        if (!validProviderIds.has(providerId)) {
          changed = true
          break
        }
      }

      if (!changed && Object.keys(previous).length === Object.keys(next).length) {
        return previous
      }

      return next
    })
  }, [groupedModels])

  const content = (
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-6xl space-y-8 px-6 py-6'
          : 'mx-auto w-full max-w-6xl space-y-8 px-6 pt-6 pb-10'
      }
    >
      <section className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="model-selection-search">Search Models</Label>
          <p className="text-sm text-muted-foreground">
            Filter saved models and provider catalogs by name, ID, or provider.
          </p>
        </div>
        <InputGroup className="h-10 bg-secondary/80 dark:bg-secondary/40">
          <InputGroupAddon>
            <InputGroupText>
              <Search className="h-4 w-4" />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="model-selection-search"
            value={modelSearchQuery}
            onChange={(event) => {
              setModelSearchQuery(event.target.value)
            }}
            placeholder="Search by model or provider..."
            className="text-sm"
          />
          {modelSearchQuery ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="Clear model search"
                onClick={() => setModelSearchQuery('')}
                size="icon-xs"
                variant="ghost"
              >
                <X className="h-3.5 w-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-medium">Saved Models</h3>
            <p className="text-sm text-muted-foreground">
              This is a global setting for your account workspace context.
            </p>
          </div>
          <p className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            {filteredSavedModels.length} saved
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl bg-secondary/80 px-2 py-1 dark:bg-secondary/40">
          {filteredSavedModels.length === 0 ? (
            <div className="px-4 py-6">
              <p className="text-sm text-muted-foreground">
                {normalizedModelSearchQuery
                  ? 'No saved models match your search.'
                  : 'No saved models yet. Use the star button on the right side of a model to save it.'}
              </p>
            </div>
          ) : (
            <Table className="[&_th]:px-4 [&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Model</TableHead>
                  <TableHead>Provider / ID</TableHead>
                  <TableHead className="w-12 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                {filteredSavedModels.map((model) => {
                  const providerName = getProviderDisplayName(model.provider)
                  const isRequiredSavedModel = requiredSavedModelId === model.id
                  return (
                    <TableRow key={`saved-${model.id}`}>
                      <TableCell className="max-w-0">
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-medium">{model.displayName}</p>
                            {modelSupportsThinking(model) ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="inline-flex shrink-0 cursor-help items-center text-muted-foreground"
                                    aria-label="This model supports thinking"
                                  >
                                    <Brain className="h-3.5 w-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  This model supports thinking.
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-0">
                        <p className="truncate text-xs text-muted-foreground">
                          {providerName} · {model.id}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            toggleSavedModel(model.id)
                          }}
                          disabled={isRequiredSavedModel}
                          aria-label={
                            isRequiredSavedModel
                              ? `${model.displayName} is required as at least one saved model`
                              : `Remove ${model.displayName} from saved models`
                          }
                        >
                          <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {unavailableSavedCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {unavailableSavedCount} saved model
            {unavailableSavedCount === 1 ? '' : 's'} not shown because they are not currently available.
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-medium">All Models</h3>
          <p className="text-sm text-muted-foreground">Models are grouped by provider.</p>
        </div>

        {isLoadingModels ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading models...
          </div>
        ) : null}

        {!isLoadingModels && modelsError ? (
          <p className="text-sm text-destructive">{modelsError}</p>
        ) : null}

        {!isLoadingModels && !modelsError && !currentOrganization?.organizationId ? (
          <p className="text-sm text-muted-foreground">
            Select a workspace to load available models.
          </p>
        ) : null}

        {!isLoadingModels && !modelsError && groupedModels.length === 0 && currentOrganization?.organizationId ? (
          <p className="text-sm text-muted-foreground">
            No models available for this workspace.
          </p>
        ) : null}

        {!isLoadingModels && !modelsError && groupedModels.length > 0 && filteredGroupedModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No models or providers match your search.
          </p>
        ) : null}

        {!isLoadingModels && !modelsError && filteredGroupedModels.length > 0 ? (
          <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
            {filteredGroupedModels.map((group, index) => {
              const isExpanded = expandedProviders[group.providerId] ?? false
              return (
                <Collapsible
                  key={group.providerId}
                  open={isExpanded}
                  onOpenChange={(open) => {
                    setExpandedProviders((previous) => ({
                      ...previous,
                      [group.providerId]: open,
                    }))
                  }}
                  className={cn(
                    'overflow-hidden',
                    index > 0 && 'border-t border-border/60'
                  )}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-background/30 focus:outline-none focus-visible:outline-none',
                        isExpanded && 'bg-background/25'
                      )}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.providerName} models`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/70">
                          <img
                            alt={`${group.providerName} logo`}
                            className="h-4 w-4 shrink-0 rounded-sm"
                            loading="lazy"
                            src={getProviderLogoUrl(group.providerId)}
                            style={{ filter: providerLogoFilter }}
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{group.providerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.models.length} available model{group.models.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="rounded-full bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
                          {group.models.length} models
                        </p>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform',
                            isExpanded && 'rotate-180'
                          )}
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-border/60">
                    <div className="px-2 pb-2">
                      <Table className="[&_th]:px-4 [&_td]:px-4">
                        <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Model</TableHead>
                            <TableHead>ID</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead className="w-12 text-right" />
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                          {group.models.map((model) => {
                            const isSaved = savedModelIds.includes(model.id)
                            const isRequiredSavedModel = requiredSavedModelId === model.id
                            const contextLimit = formatTokenLimit(model.limit?.context)
                            return (
                              <TableRow key={model.id}>
                                <TableCell className="max-w-0">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <p className="truncate text-sm font-medium">{model.displayName}</p>
                                    {modelSupportsThinking(model) ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span
                                            className="inline-flex shrink-0 cursor-help items-center text-muted-foreground"
                                            aria-label="This model supports thinking"
                                          >
                                            <Brain className="h-3.5 w-3.5" />
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                          This model supports thinking.
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-0">
                                  <p className="truncate text-xs text-muted-foreground">
                                    {model.id}
                                  </p>
                                </TableCell>
                                <TableCell>
                                  <p className="text-xs text-muted-foreground">
                                    Tier: {model.tier}
                                    {contextLimit ? ` · Context: ${contextLimit}` : ''}
                                  </p>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => {
                                      toggleSavedModel(model.id)
                                    }}
                                    disabled={isSaved && isRequiredSavedModel}
                                    aria-label={
                                      isSaved && isRequiredSavedModel
                                        ? `${model.displayName} is required as at least one saved model`
                                        : isSaved
                                        ? `Remove ${model.displayName} from saved models`
                                        : `Save ${model.displayName}`
                                    }
                                  >
                                    <Star
                                      className={cn(
                                        'h-4 w-4',
                                        isSaved
                                          ? 'fill-amber-400 text-amber-500'
                                          : 'text-muted-foreground'
                                      )}
                                    />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )

  if (surface === 'drawer') {
    return content
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'AI' }, { label: 'Model Selection' }]}
    >
      {content}
    </DashboardLayout>
  )
}
