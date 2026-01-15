import { ReactNode } from 'react'
import { TitleBar } from '../TitleBar'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  Check,
  Circle,
  Loader2,
  AlertCircle,
  Square,
  RotateCcw,
  Play,
  FolderOpen,
  ExternalLink,
} from 'lucide-react'

export interface BuildPhase {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

interface BuilderLayoutProps {
  // Phases
  phases: BuildPhase[]
  currentPhase: number
  progress: number // 0-100

  // Status
  statusMessage: string
  isRunning: boolean
  hasError: boolean

  // Logs
  logs?: string[]
  children?: ReactNode

  // Actions
  onStop?: () => void
  onRetry?: () => void
  onContinue?: () => void
  onOpenProject?: () => void
  onViewChanges?: () => void
}

export function BuilderLayout({
  phases,
  currentPhase,
  progress,
  statusMessage,
  isRunning,
  hasError,
  logs = [],
  children,
  onStop,
  onRetry,
  onContinue,
  onOpenProject,
  onViewChanges,
}: BuilderLayoutProps) {
  const isComplete = phases.every((p) => p.status === 'completed')

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar showTitle title="Building Project" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden mt-10">
        {/* Phase Timeline */}
        <div className="px-8 py-4 border-b border-border">
          <div className="flex items-center justify-center gap-2">
            {phases.map((phase, index) => (
              <PhaseIndicator
                key={phase.id}
                phase={phase}
                isLast={index === phases.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Progress Section */}
        <div className="px-8 py-8 border-b border-border">
          <div className="max-w-2xl mx-auto text-center">
            {/* Status Icon */}
            <div className="mb-4">
              {hasError ? (
                <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
              ) : isComplete ? (
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                  <Check className="h-8 w-8 text-primary" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
              )}
            </div>

            {/* Status Message */}
            <h2 className="text-xl font-medium mb-2">{statusMessage}</h2>

            {/* Progress Bar */}
            {isRunning && !hasError && (
              <div className="mt-4">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2">{progress}% complete</p>
              </div>
            )}

            {/* Completion Actions */}
            {isComplete && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button onClick={onOpenProject} className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Open Project
                </Button>
                <Button variant="outline" onClick={onViewChanges} className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  View Changes
                </Button>
              </div>
            )}

            {/* Error Actions */}
            {hasError && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button variant="outline" onClick={onRetry} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Retry
                </Button>
                <Button onClick={onViewChanges} className="gap-2">
                  View Logs
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Logs Section */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-8 py-2 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Build Logs</h3>
            {logs.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {logs.length} lines
              </span>
            )}
          </div>
          <ScrollArea className="flex-1 bg-muted/30">
            <div className="p-4 font-mono text-xs">
              {logs.length > 0 ? (
                logs.map((log, index) => (
                  <div key={index} className="py-0.5 text-muted-foreground">
                    <span className="text-muted-foreground/50 mr-2 select-none">
                      {String(index + 1).padStart(3, ' ')}
                    </span>
                    {log}
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">
                  Waiting for build to start...
                </div>
              )}
              {children}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Footer */}
      <footer className="h-14 border-t border-border flex items-center justify-center px-8 bg-background gap-3">
        {isRunning && !hasError && (
          <Button variant="outline" onClick={onStop} className="gap-2">
            <Square className="h-4 w-4" />
            Stop
          </Button>
        )}
        {!isRunning && !isComplete && !hasError && (
          <Button onClick={onContinue} className="gap-2">
            <Play className="h-4 w-4" />
            Continue
          </Button>
        )}
      </footer>
    </div>
  )
}

function PhaseIndicator({
  phase,
  isLast,
}: {
  phase: BuildPhase
  isLast: boolean
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center',
            phase.status === 'completed' && 'bg-primary text-primary-foreground',
            phase.status === 'running' && 'border-2 border-primary',
            phase.status === 'error' && 'bg-destructive text-destructive-foreground',
            phase.status === 'pending' && 'border border-muted-foreground/50'
          )}
        >
          {phase.status === 'completed' && <Check className="h-3 w-3" />}
          {phase.status === 'running' && (
            <Loader2 className="h-3 w-3 text-primary animate-spin" />
          )}
          {phase.status === 'error' && <AlertCircle className="h-3 w-3" />}
          {phase.status === 'pending' && (
            <Circle className="h-2 w-2 text-muted-foreground/50" />
          )}
        </div>
        <span
          className={cn(
            'text-sm',
            phase.status === 'pending' && 'text-muted-foreground'
          )}
        >
          {phase.title}
        </span>
      </div>
      {!isLast && (
        <div
          className={cn(
            'w-8 h-0.5',
            phase.status === 'completed' ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
        />
      )}
    </>
  )
}
