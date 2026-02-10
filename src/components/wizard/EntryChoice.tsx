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
import { FolderGit2 } from 'lucide-react'
import {
  IconArrowUp,
  IconSquare,
  IconPlus,
  IconPaperclip,
  IconChevronDown,
  IconCheck,
  IconUser,
  IconRobot,
  IconBolt,
  IconCircle,
  IconProgress,
  IconCircleDashed,
  IconBrain,
} from '@tabler/icons-react'
import type { CreationPath } from '@/hooks/useWizardState'
import {
  loadModelSettings,
  saveModelSettings,
} from '@/lib/modelSettingsStorage'
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'

export interface PromptSettings {
  model: string
  agentType: 'agent' | 'assistant'
  reasoningDepth: 'low' | 'medium' | 'high'
  thinkingEffort?: 'low' | 'medium' | 'high'
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

// Model catalog per CrossCode Pricing Spec v3
// Tiers: Fast (1/2 credits), Standard (5/10 credits), Powerful (25/50 credits)
// Context window sizes are managed in ContextDisplay.tsx via getContextWindowSize()

const defaultModels = [
  // ============================================
  // FAST TIER - 1 input / 2 output credits per 1K tokens
  // ============================================
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'fast',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'fast',
    providers: ['google'],
  },
  // ============================================
  // STANDARD TIER - 5 input / 10 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'standard',
    providers: ['anthropic'],
  },
  // ============================================
  // POWERFUL TIER - 25 input / 50 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
]

export function EntryChoice({
  onSelect,
  promptValue = '',
  onPromptChange,
  onPromptSubmit,
  isSubmitting
}: EntryChoiceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Defensive: ensure promptValue is always a string before calling trim
  const safePromptValue = promptValue ?? ''
  const trimmedLength = safePromptValue.trim().length
  const canSubmitPrompt = trimmedLength > 0

  // AI input state
  const [model, setModel] = useState('gemini-3-pro')
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState('Agent')
  const [selectedPerformance, setSelectedPerformance] = useState('High')
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>('medium')
  const [modelSettings, setModelSettings] = useState<Record<string, { selectedAgent?: 'Agent' | 'Assistant'; selectedPerformance?: 'High' | 'Medium' | 'Low'; thinkingEffort?: 'low' | 'medium' | 'high' }>>(
    () => loadModelSettings()
  )

  const selectedModelData = defaultModels.find((m) => m.id === model)
  const allowCrossProviderSwitching = AI_MODEL_SELECTOR_CONFIG.allowCrossProviderSwitching
  const activeProvider = selectedModelData?.chefSlug
  const visibleChefs =
    allowCrossProviderSwitching || !selectedModelData
      ? ['Anthropic', 'OpenAI', 'Google']
      : [selectedModelData.chef]
  const visibleModels =
    allowCrossProviderSwitching || !activeProvider
      ? defaultModels
      : defaultModels.filter((m) => m.chefSlug === activeProvider)
  const isOpusModel = model.includes('opus')
  const defaultModelSettings = useMemo(
    () => ({
      selectedAgent: 'Agent' as const,
      selectedPerformance: 'High' as const,
      thinkingEffort: 'medium' as const,
    }),
    []
  )

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const stored = modelSettingsRef.current[model]
    const next = stored ?? defaultModelSettings
    setSelectedAgent(next.selectedAgent ?? 'Agent')
    setSelectedPerformance(next.selectedPerformance ?? 'High')
    setThinkingEffort(next.thinkingEffort ?? 'medium')
  }, [model, defaultModelSettings])

  useEffect(() => {
    const nextSettings: { selectedAgent: 'Agent' | 'Assistant'; selectedPerformance: 'High' | 'Medium' | 'Low'; thinkingEffort: 'low' | 'medium' | 'high' } = {
      selectedAgent: selectedAgent as 'Agent' | 'Assistant',
      selectedPerformance: selectedPerformance as 'High' | 'Medium' | 'Low',
      thinkingEffort: thinkingEffort as 'low' | 'medium' | 'high',
    }
    setModelSettings((prev) => {
      const updated = { ...prev, [model]: nextSettings }
      saveModelSettings(updated)
      return updated
    })
  }, [model, selectedAgent, selectedPerformance, thinkingEffort])

  const performanceToDisplay: Record<string, string> = {
    High: 'x3',
    Medium: 'x2',
    Low: 'x1',
  }

  const getSettings = (): PromptSettings => ({
    model,
    agentType: selectedAgent.toLowerCase() as 'agent' | 'assistant',
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    thinkingEffort: isOpusModel ? thinkingEffort : undefined,
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmitPrompt && !isSubmitting) {
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
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 rounded-full border border-border hover:bg-accent"
                  >
                    <IconPlus className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-w-xs rounded-2xl p-1.5"
                >
                  <DropdownMenuGroup className="space-y-1">
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <IconPaperclip size={16} className="opacity-60" />
                      Attach Files
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

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
            </div>

            <Button
              type="button"
              disabled={!canSubmitPrompt || isSubmitting}
              className="size-7 p-0 rounded-full bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
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

        {/* Options row below input */}
        <div className="flex items-center gap-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
              >
                <IconUser className="size-3" />
                <span>{selectedAgent}</span>
                <IconChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
            >
              <DropdownMenuGroup className="space-y-1">
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedAgent('Agent')}
                >
                  <IconUser size={16} className="opacity-60" />
                  Agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedAgent('Assistant')}
                >
                  <IconRobot size={16} className="opacity-60" />
                  Assistant
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
              >
                <IconBolt className="size-3" />
                <span>{performanceToDisplay[selectedPerformance]}</span>
                <IconChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
            >
              <DropdownMenuGroup className="space-y-1">
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance('High')}
                >
                  <IconCircle size={16} className="opacity-60" />
                  High
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance('Medium')}
                >
                  <IconProgress size={16} className="opacity-60" />
                  Medium
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance('Low')}
                >
                  <IconCircleDashed size={16} className="opacity-60" />
                  Low
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Thinking Effort - only for Opus models */}
          {isOpusModel && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                >
                  <IconBrain className="size-3" />
                  <span>{thinkingEffort.charAt(0).toUpperCase() + thinkingEffort.slice(1)}</span>
                  <IconChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
              >
                <DropdownMenuGroup className="space-y-1">
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setThinkingEffort('high')}
                  >
                    <IconCircle size={16} className="opacity-60" />
                    High (deeper reasoning)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setThinkingEffort('medium')}
                  >
                    <IconProgress size={16} className="opacity-60" />
                    Medium (balanced)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setThinkingEffort('low')}
                  >
                    <IconCircleDashed size={16} className="opacity-60" />
                    Low (faster)
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Context window usage */}
          <Context
            maxTokens={getContextWindowSize(model)}
            usedTokens={0}
            modelId={model}
          >
            <ContextTrigger className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs" />
            <ContextContent>
              <ContextContentHeader />
              <ContextContentFooter />
            </ContextContent>
          </Context>

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
