import { useRef, useCallback, useState } from 'react'
import { Plus, History } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { useAuth } from '@/contexts/AuthContext'
import { AIConversation } from './AIConversation'
import { ChatHistory } from './ChatHistory'
import { cn } from '@/lib/utils'
import { CreditDisplay } from './CreditDisplay'

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

  // Get project ID for chat history
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    projectId
      ? 'skip'
      : currentOrganization?.organizationId
        ? { workosId: currentOrganization.organizationId }
        : 'skip'
  )
  const project = useQuery(
    api.projects.getBySlug,
    projectId
      ? 'skip'
      : convexOrg?._id && projectSlug
        ? { organizationId: convexOrg._id, slug: projectSlug }
        : 'skip'
  )
  const resolvedProjectId = projectId ?? project?._id ?? null

  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const isOpen = mode !== 'closed'
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
        'flex flex-col bg-background overflow-hidden bdry-l relative sidebar-fade-border',
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
            <CreditDisplay className="shrink-0" />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={requestClearChat}
              aria-label="New Conversation"
              title="New Conversation"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={openHistory}
              aria-label="Conversation History"
              title="Conversation History"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Body - AI Conversation */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <AIConversation className="w-full h-full" projectPath={projectPath} projectName={projectName} projectSlug={projectSlug} />
        </div>
      </div>

      {/* Chat History Sheet */}
      <ChatHistory
        isOpen={isHistoryOpen}
        onClose={closeHistory}
        projectId={resolvedProjectId}
      />
    </div>
  )
}
