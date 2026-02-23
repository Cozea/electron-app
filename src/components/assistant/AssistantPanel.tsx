import { Activity, lazy, Suspense, useRef, useCallback, useState, useEffect } from 'react'
import { Plus, History, Menu } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { useAuth } from '@/contexts/AuthContext'
import { useWindowsCaptionControlsWidth } from '@/hooks/useWindowsCaptionControlsWidth'
import { cn } from '@/lib/utils'

const AIConversation = lazy(() => import('./AIConversation').then((module) => ({ default: module.AIConversation })))
const ChatHistory = lazy(() => import('./ChatHistory').then((module) => ({ default: module.ChatHistory })))

function PanelLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Preparing assistant...
    </div>
  )
}

interface AssistantPanelProps {
  className?: string
  projectPath?: string | null
  projectId?: Id<"projects"> | null
  projectName?: string | null
  projectSlug?: string | null
}

export function AssistantPanel({ className, projectPath, projectId, projectName, projectSlug }: AssistantPanelProps) {
  const mode = useAssistantPanelStore((state) => state.mode)
  const requestClearChat = useAssistantPanelStore((state) => state.requestClearChat)
  const storedWidth = useAssistantPanelStore((state) => state.panelWidth)
  const setPanelWidth = useAssistantPanelStore((state) => state.setPanelWidth)
  const resetPanelWidth = useAssistantPanelStore((state) => state.resetPanelWidth)
  const chatTitle = useAssistantPanelStore((state) => state.chatTitle)
  const isHistoryOpen = useAssistantPanelStore((state) => state.isHistoryOpen)
  const openHistory = useAssistantPanelStore((state) => state.openHistory)
  const closeHistory = useAssistantPanelStore((state) => state.closeHistory)

  const { currentOrganization } = useAuth()
  const isOpen = mode !== 'closed'
  const isWindowsClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
  const shouldShowWindowsCaptionSpacer = isWindowsClient && isOpen
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth()

  const [hasMountedConversation, setHasMountedConversation] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setHasMountedConversation(true)
    }
  }, [isOpen])

  // Get project ID for chat history
  const shouldResolveProjectForHistory = Boolean(
    !projectId &&
    (isOpen || isHistoryOpen) &&
    currentOrganization?.organizationId &&
    projectSlug
  )
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    shouldResolveProjectForHistory && currentOrganization?.organizationId
      ? { workosId: currentOrganization.organizationId }
      : 'skip'
  )
  const project = useQuery(
    api.projects.getBySlug,
    shouldResolveProjectForHistory && convexOrg?._id && projectSlug
      ? { organizationId: convexOrg._id, slug: projectSlug }
      : 'skip'
  )
  const resolvedProjectId = projectId ?? project?._id ?? null

  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const panelWidthValue = `${storedWidth}px`

  // Resize handle event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = storedWidth
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [storedWidth])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    // Dragging left increases width (panel is on right side)
    const delta = dragStartX.current - e.clientX
    const newWidth = dragStartWidth.current + delta

    // Clamp to window width minus safety margin (e.g. 100px)
    const maxAllowedWidth = window.innerWidth - 100
    const clampedWidth = Math.min(newWidth, maxAllowedWidth)

    setPanelWidth(Math.round(clampedWidth))
  }, [isDragging, setPanelWidth])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDoubleClick = useCallback(() => {
    resetPanelWidth()
  }, [resetPanelWidth])

  return (
    <div
      className={cn(
        'flex flex-col bg-[var(--assistant-surface)] overflow-hidden bdry-l relative sidebar-fade-border [--assistant-surface:var(--background)]',
        'relative',
        !isDragging && 'transition-all duration-300 ease-in-out',
        className
      )}
      style={{
        width: isOpen ? panelWidthValue : 0,
        minWidth: isOpen ? panelWidthValue : 0,
        opacity: 1,
        // Standard flex behavior
        flexGrow: 0,
        flexShrink: 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: isDragging ? 'none' : undefined,
      }}
    >
      {/* Resize Handle */}
      {isOpen && (
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-50',
            'hover:bg-primary/20 transition-colors',
            isDragging && 'bg-primary/20'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          title="Drag to resize, double-click to reset"
        />
      )}

      {/* Inner container to prevent content squishing during animation */}
      <div
        className="flex flex-col h-full"
        style={{
          width: panelWidthValue,
          minWidth: `${storedWidth}px`,
          transition: isDragging ? 'none' : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center h-9 px-4 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium truncate min-w-0">{chatTitle}</span>
          </div>
          <div className="titlebar-no-drag flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                  aria-label="Chat actions"
                  title="Chat actions"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    requestClearChat()
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>New Chat</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    openHistory()
                  }}
                >
                  <History className="mr-2 h-4 w-4" />
                  <span>History</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {shouldShowWindowsCaptionSpacer ? (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            ) : null}
          </div>
        </div>

        {/* Body - AI Conversation */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Activity mode={isOpen ? 'visible' : 'hidden'}>
            {hasMountedConversation ? (
              <Suspense fallback={<PanelLoadingFallback />}>
                <AIConversation
                  className="w-full h-full"
                  projectPath={projectPath}
                  projectName={projectName}
                  projectSlug={projectSlug}
                />
              </Suspense>
            ) : null}
          </Activity>
        </div>
      </div>

      {/* Chat History Sheet */}
      {isHistoryOpen ? (
        <Suspense fallback={null}>
          <ChatHistory
            isOpen={isHistoryOpen}
            onClose={closeHistory}
            projectId={resolvedProjectId}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
