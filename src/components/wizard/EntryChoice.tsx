import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai/model-selector'
import { Brain, FolderGit2 } from 'lucide-react'
import {
  IconArrowUp,
  IconSquare,
  IconPlus,
  IconChevronDown,
  IconCheck,
} from '@tabler/icons-react'
import type { CreationPath } from '@/hooks/useWizardState'
import { useAuth } from '@/contexts/AuthContext'
import {
  getProviderDisplayName,
  isConnectedProvider,
  useConnectedProviders,
  type ConnectedProvider,
} from '@/hooks/useConnectedProviders'
import {
  loadGlobalModelSettings,
  loadModelSettings,
  saveModelSettings,
  type StoredModelSettings,
  updateGlobalModelSettings,
  writeStoredModelSettings,
} from '@/lib/modelSettingsStorage'
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
import {
  VARIANT_DEFINITIONS,
  getSupportedVariantsForModel,
  normalizeVariantForModel,
  type RuntimeModelCapabilities,
  type RuntimeProvider,
} from '@/lib/ai/runtimeProfiles'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
import type { ModelOption } from '@/lib/ai/modelOptions'
import {
  getModelCatalog,
  type ModelApiModel,
} from '@/lib/ai/modelCatalogClient'

export interface PromptSettings {
  model: string
  agentId: 'plan'
  surface: 'wizard'
  variantId?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

interface EntryChoiceProps {
  onSelect: (path: CreationPath) => void
  promptValue: string
  onPromptChange: (value: string) => void
  onPromptSubmit: (settings: PromptSettings, promptText: string) => void
  isSubmitting?: boolean
}

const GUIDED_OPTIONS = [
  {
    id: 'repo' as const,
    icon: FolderGit2,
    title: 'Existing Repo',
    description: 'Import from a local folder',
  },
]

export function EntryChoice({
  onSelect,
  promptValue = '',
  onPromptChange,
  onPromptSubmit,
  isSubmitting
}: EntryChoiceProps) {
  const { accessToken, currentOrganization } = useAuth()
  const { connectedProviders, providerAuthAvailable, providerStatusLoaded } = useConnectedProviders()
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Defensive: ensure promptValue is always a string before calling trim
  const safePromptValue = promptValue ?? ''
  const trimmedLength = safePromptValue.trim().length
  const canSubmitPrompt = trimmedLength > 0

  // AI input state
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState(initialGlobalModelSettings.model ?? '')
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, RuntimeModelCapabilities>>({})
  const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(initialGlobalModelSettings.variantId)
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )

  const providerScopedModels = useMemo(() => {
    const supportedModels = availableModels.filter((m) => isConnectedProvider(m.chefSlug))
    if (!providerAuthAvailable || !providerStatusLoaded) return supportedModels
    if (connectedProviders.length === 0) return []
    const connectedSet = new Set(connectedProviders)
    return supportedModels.filter((m) => connectedSet.has(m.chefSlug as ConnectedProvider))
  }, [availableModels, connectedProviders, providerAuthAvailable, providerStatusLoaded])

  const selectedModelData = providerScopedModels.find((m) => m.id === model)
  const allowCrossProviderSwitching = AI_MODEL_SELECTOR_CONFIG.allowCrossProviderSwitching
  const activeProvider = selectedModelData?.chefSlug
  const visibleModels =
    allowCrossProviderSwitching || !activeProvider
      ? providerScopedModels
      : providerScopedModels.filter((m) => m.chefSlug === activeProvider)
  const visibleChefs = useMemo(
    () => Array.from(new Set(visibleModels.map((m) => m.chef))),
    [visibleModels]
  )
  const hasSelectableModel = Boolean(selectedModelData)
  const canSubmitWithModel = canSubmitPrompt && hasSelectableModel
  const selectedModelCapabilities = useMemo(
    () => modelCapabilities[model] ?? null,
    [model, modelCapabilities]
  )
  const supportsAttachments =
    !selectedModelCapabilities ||
    selectedModelCapabilities.supportsImageInput ||
    selectedModelCapabilities.supportsPdfInput
  const supportedVariants = useMemo(
    () =>
      getSupportedVariantsForModel({
        modelId: model,
        provider: selectedModelData?.chefSlug as RuntimeProvider | undefined,
        capabilities: selectedModelCapabilities,
      }),
    [model, selectedModelData?.chefSlug, selectedModelCapabilities]
  )
  const normalizedVariantId = useMemo(
    () =>
      normalizeVariantForModel(variantId, {
        modelId: model,
        provider: selectedModelData?.chefSlug as RuntimeProvider | undefined,
        capabilities: selectedModelCapabilities,
      }),
    [model, selectedModelCapabilities, selectedModelData?.chefSlug, variantId]
  )

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    if (!model) return
    const nextSettings: StoredModelSettings = {
      agentId: 'plan',
      surface: 'wizard',
    }
    setModelSettings((prev) => {
      const updated = writeStoredModelSettings(prev, model, 'wizard', nextSettings)
      saveModelSettings(updated)
      return updated
    })
  }, [model])

  useEffect(() => {
    if (!model) return
    updateGlobalModelSettings({
      model,
      variantId: variantId ?? normalizedVariantId,
    })
  }, [model, variantId, normalizedVariantId])

  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId || !providerStatusLoaded) return

    let cancelled = false

    getModelCatalog({
      organizationId: currentOrganization.organizationId,
      accessToken,
      connectedProviders: providerAuthAvailable ? connectedProviders : undefined,
    })
      .then((data) => {
        if (cancelled) return
        if (!data?.models) return
        const nextCapabilities: Record<string, RuntimeModelCapabilities> = {}
        const mapped = data.models
          .filter((m): m is ModelApiModel & { provider: ConnectedProvider } => isConnectedProvider(m.provider))
          .map((m) => {
            if (m.capabilities) {
              nextCapabilities[m.id] = m.capabilities
            }
            return {
              id: m.id,
              name: m.displayName,
              chef: getProviderDisplayName(m.provider),
              chefSlug: m.provider,
              tier: m.tier,
              providers: [m.provider],
              limit: m.limit,
            }
          })
        setAvailableModels(mapped)
        setModelCapabilities(nextCapabilities)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('Failed to fetch models:', error)
      })

    return () => {
      cancelled = true
    }
  }, [
    accessToken,
    connectedProviders,
    currentOrganization?.organizationId,
    providerAuthAvailable,
    providerStatusLoaded,
  ])

  useEffect(() => {
    if (providerScopedModels.length === 0) return
    if (!providerScopedModels.some((item) => item.id === model)) {
      setModel(providerScopedModels[0].id)
    }
  }, [providerScopedModels, model])

  const getSettings = (): PromptSettings => ({
    model,
    agentId: 'plan',
    surface: 'wizard',
    variantId: normalizedVariantId,
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmitWithModel && !isSubmitting) {
        onPromptSubmit(getSettings(), safePromptValue.trim())
      }
    }
  }

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = target.scrollHeight + 'px'
  }

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Quick Prompt Section */}
      <div className="space-y-4">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-semibold">What do you want to build?</h2>
          <p className="text-muted-foreground text-sm">
            Describe your project and let AI handle the rest
          </p>
        </div>

        {/* AI Chat-style Input */}
        <div className="bg-secondary rounded-2xl overflow-hidden">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              console.log(e.target.files)
            }}
          />

          <div className="px-3 pt-3 pb-2">
            <Textarea
              ref={textareaRef}
              value={safePromptValue}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              placeholder="Build me a project management app with kanban boards, user authentication, and real-time collaboration..."
              className="w-full !bg-transparent rounded-none p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-[80px] max-h-[200px]"
              rows={3}
            />
          </div>

          <div className="mb-2 px-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 rounded-full border border-border hover:bg-accent"
                onClick={() => fileInputRef.current?.click()}
                disabled={!supportsAttachments}
                title={supportsAttachments ? 'Attach files' : 'Attachments unavailable'}
              >
                <IconPlus className="size-3" />
              </Button>

              {hasSelectableModel && (
                <ModelSelector
                  onOpenChange={setModelSelectorOpen}
                  open={modelSelectorOpen}
                >
                  <ModelSelectorTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                    >
                      {selectedModelData?.chefSlug && (
                        <ModelSelectorLogo provider={selectedModelData.chefSlug} />
                      )}
                      {selectedModelData?.name && (
                        <ModelSelectorName className="ml-1">
                          {selectedModelData.name}
                        </ModelSelectorName>
                      )}
                      <IconChevronDown className="size-3 ml-1" />
                    </Button>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                      {visibleChefs.map((chef) => (
                        <ModelSelectorGroup heading={chef} key={chef}>
                          {visibleModels
                            .filter((m) => m.chef === chef)
                            .map((m) => (
                              <ModelSelectorItem
                                key={m.id}
                                onSelect={() => {
                                  setModel(m.id)
                                  setModelSelectorOpen(false)
                                }}
                                value={m.id}
                              >
                                <ModelSelectorLogo provider={m.chefSlug} />
                                <ModelSelectorName>{m.name}</ModelSelectorName>
                                <ModelSelectorLogoGroup>
                                  {m.providers.map((provider) => (
                                    <ModelSelectorLogo key={provider} provider={provider} />
                                  ))}
                                </ModelSelectorLogoGroup>
                                {model === m.id ? (
                                  <IconCheck className="ml-auto size-4" />
                                ) : (
                                  <div className="ml-auto size-4" />
                                )}
                              </ModelSelectorItem>
                            ))}
                        </ModelSelectorGroup>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              )}
            </div>

            <Button
              type="button"
              disabled={!canSubmitWithModel || isSubmitting}
              className="size-7 p-0 rounded-full bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (!canSubmitWithModel) return
                console.log('[EntryChoice] Submitting with model:', model)
                onPromptSubmit(getSettings(), safePromptValue.trim())
              }}
            >
              {isSubmitting ? (
                <IconSquare className="size-3 fill-primary-foreground text-primary-foreground" />
              ) : (
                <IconArrowUp className="size-4 text-primary-foreground" />
              )}
            </Button>
          </div>
        </div>
        {!hasSelectableModel && providerStatusLoaded && providerAuthAvailable && (
          <p className="text-xs text-amber-600">
            Connect an AI provider in Workspace AI settings to select a model.
          </p>
        )}

        {/* Options row below input */}
        <div className="flex items-center gap-0">
          {hasSelectableModel && (
            <>
              <div
                className={`grid overflow-hidden transition-all duration-200 ease-out ${
                  supportedVariants.length > 1
                    ? 'grid-cols-[1fr] opacity-100 translate-y-0'
                    : 'grid-cols-[0fr] opacity-0 -translate-y-1 pointer-events-none'
                }`}
              >
                <div className="min-w-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                      >
                        <Brain className="size-3" />
                        <span>{VARIANT_DEFINITIONS[normalizedVariantId]?.label ?? normalizedVariantId}</span>
                        <IconChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-w-xs rounded-2xl p-1.5 bg-secondary border-border"
                    >
                      <DropdownMenuGroup className="space-y-1">
                        {supportedVariants.map((variant) => (
                          <DropdownMenuItem
                            key={variant}
                            className="rounded-[calc(1rem-6px)] text-xs"
                            onClick={() => setVariantId(variant)}
                          >
                            <Brain size={16} className="opacity-60" />
                            {VARIANT_DEFINITIONS[variant]?.label ?? variant}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div
                className={`grid overflow-hidden transition-all duration-200 ease-out ${
                  supportedVariants.length <= 1
                    ? 'grid-cols-[1fr] opacity-100 translate-y-0'
                    : 'grid-cols-[0fr] opacity-0 -translate-y-1 pointer-events-none'
                }`}
              >
                <div className="min-w-0 h-6 px-2 flex items-center rounded-full border border-transparent text-muted-foreground text-xs">
                  <Brain className="size-3 mr-1" />
                  <span>{VARIANT_DEFINITIONS[normalizedVariantId]?.label ?? normalizedVariantId}</span>
                </div>
              </div>

              {/* Context window usage */}
              <Context
                maxTokens={selectedModelData?.limit?.context ?? getContextWindowSize(model)}
                usedTokens={0}
                modelId={model}
              >
                <ContextTrigger className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs" />
                <ContextContent>
                  <ContextContentHeader />
                  <ContextContentFooter />
                </ContextContent>
              </Context>
            </>
          )}

          <div className="flex-1" />

          <p className="text-xs text-muted-foreground">
            Press Enter to generate
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            or choose a guided flow
          </span>
        </div>
      </div>

      {/* Guided Options */}
      <div className="flex flex-col gap-1">
        {GUIDED_OPTIONS.map((option) => (
          <button
            key={option.id}
            className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
            onClick={() => onSelect(option.id)}
          >
            <option.icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm block">{option.title}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
