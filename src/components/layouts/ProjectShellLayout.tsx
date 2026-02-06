import { useState, type ReactNode } from 'react'
import { TitleBar } from '../TitleBar'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../ui/resizable'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip'
import {
  Files,
  Search,
  GitBranch,
  MessageSquare,
  Terminal,
  AlertCircle,
  Play,
  ChevronDown,
  X,
  Maximize2,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProjectShellLayoutProps {
  // Project info
  projectName?: string
  branchName?: string

  // Panel content
  fileTree?: ReactNode
  editor?: ReactNode
  rightPanel?: ReactNode
  bottomPanel?: ReactNode

  // Panel visibility
  showLeftPanel?: boolean
  showRightPanel?: boolean
  showBottomPanel?: boolean

  // Callbacks
  onToggleLeftPanel?: () => void
  onToggleRightPanel?: () => void
  onToggleBottomPanel?: () => void
}

type ActivityBarItem = 'files' | 'search' | 'git' | 'chat'

export function ProjectShellLayout({
  projectName = 'Untitled Project',
  branchName = 'main',
  fileTree,
  editor,
  rightPanel,
  bottomPanel,
  showLeftPanel = true,
  showRightPanel = true,
  showBottomPanel = true,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleBottomPanel,
}: ProjectShellLayoutProps) {
  const [activeActivity, setActiveActivity] = useState<ActivityBarItem>('files')
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems' | 'output'>('terminal')

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar />

      {/* Top Bar */}
      <header className="h-10 mt-10 flex items-center justify-between px-2 bg-background">
        {/* Left: Project & Branch */}
        <div className="flex items-center gap-2 pl-16">
          <Button variant="ghost" size="sm" className="gap-1 h-7 text-sm">
            <span className="font-medium">{projectName}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Separator orientation="vertical" className="h-4" />
          <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            {branchName}
          </Button>
        </div>

        {/* Center: Run controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="gap-1 h-7">
            <Play className="h-3 w-3" />
            Run
          </Button>
        </div>

        {/* Right: Panel toggles */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', showLeftPanel && 'bg-accent')}
                onClick={onToggleLeftPanel}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle Sidebar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', showBottomPanel && 'bg-accent')}
                onClick={onToggleBottomPanel}
              >
                <PanelBottom className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle Panel</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', showRightPanel && 'bg-accent')}
                onClick={onToggleRightPanel}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle AI Chat</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <aside className="w-12 bg-background bdry-r flex flex-col items-center py-2 gap-1">
          <ActivityButton
            icon={Files}
            active={activeActivity === 'files'}
            onClick={() => setActiveActivity('files')}
            tooltip="Explorer"
          />
          <ActivityButton
            icon={Search}
            active={activeActivity === 'search'}
            onClick={() => setActiveActivity('search')}
            tooltip="Search"
          />
          <ActivityButton
            icon={GitBranch}
            active={activeActivity === 'git'}
            onClick={() => setActiveActivity('git')}
            tooltip="Source Control"
          />
          <div className="flex-1" />
          <ActivityButton
            icon={MessageSquare}
            active={activeActivity === 'chat'}
            onClick={() => setActiveActivity('chat')}
            tooltip="AI Chat"
          />
        </aside>

        {/* Resizable Panels */}
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Left Panel (File Tree) */}
          {showLeftPanel && (
            <>
              <ResizablePanel defaultSize="20" minSize="15" maxSize="40">
                <div className="h-full flex flex-col bg-background">
                  <div className="h-8 px-3 flex items-center justify-between bdry-b">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {activeActivity === 'files' && 'Explorer'}
                      {activeActivity === 'search' && 'Search'}
                      {activeActivity === 'git' && 'Source Control'}
                      {activeActivity === 'chat' && 'Chat'}
                    </span>
                  </div>
                  <ScrollArea className="flex-1">
                    {fileTree || (
                      <div className="p-3 text-sm text-muted-foreground">
                        No files open
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {/* Center Panel (Editor + Bottom Panel) */}
          <ResizablePanel defaultSize={showRightPanel ? '55' : '80'}>
            <ResizablePanelGroup orientation="vertical">
              {/* Editor Area */}
              <ResizablePanel defaultSize={showBottomPanel ? '70' : '100'}>
                <div className="h-full flex flex-col bg-background">
                  {/* Editor Tabs */}
                  <div className="h-9 bdry-b flex items-center px-1">
                    <div className="flex items-center gap-1 text-sm">
                      <div className="flex items-center gap-2 px-3 py-1 bg-accent rounded-t border-b-2 border-primary">
                        <span>Welcome</span>
                        <button className="hover:bg-muted rounded p-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Editor Content */}
                  <div className="flex-1 overflow-hidden">
                    {editor || (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <h2 className="text-lg font-medium mb-2">Welcome to Cozea</h2>
                          <p className="text-sm">Open a file or start a new project</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>

              {/* Bottom Panel */}
              {showBottomPanel && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize="30" minSize="15" maxSize="50">
                    <div className="h-full flex flex-col bg-background bdry-t">
                      {/* Bottom Panel Tabs */}
                      <div className="h-8 flex items-center justify-between px-2 bdry-b">
                        <Tabs value={bottomTab} onValueChange={(v) => setBottomTab(v as typeof bottomTab)}>
                          <TabsList className="h-6 bg-transparent p-0 gap-1">
                            <TabsTrigger value="terminal" className="h-6 px-2 text-xs data-[state=active]:bg-accent">
                              <Terminal className="h-3 w-3 mr-1" />
                              Terminal
                            </TabsTrigger>
                            <TabsTrigger value="problems" className="h-6 px-2 text-xs data-[state=active]:bg-accent">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Problems
                            </TabsTrigger>
                            <TabsTrigger value="output" className="h-6 px-2 text-xs data-[state=active]:bg-accent">
                              Output
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <Maximize2 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleBottomPanel}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {/* Bottom Panel Content */}
                      <ScrollArea className="flex-1">
                        {bottomPanel || (
                          <div className="p-2 font-mono text-xs text-muted-foreground">
                            {bottomTab === 'terminal' && '$ '}
                            {bottomTab === 'problems' && 'No problems detected.'}
                            {bottomTab === 'output' && 'No output.'}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Right Panel (AI Chat) */}
          {showRightPanel && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize="25" minSize="20" maxSize="40">
                <div className="h-full flex flex-col bg-background bdry-l">
                  <div className="h-8 px-3 flex items-center justify-between bdry-b">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      AI Assistant
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleRightPanel}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <ScrollArea className="flex-1">
                    {rightPanel || (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Ask me anything about your code</p>
                      </div>
                    )}
                  </ScrollArea>
                  {/* Chat Input */}
                  <div className="p-2 bdry-t">
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                      <input
                        type="text"
                        placeholder="Ask AI..."
                        className="flex-1 bg-transparent text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Status Bar */}
      <footer className="h-6 flex items-center justify-between px-2 bdry-t bg-background text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {branchName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>Ln 1, Col 1</span>
          <span>UTF-8</span>
          <span>TypeScript</span>
        </div>
      </footer>
    </div>
  )
}

function ActivityButton({
  icon: Icon,
  active,
  onClick,
  tooltip,
}: {
  icon: React.ElementType
  active?: boolean
  onClick?: () => void
  tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-10 w-10 rounded-none',
            active && 'border-l-2 border-primary bg-accent'
          )}
          onClick={onClick}
        >
          <Icon className={cn('h-5 w-5', active ? 'text-foreground' : 'text-muted-foreground')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
