import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft02Icon as __ArrowLeftHugeIcon,
  BubbleChatIcon as __MessageSquareHugeIcon,
  Clock01Icon as __ClockHugeIcon,
  TransactionHistoryIcon as __ChangesHugeIcon,
  PlusSignIcon as __PlusHugeIcon,
  MinusSignIcon as __MinusHugeIcon,
  LayoutTwoColumnIcon as __SplitViewHugeIcon,
  LayoutTwoRowIcon as __StackedViewHugeIcon,
  PanelLeftIcon as __SidebarHugeIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CommentRichText } from '@/components/comments/CommentRichText'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useOptionalProjectRouteContext } from '@/features/projects/contexts/ProjectRouteContext'
import { projectOpenDesktopClient } from '@/features/projects/lib/projectOpenDesktopClient'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { CheckpointDiffWorkerProvider } from '../components/changes/CheckpointDiffWorkerProvider'
import { useTranslation } from '@/lib/i18n'

import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { ChangedFilesTree } from '../components/changes/ChangedFilesTree'

export interface ActivityFeedItem {
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

interface ChangeGroup {
  groupId: string;
  items: ActivityFeedItem[];
  timestamp: number;
  userName: string;
  userColor: string;
  totalAdditions: number;
  totalDeletions: number;
}

function groupActivityItems(items: readonly ActivityFeedItem[]): ChangeGroup[] {
  const groupsMap = new Map<string, ChangeGroup>();
  const orderedGroups: ChangeGroup[] = [];

  for (const item of items) {
    if (!item.checkpointGroupId) continue;
    let group = groupsMap.get(item.checkpointGroupId);
    if (!group) {
      group = {
        groupId: item.checkpointGroupId,
        items: [],
        timestamp: item.timestamp,
        userName: item.userName,
        userColor: item.userColor,
        totalAdditions: 0,
        totalDeletions: 0,
      };
      groupsMap.set(item.checkpointGroupId, group);
      orderedGroups.push(group);
    }
    group.items.push(item);
    group.totalAdditions += (item.additions ?? 0);
    group.totalDeletions += (item.deletions ?? 0);
  }

  return orderedGroups;
}

function resolvePreviousCheckpointGroupIds(groups: ChangeGroup[]): Map<string, string | null> {
  const previousByGroup = new Map<string, string | null>()
  for (let index = 0; index < groups.length; index += 1) {
    previousByGroup.set(groups[index].groupId, groups[index + 1]?.groupId ?? null)
  }
  return previousByGroup
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
  const { t } = useTranslation()

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
    <div className="mt-4 pt-4 border-t border-border/70">
      {count > 0 && (
        <div className="mb-4 flex items-center gap-2 text-[15px] font-bold text-foreground px-2">
          <span>{t('changes.comments.count').replace('{count}', String(count))}</span>
        </div>
      )}

      <div className="flex flex-col px-2">
        {(comments ?? []).map((comment, i) => {
          const isLast = i === (comments?.length ?? 0) - 1;
          const hasReplyBox = expanded && viewerUserId;
          const showLine = !isLast || hasReplyBox;
          
          return (
            <div key={String(comment.id)} className="flex gap-3">
              {/* Left column (Avatar + Thread line) */}
              <div className="flex flex-col items-center shrink-0">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white font-bold shadow-sm text-sm z-10"
                  style={{ backgroundColor: comment.userColor || '#666' }}
                >
                  {comment.userName.charAt(0).toUpperCase()}
                </span>
                {showLine && (
                  <div className="w-[2px] bg-border/60 grow my-1.5" />
                )}
              </div>
              
              {/* Right column (Content) */}
              <div className="flex min-w-0 flex-1 flex-col pb-5">
                <div className="flex items-center gap-1.5 text-[14px] leading-none mb-1 mt-1">
                  <span className="font-bold text-foreground truncate hover:underline cursor-pointer">{comment.userName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground hover:underline cursor-pointer">{formatRelativeTime(comment.createdAt)}</span>
                </div>
                <div className="text-[14px] text-foreground mt-0.5 leading-relaxed">
                  <CommentRichText content={comment.content} />
                </div>
              </div>
            </div>
          )
        })}

        {expanded && viewerUserId ? (
          <div className="flex gap-3 pt-1">
            {/* Left column */}
            <div className="flex flex-col items-center shrink-0">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm text-sm z-10"
              >
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-4.5" />
              </span>
            </div>
            
            {/* Right column */}
            <div className="flex min-w-0 flex-1 flex-col">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('changes.comments.postPlaceholder')}
                className="min-h-[40px] resize-y border-transparent bg-transparent px-0 py-2 shadow-none focus-visible:ring-0 text-[14px] text-foreground placeholder:text-muted-foreground/60"
              />
              <div className="flex justify-between items-center pt-2">
                <div className="text-[12px] text-muted-foreground/60">{t('changes.comments.markdownSupported')}</div>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full px-5 h-8 font-bold"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting || draft.trim().length === 0}
                >
                  {isSubmitting ? t('changes.comments.btnPosting') : t('changes.comments.btnReply')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function ChangeGroupCard(props: {
  group: ChangeGroup
  gitCwd: string | null
  previousCheckpointGroupId: string | null
  commentCounts: Record<string, number>
  viewerUserId: Id<'users'> | null
}) {
  const {
    group,
    gitCwd,
    previousCheckpointGroupId,
    commentCounts,
    viewerUserId,
  } = props
  
  const [patch, setPatch] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [showComments, setShowComments] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split")
  const { t } = useTranslation()

  const totalComments = group.items.reduce((acc, item) => acc + (commentCounts[String(item.id)] ?? 0), 0);

  useEffect(() => {
    if (!gitCwd || !group.groupId) {
      setPatch(null)
      setPatchError(t('changes.error.noLocalCheckpoint'))
      return
    }

    let cancelled = false
    setPatchError(null)

    // Omit filePath to get the full patch for the checkpoint
    void projectOpenDesktopClient.sync
      .gitDiffCheckpoints({
        projectPath: gitCwd,
        fromCheckpointId: previousCheckpointGroupId ?? undefined,
        toCheckpointId: group.groupId,
      })
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setPatch(null)
          setPatchError(result.error ?? t('changes.error.failedToLoadPatch'))
          return
        }
        setPatch(result.diff ?? '')
      })
      .catch((error) => {
        if (cancelled) return
        setPatch(null)
        setPatchError(error instanceof Error ? error.message : t('changes.error.failedToLoadPatch'))
      })

    return () => {
      cancelled = true
    }
  }, [gitCwd, group.groupId, previousCheckpointGroupId])

  // Automatically select the first file when opening
  useEffect(() => {
    if (group.items.length > 0 && !selectedFilePath) {
      setSelectedFilePath(group.items[0].filePath);
    }
  }, [group.items, selectedFilePath]);

  const parsedFiles = useMemo(() => {
    if (!patch) return [];
    try {
      const parsedPatches = parsePatchFiles(patch.trim(), `cache-${group.groupId}`);
      return parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    } catch {
      return [];
    }
  }, [patch, group.groupId]);

  const selectedFileDiff = useMemo(() => {
    if (!selectedFilePath || parsedFiles.length === 0) return null;
    return parsedFiles.find((f) => resolveFileDiffPath(f) === selectedFilePath) ?? null;
  }, [parsedFiles, selectedFilePath]);

  const selectedItem = useMemo(() => {
    if (!selectedFilePath) return null;
    return group.items.find(item => item.filePath === selectedFilePath) ?? null;
  }, [group.items, selectedFilePath]);

  return (
    <article className="flex border-b border-border/70 p-4 sm:p-6 last:border-0 hover:bg-muted/5 transition-colors">
      <div className="mr-3 sm:mr-4 shrink-0">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-white font-bold shadow-sm text-base"
          style={{ backgroundColor: group.userColor || '#666' }}
        >
          {group.userName.charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 text-[15px] mb-1">
          <span className="font-bold text-foreground hover:underline cursor-pointer">{group.userName}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground hover:underline cursor-pointer">{formatRelativeTime(group.timestamp)}</span>
        </div>

        <div className="mb-3">
          <p className="text-[15px] text-foreground leading-snug">
            {t('changes.info.updatedFiles').replace('{count}', String(group.items.length)).replace('{plural}', group.items.length !== 1 ? 's' : '')}
          </p>
        </div>

        <div className="flex rounded-2xl border border-border/70 overflow-hidden h-[450px] mb-3 transition-all">
          {showSidebar && (
            <div className="w-[30%] min-w-[200px] max-w-[260px] border-r border-border/70 bg-muted/10 overflow-y-auto p-2">
               <ChangedFilesTree 
                 files={group.items}
                 allDirectoriesExpanded={true}
                 onOpenFile={(filePath) => setSelectedFilePath(filePath)}
               />
            </div>
          )}
          <div className="flex-1 overflow-y-auto bg-card">
            {patchError ? (
              <div className="m-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {patchError}
              </div>
            ) : selectedFileDiff ? (
              <div className="flex flex-col min-h-full">
                <FileDiff
                  fileDiff={selectedFileDiff}
                  options={{
                    diffStyle: diffStyle,
                    lineDiffType: "none",
                    overflow: "wrap",
                    themeType: "dark", 
                    unsafeCSS: `
                      [data-diffs-header],
                      [data-diff],
                      [data-file] {
                        --diffs-bg: transparent !important;
                        --diffs-light-bg: transparent !important;
                        --diffs-dark-bg: transparent !important;
                        background-color: transparent !important;
                      }
                      [data-file-info] {
                        background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
                        border-block-color: var(--border) !important;
                        color: var(--foreground) !important;
                      }
                    `
                  }}
                />
              </div>
            ) : patch ? (
               <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                 {t('changes.info.selectFile')}
               </div>
            ) : null}
          </div>
        </div>

        {/* Action Buttons (Twitter style) */}
        <div className="flex items-center justify-between text-muted-foreground mb-1 ml-1 pr-2">
          <div className="flex items-center gap-6">
            <button 
              className="flex items-center gap-1.5 text-[15px] hover:text-blue-500 transition-colors group"
              onClick={() => setShowComments((prev) => !prev)}
            >
              <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-5" />
              {totalComments > 0 && <span className="font-medium">{totalComments}</span>}
            </button>
            
            <div className="flex items-center gap-1 text-[15px] group text-emerald-500 font-medium">
              <HugeiconsIcon icon={__PlusHugeIcon} className="size-4 stroke-[2.5px]" />
              <span>{group.totalAdditions}</span>
            </div>

            <div className="flex items-center gap-1 text-[15px] group text-rose-500 font-medium">
              <HugeiconsIcon icon={__MinusHugeIcon} className="size-4 stroke-[2.5px]" />
              <span>{group.totalDeletions}</span>
            </div>
          </div>

          {/* View Toggles */}
          <div className="flex items-center gap-3">
            <button 
              className="flex items-center justify-center size-7 rounded hover:bg-muted/50 transition-colors"
              onClick={() => setShowSidebar((prev) => !prev)}
              title={t('changes.action.toggleTree')}
            >
              <HugeiconsIcon icon={__SidebarHugeIcon} className="size-4.5" />
            </button>
            <div className="h-4 w-px bg-border/70" />
            <button 
              className="flex items-center justify-center size-7 rounded hover:bg-muted/50 transition-colors"
              onClick={() => setDiffStyle((prev) => prev === "split" ? "unified" : "split")}
              title={diffStyle === "split" ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
            >
              <HugeiconsIcon icon={diffStyle === "split" ? __StackedViewHugeIcon : __SplitViewHugeIcon} className="size-4.5" />
            </button>
          </div>
        </div>

        {/* Selected File Comments Thread */}
        {showComments && selectedItem ? (
          <ChangeComments
            changeId={selectedItem.id}
            viewerUserId={viewerUserId}
            count={commentCounts[String(selectedItem.id)] ?? 0}
            expanded={true}
          />
        ) : null}
      </div>
    </article>
  )
}

export function ChangesPage(_props: ChangesPageProps) {
  const { t } = useTranslation()
  const { project, convexUserId } = useAccessibleProject()
  const routeContext = useOptionalProjectRouteContext()
  const gitCwd = routeContext?.gitCwd ?? null

  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 200 } : 'skip',
  ) as ActivityFeedItem[] | undefined

  const groups = useMemo(() => groupActivityItems(activity ?? []), [activity]);

  const changeIds = useMemo(
    () => activity?.map((item) => item.id as Id<'fileChanges'>) ?? [],
    [activity],
  )
  
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    project?._id && changeIds.length > 0 ? { projectId: project._id, changeIds } : 'skip',
  ) as Record<string, number> | undefined

  const previousCheckpointGroupIds = useMemo(
    () => resolvePreviousCheckpointGroupIds(groups),
    [groups],
  )

  useEffect(() => {
    if (!project?.slug) return
    markSyncFeedAsSeen(project.slug)
  }, [project?.slug])

  return (
    <CheckpointDiffWorkerProvider>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="min-h-0 flex-1 overflow-auto">
          {!project ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              {t('changes.empty.projectUnavailable')}
            </div>
          ) : activity === undefined ? null : groups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <HugeiconsIcon icon={__ClockHugeIcon} className="size-8 text-muted-foreground/35" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t('changes.empty.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('changes.empty.desc')}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {groups.map((group) => {
                return (
                  <ChangeGroupCard
                    key={group.groupId}
                    group={group}
                    gitCwd={gitCwd}
                    previousCheckpointGroupId={previousCheckpointGroupIds.get(group.groupId) ?? null}
                    commentCounts={commentCounts ?? {}}
                    viewerUserId={convexUserId}
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
