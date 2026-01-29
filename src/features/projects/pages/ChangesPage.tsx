import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Bot,
  PanelRightClose,
  MessageSquare,
  Smile,
} from 'lucide-react'
import {
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
} from '@primer/octicons-react'
import { DiffPanel } from '../components/changes/DiffPanel'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'

function formatTimeOnly(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDateHeader(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // Reset times to compare dates only
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return 'TODAY'
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return 'YESTERDAY'
  } else {
    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).toUpperCase().replace(',', '')
  }
}

function getDateKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// Group activity by date
function groupActivityByDate<T extends { timestamp: number }>(items: T[]): { dateHeader: string; items: T[] }[] {
  const groups: Map<string, { dateHeader: string; items: T[] }> = new Map()

  for (const item of items) {
    const key = getDateKey(item.timestamp)
    if (!groups.has(key)) {
      groups.set(key, {
        dateHeader: formatDateHeader(item.timestamp),
        items: [],
      })
    }
    groups.get(key)!.items.push(item)
  }

  return Array.from(groups.values())
}

function getChangeIcon(changeType: string) {
  switch (changeType) {
    case 'create':
      return <DiffAddedIcon size={14} className="text-green-500" />
    case 'delete':
      return <DiffRemovedIcon size={14} className="text-red-500" />
    case 'modify':
    default:
      return <DiffModifiedIcon size={14} className="text-yellow-500" />
  }
}

function formatRelativeTime(timestamp: number) {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

// Component to display comments for a change
function ChangeComments({ changeId }: { changeId: Id<"fileChanges"> }) {
  const comments = useQuery(api.activity.getCommentsForChange, { changeId })
  const [isExpanded, setIsExpanded] = useState(true)

  if (!comments || comments.length === 0) return null

  return (
    <div className="ml-[88px] mt-2 mb-3">
      {/* Toggle button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        className="text-xs font-medium text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
      >
        {isExpanded ? 'Hide' : 'Show'} {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </button>

      {/* Comments list */}
      {isExpanded && (
        <div className="relative">
          {/* Dashed timeline line with rounded top and fade */}
          <div className="absolute left-[19px] top-0 bottom-0 flex flex-col items-center pointer-events-none">
            {/* Rounded top dot */}
            <div className="w-2 h-2 rounded-full bg-border shrink-0" />
            {/* Dashed line with fade */}
            <div
              className="w-px flex-1 border-l border-dashed border-border"
              style={{
                maskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
              }}
            />
          </div>

          {/* Comments */}
          <div className="space-y-0 pl-12">
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-3 pb-4">
                {/* Avatar */}
                {comment.userImage ? (
                  <img
                    src={comment.userImage}
                    alt={comment.userName}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
                    style={{ backgroundColor: comment.userColor }}
                  >
                    {comment.userName?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}

                {/* Content column */}
                <div className="flex-1 min-w-0">
                  {/* Name and time */}
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <span className="text-sm font-semibold truncate shrink min-w-0">{comment.userName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">•</span>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>

                  {/* Comment content */}
                  <p className="text-sm text-foreground/90 mb-3">{comment.content}</p>

                  {/* Floating reaction buttons */}
                  <div className="flex items-center gap-2">
                    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 hover:bg-muted text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <span>👍</span>
                      <span>2</span>
                    </button>
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted/50 hover:bg-muted text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <Smile className="h-4 w-4" />
                      <span>+</span>
                    </button>
                    <span className="text-muted-foreground/50">•</span>
                    <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ChangesPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [selectedChangeId, setSelectedChangeId] = useState<Id<"fileChanges"> | null>(null)

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  // Get activity feed
  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 100 } : 'skip'
  )

  // Get comment counts for all changes
  const changeIds = activity?.map(item => item.id as Id<"fileChanges">) || []
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    changeIds.length > 0 ? { changeIds } : 'skip'
  )

  return (
    <div className="flex h-full bg-sidebar/60">
      {/* Timeline Panel */}
      <div className={`flex flex-col ${selectedChangeId ? 'w-1/2 border-r border-border' : 'w-full'} transition-all`}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-9 bg-sidebar/30 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">Changes</h1>
          </div>
          {selectedChangeId && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <PanelRightClose className="h-3 w-3" />
              Click item to view diff
            </span>
          )}
        </div>

        {/* Timeline Content */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {!project?._id ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <p className="text-sm">Loading project...</p>
              </div>
            ) : activity === undefined ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-pulse text-muted-foreground">Loading activity...</div>
              </div>
            ) : activity.length === 0 ? (
              <Card className="p-12 text-center">
                <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Changes Yet</h3>
                <p className="text-sm text-muted-foreground">
                  File changes will appear here in real-time as you and your team edit files.
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {groupActivityByDate(activity).map((group) => (
                  <div key={group.dateHeader}>
                    {/* Date Header */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold text-muted-foreground tracking-wider">
                        {group.dateHeader}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    {/* Items for this date */}
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <div key={item.id}>
                          <div
                            onClick={() => setSelectedChangeId(item.id as Id<"fileChanges">)}
                            className={`
                              flex items-start gap-3 py-2 px-2 rounded-lg cursor-pointer transition-colors
                              ${selectedChangeId === item.id
                                ? 'bg-primary/10 border border-primary/20'
                                : 'hover:bg-muted/50'
                              }
                            `}
                          >
                            {/* Time Column */}
                            <div className="w-20 shrink-0 pt-1 mr-2">
                              <span className="text-sm text-muted-foreground whitespace-nowrap">
                                {formatTimeOnly(item.timestamp)}
                              </span>
                            </div>

                            {/* Avatar */}
                            <div className="shrink-0 pt-0.5">
                              {item.userImage ? (
                                <img
                                  src={item.userImage}
                                  alt={item.userName}
                                  className="w-8 h-8 rounded-full object-cover"
                                />
                              ) : (
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white"
                                  style={{ backgroundColor: item.userColor }}
                                >
                                  {item.isAgent ? (
                                    <Bot className="h-4 w-4" />
                                  ) : (
                                    item.userName?.charAt(0).toUpperCase() || 'U'
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Content - single line */}
                            <div className="flex-1 min-w-0 flex items-center gap-2 pt-1.5">
                              <span className="font-medium text-sm">
                                {item.userName}
                              </span>
                              {getChangeIcon(item.changeType)}
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-xs font-mono">
                                {getFileIcon(item.filePath.split('/').pop() || item.filePath, { width: 14, height: 14 })}
                                <span className="truncate">{item.filePath.split('/').pop()}</span>
                              </span>
                              {item.isAgent && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  AI
                                </Badge>
                              )}
                              {(item.additions !== undefined && item.additions > 0) && (
                                <span className="text-xs text-green-500">+{item.additions}</span>
                              )}
                              {(item.deletions !== undefined && item.deletions > 0) && (
                                <span className="text-xs text-red-500">-{item.deletions}</span>
                              )}
                              {commentCounts && commentCounts[item.id] > 0 && (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                                  <MessageSquare className="h-3 w-3" />
                                  {commentCounts[item.id]}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Comments under this change */}
                          {commentCounts && commentCounts[item.id] > 0 && (
                            <ChangeComments changeId={item.id as Id<"fileChanges">} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Diff Panel */}
      {selectedChangeId && (
        <div className="w-1/2 bg-background">
          <DiffPanel
            changeId={selectedChangeId}
            onClose={() => setSelectedChangeId(null)}
          />
        </div>
      )}
    </div>
  )
}
