const fs = require('fs');
const file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

const oldComponent = `        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            {AI_TERMINAL_PROFILES.map((profile) => (
              <Button
                key={profile.id}
                variant="outline"
                className="h-auto justify-start gap-2 px-3 py-2 text-left text-xs font-normal"
                disabled={!projectPath || launchingId !== null}
                onClick={() => void launchAITerminal(profile)}
              >
                <Plus className="h-3.5 w-3.5 opacity-60" />
                <span className="truncate">{profile.name}</span>
              </Button>
            ))}
          </div>

          {launchError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {launchError}
            </div>
          ) : null}

          {sessions.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {sessions.map((session) => {
                  const isActive = activeSession?.terminalId === session.terminalId
                  const isLive = isInteractiveSession(session.terminal)

                  return (
                    <div
                      key={session.terminalId}
                      className={cn(
                        'flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                        isActive ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/50',
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 truncate"
                        onClick={() => projectPath && setActiveSession(projectPath, session.terminalId)}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', isLive ? 'bg-emerald-500' : 'bg-muted-foreground/60')} />
                        <span className="truncate">{session.label}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground"
                        onClick={() => void closeSession(session.terminalId)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-[var(--terminal-panel-bg,var(--content-surface))]">
                {activeSession ? (
                  <>
                    {!isInteractiveSession(activeSession.terminal) ? (
                      <div className="absolute inset-x-0 top-0 z-10 border-b border-border bg-background/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
                        This agent session has exited. You can inspect the output or close the session.
                      </div>
                    ) : null}
                    <TerminalInstance
                      terminalId={activeSession.terminalId}
                      className="absolute inset-0 h-full w-full"
                      shouldAutoFocus={isInteractiveSession(activeSession.terminal)}
                      readOnly={!isInteractiveSession(activeSession.terminal)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-2 z-20 h-6 bg-background/60 px-2 text-[10px] hover:bg-background"
                      onClick={() => void closeSession(activeSession.terminalId)}
                    >
                      Close Session
                    </Button>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                    Select a session to continue.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/80 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <Terminal className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">Launch an AI agent</div>
                <div className="text-xs text-muted-foreground">
                  Each button creates a new agent session for this project.
                </div>
              </div>
            </div>
          )}
        </div>`;

const newComponent = `        {sessions.length > 0 && (
          <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-border bg-muted/30 px-2 gap-1 scrollbar-none">
            {sessions.map((session) => {
              const isActive = activeSession?.terminalId === session.terminalId && !isCreatingNew
              const isLive = isInteractiveSession(session.terminal)
              const profile = AI_TERMINAL_PROFILES.find(p => p.id === session.profileId)
              const Icon = profile?.icon || Terminal

              return (
                <div
                  key={session.terminalId}
                  className={cn(
                    'group flex h-7 min-w-0 max-w-[200px] items-center gap-1.5 rounded-sm border-b-2 px-2 text-xs transition-colors',
                    isActive 
                      ? 'border-primary bg-background text-foreground shadow-sm' 
                      : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5 truncate"
                    onClick={() => {
                      setIsCreatingNew(false)
                      projectPath && setActiveSession(projectPath, session.terminalId)
                    }}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", profile?.color)} />
                    <span className="truncate">{session.label}</span>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isLive ? 'bg-emerald-500' : 'bg-muted-foreground/60')} />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 shrink-0 rounded-sm opacity-0 hover:bg-muted transition-opacity group-hover:opacity-100"
                    onClick={() => void closeSession(session.terminalId)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
            
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 shrink-0 text-muted-foreground rounded-sm",
                isCreatingNew && "bg-background shadow-sm text-foreground"
              )}
              onClick={() => {
                setIsCreatingNew(true)
                if (projectPath) setActiveSession(projectPath, null)
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col relative bg-[var(--terminal-panel-bg,var(--content-surface))]">
          {launchError ? (
            <div className="absolute top-2 left-2 right-2 z-10 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {launchError}
            </div>
          ) : null}

          {(!isCreatingNew && activeSession) ? (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {!isInteractiveSession(activeSession.terminal) ? (
                <div className="absolute inset-x-0 top-0 z-10 border-b border-border bg-background/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
                  This agent session has exited. You can inspect the output or close the session.
                </div>
              ) : null}
              <TerminalInstance
                terminalId={activeSession.terminalId}
                className="absolute inset-0 h-full w-full"
                shouldAutoFocus={isInteractiveSession(activeSession.terminal)}
                readOnly={!isInteractiveSession(activeSession.terminal)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-2 top-2 z-20 h-6 bg-background/60 px-2 text-[10px] hover:bg-background"
                onClick={() => void closeSession(activeSession.terminalId)}
              >
                Close Session
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6">
              <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-1">
                  <h3 className="text-sm font-medium text-foreground">Launch an AI agent</h3>
                  <p className="text-xs text-muted-foreground">Select a tool to start a new terminal session in this project.</p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  {AI_TERMINAL_PROFILES.map((profile) => {
                    const Icon = profile.icon;
                    return (
                      <Button
                        key={profile.id}
                        variant="outline"
                        className="h-24 flex-col gap-3 bg-card hover:bg-accent hover:text-accent-foreground border-border/50 transition-all shadow-sm hover:shadow-md"
                        disabled={!projectPath || launchingId !== null}
                        onClick={() => void launchAITerminal(profile)}
                      >
                        <Icon className={cn("h-8 w-8", profile.color)} />
                        <span className="font-medium text-sm">{profile.name}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>`;

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file.replace(oldComponent, newComponent));
