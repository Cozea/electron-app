import { memo, startTransition, useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { useConvex } from 'convex/react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Pencil, GitBranch, Layers, Palette, Code2, Server, Rocket, Loader2, Check, CircleDashed, RefreshCw, Database, Star } from 'lucide-react'
import {
  SiCss3,
  SiDart,
  SiGnubash,
  SiGo,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiMarkdown,
  SiPhp,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSass,
  SiSvelte,
  SiSwift,
  SiTypescript,
  SiVuedotjs,
  SiYaml,
} from 'react-icons/si'
import type { WizardState, WizardSourceControl } from '@/hooks/useWizardState'
import { cn } from '@/lib/utils'
import { IntegrationIcon } from '@/components/integrations/IntegrationIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { RepositoryLanguageDescriptor } from '@shared/electronApiTypes'
import {
  getConnectedRepositoryReadmeSnippet,
  listConnectedRepositoryLanguages,
} from '@/lib/git/providerRepositoryManagement'

interface ReviewStepProps {
  state: WizardState
  organizationId?: Id<'organizations'> | null
  userId?: Id<'users'> | null
  onEditStep: (step: number) => void
  editStepIndexById?: Partial<Record<string, number>>
  onImport?: () => void
  isImporting?: boolean
  importError?: string | null
  importSyncState?: 'idle' | 'checking' | 'syncing' | 'ready' | 'error'
  importSyncMessage?: string | null
  className?: string
  onUpdateSourceControl?: (sourceControl: Partial<WizardSourceControl>) => void
}

const IMPORT_STEPS = [
  'Validate source',
  'Attach or clone workspace',
  'Prepare runtimes',
  'Open project',
] as const

interface LanguageSegment {
  name: string
  percentage: number
  color: string
  Icon: ComponentType<{ className?: string }>
}

interface LanguageSplitBarProps {
  isLoading: boolean
  languages: RepositoryLanguageDescriptor[]
}

const LANGUAGE_FALLBACK_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#f43f5e',
  '#06b6d4',
] as const

const LANGUAGE_PRESENTATION: Record<string, {
  color: string
  Icon: ComponentType<{ className?: string }>
}> = {
  typescript: { color: '#3178C6', Icon: SiTypescript },
  javascript: { color: '#F7DF1E', Icon: SiJavascript },
  jsx: { color: '#61DAFB', Icon: SiReact },
  tsx: { color: '#61DAFB', Icon: SiReact },
  python: { color: '#3776AB', Icon: SiPython },
  go: { color: '#00ADD8', Icon: SiGo },
  rust: { color: '#CE422B', Icon: SiRust },
  php: { color: '#777BB4', Icon: SiPhp },
  ruby: { color: '#CC342D', Icon: SiRuby },
  swift: { color: '#FA7343', Icon: SiSwift },
  kotlin: { color: '#7F52FF', Icon: SiKotlin },
  dart: { color: '#0175C2', Icon: SiDart },
  html: { color: '#E34F26', Icon: SiHtml5 },
  css: { color: '#1572B6', Icon: SiCss3 },
  scss: { color: '#CC6699', Icon: SiSass },
  sass: { color: '#CC6699', Icon: SiSass },
  shell: { color: '#89E051', Icon: SiGnubash },
  bash: { color: '#89E051', Icon: SiGnubash },
  vue: { color: '#4FC08D', Icon: SiVuedotjs },
  svelte: { color: '#FF3E00', Icon: SiSvelte },
  json: { color: '#F59E0B', Icon: SiJson },
  yaml: { color: '#CB171E', Icon: SiYaml },
  yml: { color: '#CB171E', Icon: SiYaml },
  markdown: { color: '#111827', Icon: SiMarkdown },
}

function formatLanguagePercentage(value: number): string {
  if (value >= 10) {
    return `${Math.round(value)}%`
  }
  if (value >= 1) {
    return `${value.toFixed(1).replace(/\.0$/, '')}%`
  }
  return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
}

function buildLanguageSegments(
  languages: RepositoryLanguageDescriptor[]
): LanguageSegment[] {
  const normalized = [...languages]
    .filter((language) => language.percentage > 0)
    .sort((left, right) => right.percentage - left.percentage)

  if (normalized.length === 0) {
    return []
  }

  const getPresentation = (name: string, index: number) => {
    const normalizedName = name.trim().toLowerCase()
    return LANGUAGE_PRESENTATION[normalizedName] ?? {
      color: LANGUAGE_FALLBACK_COLORS[index % LANGUAGE_FALLBACK_COLORS.length],
      Icon: Code2,
    }
  }

  const topLanguages = normalized.slice(0, 5)
  const remainingPercentage = normalized
    .slice(5)
    .reduce((sum, language) => sum + language.percentage, 0)

  const segments: LanguageSegment[] = topLanguages.map((language, index) => {
    const presentation = getPresentation(language.name, index)
    return {
      name: language.name,
      percentage: language.percentage,
      color: presentation.color,
      Icon: presentation.Icon,
    }
  })

  if (remainingPercentage > 0.1) {
    segments.push({
      name: 'Other',
      percentage: remainingPercentage,
      color: 'rgba(148, 163, 184, 0.45)',
      Icon: Layers,
    })
  }

  return segments
}

const LanguageSplitBar = memo(function LanguageSplitBar({
  isLoading,
  languages,
}: LanguageSplitBarProps) {
  const segments = useMemo(() => buildLanguageSegments(languages), [languages])
  const total = segments.reduce((sum, segment) => sum + segment.percentage, 0)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading language split...</span>
      </div>
    )
  }

  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground">Language split unavailable</p>
  }

  return (
    <div className="mb-8">
      <div className="flex w-full h-1.5 rounded-full overflow-hidden bg-zinc-900/50 dark:bg-zinc-900 mb-4">
        {segments.map((segment) => {
          const width = total > 0 ? (segment.percentage / total) * 100 : 0
          const percentLabel = formatLanguagePercentage(segment.percentage)

          return (
            <Tooltip key={segment.name}>
              <TooltipTrigger asChild>
                <div
                  className="h-full shrink-0 cursor-default border-0 p-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  role="progressbar"
                  style={{
                    width: `${width}%`,
                    backgroundColor: segment.color,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="flex flex-col gap-0.5">
                <span className="font-medium">{segment.name}</span>
                <span>{percentLabel}</span>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-6 text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
        {segments.map((segment) => (
          <div key={segment.name} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="shrink-0"
              style={{ color: segment.color }}
            >
              <segment.Icon className="h-3 w-3" />
            </span>
            <span>{segment.name} {formatLanguagePercentage(segment.percentage)}</span>
          </div>
        ))}
      </div>
    </div>
  )
})


function formatSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || bytes < 0) return null
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatNumber(num?: number): string | null {
  if (typeof num !== 'number' || num < 0) return null
  return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(num)
}

function formatRelativeLastCommit(value?: string): string | null {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  const deltaMs = Date.now() - timestamp
  if (deltaMs < 0) {
    return 'just now'
  }

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  if (deltaMs < minute) return 'just now'
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m ago`
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`
  if (deltaMs < month) return `${Math.floor(deltaMs / day)}d ago`
  if (deltaMs < year) return `${Math.floor(deltaMs / month)}mo ago`
  return `${Math.floor(deltaMs / year)}y ago`
}

function getCurrentImportStepIndex(params: {
  importSyncMessage?: string | null
  isImportReady: boolean
}) {
  const { importSyncMessage, isImportReady } = params
  const normalizedImportMessage = (importSyncMessage || '').toLowerCase()

  if (isImportReady) return IMPORT_STEPS.length - 1
  if (normalizedImportMessage.includes('opening project')) return 3
  if (
    normalizedImportMessage.includes('checking required runtimes') ||
    normalizedImportMessage.includes('preparing node') ||
    normalizedImportMessage.includes('preparing npm') ||
    normalizedImportMessage.includes('preparing corepack') ||
    normalizedImportMessage.includes('preparing pnpm') ||
    normalizedImportMessage.includes('preparing yarn') ||
    normalizedImportMessage.includes('preparing bun') ||
    normalizedImportMessage.includes('preparing python') ||
    normalizedImportMessage.includes('preparing rust') ||
    normalizedImportMessage.includes('preparing go') ||
    normalizedImportMessage.includes('runtime setup complete') ||
    normalizedImportMessage.includes('installed runtimes')
  ) return 2
  if (
    normalizedImportMessage.includes('creating project') ||
    normalizedImportMessage.includes('cloning repository') ||
    normalizedImportMessage.includes('attaching repository') ||
    normalizedImportMessage.includes('setting up repository')
  ) return 1
  return 0
}

interface ImportProgressSectionProps {
  importError?: string | null
  importSyncMessage?: string | null
  importSyncState: 'idle' | 'checking' | 'syncing' | 'ready' | 'error'
}

const ImportProgressSection = memo(function ImportProgressSection({
  importError,
  importSyncMessage,
  importSyncState,
}: ImportProgressSectionProps) {
  const isImportError = importSyncState === 'error'
  const isImportReady = importSyncState === 'ready'
  const currentImportStepIndex = getCurrentImportStepIndex({ importSyncMessage, isImportReady })

  return (
    <div className="p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Import Progress</p>
      <div className="mt-5 space-y-4">
        {IMPORT_STEPS.map((step, index) => {
          const isComplete = index < currentImportStepIndex || (isImportReady && index <= currentImportStepIndex)
          const isCurrent = index === currentImportStepIndex && !isComplete
          const isFailed = isImportError && index === currentImportStepIndex

          return (
            <div key={step} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {isComplete ? (
                  <Check className="h-4 w-4 text-foreground" />
                ) : isCurrent ? (
                  <Loader2 className={cn('h-4 w-4 animate-spin', isFailed ? 'text-destructive' : 'text-foreground')} />
                ) : (
                  <CircleDashed className="h-4 w-4 text-muted-foreground/70" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'text-sm',
                  isComplete && 'text-muted-foreground line-through',
                  isCurrent && !isFailed && 'font-medium text-foreground',
                  isFailed && 'font-medium text-destructive',
                  !isComplete && !isCurrent && 'text-muted-foreground'
                )}>
                  {step}
                </p>
                {index === currentImportStepIndex && (importSyncMessage || importError) && (
                  <p className={cn(
                    'mt-1 text-xs',
                    isFailed ? 'text-destructive/90' : 'text-muted-foreground'
                  )}>
                    {importError || importSyncMessage}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-6">
    {children}
  </div>
)

export function ReviewStep({
  state,
  organizationId,
  userId,
  onEditStep,
  editStepIndexById,
  onImport,
  importSyncState = 'idle',
  importError,
  importSyncMessage,
  className,
  onUpdateSourceControl,
}: ReviewStepProps) {
  const convex = useConvex()
  const resolveEditStep = (stepId: string, fallback: number) => editStepIndexById?.[stepId] ?? fallback
  const isImportActive = importSyncState !== 'idle'
  const isImportError = importSyncState === 'error'
  const [repositoryLanguages, setRepositoryLanguages] = useState<RepositoryLanguageDescriptor[]>([])
  const [isLoadingRepositoryLanguages, setIsLoadingRepositoryLanguages] = useState(false)
  const [repositoryReadmeSnippet, setRepositoryReadmeSnippet] = useState<string | null>(null)
  const [isLoadingRepositoryReadme, setIsLoadingRepositoryReadme] = useState(false)

  // For repo path, get the folder/repo name from the URL
  const repoName = state.repoSource?.repoUrl
    ? state.repoSource.repoUrl.split('/').pop() || 'Repository'
    : 'Repository'
  const remoteOwnerLogin = state.repoSource?.provider !== 'local'
    ? state.repoSource?.ownerLogin
    : undefined
  const ownerAvatarFallback = (() => {
    const segment = remoteOwnerLogin?.split('/').filter(Boolean).pop() ?? ''
    return segment.slice(0, 2).toUpperCase() || 'RE'
  })()
  const remoteRepositoryProvider =
    state.repoSource?.provider === 'github' || state.repoSource?.provider === 'gitlab'
      ? state.repoSource.provider
      : undefined
  const shouldLoadRepositoryLanguages = Boolean(
    remoteRepositoryProvider && state.repoSource?.repoUrl && organizationId && userId
  )
  const isExternalRemoteImport = state.repoSource?.provider !== undefined && state.repoSource.provider !== 'local'
  const teamStepIndex = editStepIndexById?.team

  useEffect(() => {
    const provider = remoteRepositoryProvider
    if (!provider || !shouldLoadRepositoryLanguages || !organizationId || !userId || !state.repoSource?.repoUrl) {
      startTransition(() => {
        setRepositoryLanguages([])
        setIsLoadingRepositoryLanguages(false)
        setRepositoryReadmeSnippet(null)
        setIsLoadingRepositoryReadme(false)
      })
      return
    }

    let cancelled = false
    startTransition(() => {
      setIsLoadingRepositoryLanguages(true)
      setIsLoadingRepositoryReadme(true)
    })

    void Promise.all([
      listConnectedRepositoryLanguages({
        convex,
        organizationId,
        userId,
        provider,
        repoUrl: state.repoSource.repoUrl,
      }),
      getConnectedRepositoryReadmeSnippet({
        convex,
        organizationId,
        userId,
        provider,
        repoUrl: state.repoSource.repoUrl,
        branch: state.repoSource.branch,
      }),
    ])
      .then(([languages, readme]) => {
        if (!cancelled) {
          startTransition(() => {
            setRepositoryLanguages(languages)
            setRepositoryReadmeSnippet(readme.excerpt)
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Failed to load repository remote metadata:', error)
          startTransition(() => {
            setRepositoryLanguages([])
            setRepositoryReadmeSnippet(null)
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          startTransition(() => {
            setIsLoadingRepositoryLanguages(false)
            setIsLoadingRepositoryReadme(false)
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    convex,
    organizationId,
    remoteRepositoryProvider,
    shouldLoadRepositoryLanguages,
    state.repoSource?.repoUrl,
    state.repoSource?.branch,
    userId,
  ])

  const lastCommitLabel = formatRelativeLastCommit(state.repoSource?.lastActivityAt)

  const getProviderIcon = () => (
    <svg width="20" height="17" viewBox="0 0 56 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8C2 5.79086 3.79086 4 6 4H18L24 12H50C52.2091 12 54 13.7909 54 16V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V8Z" fill="#F5C242"/>
      <path d="M2 16H54V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V16Z" fill="#FCDC6C"/>
      <path d="M18 4L24 12H18V4Z" fill="#E5A620"/>
    </svg>
  )

  const repoReviewBody = (
    <div className="max-w-5xl mx-auto px-8 py-8 flex flex-col w-full">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="scale-125 transform origin-left">
            {getProviderIcon()}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{repoName}</h1>
        </div>
        <div className="flex items-center gap-3 mb-8">
          {remoteOwnerLogin ? (
            <>
              <Avatar className="h-6 w-6 rounded-xl">
                <AvatarImage src={state.repoSource?.ownerAvatarUrl} alt={remoteOwnerLogin} />
                <AvatarFallback className="rounded-xl text-[10px] font-medium">{ownerAvatarFallback}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{remoteOwnerLogin}</span>
              <span className="text-zinc-700">•</span>
              {state.repoSource?.provider === 'github' || state.repoSource?.provider === 'gitlab' ? (
                  <IntegrationIcon
                    provider={state.repoSource.provider}
                    size="sm"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                ) : <Code2 className="h-4 w-4 text-muted-foreground" />}
              {lastCommitLabel ? (
                <>
                  <span className="text-zinc-700">•</span>
                  <span className="text-sm font-medium">Last commit {lastCommitLabel}</span>
                </>
              ) : null}
            </>
          ) : (
             <span className="text-sm font-medium">Local Project</span>
          )}
        </div>
        
        <div className="border-b border-border/40 dark:border-zinc-900 mb-8" />
        
        {!isExternalRemoteImport ? (
          <div className="mb-8">
            <SectionLabel>Stack</SectionLabel>
            {state.repoSource?.detectedStack ? (
              <div className="space-y-4">
                {state.repoSource.detectedStack.framework && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Framework</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.framework}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.styling && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Styling</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.styling}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.database && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Database</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.database}</span>
                  </div>
                )}
                {state.repoSource.detectedStack.testingFramework && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Testing</span>
                    </div>
                    <span className="text-sm">{state.repoSource.detectedStack.testingFramework}</span>
                  </div>
                )}
                {(state.repoSource.detectedStack.pageCount || state.repoSource.detectedStack.componentCount) && (
                  <div className="flex items-center gap-4 pt-1">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Structure</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {state.repoSource.detectedStack.pageCount && (
                        <span>{state.repoSource.detectedStack.pageCount} pages</span>
                      )}
                      {state.repoSource.detectedStack.pageCount && state.repoSource.detectedStack.componentCount && (
                        <span> · </span>
                      )}
                      {state.repoSource.detectedStack.componentCount && (
                        <span>{state.repoSource.detectedStack.componentCount} components</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No stack detected</p>
            )}
          </div>
        ) : (
          <div className="mb-8">
            <SectionLabel>README</SectionLabel>
            {isLoadingRepositoryReadme ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading README excerpt...</span>
              </div>
            ) : repositoryReadmeSnippet ? (
              <p className="text-muted-foreground leading-relaxed text-[15px] max-w-3xl mb-8">
                {repositoryReadmeSnippet}
              </p>
            ) : (
              <p className="text-muted-foreground leading-relaxed text-[15px] max-w-3xl mb-8">
                No README available.
              </p>
            )}
            
            {shouldLoadRepositoryLanguages ? (
              <LanguageSplitBar
                isLoading={isLoadingRepositoryLanguages}
                languages={repositoryLanguages}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Language split unavailable</p>
            )}
          </div>
        )}

        <div className="border-b border-border/40 dark:border-zinc-900 mb-8" />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          <div>
            <div className="mb-8">
              <SectionLabel>Source</SectionLabel>
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                  <GitBranch className="h-4 w-4" />
                  <span>Branch</span>
                </div>
                {state.repoSource?.branch ? (
                  <span 
                    className="text-xs bg-black/5 dark:bg-zinc-900 px-3 py-1 rounded-full font-mono truncate max-w-[200px] md:max-w-[300px]" 
                    title={state.repoSource.branch}
                  >
                    {state.repoSource.branch}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">N/A</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-6">
                <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
                  Sync
                </div>
                {!onUpdateSourceControl && (
                  <button 
                    onClick={() => onEditStep(resolveEditStep('repo-source', 1))}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                    <RefreshCw className="h-4 w-4" />
                    <span>Mode</span>
                  </div>
                  {onUpdateSourceControl ? (
                    <Select 
                      value={state.sourceControl.syncPolicy || 'auto'} 
                      onValueChange={(val) => onUpdateSourceControl({ syncPolicy: val as 'auto' | 'manual' })}
                    >
                      <SelectTrigger className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus:ring-0 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic git sync</SelectItem>
                        <SelectItem value="manual">Manual git sync</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm">
                      {state.sourceControl.syncPolicy === 'manual' ? 'Manual git sync' : 'Automatic git sync'}
                    </span>
                  )}
                </div>
                {!isExternalRemoteImport && state.sourceControl.defaultBranch ? (
                  <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                      <GitBranch className="h-4 w-4" />
                      <span>Branch</span>
                    </div>
                    {onUpdateSourceControl ? (
                      <Input
                        className="w-48 h-8 text-xs bg-black/5 dark:bg-zinc-900 border-0 focus-visible:ring-0 font-mono px-3"
                        value={state.sourceControl.defaultBranch}
                        onChange={(e) => onUpdateSourceControl({ defaultBranch: e.target.value })}
                      />
                    ) : (
                      <span 
                        className="text-sm font-mono truncate max-w-[200px] md:max-w-[300px]" 
                        title={state.sourceControl.defaultBranch}
                      >
                        {state.sourceControl.defaultBranch}
                      </span>
                    )}
                  </div>
                ) : null}
                {state.repoSource?.provider === 'local' ? (
                  <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground w-24 shrink-0">
                      <Layers className="h-4 w-4" />
                      <span>Checkout</span>
                    </div>
                    <span className="text-sm">Use existing local checkout</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-6">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500">
                Team
              </div>
              {typeof teamStepIndex === 'number' ? (
                <button
                  onClick={() => onEditStep(teamStepIndex)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Edit</span>
                </button>
              ) : null}
            </div>
            
            <div className="space-y-3">
              {state.team.length > 0 ? state.team.map((member) => {
                const initials = member.name
                  ? member.name.split(' ').map((namePart) => namePart[0]).join('').toUpperCase().slice(0, 2)
                  : member.email[0].toUpperCase()

                return (
                  <div key={member.email} className="flex items-center justify-between p-3 border border-border/40 dark:border-outline dark:bg-zinc-900/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {member.profileImageUrl && (
                          <AvatarImage src={member.profileImageUrl} alt={member.name || member.email} />
                        )}
                        <AvatarFallback className="text-xs bg-muted">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">
                          {member.name || member.email} 
                          {member.isCurrentUser && (
                            <span className="text-muted-foreground font-normal ml-1">(you)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-black/5 dark:bg-zinc-800 rounded uppercase tracking-wider text-muted-foreground">
                      {member.role.replace('_', ' ')}
                    </span>
                  </div>
                )
              }) : (
                <p className="text-sm text-muted-foreground">No team members added</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div
      className={cn(
        "w-full h-full",
        className
      )}
    >
      <div className={cn(
        'relative h-full w-full'
      )}>
        <div
          aria-hidden={isImportActive}
          className={cn(
            'h-full w-full flex flex-col',
            isImportActive && 'pointer-events-none absolute inset-0 opacity-0',
            'transition-opacity duration-150'
          )}
        >
          <div className="flex-1 overflow-y-auto app-scrollbar">
            {repoReviewBody}
          </div>

          {/* Footer Area */}
          <div className="w-full flex justify-center border-t border-border/40 dark:border-zinc-900 bg-background/50 backdrop-blur-sm z-10 px-8 py-6">
            <div className="max-w-5xl w-full flex justify-between items-center">
              <div className="flex gap-8 text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
                {typeof state.repoSource?.sizeBytes === 'number' && (
                  <div className="flex items-center gap-2"><Database className="w-4 h-4"/> {formatSize(state.repoSource.sizeBytes)}</div>
                )}
                {typeof state.repoSource?.starsCount === 'number' && (
                  <div className="flex items-center gap-2"><Star className="w-4 h-4"/> {formatNumber(state.repoSource.starsCount)} STARS</div>
                )}
              </div>
              
              {onImport && (
                <Button
                  onClick={onImport}
                  disabled={isImportActive && !isImportError}
                  className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors px-8 h-10 rounded-full font-bold text-sm flex items-center gap-2 group"
                >
                  {isImportActive && !isImportError ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Import Project
                      <Rocket className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div
          aria-hidden={!isImportActive}
          className={cn(
            'h-full w-full max-w-5xl mx-auto',
            !isImportActive && 'pointer-events-none absolute inset-0 opacity-0',
            'transition-opacity duration-150 flex flex-col'
          )}
        >
          <div className="flex-1 overflow-y-auto app-scrollbar">
            <ImportProgressSection
              importError={importError}
              importSyncMessage={importSyncMessage}
              importSyncState={importSyncState}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
