import { Activity, lazy, Suspense, useRef, useCallback, useState, useEffect } from 'react'
import { Plus, History, Menu, Maximize2, Minimize2 } from 'lucide-react'
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
import { MIN_PANEL_WIDTH, MAX_DRAG_PANEL_WIDTH } from '@/stores/useAssistantPanelStore'
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
  const expandToFullscreen = useAssistantPanelStore((state) => state.expandToFullscreen)
  const collapseToPanel = useAssistantPanelStore((state) => state.collapseToPanel)
  const chatTitle = useAssistantPanelStore((state) => state.chatTitle)
  const isHistoryOpen = useAssistantPanelStore((state) => state.isHistoryOpen)
  const openHistory = useAssistantPanelStore((state) => state.openHistory)
  const closeHistory = useAssistantPanelStore((state) => state.closeHistory)
  const startNewConversation = useAssistantPanelStore((state) => state.startNewConversation)

  const { user, currentOrganization } = useAuth()
  const isOpen = mode !== 'closed'
  const isWindowsClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
  const isMacClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const shouldShowWindowsCaptionSpacer = isWindowsClient && isOpen
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth()

  const [hasMountedConversation, setHasMountedConversation] = useState(isOpen)
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setHasMountedConversation(true)
    }
  }, [isOpen])

  // Get project ID for chat history
  const shouldResolveProjectForHistory = Boolean(
    !projectId &&
    (isOpen || isHistoryOpen) &&
    user?.id &&
    projectSlug
  )
  const convexUser = useQuery(
    api.users.getByWorkosId,
    shouldResolveProjectForHistory && user?.id
      ? { workosId: user.id }
      : 'skip'
  )
  const projectResolution = useQuery(
    api.projects.getAccessibleBySlug,
    shouldResolveProjectForHistory && convexUser?._id && projectSlug
      ? {
          slug: projectSlug,
          userId: convexUser._id,
          preferredOrganizationId: currentOrganization?.convexOrgId as Id<'organizations'> | undefined,
        }
      : 'skip'
  )
  const resolvedProjectId =
    projectId ??
    (projectResolution?.status === 'ok' ? projectResolution.project._id : null)

  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const isFullscreen = mode === 'fullscreen'
  const panelWidthValue = isFullscreen ? '100%' : `${storedWidth}px`

  useEffect(() => {
    if (!isFullscreen) return
    if (isHistoryOpen) {
      closeHistory()
    }
    setIsActionsMenuOpen(false)
  }, [closeHistory, isFullscreen, isHistoryOpen])

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
    // Cap drag resize so user must use expand button for full width
    const clampedWidth = Math.round(
      Math.max(MIN_PANEL_WIDTH, Math.min(MAX_DRAG_PANEL_WIDTH, newWidth))
    )
    setPanelWidth(clampedWidth)
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
        'h-full flex flex-col bg-[var(--assistant-surface)] overflow-hidden relative [--assistant-surface:var(--content-surface)]',
        !isFullscreen && 'border-l border-border',
        'relative',
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
      {/* Resize Handle - only when not fullscreen */}
      {isOpen && !isFullscreen && (
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
        className="flex flex-col h-full min-w-0"
        style={{
          width: '100%',
          minWidth: 0,
          transition: isDragging ? 'none' : undefined,
        }}
      >
        {/* Header */}
        <div className={cn('titlebar-drag-region flex items-center h-9 px-4 shrink-0 gap-2', isMacClient && 'pr-2')}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium truncate min-w-0">{chatTitle}</span>
          </div>
          <div className="titlebar-no-drag flex items-center gap-1 shrink-0">
            {isFullscreen ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={startNewConversation}
                aria-label="New chat"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={isFullscreen ? collapseToPanel : expandToFullscreen}
              aria-label={isFullscreen ? 'Collapse to panel' : 'Expand to full width'}
              title={isFullscreen ? 'Collapse to panel' : 'Expand to full width'}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            {!isFullscreen ? (
              <DropdownMenu
                open={isActionsMenuOpen}
                onOpenChange={(nextOpen) => {
                  if (nextOpen && isHistoryOpen) {
                    closeHistory()
                    setIsActionsMenuOpen(false)
                    return
                  }
                  setIsActionsMenuOpen(nextOpen)
                }}
              >
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
                    onSelect={() => {
                      setIsActionsMenuOpen(false)
                      requestClearChat()
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <span>New Chat</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setIsActionsMenuOpen(false)
                      openHistory()
                    }}
                  >
                    <History className="mr-2 h-4 w-4" />
                    <span>History</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
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
                  projectId={resolvedProjectId}
                  projectName={projectName}
                  projectSlug={projectSlug}
                />
              </Suspense>
            ) : null}
          </Activity>
        </div>
      </div>

      {/* Chat History Sheet */}
      {isHistoryOpen && !isFullscreen ? (
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
