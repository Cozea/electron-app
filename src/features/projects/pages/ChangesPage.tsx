import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft02Icon as __ArrowLeftHugeIcon,
  BubbleChatIcon as __MessageSquareHugeIcon,
  Clock01Icon as __ClockHugeIcon,
  TransactionHistoryIcon as __ChangesHugeIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CommentRichText } from '@/components/comments/CommentRichText'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useOptionalProjectRouteContext } from '@/features/projects/contexts/ProjectRouteContext'
import { projectOpenDesktopClient } from '@/features/projects/lib/projectOpenDesktopClient'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { CheckpointDiffWorkerProvider } from '../components/changes/CheckpointDiffWorkerProvider'
import { CheckpointPatchView } from '../components/changes/CheckpointPatchView'

interface ActivityFeedItem {
  id: Id<'fileChanges'>
  checkpointGroupId?: string
  userId?: Id<'users'>
  filePath: string
  oldPath?: string
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  additions?: number
  deletions?: number
  totalLines?: number
  origin: 'user' | 'agent' | 'remote' | 'init'
  userName: string
  userColor: string
  userImage?: string
  isAgent?: boolean
  timestamp: number
}

interface ChangeComment {
  id: Id<'changeComments'>
  changeId: Id<'fileChanges'>
  userId: Id<'users'>
  parentCommentId?: Id<'changeComments'>
  content: string
  userName: string
  userColor: string
  userImage?: string
  createdAt: number
}

interface ChangesPageProps {
  presentation?: 'modal' | 'embedded'
  onRequestClose?: (() => void) | null
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const minutes = Math.floor(diffMs / 60_000)
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function resolvePreviousCheckpointGroupIds(items: readonly ActivityFeedItem[]): Map<string, string | null> {
  const uniqueGroups: string[] = []
  const seen = new Set<string>()

  for (const item of items) {
    if (!item.checkpointGroupId || seen.has(item.checkpointGroupId)) continue
    seen.add(item.checkpointGroupId)
    uniqueGroups.push(item.checkpointGroupId)
  }

  const previousByGroup = new Map<string, string | null>()
  for (let index = 0; index < uniqueGroups.length; index += 1) {
    previousByGroup.set(uniqueGroups[index], uniqueGroups[index + 1] ?? null)
  }

  const previousByChangeId = new Map<string, string | null>()
  for (const item of items) {
    previousByChangeId.set(
      String(item.id),
      item.checkpointGroupId ? (previousByGroup.get(item.checkpointGroupId) ?? null) : null,
    )
  }
  return previousByChangeId
}

function ChangeComments(props: {
  changeId: Id<'fileChanges'>
  viewerUserId: Id<'users'> | null
  count: number
  expanded: boolean
}) {
  const { changeId, viewerUserId, count, expanded } = props
  const comments = useQuery(
    api.activity.getCommentsForChange,
    expanded
      ? {
          changeId,
          viewerUserId: viewerUserId ?? undefined,
        }
      : 'skip',
  ) as ChangeComment[] | undefined
  const addComment = useMutation(api.activity.addComment)
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    const next = draft.trim()
    if (!next || !viewerUserId) return
    setIsSubmitting(true)
    try {
      await addComment({
        changeId,
        userId: viewerUserId,
        content: next,
      })
      setDraft('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-background/55 p-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-3.5" />
        <span>{count} comments</span>
      </div>

      <div className="space-y-3">
        {(comments ?? []).map((comment) => (
          <div key={String(comment.id)} className="rounded-lg border border-border/60 bg-card/55 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: comment.userColor }}
                />
                <span className="truncate text-xs font-medium text-foreground">{comment.userName}</span>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(comment.createdAt)}
              </span>
            </div>
            <CommentRichText content={comment.content} />
          </div>
        ))}

        {expanded && viewerUserId ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a comment about this change"
              className="min-h-[92px] resize-y border-border/70 bg-background"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || draft.trim().length === 0}
              >
                {isSubmitting ? 'Posting…' : 'Post Comment'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ChangeCard(props: {
  item: ActivityFeedItem
  gitCwd: string | null
  previousCheckpointGroupId: string | null
  commentCount: number
  viewerUserId: Id<'users'> | null
  expanded: boolean
  onToggle: () => void
}) {
  const {
    item,
    gitCwd,
    previousCheckpointGroupId,
    commentCount,
    viewerUserId,
    expanded,
    onToggle,
  } = props
  const [patch, setPatch] = useState<string | null>(null)
  const [isLoadingPatch, setIsLoadingPatch] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    if (!gitCwd || !item.checkpointGroupId) {
      setPatch(null)
      setPatchError('This change has no local checkpoint available yet.')
      return
    }

    let cancelled = false
    setIsLoadingPatch(true)
    setPatchError(null)

    void projectOpenDesktopClient.sync
      .gitDiffCheckpoints({
        projectPath: gitCwd,
        fromCheckpointId: previousCheckpointGroupId ?? undefined,
        toCheckpointId: item.checkpointGroupId,
        filePath: item.filePath,
      })
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setPatch(null)
          setPatchError(result.error ?? 'Failed to load patch.')
          return
        }
        setPatch(result.diff ?? '')
      })
      .catch((error) => {
        if (cancelled) return
        setPatch(null)
        setPatchError(error instanceof Error ? error.message : 'Failed to load patch.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPatch(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [expanded, gitCwd, item.checkpointGroupId, item.filePath, previousCheckpointGroupId])

  const titlePath =
    item.changeType === 'rename' && item.oldPath?.trim()
      ? `${item.oldPath} -> ${item.filePath}`
      : item.filePath

  return (
    <article className="rounded-2xl border border-border/70 bg-card/50 shadow-sm">
      <button
        type="button"
        className="flex w-full flex-col gap-3 p-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
              <span className="font-medium text-foreground">{item.userName}</span>
              <span className="text-muted-foreground/40">•</span>
              <span>{formatRelativeTime(item.timestamp)}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] text-foreground">{titlePath}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(item.timestamp)}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="border-border/70 bg-background/70 capitalize">
              {item.changeType}
            </Badge>
            {(item.additions ?? 0) > 0 ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                +{item.additions}
              </Badge>
            ) : null}
            {(item.deletions ?? 0) > 0 ? (
              <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
                -{item.deletions}
              </Badge>
            ) : null}
            {commentCount > 0 ? (
              <Badge variant="secondary" className="gap-1">
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-3" />
                {commentCount}
              </Badge>
            ) : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-border/70 px-4 pb-4 pt-3">
          {patchError ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {patchError}
            </div>
          ) : null}

          {isLoadingPatch ? (
            <div className="rounded-xl border border-border/70 bg-background/55 px-3 py-4 text-xs text-muted-foreground">
              Loading patch…
            </div>
          ) : (
            <CheckpointPatchView patch={patch} />
          )}

          <ChangeComments
            changeId={item.id}
            viewerUserId={viewerUserId}
            count={commentCount}
            expanded={expanded}
          />
        </div>
      ) : null}
    </article>
  )
}

export function ChangesPage({ presentation = 'modal', onRequestClose = null }: ChangesPageProps) {
  const { project, convexUserId } = useAccessibleProject()
  const routeContext = useOptionalProjectRouteContext()
  const gitCwd = routeContext?.gitCwd ?? null
  const [expandedChangeId, setExpandedChangeId] = useState<string | null>(null)

  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 200 } : 'skip',
  ) as ActivityFeedItem[] | undefined

  const changeIds = useMemo(
    () => activity?.map((item) => item.id as Id<'fileChanges'>) ?? [],
    [activity],
  )
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    project?._id && changeIds.length > 0 ? { projectId: project._id, changeIds } : 'skip',
  ) as Record<string, number> | undefined

  const previousCheckpointGroupIds = useMemo(
    () => resolvePreviousCheckpointGroupIds(activity ?? []),
    [activity],
  )

  useEffect(() => {
    if (!project?.slug) return
    markSyncFeedAsSeen(project.slug)
  }, [project?.slug])

  useEffect(() => {
    if (!activity?.length) {
      setExpandedChangeId(null)
      return
    }
    if (!expandedChangeId) {
      setExpandedChangeId(String(activity[0].id))
      return
    }
    const stillVisible = activity.some((item) => String(item.id) === expandedChangeId)
    if (!stillVisible) {
      setExpandedChangeId(String(activity[0].id))
    }
  }, [activity, expandedChangeId])

  return (
    <CheckpointDiffWorkerProvider>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <HugeiconsIcon icon={__ChangesHugeIcon} className="size-4 text-muted-foreground" />
              <span>Changes</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              T3-style inline diffs backed by local Git checkpoints.
            </p>
          </div>

          {presentation === 'embedded' && onRequestClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRequestClose}>
              <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="mr-1 size-4" />
              Back
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!project ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              Project unavailable.
            </div>
          ) : activity === undefined ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              Loading changes…
            </div>
          ) : activity.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <HugeiconsIcon icon={__ClockHugeIcon} className="size-8 text-muted-foreground/35" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No changes yet</p>
                <p className="text-xs text-muted-foreground">
                  New edits will appear here as inline Git-backed diffs.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4">
              {activity.map((item) => {
                const commentCount = commentCounts?.[String(item.id)] ?? 0
                const isExpanded = expandedChangeId === String(item.id)
                return (
                  <ChangeCard
                    key={String(item.id)}
                    item={item}
                    gitCwd={gitCwd}
                    previousCheckpointGroupId={previousCheckpointGroupIds.get(String(item.id)) ?? null}
                    commentCount={commentCount}
                    viewerUserId={convexUserId}
                    expanded={isExpanded}
                    onToggle={() =>
                      setExpandedChangeId((current) =>
                        current === String(item.id) ? null : String(item.id),
                      )
                    }
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </CheckpointDiffWorkerProvider>
  )
}
