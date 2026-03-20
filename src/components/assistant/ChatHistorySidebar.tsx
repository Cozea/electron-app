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
import { MessageCircle, Plus, Search } from 'lucide-react'
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

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  if (weeks < 52) return `${weeks}w`
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function ChatHistorySidebar({ projectId }: ChatHistorySidebarProps) {
  const { convexUserId } = useAuth()
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
  const visibleConversations = filteredConversations ?? []

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
      windowChromeAware
      style={{
        '--sidebar': 'var(--left-sidebar-surface)',
        '--sidebar-surface': 'var(--left-sidebar-surface)',
      } as React.CSSProperties}
      className="file-tree-panel-border h-full min-w-0 shrink-0 border-l border-border/55 bg-sidebar"
    >
      <SidebarHeader
        className="titlebar-drag-region h-11 px-4"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Sessions
          </span>
          <div className="titlebar-no-drag flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground",
                isSearchVisible && "bg-sidebar-accent text-sidebar-accent-foreground"
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
              className="h-7 w-7 rounded-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground"
              onClick={startNewConversation}
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="titlebar-no-drag h-full overflow-hidden pt-1">
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-out",
            isSearchVisible ? "max-h-16 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="px-4 pt-1 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/55" />
              <Input
                type="text"
                placeholder="Search sessions"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 rounded-2xl border border-sidebar-border/70 bg-background/90 pl-9 text-[13px] text-sidebar-foreground placeholder:text-sidebar-foreground/50 shadow-none focus-visible:ring-sidebar-ring/35 dark:border-sidebar-border/60 dark:bg-secondary/40"
              />
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="px-3 pb-4">
              {conversations === undefined ? (
                <div className="px-3 py-8 text-[13px] text-muted-foreground">Loading sessions...</div>
              ) : visibleConversations.length === 0 ? (
                <div className="px-3 py-8 text-[13px] text-muted-foreground">
                  {searchQuery ? 'No matching sessions' : 'No sessions yet'}
                </div>
              ) : (
                visibleConversations.map((conv) => {
                  const isActive = currentConversationId === conv._id
                  return (
                    <button
                      key={conv._id}
                      type="button"
                      onClick={() => handleSelect(conv)}
                      className={cn(
                        'group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
                        isActive
                          ? 'bg-sidebar-accent/80 text-sidebar-accent-foreground'
                          : 'hover:bg-sidebar-accent/55'
                      )}
                    >
                      <span className={cn(
                        'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                        isActive ? 'bg-primary' : 'bg-primary/95'
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[17px] font-normal leading-6 text-foreground">
                          {conv.title}
                        </div>
                        <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                          {isActive ? 'Current session' : 'Conversation'}
                        </div>
                      </div>
                      <div className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span>{formatRelativeTime(conv.createdAt)}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </SidebarContent>
    </Sidebar>
  )
}
