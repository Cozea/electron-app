import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Plus, Terminal, X, Upload } from 'lucide-react'
import { SiAnthropic, SiGooglegemini, SiGithubcopilot, SiOpenai } from 'react-icons/si'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAITerminalStore } from '@/stores/useAITerminalStore'
import { useTerminalActions, useTerminalStore, type TerminalInstance as StoredTerminalInstance } from '@/stores/useTerminalStore'
import { TerminalInstance } from '@/features/projects/components/TerminalInstance'
import { MessagesTimeline } from '@/features/projects/components/assistant/chat/MessagesTimeline'
import type { AgentToolId } from '@shared/electronApiTypes'

interface AITerminalProfile {
  id: AgentToolId
  name: string
  icon: React.ElementType
  color: string
  supportedModes: ('cli' | 'gui')[]
}

interface AITerminalSidebarProps {
  className?: string
  projectPath?: string | null
}

const AI_TERMINAL_PROFILES: AITerminalProfile[] = [
  { id: 'claude', name: 'Claude Code', icon: SiAnthropic, color: 'text-[#d97757]', supportedModes: ['cli', 'gui'] },
  { id: 'gemini', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-[#8E75B2]', supportedModes: ['cli'] },
  { id: 'copilot', name: 'Copilot', icon: SiGithubcopilot, color: 'text-[#8A2BE2]', supportedModes: ['cli'] },
  { id: 'codex', name: 'Codex', icon: SiOpenai, color: 'text-[#10a37f]', supportedModes: ['cli'] },
  { id: 'kilo', name: 'Kilo Code', icon: Bot, color: 'text-primary', supportedModes: ['cli'] },
  { id: 'shell', name: 'Shell', icon: Terminal, color: 'text-muted-foreground', supportedModes: ['cli'] },
]


const KNOWN_CLIS = [
  { command: 'npm install -g @anthropic-ai/claude-code', name: 'Claude Code', icon: SiAnthropic, color: 'text-[#d97757]' },
  { command: 'npm install -g @google/gemini-cli', name: 'Gemini CLI', icon: SiGooglegemini, color: 'text-[#8E75B2]' },
  { command: 'npm install -g @githubnext/github-copilot-cli', name: 'Copilot', icon: SiGithubcopilot, color: 'text-[#8A2BE2]' },
  { command: 'npm install -g openai-codex-cli', name: 'Codex', icon: SiOpenai, color: 'text-[#10a37f]' },
  { command: 'npm install -g kilo-code', name: 'Kilo Code', icon: Bot, color: 'text-primary' },
]

const EMPTY_SESSIONS: ReturnType<typeof buildEmptySessions> = []

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildEmptySessions() {
  return [] as Array<{
    terminal: StoredTerminalInstance
    terminalId: string
    profileId: string
    profileName: string
    label: string
    command: string
    createdAt: number
  }>
}

function isInteractiveSession(session?: StoredTerminalInstance | null): boolean {
  return Boolean(session && session.status !== 'exited' && session.status !== 'error')
}

export function AITerminalSidebar({ className, projectPath }: AITerminalSidebarProps) {
  const mode = useAITerminalStore((state) => state.mode)
  const storedWidth = useAITerminalStore((state) => state.panelWidth)
  const setPanelWidth = useAITerminalStore((state) => state.setPanelWidth)
  const resetPanelWidth = useAITerminalStore((state) => state.resetPanelWidth)
  const upsertSession = useAITerminalStore((state) => state.upsertSession)
  const removeSessionRecord = useAITerminalStore((state) => state.removeSession)
  const setActiveSession = useAITerminalStore((state) => state.setActiveSession)
  const sessionRecords = useAITerminalStore((state) =>
    projectPath ? state.sessionsByProject[projectPath] ?? EMPTY_SESSIONS : EMPTY_SESSIONS,
  )
  const activeSessionId = useAITerminalStore((state) =>
    projectPath ? state.activeSessionIdsByProject[projectPath] ?? null : null,
  )

  const terminals = useTerminalStore((state) => state.terminals)
  const { registerTerminal, removeTerminal } = useTerminalActions()

  const [isDragging, setIsDragging] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [viewMode, setViewMode] = useState<'cli'|'gui'>('gui')
  const [isInstallingAgent, setIsInstallingAgent] = useState(false)
  const [installCommand, setInstallCommand] = useState('')

  const recognizedCli = useMemo(() => {
    if (!installCommand.trim()) return null
    return KNOWN_CLIS.find(cli => installCommand.includes(cli.command) || cli.command.includes(installCommand.trim()))
  }, [installCommand])

  const isOpen = mode !== 'closed'
  const isFullscreen = mode === 'fullscreen'
  const panelWidthValue = isFullscreen ? '100%' : `${storedWidth}px`

  const sessions = useMemo(() => {
    if (!projectPath) return EMPTY_SESSIONS

    return sessionRecords
      .map((record) => {
        const terminal = terminals[record.terminalId]
        if (!terminal) return null
        return {
          ...record,
          terminal,
        }
      })
      .filter((session): session is typeof EMPTY_SESSIONS[number] => Boolean(session))
  }, [projectPath, sessionRecords, terminals])

  const activeSession = useMemo(() => {
    if (!activeSessionId) return null
    return sessions.find((session) => session.terminalId === activeSessionId) ?? null
  }, [activeSessionId, sessions])

  useEffect(() => {
    void Promise.all(
      AI_TERMINAL_PROFILES
        .filter((profile) => profile.id !== 'shell')
        .map(async (profile) => {
          try {
            await window.electronAPI.agentTools.getStatus({ toolId: profile.id })
          } catch {
            // Ignore warm-up failures; launch will surface actionable errors.
          }
        }),
    )
  }, [])

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    setIsDragging(true)
    dragStartX.current = event.clientX
    dragStartWidth.current = storedWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [storedWidth])

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!isDragging) return
    const delta = dragStartX.current - event.clientX
    const nextWidth = dragStartWidth.current + delta
    setPanelWidth(Math.round(Math.max(250, Math.min(800, nextWidth))))
  }, [isDragging, setPanelWidth])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDoubleClick = useCallback(() => {
    resetPanelWidth()
  }, [resetPanelWidth])

  const closeSession = useCallback(async (terminalId: string) => {
    const terminal = useTerminalStore.getState().terminals[terminalId]
    if (terminal && terminal.status !== 'exited' && terminal.status !== 'error') {
      try {
        await window.electronAPI.terminal.kill({ terminalId })
      } catch {
        // Ignore backend kill failures and still clean up local state.
      }
    }

    removeTerminal(terminalId)
    if (projectPath) {
      removeSessionRecord(projectPath, terminalId)
    }
  }, [projectPath, removeSessionRecord, removeTerminal])

  const launchAITerminal = useCallback(async (profile: AITerminalProfile) => {
    if (!projectPath) return

    setLaunchingId(profile.id)
    setLaunchError(null)

    try {
      const prepared = await window.electronAPI.agentTools.prepare({ toolId: profile.id })
      if (!prepared.success || !prepared.available) {
        throw new Error(prepared.error || 'Failed to prepare agent CLI')
      }

      const launchCommand = prepared.launchCommand ?? ''

      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
        cols: 80,
        rows: 24,
      })

      if (!result.success || !result.terminalId) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      const terminalId = result.terminalId
      const info = await window.electronAPI.terminal.getInfo({ terminalId })
      const createdAt = Date.now()

      registerTerminal({
        id: terminalId,
        profileId: info?.profileId ?? 'default',
        profileName: info?.profileName ?? 'Shell',
        title: profile.name,
        label: profile.name,
        kind: 'agent',
        surface: 'assistant',
        agentProfileId: profile.id,
        agentProfileName: profile.name,
        nameSource: 'manual',
        command: launchCommand,
        projectPath,
        status: 'starting',
        hasOutput: false,
        lastHeartbeatAt: createdAt,
      })

      upsertSession(projectPath, {
        terminalId,
        profileId: profile.id,
        profileName: profile.name,
        label: profile.name,
        command: launchCommand,
        createdAt,
      })
      setActiveSession(projectPath, terminalId)
      setIsCreatingNew(false)

      if (launchCommand) {
        const accepted = await window.electronAPI.terminal.input({
          terminalId,
          data: `${launchCommand}\r`,
        })
        if (!accepted) {
          throw new Error('Failed to launch agent session')
        }
      }
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Failed to launch terminal')
    } finally {
      setLaunchingId(null)
    }
  }, [projectPath, registerTerminal, setActiveSession, upsertSession])

  useEffect(() => {
    if (!projectPath) return

    let cancelled = false

    void (async () => {
      for (const session of sessionRecords) {
        if (cancelled) return
        if (terminals[session.terminalId]) continue

        const info = await window.electronAPI.terminal.getInfo({ terminalId: session.terminalId })
        if (cancelled) return

        if (!info) {
          removeSessionRecord(projectPath, session.terminalId)
          continue
        }

        registerTerminal({
          id: info.id,
          profileId: info.profileId,
          profileName: info.profileName,
          title: session.label,
          label: session.label,
          kind: 'agent',
          surface: 'assistant',
          agentProfileId: session.profileId,
          agentProfileName: session.profileName,
          nameSource: 'manual',
          command: session.command,
          projectPath,
          status: 'running',
          hasOutput: false,
          lastHeartbeatAt: session.createdAt,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectPath, registerTerminal, removeSessionRecord, sessionRecords, terminals])

  useEffect(() => {
    if (!projectPath) return

    const liveSessions = sessionRecords.filter((session) => Boolean(terminals[session.terminalId]))
    if (liveSessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSession(projectPath, null)
      }
      return
    }

    const runningSession = liveSessions.find((session) => isInteractiveSession(terminals[session.terminalId]))
    const currentSession = activeSessionId ? terminals[activeSessionId] ?? null : null
    const currentStillExists = activeSessionId ? liveSessions.some((session) => session.terminalId === activeSessionId) : false

    if (currentStillExists && currentSession && isInteractiveSession(currentSession)) {
      return
    }

    if (currentStillExists && !runningSession) {
      return
    }

    if (!isCreatingNew) {
      const nextActiveId = runningSession?.terminalId ?? liveSessions[0]?.terminalId ?? null
      if (nextActiveId !== activeSessionId) {
        setActiveSession(projectPath, nextActiveId)
      }
    }
  }, [activeSessionId, isCreatingNew, projectPath, sessionRecords, setActiveSession, terminals])

  useEffect(() => {
    setLaunchError(null)
    setLaunchingId(null)
  }, [projectPath])

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden bg-content-surface',
        !isFullscreen && 'border-l border-border',
        !isDragging && 'transition-[width,flex-grow,flex-shrink,min-width] duration-300 ease-in-out',
        className,
      )}
      style={{
        width: isOpen ? panelWidthValue : 0,
        minWidth: isOpen ? (isFullscreen ? 0 : `${storedWidth}px`) : 0,
        opacity: 1,
        flexGrow: isFullscreen ? 1 : 0,
        flexShrink: isFullscreen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: isDragging ? 'none' : undefined,
      }}
    >
      <div className="h-10 shrink-0" aria-hidden="true" />

      {isOpen && !isFullscreen ? (
        <div
          className={cn(
            'absolute bottom-0 left-0 top-0 z-50 w-1.5 cursor-ew-resize transition-colors hover:bg-primary/20',
            isDragging && 'bg-primary/20',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        />
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {sessions.length > 0 && (
          <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-border bg-content-surface px-1 scrollbar-none">
            {sessions.map((session) => {
              const isActive = activeSession?.terminalId === session.terminalId && !isCreatingNew
              const isLive = isInteractiveSession(session.terminal)
              const profile = AI_TERMINAL_PROFILES.find(p => p.id === session.profileId)
              const Icon = profile?.icon || Terminal

              return (
                <button
                  key={session.terminalId}
                  onClick={() => {
                    setIsCreatingNew(false)
                    if (projectPath) setActiveSession(projectPath, session.terminalId)
                  }}
                  className={cn(
                    "group relative flex items-center gap-1.5 px-3 h-full text-[11px] tracking-wide transition-colors",
                    isActive
                        ? "text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground hover:bg-foreground/5"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', isLive ? (isActive ? 'bg-emerald-500 shadow-[0_0_4px_rgba(34,197,94,0.4)]' : 'bg-emerald-500/70') : 'bg-muted-foreground/50')} />
                    <Icon className={cn("h-3 w-3 shrink-0 hidden sm:block", profile?.color)} />
                    <span className="truncate max-w-[140px]">{session.label}</span>
                  </span>
                  
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void closeSession(session.terminalId)
                    }}
                    className="pointer-events-none ml-1 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3 shrink-0" />
                  </span>
                  {isActive && <span className="absolute bottom-0 left-3 right-3 h-px bg-primary" />}
                </button>
              )
            })}
            
            <button
              onClick={() => {
                setIsCreatingNew(true)
                if (projectPath) setActiveSession(projectPath, null)
              }}
              className={cn(
                  "relative flex items-center justify-center px-3 h-full text-muted-foreground transition-colors hover:text-sidebar-foreground hover:bg-foreground/5",
                  isCreatingNew && "text-sidebar-foreground"
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              {isCreatingNew && <span className="absolute bottom-0 left-3 right-3 h-px bg-primary" />}
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col relative bg-[var(--terminal-panel-bg,var(--content-surface))]">
          {launchError ? (
            <div className="absolute top-2 left-2 right-2 z-10 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {launchError}
            </div>
          ) : null}

          {(!isCreatingNew && activeSession) ? (() => {
            const activeProfile = AI_TERMINAL_PROFILES.find(p => p.id === activeSession.profileId)
            const supportsGui = activeProfile?.supportedModes?.includes('gui')
            
            return (
              <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden">
                {supportsGui && (
                  <div className="flex shrink-0 items-center justify-center p-1.5 border-b border-border/50 bg-muted/20">
                    <div className="flex items-center rounded-md border border-border bg-background p-0.5 shadow-sm">
                      <button
                        onClick={() => setViewMode('gui')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-medium rounded-sm transition-all",
                          viewMode === 'gui' ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        GUI
                      </button>
                      <button
                        onClick={() => setViewMode('cli')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-medium rounded-sm transition-all",
                          viewMode === 'cli' ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        CLI
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="relative flex-1 min-h-0">
                  {!isInteractiveSession(activeSession.terminal) ? (
                    <div className="absolute inset-x-0 top-0 z-10 border-b border-border bg-background/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
                      This agent session has exited. You can inspect the output or close the session.
                    </div>
                  ) : null}
                  
                  {(!supportsGui || viewMode === 'cli') ? (
                    <TerminalInstance
                      terminalId={activeSession.terminalId}
                      className="absolute inset-0 h-full w-full"
                      shouldAutoFocus={isInteractiveSession(activeSession.terminal)}
                      readOnly={!isInteractiveSession(activeSession.terminal)}
                    />
                  ) : (
                    <MessagesTimeline threadId={activeSession.terminalId} />
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-20 h-6 bg-background/60 px-2 text-[10px] hover:bg-background shadow-sm"
                    onClick={() => void closeSession(activeSession.terminalId)}
                  >
                    Close Session
                  </Button>
                </div>
              </div>
            )
          })()
           : (
            <div className="flex flex-1 flex-col items-center justify-center p-4">
              {isInstallingAgent ? (
                <div className="w-full max-w-sm space-y-6">
                  <div className="flex items-center justify-center">
                    <h3 className="text-sm font-medium text-foreground">Add Custom CLI</h3>
                  </div>
                  
                  <div className="flex flex-col items-center gap-6">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center bg-secondary transition-all hover:bg-secondary/80 group cursor-pointer relative overflow-hidden border border-border/60 shadow-sm">
                      {recognizedCli ? (
                        <recognizedCli.icon className={cn("h-10 w-10", recognizedCli.color)} />
                      ) : (
                        <Upload className="h-8 w-8 text-muted-foreground" />
                      )}
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Upload className="h-6 w-6 text-foreground" />
                      </div>
                    </div>

                    <div className="w-full space-y-2">
                      <label className="text-xs font-medium text-muted-foreground ml-1">Install Command</label>
                      <input
                        list="known-clis"
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                        placeholder="e.g. npm install -g my-cli"
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <datalist id="known-clis">
                        {KNOWN_CLIS.map(cli => (
                          <option key={cli.command} value={cli.command}>{cli.name}</option>
                        ))}
                      </datalist>
                    </div>

                    <div className="w-full flex flex-col gap-2 mt-2">
                      <Button 
                        className="w-full" 
                        disabled={!installCommand.trim()}
                        onClick={() => {
                          console.log('Installing:', installCommand)
                          setIsInstallingAgent(false)
                          setInstallCommand('')
                        }}
                      >
                        Install Agent
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => { setIsInstallingAgent(false); setInstallCommand(''); }}
                      >
                        Back
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm space-y-4">
                  <div className="text-center space-y-1">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary mb-3">
                      <Terminal className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-medium text-foreground">Launch an AI agent</h3>
                  </div>
                
                <div className="grid grid-cols-4 gap-2 mt-6 justify-items-center">
                  {AI_TERMINAL_PROFILES.map((profile) => {
                    const Icon = profile.icon;
                    return (
                      <button
                        key={profile.id}
                        disabled={!projectPath || launchingId !== null}
                        onClick={() => void launchAITerminal(profile)}
                        className="group flex flex-col items-center gap-2 outline-none w-full"
                      >
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-secondary transition-all group-hover:bg-secondary/80 group-active:scale-95">
                          <Icon className={cn("h-7 w-7", profile.color)} />
                        </div>
                        <span className="text-[11px] font-medium text-muted-foreground text-center truncate w-full px-0.5 group-hover:text-foreground">
                          {profile.name.replace(' Code', '').replace(' CLI', '')}
                        </span>
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => setIsInstallingAgent(true)}
                    className="group flex flex-col items-center gap-2 outline-none w-full"
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-secondary transition-all group-hover:bg-secondary/80 group-active:scale-95 text-muted-foreground group-hover:text-foreground">
                      <Plus className="h-7 w-7" />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground text-center truncate w-full px-0.5 group-hover:text-foreground">
                      Add
                    </span>
                  </button>
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
