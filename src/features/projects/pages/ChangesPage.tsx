const Shimmer = (props: any) => <div className={`animate-pulse bg-muted rounded ${props.className || 'h-4 w-full'}`} />;
import { memo, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from '@/lib/router'
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
import { CommentRichText } from '@/components/comments/CommentRichText'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'

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

interface ChangeCommentsProps {
  changeId: Id<"fileChanges">
  viewerUserId: Id<"users"> | null
  commentCount: number
  isSelected: boolean
  shouldPreload: boolean
  expandOnSelect: boolean
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

// Component to display comments for a change
const ChangeComments = memo(function ChangeComments({
  changeId,
  viewerUserId,
  commentCount,
  isSelected,
  shouldPreload,
  expandOnSelect,
}: ChangeCommentsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const comments = useQuery(
    api.activity.getCommentsForChange,
    commentCount > 0 && (isExpanded || shouldPreload)
      ? {
          changeId,
          viewerUserId: viewerUserId ?? undefined,
        }
      : "skip"
  ) as ChangeComment[] | undefined
  const addComment = useMutation(api.activity.addComment)
  const toggleCommentReaction = useMutation(api.activity.toggleCommentReaction)
  const [replyingToCommentId, setReplyingToCommentId] = useState<Id<"changeComments"> | null>(null)
  const [replyDraftByComment, setReplyDraftByComment] = useState<Record<string, string>>({})
  const [submittingReplyFor, setSubmittingReplyFor] = useState<string | null>(null)
  const [pendingReactionKey, setPendingReactionKey] = useState<string | null>(null)

  useEffect(() => {
    if (isSelected && expandOnSelect) {
      setIsExpanded(true)
    }
  }, [expandOnSelect, isSelected])

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

  if (commentCount <= 0) return null

  const renderComment = (comment: ChangeComment, depth: number) => {
    const nestedReplies =
      depth === 0 ? commentsByParent.get(comment.id.toString()) ?? [] : []
    const replyKey = comment.id.toString()
    const replyDraft = replyDraftByComment[replyKey] ?? ""
    const isReplyComposerOpen = depth === 0 && replyingToCommentId === comment.id
    const isSubmittingReply = submittingReplyFor === replyKey
    const thumbsReaction = comment.reactions.find((reaction) => reaction.emoji === "👍")
    const nonThumbReactions = comment.reactions
      .filter((reaction) => reaction.emoji !== "👍")
      .sort((a, b) => b.count - a.count)
    const reactionPillItems: ChangeCommentReaction[] = [
      {
        emoji: "👍",
        count: thumbsReaction?.count ?? 0,
        reactedByViewer: thumbsReaction?.reactedByViewer ?? false,
      },
      ...nonThumbReactions,
    ]
    const hasManyReactionTypes = reactionPillItems.length > 4

    return (
      <div key={comment.id} className={cn("flex gap-3", depth === 0 ? "pb-4" : "pb-3")}>
        {comment.userImage ? (
          <img
            src={comment.userImage}
            alt={comment.userName}
            className="h-8 w-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
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

          <CommentRichText
            content={comment.content}
            className="text-sm text-foreground/90 mb-3"
          />

          <div className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex rounded-full bg-muted/50 p-1",
                hasManyReactionTypes && "max-w-[220px] overflow-x-auto scrollbar-hide"
              )}
            >
              <div className="inline-flex items-center gap-1">
                {reactionPillItems.map((reaction) => (
                  <button
                    key={`${comment.id}:${reaction.emoji}`}
                    type="button"
                    onClick={() => void handleToggleReaction(comment.id, reaction.emoji)}
                    disabled={!viewerUserId || pendingReactionKey === `${comment.id}:${reaction.emoji}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                ))}
              </div>
            </div>

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

            {depth === 0 && (
              <>
                <span className="text-muted-foreground/50">•</span>

                <button
                  type="button"
                  onClick={() => setReplyingToCommentId(comment.id)}
                  disabled={!viewerUserId}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Reply
                </button>
              </>
            )}
          </div>

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
        {isExpanded ? 'Hide' : 'Show'} {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
      </button>
      <div
        aria-hidden={!isExpanded}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-300 ease-out",
          isExpanded
            ? "grid-rows-[1fr] opacity-100 translate-y-0"
            : "grid-rows-[0fr] opacity-0 -translate-y-1"
        )}
      >
        <div className="min-h-0">
          <div className="relative min-h-12">
            {comments === undefined ? (
              <Shimmer className="text-xs text-muted-foreground">Loading comments…</Shimmer>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
ChangeComments.displayName = "ChangeComments"

export function ChangesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()
  const [selectedChangeId, setSelectedChangeId] = useState<Id<"fileChanges"> | null>(null)
  const [selectionWasUserDriven, setSelectionWasUserDriven] = useState(false)
  const [backgroundPreloadIds, setBackgroundPreloadIds] = useState<Id<"fileChanges">[]>([])
  const selectedUserId = searchParams.get('userId')

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
  const changeIds = useMemo(
    () => filteredActivity?.map((item) => item.id as Id<"fileChanges">) ?? [],
    [filteredActivity]
  )
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    changeIds.length > 0 ? { changeIds } : 'skip'
  )
  const selectedChange = useQuery(
    api.activity.getChangeWithContent,
    selectedChangeId ? { changeId: selectedChangeId } : 'skip'
  ) as SelectedChangeSummary | null | undefined
  const showSplitPane = Boolean(selectedChangeId)
  const [cachedSelectedChange, setCachedSelectedChange] = useState<SelectedChangeSummary | null>(null)
  const displayedSelectedChange = selectedChange ?? cachedSelectedChange
  const isSelectedChangeLoading = Boolean(selectedChangeId) && selectedChange === undefined
  const groupedActivity = useMemo(
    () => (filteredActivity ? groupActivityByDate(filteredActivity) : []),
    [filteredActivity]
  )
  const latestChangeId = filteredActivity?.[0]?.id as Id<"fileChanges"> | undefined
  const backgroundPreloadIdSet = useMemo(
    () => new Set(backgroundPreloadIds.map((id) => id.toString())),
    [backgroundPreloadIds]
  )

  const [prevSelectedChangeDeps, setPrevSelectedChangeDeps] = useState({ selectedChange, selectedChangeId })
  if (selectedChange !== prevSelectedChangeDeps.selectedChange || selectedChangeId !== prevSelectedChangeDeps.selectedChangeId) {
    setPrevSelectedChangeDeps({ selectedChange, selectedChangeId })
    if (!selectedChangeId) {
      setCachedSelectedChange(null)
    } else if (selectedChange) {
      setCachedSelectedChange(selectedChange)
    } else if (selectedChange === null) {
      setCachedSelectedChange(null)
    }
  }

  // Auto-select the most recent change when activity loads
  const [prevActivityDeps, setPrevActivityDeps] = useState({ filteredActivity, selectedChangeId })
  if (filteredActivity !== prevActivityDeps.filteredActivity || selectedChangeId !== prevActivityDeps.selectedChangeId) {
    setPrevActivityDeps({ filteredActivity, selectedChangeId })
    if (!filteredActivity || filteredActivity.length === 0) {
      setSelectionWasUserDriven(false)
      setSelectedChangeId(null)
    } else {
      const selectedStillVisible = selectedChangeId
        ? filteredActivity.some((item) => item.id === selectedChangeId)
        : false

      if (selectedChangeId === null || !selectedStillVisible) {
        setSelectionWasUserDriven(false)
        setSelectedChangeId(filteredActivity[0].id as Id<"fileChanges">)
      }
    }
  }

  const [prevPreloadDeps, setPrevPreloadDeps] = useState({ filteredActivity, latestChangeId })
  if (filteredActivity !== prevPreloadDeps.filteredActivity || latestChangeId !== prevPreloadDeps.latestChangeId) {
    setPrevPreloadDeps({ filteredActivity, latestChangeId })
    if (!filteredActivity || filteredActivity.length === 0 || !latestChangeId) {
      setBackgroundPreloadIds([])
    } else {
      const deferredIds = filteredActivity
        .map((item) => item.id as Id<"fileChanges">)
        .filter((id) => id !== latestChangeId)

      if (deferredIds.length === 0) {
        setBackgroundPreloadIds([])
      } else {
        setBackgroundPreloadIds([])
      }
    }
  }

  useEffect(() => {
    if (!filteredActivity || filteredActivity.length === 0 || !latestChangeId) {
      return
    }

    const deferredIds = filteredActivity
      .map((item) => item.id as Id<"fileChanges">)
      .filter((id) => id !== latestChangeId)

    if (deferredIds.length === 0) {
      return
    }

    const preloadBatchSize = 6
    let cursor = 0
    let cancelled = false
    const canUseIdleCallbacks =
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function" &&
      typeof window.cancelIdleCallback === "function"
    const idleHandles: number[] = []
    const timeoutHandles: Array<ReturnType<typeof setTimeout>> = []

    const preloadNextBatch = () => {
      if (cancelled || cursor >= deferredIds.length) return

      const batch = deferredIds.slice(cursor, cursor + preloadBatchSize)
      cursor += preloadBatchSize

      setBackgroundPreloadIds((current) => {
        if (batch.length === 0) return current
        const existing = new Set(current.map((id) => id.toString()))
        const next = [...current]
        for (const id of batch) {
          const key = id.toString()
          if (!existing.has(key)) {
            existing.add(key)
            next.push(id)
          }
        }
        return next
      })

      scheduleNextBatch()
    }

    const scheduleNextBatch = () => {
      if (cancelled || cursor >= deferredIds.length) return
      if (canUseIdleCallbacks) {
        const handle = window.requestIdleCallback(
          () => preloadNextBatch(),
          { timeout: 1200 }
        )
        idleHandles.push(handle)
        return
      }

      const timeoutHandle = globalThis.setTimeout(() => preloadNextBatch(), 120)
      timeoutHandles.push(timeoutHandle)
    }

    scheduleNextBatch()

    return () => {
      cancelled = true
      if (canUseIdleCallbacks) {
        for (const handle of idleHandles) {
          window.cancelIdleCallback(handle)
        }
      }
      for (const handle of timeoutHandles) {
        globalThis.clearTimeout(handle)
      }
    }
  }, [filteredActivity, latestChangeId])

  // Mark sync feed as seen when page loads
  useEffect(() => {
    if (project?.slug) {
      markSyncFeedAsSeen(project.slug)
    }
  }, [project?.slug])

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
    <div className="relative flex h-full min-h-0 overflow-hidden bg-content-surface">
      {/* Timeline Panel */}
      <div className={`flex min-h-0 min-w-0 overflow-hidden flex-col ${showSplitPane ? 'w-1/2' : 'w-full'} transition-all`}>
        {/* Timeline Content */}
        <div className="relative flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              {!project?._id ? (
                null
              ) : filteredActivity === undefined ? (
                null
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
                          setSearchParams(Object.fromEntries(nextParams.entries()) as any)
                        }}
                      >
                        Clear filter
                      </Button>
                    </div>
                  )}
                  {groupedActivity.map((group) => (
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
                        {group.items.map((item) => {
                          const rowChangeId = item.id as Id<"fileChanges">
                          const shouldPreloadRowComments =
                            rowChangeId === latestChangeId ||
                            backgroundPreloadIdSet.has(rowChangeId.toString())

                          return (
                            <div key={item.id}>
                            <div
                              onClick={() => {
                                setSelectionWasUserDriven(true)
                                setSelectedChangeId(rowChangeId)
                              }}
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
                                changeId={rowChangeId}
                                viewerUserId={convexUserId ?? null}
                                commentCount={commentCounts[item.id]}
                                isSelected={selectedChangeId === item.id}
                                shouldPreload={shouldPreloadRowComments}
                                expandOnSelect={selectionWasUserDriven && selectedChangeId === item.id}
                              />
                            )}
                          </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
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
          ) : null}
        </div>
      )}
      {showSplitPane && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 -translate-x-1/2">
          <div className="h-full w-px bg-border" />
        </div>
      )}
    </div>
  )
}
