import { useState, useRef, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatHistoryProps {
  isOpen: boolean
  onClose: () => void
  projectId: Id<"projects"> | null
}

function formatRelativeTime(timestamp: number) {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const weeks = Math.floor(diff / 604800000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  if (weeks < 52) return `${weeks}w`
  return new Date(timestamp).toLocaleDateString()
}

export function ChatHistory({ isOpen, onClose, projectId }: ChatHistoryProps) {
  const { convexUserId } = useAuth()
  const {
    currentConversationId,
    setCurrentConversationId,
    setChatTitle,
  } = useAssistantPanelStore()

  const [searchQuery, setSearchQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const conversations = useQuery(
    api.aiConversations.list,
    convexUserId && projectId
      ? { projectId, userId: convexUserId, status: "active" }
      : "skip"
  )

  // Focus search input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Delay to prevent immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSelect = (conv: { _id: Id<"aiConversations">; title: string }) => {
    setCurrentConversationId(conv._id)
    setChatTitle(conv.title)
    onClose()
  }

  // Filter conversations by search query
  const filteredConversations = conversations?.filter((conv) =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (!isOpen) return null

  return (
    <div
      ref={panelRef}
      className="absolute left-3 right-3 top-12 z-50 flex max-h-[420px] flex-col overflow-hidden rounded-2xl bg-secondary text-secondary-foreground p-1 shadow-xl animate-in fade-in-0 slide-in-from-top-2 duration-150"
    >
      {/* Search */}
      <div className="px-2 pt-1 pb-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search recent tasks"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Conversations list */}
      <ScrollArea className="flex-1 max-h-[336px]">
        <div className="px-1 pb-1">
          {conversations === undefined ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <span className="text-sm">Loading...</span>
            </div>
          ) : filteredConversations?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No matching conversations' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            filteredConversations?.map((conv) => (
              <div
                key={conv._id}
                onClick={() => handleSelect(conv)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-full px-2 py-1.5 text-sm transition-colors",
                  currentConversationId === conv._id
                    ? "bg-foreground/10 dark:bg-foreground/16 text-foreground"
                    : "hover:bg-foreground/10 dark:hover:bg-foreground/16"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                  {currentConversationId === conv._id && (
                    <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {formatRelativeTime(conv.updatedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
