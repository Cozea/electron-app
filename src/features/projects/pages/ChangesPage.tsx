import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Activity,
  Asterisk,
  Bot,
  MessageSquare,
  Minus,
  Plus,
  Smile,
} from 'lucide-react'
import { DiffPanel } from '../components/changes/DiffPanel'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'

interface SelectedChangeSummary {
  id: Id<"fileChanges">
  filePath: string
  changeType: string
  userImage?: string
  userName: string
  userColor: string
  timestamp: number
}

interface ActivityFeedItem {
  id: Id<"fileChanges">
  userId?: Id<"users">
  filePath: string
  changeType: string
  additions?: number
  deletions?: number
  totalLines?: number
  origin: string
  userName: string
  userColor: string
  userImage?: string
  isAgent?: boolean
  timestamp: number
}

interface ChangeCommentReaction {
  emoji: string
  count: number
  reactedByViewer: boolean
}

interface ChangeComment {
  id: Id<"changeComments">
  changeId: Id<"fileChanges">
  userId: Id<"users">
  parentCommentId?: Id<"changeComments">
  content: string
  userName: string
  userColor: string
  userImage?: string
  createdAt: number
  reactions: ChangeCommentReaction[]
}

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
  const baseClasses = 'h-3.5 w-3.5'
  switch (changeType) {
    case 'create':
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary">
          <Plus className={`${baseClasses} text-green-500`} />
        </span>
      )
    case 'delete':
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary">
          <Minus className={`${baseClasses} text-red-500`} />
        </span>
      )
    case 'modify':
    default:
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary">
          <Asterisk className={`${baseClasses} text-amber-500`} />
        </span>
      )
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

function FeedLoadingRows() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, groupIndex) => (
        <div key={groupIndex}>
          <div className="flex items-center gap-3 mb-3">
            <Shimmer className="text-sm">Loading feed</Shimmer>
            <div className="flex-1 h-px bg-border/70" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((__, rowIndex) => (
              <div
                key={`${groupIndex}-${rowIndex}`}
                className="flex items-start gap-3 py-2 px-3 rounded-full"
              >
                <div className="w-20 shrink-0 pt-1 mr-2">
                  <Shimmer className="text-xs">00:00</Shimmer>
                </div>
                <div className="w-8 h-8 rounded-full bg-muted/70 shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-2 pt-1.5">
                  <Shimmer className="text-sm">Username</Shimmer>
                  <Shimmer className="text-xs">+/-</Shimmer>
                  <Shimmer className="text-sm">src/components/Example.tsx</Shimmer>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DiffPanelLoadingShell() {
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 px-4 h-12 bg-sidebar">
        <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary" />
        <Shimmer className="text-sm">src/components/Example.tsx</Shimmer>
        <div className="ml-auto flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-muted/70" />
          <Shimmer className="text-xs">just now</Shimmer>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative p-4 bg-sidebar/30">
        <div className="space-y-2">
          <Shimmer className="text-sm">Loading diff preview...</Shimmer>
          <Shimmer className="text-sm">Preparing hunks...</Shimmer>
          <Shimmer className="text-sm">Rendering comments...</Shimmer>
        </div>
      </div>

      <div className="p-4 bg-sidebar">
        <div className="rounded-xl bg-background overflow-hidden shadow-sm">
          <div className="min-h-[80px] px-3 py-2">
            <Shimmer className="text-sm">Add comment</Shimmer>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              <div className="h-8 w-8 rounded-full bg-muted/60" />
              <div className="h-8 w-8 rounded-full bg-muted/60" />
              <div className="h-8 w-8 rounded-full bg-muted/60" />
            </div>
            <div className="h-8 w-16 rounded-full bg-muted/60" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Component to display comments for a change
function ChangeComments({
  changeId,
  viewerUserId,
}: {
  changeId: Id<"fileChanges">
  viewerUserId: Id<"users"> | null
}) {
  const comments = useQuery(api.activity.getCommentsForChange, {
    changeId,
    viewerUserId: viewerUserId ?? undefined,
  }) as ChangeComment[] | undefined
  const addComment = useMutation(api.activity.addComment)
  const toggleCommentReaction = useMutation(api.activity.toggleCommentReaction)
  const [isExpanded, setIsExpanded] = useState(true)
  const [replyingToCommentId, setReplyingToCommentId] = useState<Id<"changeComments"> | null>(null)
  const [replyDraftByComment, setReplyDraftByComment] = useState<Record<string, string>>({})
  const [submittingReplyFor, setSubmittingReplyFor] = useState<string | null>(null)
  const [pendingReactionKey, setPendingReactionKey] = useState<string | null>(null)

  const commentsByParent = useMemo(() => {
    const grouped = new Map<string, ChangeComment[]>()
    if (!comments) return grouped

    for (const comment of comments) {
      const key = comment.parentCommentId?.toString() ?? "__root__"
      const bucket = grouped.get(key) ?? []
      bucket.push(comment)
      grouped.set(key, bucket)
    }

    return grouped
  }, [comments])

  const topLevelComments = commentsByParent.get("__root__") ?? []

  const handleToggleReaction = async (
    commentId: Id<"changeComments">,
    emoji: string
  ) => {
    if (!viewerUserId) return
    const pendingKey = `${commentId}:${emoji}`
    setPendingReactionKey(pendingKey)
    try {
      await toggleCommentReaction({
        commentId,
        userId: viewerUserId,
        emoji,
      })
    } catch (error) {
      console.error("Failed to toggle comment reaction:", error)
    } finally {
      setPendingReactionKey((current) => (current === pendingKey ? null : current))
    }
  }

  const handleSubmitReply = async (parentCommentId: Id<"changeComments">) => {
    if (!viewerUserId) return
    const draft = replyDraftByComment[parentCommentId.toString()]?.trim()
    if (!draft) return

    const pendingKey = parentCommentId.toString()
    setSubmittingReplyFor(pendingKey)
    try {
      await addComment({
        changeId,
        userId: viewerUserId,
        content: draft,
        parentCommentId,
      })
      setReplyDraftByComment((current) => ({ ...current, [pendingKey]: "" }))
      setReplyingToCommentId(null)
    } catch (error) {
      console.error("Failed to add reply:", error)
    } finally {
      setSubmittingReplyFor((current) => (current === pendingKey ? null : current))
    }
  }

  if (!comments || comments.length === 0) return null

  const renderComment = (comment: ChangeComment, depth: number) => {
    const nestedReplies = commentsByParent.get(comment.id.toString()) ?? []
    const replyKey = comment.id.toString()
    const replyDraft = replyDraftByComment[replyKey] ?? ""
    const isReplyComposerOpen = replyingToCommentId === comment.id
    const isSubmittingReply = submittingReplyFor === replyKey
    const thumbsReaction = comment.reactions.find((reaction) => reaction.emoji === "👍")
    const thumbsCount = thumbsReaction?.count ?? 0
    const thumbsReactedByViewer = thumbsReaction?.reactedByViewer ?? false

    const extraReactions = comment.reactions.filter((reaction) => reaction.emoji !== "👍")

    return (
      <div key={comment.id} className={cn("flex gap-3", depth === 0 ? "pb-4" : "pb-3")}>
        {comment.userImage ? (
          <img
            src={comment.userImage}
            alt={comment.userName}
            className={cn(
              "rounded-full object-cover shrink-0",
              depth === 0 ? "w-10 h-10" : "w-8 h-8"
            )}
          />
        ) : (
          <div
            className={cn(
              "rounded-full flex items-center justify-center font-medium text-white shrink-0",
              depth === 0 ? "w-10 h-10 text-sm" : "w-8 h-8 text-xs"
            )}
            style={{ backgroundColor: comment.userColor }}
          >
            {comment.userName?.charAt(0).toUpperCase() || 'U'}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 min-w-0">
            <span className="text-sm font-semibold truncate shrink min-w-0">{comment.userName}</span>
            <span className="text-xs text-muted-foreground shrink-0">•</span>
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
              {formatRelativeTime(comment.createdAt)}
            </span>
          </div>

          <p className="text-sm text-foreground/90 whitespace-pre-wrap mb-3">{comment.content}</p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleReaction(comment.id, "👍")}
              disabled={!viewerUserId || pendingReactionKey === `${comment.id}:👍`}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
                thumbsReactedByViewer
                  ? "bg-primary/15 text-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span>👍</span>
              <span>{thumbsCount}</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!viewerUserId}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted/50 hover:bg-muted text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <Smile className="h-4 w-4" />
                  <span>+</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-0">
                {["❤️", "🎉", "😄", "🚀"].map((emoji) => (
                  <DropdownMenuItem
                    key={emoji}
                    onClick={() => void handleToggleReaction(comment.id, emoji)}
                    disabled={pendingReactionKey === `${comment.id}:${emoji}`}
                    className="text-base"
                  >
                    {emoji}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-muted-foreground/50">•</span>

            <button
              type="button"
              onClick={() => setReplyingToCommentId(comment.id)}
              disabled={!viewerUserId}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Reply
            </button>
          </div>

          {extraReactions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {extraReactions.map((reaction) => (
                <button
                  key={`${comment.id}-${reaction.emoji}`}
                  type="button"
                  onClick={() => void handleToggleReaction(comment.id, reaction.emoji)}
                  disabled={!viewerUserId || pendingReactionKey === `${comment.id}:${reaction.emoji}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
                    reaction.reactedByViewer
                      ? "bg-primary/15 text-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              ))}
            </div>
          )}

          {isReplyComposerOpen && (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
              <Textarea
                value={replyDraft}
                onChange={(event) =>
                  setReplyDraftByComment((current) => ({
                    ...current,
                    [replyKey]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    void handleSubmitReply(comment.id)
                  }
                }}
                placeholder={`Reply to ${comment.userName}`}
                className="min-h-[72px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-md bg-background"
                disabled={isSubmittingReply}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplyingToCommentId(null)
                    setReplyDraftByComment((current) => ({ ...current, [replyKey]: "" }))
                  }}
                  disabled={isSubmittingReply}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSubmitReply(comment.id)}
                  disabled={!viewerUserId || !replyDraft.trim() || isSubmittingReply}
                >
                  Send Reply
                </Button>
              </div>
            </div>
          )}

          {nestedReplies.length > 0 && (
            <div className="mt-3 border-l border-border/60 pl-4 space-y-3">
              {nestedReplies.map((reply) => renderComment(reply, depth + 1))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ml-[88px] mt-2 mb-3">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setIsExpanded((current) => !current)
        }}
        className="text-xs font-medium text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
      >
        {isExpanded ? 'Hide' : 'Show'} {topLevelComments.length} {topLevelComments.length === 1 ? 'comment' : 'comments'}
      </button>

      {isExpanded && (
        <div className="relative">
          <div className="absolute left-[19px] top-0 bottom-0 flex flex-col items-center pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-border shrink-0" />
            <div
              className="w-px flex-1 border-l border-dashed border-border"
              style={{
                maskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
              }}
            />
          </div>

          <div className="space-y-0 pl-12">
            {topLevelComments.map((comment) => renderComment(comment, 0))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ChangesPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentOrganization, convexUserId } = useAuth()
  const [selectedChangeId, setSelectedChangeId] = useState<Id<"fileChanges"> | null>(null)
  const selectedUserId = searchParams.get('userId')

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
  ) as ActivityFeedItem[] | undefined

  const filteredActivity = useMemo(() => {
    if (!activity) return activity
    if (!selectedUserId) return activity
    return activity.filter((item) => item.userId === selectedUserId)
  }, [activity, selectedUserId])

  const selectedFilterUserName = useMemo(() => {
    if (!selectedUserId || !activity) return null
    return activity.find((item) => item.userId === selectedUserId)?.userName ?? null
  }, [activity, selectedUserId])

  // Get comment counts for all changes
  const changeIds = filteredActivity?.map(item => item.id as Id<"fileChanges">) || []
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    changeIds.length > 0 ? { changeIds } : 'skip'
  )
  const selectedChange = useQuery(
    api.activity.getChangeWithContent,
    selectedChangeId ? { changeId: selectedChangeId } : 'skip'
  ) as SelectedChangeSummary | null | undefined
  const isFeedLoading = !project?._id || activity === undefined
  const showSplitPane = Boolean(selectedChangeId) || isFeedLoading
  const [cachedSelectedChange, setCachedSelectedChange] = useState<SelectedChangeSummary | null>(null)
  const displayedSelectedChange = selectedChange ?? cachedSelectedChange
  const isSelectedChangeLoading = Boolean(selectedChangeId) && selectedChange === undefined

  useEffect(() => {
    if (!selectedChangeId) {
      setCachedSelectedChange(null)
      return
    }

    if (selectedChange) {
      setCachedSelectedChange(selectedChange)
      return
    }

    if (selectedChange === null) {
      setCachedSelectedChange(null)
    }
  }, [selectedChange, selectedChangeId])

  // Auto-select the most recent change when activity loads
  useEffect(() => {
    if (!filteredActivity || filteredActivity.length === 0) {
      setSelectedChangeId(null)
      return
    }

    const selectedStillVisible = selectedChangeId
      ? filteredActivity.some((item) => item.id === selectedChangeId)
      : false

    if (selectedChangeId === null || !selectedStillVisible) {
      setSelectedChangeId(filteredActivity[0].id as Id<"fileChanges">)
    }
  }, [filteredActivity, selectedChangeId])

  // Mark sync feed as seen when page loads
  useEffect(() => {
    if (slug) {
      markSyncFeedAsSeen(slug)
    }
  }, [slug])

  const headerControls = useMemo(
    () => (
      <div className="flex items-center gap-2">
        {selectedChangeId && displayedSelectedChange && (
          <>
            <div className="flex items-center gap-2 min-w-0 max-w-[420px]">
              {getChangeIcon(displayedSelectedChange.changeType)}
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-xs min-w-0 max-w-[260px]">
                {getFileIcon(displayedSelectedChange.filePath.split('/').pop() || displayedSelectedChange.filePath, {
                  width: 14,
                  height: 14,
                })}
                <span className="truncate">
                  {displayedSelectedChange.filePath.split('/').pop() || displayedSelectedChange.filePath}
                </span>
              </span>
              {isSelectedChangeLoading && (
                <Shimmer className="text-[11px] text-muted-foreground">Updating…</Shimmer>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {displayedSelectedChange.userImage ? (
                <img
                  src={displayedSelectedChange.userImage}
                  alt={displayedSelectedChange.userName}
                  className="h-4 w-4 rounded-full object-cover"
                  title={displayedSelectedChange.userName}
                />
              ) : (
                <div
                  className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-medium text-white"
                  style={{ backgroundColor: displayedSelectedChange.userColor }}
                  title={displayedSelectedChange.userName}
                >
                  {displayedSelectedChange.userName?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(displayedSelectedChange.timestamp)}
              </span>
            </div>
          </>
        )}
        {selectedChangeId && !displayedSelectedChange && (
          <Shimmer className="text-xs text-muted-foreground">Loading selected change…</Shimmer>
        )}
        {!selectedChangeId && (
          <span className="text-xs text-muted-foreground">Select a change to view diff</span>
        )}
      </div>
    ),
    [displayedSelectedChange, isSelectedChangeLoading, selectedChangeId]
  )

  useProjectHeader(headerControls)

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-sidebar/60">
      {/* Timeline Panel */}
      <div className={`flex min-h-0 min-w-0 overflow-hidden flex-col ${showSplitPane ? 'w-1/2' : 'w-full'} transition-all`}>
        {/* Timeline Content */}
        <div className="relative flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              {!project?._id ? (
                <FeedLoadingRows />
              ) : filteredActivity === undefined ? (
                <FeedLoadingRows />
              ) : filteredActivity.length === 0 ? (
                <Card className="p-12 text-center">
                  <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No Changes Yet</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedUserId
                      ? "No changes found for this user in the current feed window."
                      : "File changes will appear here in real-time as you and your team edit files."}
                  </p>
                </Card>
              ) : (
                <div className="space-y-6">
                  {selectedUserId && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[11px]">
                        {selectedFilterUserName
                          ? `Filtered by ${selectedFilterUserName}`
                          : "Filtered by selected user"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          const nextParams = new URLSearchParams(searchParams)
                          nextParams.delete('userId')
                          setSearchParams(nextParams, { replace: true })
                        }}
                      >
                        Clear filter
                      </Button>
                    </div>
                  )}
                  {groupActivityByDate(filteredActivity).map((group) => (
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
                                flex items-start gap-3 py-2 px-3 rounded-full cursor-pointer transition-colors
                                ${selectedChangeId === item.id
                                  ? 'bg-primary/10'
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
                                <span className="font-medium text-sm truncate max-w-[120px]" title={item.userName}>
                                  {item.userName}
                                </span>
                                {getChangeIcon(item.changeType)}
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-xs shrink min-w-0 max-w-[180px]">
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
                              <ChangeComments
                                changeId={item.id as Id<"fileChanges">}
                                viewerUserId={convexUserId ?? null}
                              />
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
          <div className="pointer-events-none absolute left-0 right-0 top-0 h-8 bg-gradient-to-b from-sidebar to-transparent z-10" />
          <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-t from-sidebar to-transparent z-10" />
        </div>
      </div>

      {/* Diff Panel */}
      {showSplitPane && (
        <div className="w-1/2 min-h-0 min-w-0 overflow-hidden bg-background">
          {selectedChangeId ? (
            <DiffPanel
              changeId={selectedChangeId}
              onClose={() => setSelectedChangeId(null)}
              showHeader={false}
            />
          ) : (
            <DiffPanelLoadingShell />
          )}
        </div>
      )}
      {showSplitPane && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 -translate-x-1/2">
          <div
            className="h-full w-px bg-border"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
            }}
          />
        </div>
      )}
    </div>
  )
}
