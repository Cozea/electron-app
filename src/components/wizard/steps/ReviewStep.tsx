import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Pencil, GitBranch, Layers, Palette, Code2, Server, Cloud, Sparkles, Rocket, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
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
}

export function ReviewStep({
  state,
  onEditStep,
  onImport,
  isImporting,
  importError,
  importSyncState = 'idle',
  importSyncMessage,
  className,
}: ReviewStepProps) {
  const isRepoPath = state.path === 'repo'
  const isImportActive = importSyncState !== 'idle'
  const isImportError = importSyncState === 'error'
  const isImportReady = importSyncState === 'ready'
  const progressValue = isImportError || isImportReady
    ? 100
    : importSyncState === 'syncing'
      ? 72
      : 34
  const statusText = isImportError
    ? (importError || importSyncMessage || 'Import failed')
    : importSyncMessage || (isImportReady ? 'Opening project...' : 'Importing...')

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

  // Get team step index based on path
  const getTeamStepIndex = () => {
    if (isRepoPath) return 2 // repo-source(1), team(2)
    return 6 // intent(1), template(2), stack(3), source(4), visuals(5), team(6)
  }

  return (
    <div className={cn("max-w-2xl mx-auto", className)}>
      {/* Blueprint Card */}
      <div className="rounded-xl bg-card overflow-hidden">
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

        {/* Stack Section */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Stack</p>
            {!isRepoPath && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(3)}>
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {isRepoPath && state.repoSource?.detectedStack ? (
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
            ) : !isRepoPath ? (
              <>
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
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No stack detected</p>
            )}
          </div>
        </div>

        {/* Visuals Section - only for fresh path */}
        {!isRepoPath && (
          <>
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
                    <div
                      className="w-6 h-6 rounded-full border border-border"
                      style={{ backgroundColor: state.visuals.primaryColor }}
                    />
                    <div
                      className="w-6 h-6 rounded-full border border-border"
                      style={{ backgroundColor: state.visuals.secondaryColor }}
                    />
                    <div
                      className="w-6 h-6 rounded-full border border-border"
                      style={{ backgroundColor: state.visuals.accentColor }}
                    />
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
          </>
        )}

        {/* Branch info for repo path */}
        {isRepoPath && state.repoSource?.branch && (
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
                <Badge variant="outline" className="text-xs font-mono">
                  {state.repoSource.branch}
                </Badge>
              </div>
            </div>
          </>
        )}

        {/* Team Section */}
        <div className="border-t border-border" />
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Team</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onEditStep(getTeamStepIndex())}>
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          </div>

          {state.team.length > 0 ? (
            <div className="space-y-3">
              {state.team.map((member) => {
                const initials = member.name
                  ? member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
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
                    <Badge variant="secondary" className="text-xs capitalize">
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

        {/* Import Button - only for repo path */}
        {isRepoPath && onImport && (
          <div className="p-6">
            <div className="flex justify-end">
              <div
                className={cn(
                  'relative h-12 transition-all duration-300 ease-out',
                  isImportActive ? 'w-full' : 'w-60'
                )}
              >
                <Button
                  onClick={onImport}
                  disabled={isImporting}
                  className={cn(
                    'absolute inset-0 h-12 rounded-full gap-2 transition-all duration-300 ease-out',
                    isImportActive ? 'pointer-events-none opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
                  )}
                >
                  <Rocket className="h-4 w-4" />
                  Import Project
                </Button>

                <div
                  className={cn(
                    'absolute inset-0 overflow-hidden rounded-full bg-secondary/90 transition-all duration-300 ease-out',
                    isImportActive ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-[0.98]'
                  )}
                >
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 transition-[width,background-color] duration-500 ease-out',
                      isImportError ? 'bg-destructive/75' : isImportReady ? 'bg-green-500/70' : 'bg-primary/65',
                      !isImportError && !isImportReady ? 'animate-pulse' : ''
                    )}
                    style={{ width: `${progressValue}%` }}
                  />

                  <div className="relative z-10 flex h-full items-center gap-2 px-4">
                    {isImportError ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive-foreground" />
                    ) : isImportReady ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground" />
                    ) : (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-foreground" />
                    )}
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm font-medium',
                        isImportError ? 'text-destructive-foreground' : 'text-foreground'
                      )}
                      title={statusText}
                    >
                      {statusText}
                    </p>
                  </div>
                </div>
              </div>
            </div>
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
