const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

const oldTabs = `        {sessions.length > 0 && (
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
                      if (projectPath) setActiveSession(projectPath, session.terminalId)
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
        )}`;

const newTabs = `        {sessions.length > 0 && (
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
        )}`;

const oldGrid = `          {(!isCreatingNew && activeSession) ? (
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
          )}`;

const newGrid = `          {(!isCreatingNew && activeSession) ? (
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
            <div className="flex flex-1 flex-col items-center justify-center p-4">
              <div className="w-full max-w-sm">
                <div className="grid grid-cols-4 gap-x-2 gap-y-6">
                  {AI_TERMINAL_PROFILES.map((profile) => {
                    const Icon = profile.icon;
                    return (
                      <button
                        key={profile.id}
                        disabled={!projectPath || launchingId !== null}
                        onClick={() => void launchAITerminal(profile)}
                        className="group flex flex-col items-center justify-start gap-2 outline-none"
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 transition-transform group-hover:scale-105 group-active:scale-95 group-hover:bg-secondary border border-border/50 shadow-sm">
                          <Icon className={cn("h-7 w-7", profile.color)} />
                        </div>
                        <span className="text-[10px] font-medium text-muted-foreground text-center truncate w-full px-1 group-hover:text-foreground">
                          {profile.name.replace(' Code', '').replace(' CLI', '')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}`;

if (file.includes(oldTabs)) {
    file = file.replace(oldTabs, newTabs);
} else {
    console.error("Could not find oldTabs");
}

if (file.includes(oldGrid)) {
    file = file.replace(oldGrid, newGrid);
} else {
    console.error("Could not find oldGrid");
}

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
