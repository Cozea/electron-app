import { useRef, useCallback, useState, useEffect } from 'react'
import { Terminal, Maximize2, Minimize2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAITerminalStore } from '@/stores/useAITerminalStore'
import { TerminalInstance } from '@/features/projects/components/TerminalInstance'


interface AITerminalSidebarProps {
  className?: string
  projectPath?: string | null
}

const AI_TERMINAL_PROFILES = [
  { id: 'claude', name: 'Claude Code', command: 'claude' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini' },
  { id: 'kilo', name: 'Kilo Code', command: 'kilo' },
  { id: 'sh', name: 'Shell', command: '' },
]

export function AITerminalSidebar({ className, projectPath }: AITerminalSidebarProps) {
  const mode = useAITerminalStore((state) => state.mode)
  const storedWidth = useAITerminalStore((state) => state.panelWidth)
  const setPanelWidth = useAITerminalStore((state) => state.setPanelWidth)
  const resetPanelWidth = useAITerminalStore((state) => state.resetPanelWidth)
  const expandToFullscreen = useAITerminalStore((state) => state.expandToFullscreen)
  const collapseToPanel = useAITerminalStore((state) => state.collapseToPanel)
  
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  
  const isOpen = mode !== 'closed'
  const isFullscreen = mode === 'fullscreen'
  const panelWidthValue = isFullscreen ? '100%' : `${storedWidth}px`

  // Handle dragging resize
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = storedWidth
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [storedWidth])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    const delta = dragStartX.current - e.clientX
    const newWidth = dragStartWidth.current + delta
    const clampedWidth = Math.round(Math.max(250, Math.min(800, newWidth)))
    setPanelWidth(clampedWidth)
  }, [isDragging, setPanelWidth])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDoubleClick = useCallback(() => {
    resetPanelWidth()
  }, [resetPanelWidth])

  // Launching a new terminal
  const launchAITerminal = async (profileId: string, command: string) => {
    void profileId; if (!projectPath) return
    
    try {
      const result = await window.electronAPI.terminal.create({
        projectPath,
        cwd: projectPath,
        cols: 80,
        rows: 24,
      })

      if (result.success && result.terminalId) {
        setActiveTerminalId(result.terminalId)
        
        if (command) {
          setTimeout(() => {
            window.electronAPI.terminal.input({
              terminalId: result.terminalId!,
              data: command + '\r',
            })
          }, 300) // Small delay to let shell boot up
        }
      }
    } catch (err) {
      console.error("Failed to launch AI terminal", err)
    }
  }

  // Effect to clean up dead active terminal references
  useEffect(() => {
    if (!activeTerminalId) return
    
    const unsubscribe = window.electronAPI.terminal.onExit((event) => {
      if (event.terminalId === activeTerminalId) {
        // Find another terminal or set to null if none
        setActiveTerminalId(null)
      }
    })
    
    return unsubscribe
  }, [activeTerminalId])

  return (
    <div
      className={cn(
        'h-full flex flex-col bg-content-surface overflow-hidden relative',
        !isFullscreen && 'border-l border-border',
        !isDragging && 'transition-[width,flex-grow,flex-shrink,min-width] duration-300 ease-in-out',
        className
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

      {isOpen && !isFullscreen && (
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-50 hover:bg-primary/20 transition-colors',
            isDragging && 'bg-primary/20'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col min-w-0" style={{ width: '100%' }}>
        <div className="flex items-center h-9 px-4 shrink-0 gap-2 bdry-b border-border">
          <div className="flex items-center gap-2 min-w-0 flex-1 text-xs font-medium">
            <Terminal className="w-4 h-4" />
            <span>AI Agents</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={isFullscreen ? collapseToPanel : expandToFullscreen}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col">
          {!activeTerminalId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-2">
                <Terminal className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-medium text-sm">Launch an AI Agent</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-[200px] mx-auto">
                  Run AI tools directly in your terminal using system credentials.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[200px] mt-4">
                {AI_TERMINAL_PROFILES.map(profile => (
                  <Button
                    key={profile.id}
                    variant="outline"
                    className="w-full justify-start text-xs font-normal"
                    onClick={() => launchAITerminal(profile.id, profile.command)}
                  >
                    <Plus className="w-3 h-3 mr-2 opacity-50" />
                    {profile.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 relative bg-[var(--terminal-panel-bg,var(--content-surface))]">
               <TerminalInstance
                  terminalId={activeTerminalId}
                  className="absolute inset-0 h-full w-full"
                  shouldAutoFocus={true}
               />
               <Button
                 variant="ghost"
                 size="sm"
                 className="absolute top-2 right-2 h-6 px-2 text-[10px] bg-background/50 hover:bg-background shadow-sm z-10"
                 onClick={() => setActiveTerminalId(null)}
               >
                 Close Session
               </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}