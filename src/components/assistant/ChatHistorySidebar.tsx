import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Plus, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatHistorySidebarProps {
  projectId: Id<'projects'> | null
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

export function ChatHistorySidebar({ projectId }: ChatHistorySidebarProps) {
  const { convexUserId } = useAuth()
  const applyWindowControlsInset =
    typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const {
    currentConversationId,
    setCurrentConversationId,
    setChatTitle,
    startNewConversation,
  } = useAssistantPanelStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchVisible, setIsSearchVisible] = useState(false)

  const conversations = useQuery(
    api.aiConversations.list,
    convexUserId && projectId
      ? { projectId, userId: convexUserId, status: 'active' }
      : 'skip'
  )

  const filteredConversations = useMemo(() => {
    if (!conversations) return conversations
    const query = searchQuery.trim().toLowerCase()
    if (!query) return conversations
    return conversations.filter((conv) => conv.title.toLowerCase().includes(query))
  }, [conversations, searchQuery])

  const handleSelect = (conv: { _id: Id<'aiConversations'>; title: string }) => {
    setCurrentConversationId(conv._id)
    setChatTitle(conv.title)
  }

  const handleToggleSearch = () => {
    setIsSearchVisible((previous) => {
      const next = !previous
      if (!next) setSearchQuery('')
      return next
    })
  }

  return (
    <Sidebar
      side="right"
      variant="sidebar"
      collapsible="none"
      style={{
        '--sidebar': 'var(--main-nav-sidebar-surface)',
        '--sidebar-surface': 'var(--main-nav-sidebar-surface)',
      } as React.CSSProperties}
      className="file-tree-panel-border h-full min-w-0 shrink-0 border-l border-border/55 bg-sidebar"
    >
      <SidebarHeader
        className={cn(
          'titlebar-drag-region h-9 px-3',
          applyWindowControlsInset && 'mt-9'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Chats
          </span>
          <div className="titlebar-no-drag flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground",
                isSearchVisible && "bg-sidebar-accent text-secondary-foreground"
              )}
              onClick={handleToggleSearch}
              aria-label={isSearchVisible ? "Close search" : "Open search"}
              title={isSearchVisible ? "Close search" : "Search chats"}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-secondary-foreground/60 hover:text-secondary-foreground"
              onClick={startNewConversation}
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="titlebar-no-drag h-full overflow-hidden pt-2">
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-out",
            isSearchVisible ? "max-h-14 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="px-2 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search chats"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-8 rounded-xl border-0 bg-secondary/80 pl-8 text-sm shadow-none focus-visible:ring-0 dark:bg-secondary/40"
              />
            </div>
          </div>
        </div>

        <ScrollArea className="h-full">
          <div className="px-2 pb-3">
            {conversations === undefined ? (
              <div className="px-2 py-6 text-sm text-muted-foreground">Loading chats...</div>
            ) : filteredConversations?.length === 0 ? (
              <div className="px-2 py-6 text-sm text-muted-foreground">
                {searchQuery ? 'No matching chats' : 'No chats yet'}
              </div>
            ) : (
              filteredConversations?.map((conv) => (
                <button
                  key={conv._id}
                  type="button"
                  onClick={() => handleSelect(conv)}
                  className={cn(
                    'group mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    currentConversationId === conv._id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/70'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{conv.title}</span>
                  {currentConversationId === conv._id ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelativeTime(conv.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </SidebarContent>
    </Sidebar>
  )
}
