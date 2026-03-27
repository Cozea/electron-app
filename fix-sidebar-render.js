const fs = require('fs');
let file = fs.readFileSync('src/components/terminal/AITerminalSidebar.tsx', 'utf8');

const oldRender = `          {(!isCreatingNew && activeSession) ? (
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
            </div>`;

const newRender = `          {(!isCreatingNew && activeSession) ? (() => {
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
          })()`;

file = file.replace(oldRender, newRender);

fs.writeFileSync('src/components/terminal/AITerminalSidebar.tsx', file);
