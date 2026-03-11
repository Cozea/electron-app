import { memo, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Pencil, GitBranch, Layers, Palette, Code2, Server, Cloud, Sparkles, Rocket, Loader2, Check, CircleDashed } from 'lucide-react'
import { IconBrandGithub, IconBrandGitlab } from '@tabler/icons-react'
import type { WizardState } from '@/hooks/useWizardState'
import { cn } from '@/lib/utils'

interface ReviewStepProps {
  state: WizardState
  onEditStep: (step: number) => void
  onImport?: () => void
  isImporting?: boolean
  importError?: string | null
  importSyncState?: 'idle' | 'checking' | 'syncing' | 'ready' | 'error'
  importSyncMessage?: string | null
  className?: string
  fillHeight?: boolean
}

const IMPORT_STEPS = [
  'Validate source',
  'Set up local project',
  'Prepare runtimes',
  'Install dependencies',
  'Sync to cloud',
  'Open project',
] as const

function getCurrentImportStepIndex(params: {
  importSyncMessage?: string | null
  isImportReady: boolean
}) {
  const { importSyncMessage, isImportReady } = params
  const normalizedImportMessage = (importSyncMessage || '').toLowerCase()

  if (isImportReady) return IMPORT_STEPS.length - 1
  if (normalizedImportMessage.includes('opening project')) return 5
  if (
    normalizedImportMessage.includes('publishing workspace') ||
    normalizedImportMessage.includes('checking git repository') ||
    normalizedImportMessage.includes('fetching latest changes') ||
    normalizedImportMessage.includes('restoring project files') ||
    normalizedImportMessage.includes('saving local changes') ||
    normalizedImportMessage.includes('pulling latest changes') ||
    normalizedImportMessage.includes('publishing latest changes')
  ) return 4
  if (
    normalizedImportMessage.includes('installing dependencies') ||
    normalizedImportMessage.includes('retrying install with legacy peer deps')
  ) return 3
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
    normalizedImportMessage.includes('relocating repository')
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

export function ReviewStep({
  state,
  onEditStep,
  onImport,
  importSyncState = 'idle',
  importError,
  importSyncMessage,
  className,
  fillHeight = false,
}: ReviewStepProps) {
  const isRepoPath = state.path === 'repo'
  const isImportActive = importSyncState !== 'idle'
  const isImportError = importSyncState === 'error'

  // For repo path, get the folder/repo name from the URL
  const repoName = state.repoSource?.repoUrl
    ? state.repoSource.repoUrl.split('/').pop() || 'Repository'
    : 'Repository'

  // For fresh path, get project name
  const projectName = state.intent.name || 'Untitled Project'

  const getProviderIcon = () => {
    switch (state.repoSource?.provider) {
      case 'github':
        return <IconBrandGithub className="h-5 w-5" />
      case 'gitlab':
        return <IconBrandGitlab className="h-5 w-5" />
      case 'local':
        return (
          <svg width="20" height="17" viewBox="0 0 56 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 8C2 5.79086 3.79086 4 6 4H18L24 12H50C52.2091 12 54 13.7909 54 16V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V8Z" fill="#F5C242"/>
            <path d="M2 16H54V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V16Z" fill="#FCDC6C"/>
            <path d="M18 4L24 12H18V4Z" fill="#E5A620"/>
          </svg>
        )
      default:
        return null
    }
  }

  const repoReviewBody = useMemo(() => (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Stack</p>
        </div>

        <div className="space-y-3">
          {state.repoSource?.detectedStack ? (
            <>
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
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No stack detected</p>
          )}
        </div>
      </div>

      {state.repoSource?.branch && (
        <>
          <div className="border-t border-border" />
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Source</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 w-24 shrink-0">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Branch</span>
              </div>
              <Badge
                variant="outline"
                className="text-xs font-mono border-transparent bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
              >
                {state.repoSource.branch}
              </Badge>
            </div>
          </div>
        </>
      )}

      <div className="border-t border-border" />
      <div className={cn('p-6', fillHeight && 'flex-1')}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team</p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(2)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        </div>

        {state.team.length > 0 ? (
          <div className="space-y-3">
            {state.team.map((member) => {
              const initials = member.name
                ? member.name.split(' ').map((namePart) => namePart[0]).join('').toUpperCase().slice(0, 2)
                : member.email[0].toUpperCase()

              return (
                <div key={member.email} className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    {member.profileImageUrl && (
                      <AvatarImage src={member.profileImageUrl} alt={member.name || member.email} />
                    )}
                    <AvatarFallback className="text-xs bg-muted">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm flex-1">
                    {member.name || member.email}
                    {member.isCurrentUser && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-xs capitalize border-transparent bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                  >
                    {member.role.replace('_', ' ')}
                  </Badge>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No team members added</p>
        )}
      </div>
    </>
  ), [fillHeight, onEditStep, state.repoSource?.branch, state.repoSource?.detectedStack, state.team])

  const freshReviewBody = useMemo(() => (
    <>
      <div className="border-t border-border" />
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Stack</p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(3)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-24 shrink-0">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Backend</span>
            </div>
            <span className="text-sm">{state.stack.backend}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-24 shrink-0">
              <Cloud className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Hosting</span>
            </div>
            <span className="text-sm">{state.stack.hosting}</span>
          </div>
          {state.stack.aiProvider && state.stack.aiProvider !== 'none' && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 w-24 shrink-0">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">AI</span>
              </div>
              <span className="text-sm">{state.stack.aiProvider}</span>
            </div>
          )}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-24 shrink-0">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Git</span>
            </div>
            <span className="text-sm">
              {state.sourceControl.provider} · {state.sourceControl.visibility} · {state.sourceControl.mergeStrategy} merge
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-border" />
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Style Guidelines</p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(5)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-24 shrink-0">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Color</span>
            </div>
            <div className="flex gap-1.5">
              <div className="w-6 h-6 rounded-full border border-border" style={{ backgroundColor: state.visuals.primaryColor }} />
              <div className="w-6 h-6 rounded-full border border-border" style={{ backgroundColor: state.visuals.secondaryColor }} />
              <div className="w-6 h-6 rounded-full border border-border" style={{ backgroundColor: state.visuals.accentColor }} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-24 shrink-0">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">UI</span>
            </div>
            <span className="text-sm">{state.visuals.uiLibrary}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border" />
      <div className={cn('p-6', fillHeight && 'flex-1')}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team</p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(6)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        </div>

        {state.team.length > 0 ? (
          <div className="space-y-3">
            {state.team.map((member) => {
              const initials = member.name
                ? member.name.split(' ').map((namePart) => namePart[0]).join('').toUpperCase().slice(0, 2)
                : member.email[0].toUpperCase()

              return (
                <div key={member.email} className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    {member.profileImageUrl && (
                      <AvatarImage src={member.profileImageUrl} alt={member.name || member.email} />
                    )}
                    <AvatarFallback className="text-xs bg-muted">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm flex-1">
                    {member.name || member.email}
                    {member.isCurrentUser && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-xs capitalize border-transparent bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                  >
                    {member.role.replace('_', ' ')}
                  </Badge>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No team members added</p>
        )}
      </div>
    </>
  ), [fillHeight, onEditStep, state.sourceControl.mergeStrategy, state.sourceControl.provider, state.sourceControl.visibility, state.stack.aiProvider, state.stack.backend, state.stack.hosting, state.team, state.visuals.accentColor, state.visuals.primaryColor, state.visuals.secondaryColor, state.visuals.uiLibrary])

  return (
    <div
      className={cn(
        "max-w-2xl mx-auto",
        fillHeight && "h-full min-h-0",
        className
      )}
    >
      {/* Blueprint Card */}
      <div className={cn(
        isRepoPath
          ? "overflow-hidden"
          : "rounded-xl bg-secondary/80 dark:bg-secondary/40 overflow-hidden",
        fillHeight && "flex h-full flex-col"
      )}>
        <div className={cn(fillHeight && "min-h-0 flex-1 overflow-y-auto")}>
          {/* Header */}
          <div className="p-6 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {isRepoPath ? 'Import Blueprint' : 'App Blueprint'}
            </p>
            <div className="flex items-center gap-3">
              {isRepoPath && getProviderIcon()}
              <h2 className="text-2xl font-semibold">
                {isRepoPath ? repoName : projectName}
              </h2>
            </div>
            {isRepoPath && state.repoSource?.repoUrl && (
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {state.repoSource.repoUrl}
              </p>
            )}
            {!isRepoPath && state.intent.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {state.intent.description}
              </p>
            )}
          </div>

          <div className="border-t border-border" />
          {isRepoPath ? (
            <div className={cn('relative', fillHeight && 'min-h-0 flex-1')}>
              <div
                aria-hidden={isImportActive}
                className={cn(
                  fillHeight && 'h-full',
                  isImportActive && 'pointer-events-none absolute inset-0 overflow-hidden opacity-0',
                  'transition-opacity duration-150'
                )}
              >
                {repoReviewBody}
              </div>
              <div
                aria-hidden={!isImportActive}
                className={cn(
                  fillHeight && 'h-full',
                  !isImportActive && 'pointer-events-none absolute inset-0 overflow-hidden opacity-0',
                  'transition-opacity duration-150'
                )}
              >
                <ImportProgressSection
                  importError={importError}
                  importSyncMessage={importSyncMessage}
                  importSyncState={importSyncState}
                />
              </div>
            </div>
          ) : (
            freshReviewBody
          )}
        </div>

        {/* Import Button - only for repo path */}
        {isRepoPath && onImport && (
          <div className="mt-auto flex min-h-20 items-end justify-end px-6 pb-2 pt-4">
            <Button
              onClick={onImport}
              disabled={isImportActive && !isImportError}
              className="h-10 rounded-full px-4 text-sm"
            >
              {isImportActive && !isImportError ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {isImportError ? 'Retry Import' : isImportActive ? 'Importing' : 'Import Project'}
            </Button>
          </div>
        )}
      </div>

      {!isRepoPath && (
        <div className="text-center mt-6">
          <p className="text-sm text-muted-foreground">
            Click "Generate Plan" to have AI create your project structure
          </p>
        </div>
      )}
    </div>
  )
}
