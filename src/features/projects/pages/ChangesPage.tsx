

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon as __PlusHugeIcon, ArrowLeftRightIcon as __MessageSquareHugeIcon, Cancel01Icon as __XHugeIcon, ChartBarBigIcon as __ActivityHugeIcon, CpuChargeIcon as __BotHugeIcon, FaceIdIcon as __SmileHugeIcon, MinusSignIcon as __MinusHugeIcon, SparklesIcon as __AsteriskHugeIcon } from '@hugeicons/core-free-icons'

const Shimmer = (props: any) => <div className={`animate-pulse bg-muted rounded ${props.className || 'h-4 w-full'}`} />;
import { memo, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from '@/lib/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { useCachedQuery } from '@/stores/useQueryCache'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { GroupedVirtuoso } from 'react-virtuoso'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DiffPanel, type ChangeWithContent } from '../components/changes/DiffPanel'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import { CommentRichText } from '@/components/comments/CommentRichText'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import {
  getProjectChangesActivityCacheKey,
  getProjectChangesSelectedChangeCacheKey,
} from '@/features/projects/lib/changesQueryCache'

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
  isEmbedded: boolean
  isSelected: boolean
  expandOnSelect: boolean
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

interface ChangesPageProps {
  presentation?: 'modal' | 'embedded'
  onRequestClose?: (() => void) | null
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
          <HugeiconsIcon icon={__PlusHugeIcon} className={`${baseClasses} text-green-500`} />
        </span>
      )
    case 'delete':
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary">
          <HugeiconsIcon icon={__MinusHugeIcon} className={`${baseClasses} text-red-500`} />
        </span>
      )
    case 'modify':
    default:
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary">
          <HugeiconsIcon icon={__AsteriskHugeIcon} className={`${baseClasses} text-amber-500`} />
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
  isEmbedded,
  isSelected,
  expandOnSelect,
  isExpanded,
  onExpandedChange,
}: ChangeCommentsProps) {
  const comments = useQuery(
    api.activity.getCommentsForChange,
    commentCount > 0 && isExpanded
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
      onExpandedChange(true)
    }
  }, [expandOnSelect, isSelected, onExpandedChange])

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
                  <HugeiconsIcon icon={__SmileHugeIcon} className="h-4 w-4" />
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
          onExpandedChange(!isExpanded)
        }}
        className="text-xs font-medium text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
      >
        {isExpanded ? 'Hide' : 'Show'} {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
      </button>
      <div
        aria-hidden={!isExpanded}
        className={cn(
          "grid overflow-hidden",
          isEmbedded
            ? isExpanded
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr]"
            : isExpanded
              ? "grid-rows-[1fr] opacity-100 translate-y-0"
              : "grid-rows-[0fr] opacity-0 -translate-y-1",
          !isEmbedded && "transition-[grid-template-rows,opacity,transform] duration-300 ease-out",
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

interface ActivityFeedRowProps {
  item: ActivityFeedItem
  isSelected: boolean
  isEmbedded: boolean
  viewerUserId: Id<"users"> | null
  commentCount: number
  expandCommentsOnSelect: boolean
  commentsExpanded: boolean
  onCommentsExpandedChange: (expanded: boolean) => void
  onSelect: () => void
}

const ActivityFeedRow = memo(function ActivityFeedRow({
  item,
  isSelected,
  isEmbedded,
  viewerUserId,
  commentCount,
  expandCommentsOnSelect,
  commentsExpanded,
  onCommentsExpandedChange,
  onSelect,
}: ActivityFeedRowProps) {
  const rowChangeId = item.id as Id<"fileChanges">

  return (
    <div>
      <div
        onClick={onSelect}
        className={cn(
          'flex items-start gap-3 rounded-full px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
        )}
      >
        <div className="w-20 shrink-0 pt-1 mr-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatTimeOnly(item.timestamp)}
          </span>
        </div>

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
                <HugeiconsIcon icon={__BotHugeIcon} className="h-4 w-4" />
              ) : (
                item.userName?.charAt(0).toUpperCase() || 'U'
              )}
            </div>
          )}
        </div>

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
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto">
              <HugeiconsIcon icon={__MessageSquareHugeIcon} className="h-3 w-3" />
              {commentCount}
            </span>
          )}
        </div>
      </div>
      {commentCount > 0 && (
        <ChangeComments
          changeId={rowChangeId}
          viewerUserId={viewerUserId}
          commentCount={commentCount}
          isEmbedded={isEmbedded}
          isSelected={isSelected}
          expandOnSelect={expandCommentsOnSelect}
          isExpanded={commentsExpanded}
          onExpandedChange={onCommentsExpandedChange}
        />
      )}
    </div>
  )
})
ActivityFeedRow.displayName = 'ActivityFeedRow'

export function ChangesPage({
  presentation = 'modal',
  onRequestClose = null,
}: ChangesPageProps = {}) {
  const isEmbedded = presentation === 'embedded'
  const navigate = useViewTransitionNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()
  const [selectedChangeId, setSelectedChangeId] = useState<Id<"fileChanges"> | null>(null)
  const [selectionWasUserDriven, setSelectionWasUserDriven] = useState(false)
  const [expandedCommentChangeIds, setExpandedCommentChangeIds] = useState<Record<string, boolean>>({})
  const selectedUserId = searchParams.get('userId')

  // Get activity feed
  const freshActivity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 100 } : 'skip'
  ) as ActivityFeedItem[] | undefined
  const activity = useCachedQuery<ActivityFeedItem[] | undefined>(
    project?._id ? getProjectChangesActivityCacheKey(project._id) : '__skip__',
    freshActivity,
  )

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
    project?._id && changeIds.length > 0 ? { projectId: project._id, changeIds } : 'skip'
  )
  const resolvedSelectedChangeId =
    selectedChangeId ??
    (!selectionWasUserDriven && filteredActivity && filteredActivity.length > 0
      ? (filteredActivity[0].id as Id<"fileChanges">)
      : null)
  const freshSelectedChange = useQuery(
    api.activity.getChangeWithContent,
    resolvedSelectedChangeId ? { changeId: resolvedSelectedChangeId } : 'skip'
  ) as ChangeWithContent | null | undefined
  const displayedSelectedChange = useCachedQuery<ChangeWithContent | null | undefined>(
    resolvedSelectedChangeId ? getProjectChangesSelectedChangeCacheKey(resolvedSelectedChangeId) : '__skip__',
    freshSelectedChange,
  )
  const isSelectedChangeLoading =
    Boolean(resolvedSelectedChangeId) &&
    freshSelectedChange === undefined &&
    displayedSelectedChange === undefined
  const showSplitPane = Boolean(resolvedSelectedChangeId)
  const groupedActivity = useMemo(
    () => (filteredActivity ? groupActivityByDate(filteredActivity) : []),
    [filteredActivity]
  )
  const flatActivity = useMemo(
    () => groupedActivity.flatMap((group) => group.items),
    [groupedActivity]
  )
  const groupCounts = useMemo(
    () => groupedActivity.map((group) => group.items.length),
    [groupedActivity]
  )

  useEffect(() => {
    if (!filteredActivity || filteredActivity.length === 0) {
      if (selectedChangeId !== null) {
        setSelectionWasUserDriven(false)
        setSelectedChangeId(null)
      }
      return
    }

    const selectedStillVisible = selectedChangeId
      ? filteredActivity.some((item) => item.id === selectedChangeId)
      : false

    if (selectedChangeId !== null && !selectedStillVisible) {
      setSelectionWasUserDriven(false)
      setSelectedChangeId(null)
    }
  }, [filteredActivity, selectedChangeId])

  useEffect(() => {
    if (!filteredActivity) {
      return
    }

    const visibleIds = new Set(filteredActivity.map((item) => item.id.toString()))
    setExpandedCommentChangeIds((current) => {
      let changed = false
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(current)) {
        if (value && visibleIds.has(key)) {
          next[key] = value
        } else if (value) {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [filteredActivity])

  // Mark sync feed as seen when page loads
  useEffect(() => {
    if (project?.slug) {
      markSyncFeedAsSeen(project.slug)
    }
  }, [project?.slug])
  const projectWorkbenchPath = project?._id ? buildProjectPath(String(project._id), 'workbench') : '/projects'

  function closeChangesModal(): void {
    if (isEmbedded) {
      onRequestClose?.()
      return
    }
    navigate(projectWorkbenchPath, { replace: true })
  }

  useEffect(() => {
    if (isEmbedded) return
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeChangesModal()
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isEmbedded, projectWorkbenchPath])

  const shell = (
    <div
      role={isEmbedded ? undefined : 'dialog'}
      aria-modal={isEmbedded ? undefined : true}
      aria-labelledby={isEmbedded ? undefined : 'changes-modal-title'}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-background',
        !isEmbedded &&
          'max-w-6xl rounded-[32px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={cn("border-b border-border/60", isEmbedded ? "px-4 py-3" : "px-6 py-5")}>
        {!isEmbedded ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 id="changes-modal-title" className="text-xl font-semibold text-foreground">
                Changes
              </h1>
            </div>

            <button
              type="button"
              onClick={closeChangesModal}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Close changes"
            >
              <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className={cn("flex items-center gap-2 min-w-0", !isEmbedded && "mt-4")}>
          {resolvedSelectedChangeId && displayedSelectedChange && (
            <>
              <div className="flex items-center gap-2 min-w-0 max-w-[520px]">
                {getChangeIcon(displayedSelectedChange.changeType)}
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
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
          {!resolvedSelectedChangeId && (
            <span className="text-xs text-muted-foreground">Select a change to view diff</span>
          )}
        </div>
      </div>

      <div className="relative flex h-full min-h-0 overflow-hidden bg-content-surface">
        <div
          className={cn(
            "flex min-h-0 min-w-0 overflow-hidden flex-col",
            showSplitPane ? "w-1/2" : "w-full",
            !isEmbedded && "transition-all",
          )}
        >
          <div className="relative flex-1 min-h-0">
            <div className="flex h-full min-h-0 flex-col p-4">
              {!project?._id ? (
                null
              ) : filteredActivity === undefined ? (
                null
              ) : filteredActivity.length === 0 ? (
                <Card className="p-12 text-center">
                  <HugeiconsIcon icon={__ActivityHugeIcon} className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No Changes Yet</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedUserId
                      ? "No changes found for this user in the current feed window."
                      : "File changes will appear here in real-time as you and your team edit files."}
                  </p>
                </Card>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-6">
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
                  <div className="min-h-0 flex-1">
                    <GroupedVirtuoso
                      data={flatActivity}
                      groupCounts={groupCounts}
                      defaultItemHeight={60}
                      increaseViewportBy={{ top: 360, bottom: 720 }}
                      style={{ height: '100%' }}
                      computeItemKey={(_index, item) => item.id}
                      groupContent={(groupIndex) => (
                        <div className="bg-content-surface px-1 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-muted-foreground tracking-wider">
                              {groupedActivity[groupIndex]?.dateHeader ?? ''}
                            </span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                        </div>
                      )}
                      itemContent={(_index, _groupIndex, item) => {
                        const itemId = item.id.toString()
                        const rowChangeId = item.id as Id<"fileChanges">
                        const commentCount = commentCounts?.[item.id] ?? 0

                        return (
                          <div className="px-1 py-0.5">
                            <ActivityFeedRow
                              item={item}
                              isSelected={resolvedSelectedChangeId === item.id}
                              isEmbedded={isEmbedded}
                              viewerUserId={convexUserId ?? null}
                              commentCount={commentCount}
                              expandCommentsOnSelect={selectionWasUserDriven && resolvedSelectedChangeId === item.id}
                              commentsExpanded={expandedCommentChangeIds[itemId] ?? false}
                              onCommentsExpandedChange={(expanded) => {
                                setExpandedCommentChangeIds((current) => {
                                  if ((current[itemId] ?? false) === expanded) {
                                    return current
                                  }
                                  if (!expanded) {
                                    const next = { ...current }
                                    delete next[itemId]
                                    return next
                                  }
                                  return {
                                    ...current,
                                    [itemId]: true,
                                  }
                                })
                              }}
                              onSelect={() => {
                                setSelectionWasUserDriven(true)
                                setSelectedChangeId(rowChangeId)
                              }}
                            />
                          </div>
                        )
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {showSplitPane && (
          <div className="w-1/2 min-h-0 min-w-0 overflow-hidden bg-background">
            {resolvedSelectedChangeId ? (
              <DiffPanel
                changeId={resolvedSelectedChangeId}
                change={displayedSelectedChange}
                isLoadingChange={isSelectedChangeLoading}
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
    </div>
  )

  return (
    <>
      {!isEmbedded ? (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
          onClick={closeChangesModal}
          aria-hidden="true"
        />
      ) : null}
      {!isEmbedded ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 sm:p-6 sm:pt-14">
          {shell}
        </div>
      ) : (
        shell
      )}
    </>
  )
}
