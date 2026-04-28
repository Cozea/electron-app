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
  Search01Icon as __SearchHugeIcon,
  FilterMailIcon as __FilterHugeIcon,
  Settings02Icon as __SettingsHugeIcon,
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

function DiffStatBlocks({ additions, deletions }: { additions: number, deletions: number }) {
  const total = additions + deletions;
  let addBlocks = 0;
  let delBlocks = 0;
  
  if (total > 0) {
    if (total <= 5) {
      addBlocks = additions;
      delBlocks = deletions;
    } else {
      addBlocks = Math.round((additions / total) * 5);
      delBlocks = 5 - addBlocks;
      
      // Ensure at least 1 block is shown if there are additions/deletions
      if (additions > 0 && addBlocks === 0) {
        addBlocks = 1;
        delBlocks = 4;
      } else if (deletions > 0 && delBlocks === 0) {
        delBlocks = 1;
        addBlocks = 4;
      }
    }
  }
  
  const neutralBlocks = Math.max(0, 5 - addBlocks - delBlocks);

  return (
    <div className="flex items-center gap-[2px] ml-2" title={`${additions} additions & ${deletions} deletions`}>
      {Array.from({ length: addBlocks }).map((_, i) => (
        <div key={`add-${i}`} className="h-2.5 w-2.5 rounded-[1.5px] bg-[#059669]" />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <div key={`del-${i}`} className="h-2.5 w-2.5 rounded-[1.5px] bg-[#e11d48]" />
      ))}
      {Array.from({ length: neutralBlocks }).map((_, i) => (
        <div key={`neutral-${i}`} className="h-2.5 w-2.5 rounded-[1.5px] bg-muted-foreground/20" />
      ))}
    </div>
  );
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

function matchesFileFilter(filePath: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const normalizedPath = filePath.toLowerCase()
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalizedPath.includes(token))
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
          <span>{t('changes.comments.count').split('(')[0].trim()}</span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted/60 px-1.5 text-[13px] font-medium text-foreground">
            {count}
          </span>
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
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white font-bold shadow-sm text-xs z-10 mt-1"
                  style={{ backgroundColor: comment.userColor || '#666' }}
                >
                  {comment.userName.charAt(0).toUpperCase()}
                </span>
                {showLine && (
                  <div className="w-[2px] bg-border/60 grow my-1" />
                )}
              </div>
              
              {/* Right column (Content) */}
              <div className="flex min-w-0 flex-1 flex-col pb-4">
                <div className="flex items-center gap-1.5 text-[14px] leading-none mb-1 mt-1.5">
                  <span className="font-semibold text-foreground text-sm truncate hover:underline cursor-pointer">{comment.userName}</span>
                  <span className="text-muted-foreground text-sm">·</span>
                  <span className="text-muted-foreground text-sm hover:underline cursor-pointer">{formatRelativeTime(comment.createdAt)}</span>
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
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm text-xs z-10 mt-1"
              >
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-3.5" />
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
              <div className="flex justify-end items-center pt-2">
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
  selectedFilePath: string | null
}) {
  const {
    group,
    gitCwd,
    previousCheckpointGroupId,
    commentCounts,
    viewerUserId,
    selectedFilePath,
  } = props
  
  const [patch, setPatch] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [showComments, setShowComments] = useState(false)
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
    <article className="flex py-2 px-4 sm:px-6 hover:bg-muted/5 transition-colors">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex rounded-2xl border border-border/70 overflow-hidden h-[450px] mb-3 transition-all relative">
          <div className="flex-1 overflow-y-auto bg-card relative">
            {patchError ? (
              <div className="flex flex-col min-h-full">
                <div className="flex items-center gap-2 p-2 px-3 border-b border-border/70 bg-card sticky top-0 z-10">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white font-bold shadow-sm text-xs"
                    style={{ backgroundColor: group.userColor || '#666' }}
                  >
                    {group.userName.charAt(0).toUpperCase()}
                  </span>
                  <span className="font-semibold text-foreground text-sm">{group.userName}</span>
                  <span className="text-muted-foreground text-sm">·</span>
                  <span className="text-muted-foreground text-sm">{formatRelativeTime(group.timestamp)}</span>
                </div>
                <div className="m-4 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {patchError}
                </div>
              </div>
            ) : selectedFileDiff ? (
              <div className="flex flex-col min-h-full">
                <FileDiff
                  fileDiff={selectedFileDiff}
                  renderHeaderPrefix={() => (
                    <div className="flex items-center gap-2 mr-3 pr-3 border-r border-border/60">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white font-bold shadow-sm text-xs"
                        style={{ backgroundColor: group.userColor || '#666' }}
                      >
                        {group.userName.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-semibold text-foreground text-sm">{group.userName}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-muted-foreground text-sm">{formatRelativeTime(group.timestamp)}</span>
                    </div>
                  )}
                  renderHeaderMetadata={(fileDiff) => {
                    let additions = 0;
                    let deletions = 0;
                    for (const hunk of fileDiff.hunks) {
                      additions += hunk.additionLines;
                      deletions += hunk.deletionLines;
                    }
                    if (additions === 0 && deletions === 0) return null;
                    return <DiffStatBlocks additions={additions} deletions={deletions} />;
                  }}
                  options={{
                    diffStyle: diffStyle,
                    lineDiffType: "none",
                    overflow: "wrap",
                    themeType: "dark", 
                    unsafeCSS: `
                      [data-diffs-header] {
                        position: sticky !important;
                        top: 0 !important;
                        z-index: 10 !important;
                        background-color: var(--card) !important;
                        border-bottom: 1px solid var(--border) !important;
                      }
                      [data-additions-count],
                      [data-deletions-count] {
                        font-family: ui-sans-serif, system-ui, sans-serif !important;
                        font-variant-numeric: tabular-nums;
                      }
                      [data-additions-count] {
                        color: #059669 !important;
                      }
                      [data-deletions-count] {
                        color: #e11d48 !important;
                      }
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

          {/* Action Buttons (Twitter style) */}
          <div className="absolute bottom-4 right-4 z-20 flex w-fit items-center gap-4 text-secondary-foreground/80 border border-border/50 rounded-full px-3 py-1.5 bg-secondary/90 backdrop-blur shadow-sm">
            <div className="flex items-center gap-6">
              <button 
                className="flex items-center gap-1.5 text-[14px] hover:text-secondary-foreground transition-colors group"
                onClick={() => setShowComments((prev) => !prev)}
              >
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-4.5" />
                {totalComments > 0 && <span className="font-medium">{totalComments}</span>}
              </button>
            </div>

            {/* View Toggles */}
            <div className="flex items-center gap-3">
              <button 
                className="flex items-center justify-center size-6 rounded-full hover:bg-muted-foreground/20 transition-colors hover:text-secondary-foreground"
                onClick={() => setDiffStyle((prev) => prev === "split" ? "unified" : "split")}
                title={diffStyle === "split" ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
              >
                <HugeiconsIcon icon={diffStyle === "split" ? __StackedViewHugeIcon : __SplitViewHugeIcon} className="size-4" />
              </button>
            </div>
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

  const uniqueFiles = useMemo(() => {
    if (!activity) return [];
    const map = new Map<string, ActivityFeedItem>();
    for (const item of activity) {
      if (!map.has(item.filePath)) {
        map.set(item.filePath, { ...item });
      } else {
        const existing = map.get(item.filePath)!;
        existing.additions = (existing.additions || 0) + (item.additions || 0);
        existing.deletions = (existing.deletions || 0) + (item.deletions || 0);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }, [activity]);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileFilterQuery, setFileFilterQuery] = useState("");

  const visibleFiles = useMemo(
    () => uniqueFiles.filter((file) => matchesFileFilter(file.filePath, fileFilterQuery)),
    [fileFilterQuery, uniqueFiles],
  );

  useEffect(() => {
    const firstFilePath = uniqueFiles[0]?.filePath ?? null;
    if (!firstFilePath) {
      if (selectedFilePath !== null) {
        setSelectedFilePath(null);
      }
      return;
    }

    const selectedFileStillExists = uniqueFiles.some((file) => file.filePath === selectedFilePath);
    if (!selectedFileStillExists) {
      setSelectedFilePath(firstFilePath);
    }
  }, [uniqueFiles, selectedFilePath]);

  const filteredGroups = useMemo(() => {
    if (!selectedFilePath) return groups;
    return groups.filter(g => g.items.some(i => i.filePath === selectedFilePath));
  }, [groups, selectedFilePath]);

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
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              <div className="w-[30%] min-w-[200px] max-w-[300px] border-r border-border/70 flex flex-col shrink-0">
                 <div className="p-4 pb-0 shrink-0">
                   <div className="mb-3 flex items-center">
                     <label className="relative flex h-8 min-w-0 flex-1 items-center rounded-md border border-border/40 bg-muted/60 transition-colors focus-within:border-border/60 focus-within:bg-background">
                       <HugeiconsIcon
                         icon={__SearchHugeIcon}
                         className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70"
                       />
                       <input
                         value={fileFilterQuery}
                         onChange={(event) => setFileFilterQuery(event.target.value)}
                         placeholder={t('changes.placeholder.filterFiles')}
                         className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
                       />
                       <button
                         type="button"
                         className="absolute right-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                         aria-label={t('changes.action.filterFiles')}
                       >
                         <HugeiconsIcon icon={__FilterHugeIcon} className="size-3.5" />
                       </button>
                     </label>
                   </div>
                 </div>
                 <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
                   {visibleFiles.length > 0 ? (
                     <ChangedFilesTree
                       files={visibleFiles}
                       allDirectoriesExpanded={true}
                       onOpenFile={(filePath) => setSelectedFilePath(filePath)}
                       selectedFilePath={selectedFilePath}
                     />
                   ) : (
                     <div className="px-4 py-3 text-xs text-muted-foreground">
                       {t('changes.empty.noMatchingFiles')}
                     </div>
                   )}
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-background flex flex-col">
                {/* Search within code header */}
                <div className="flex items-center gap-2 px-6 py-3 border-b border-border/70 shrink-0">
                  <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-transparent text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
                    <HugeiconsIcon icon={__SidebarHugeIcon} className="size-4.5" />
                  </button>
                  <label className="relative flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border/40 bg-muted/60 transition-colors focus-within:border-border/60 focus-within:bg-background">
                    <HugeiconsIcon
                      icon={__SearchHugeIcon}
                      className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70"
                    />
                    <input
                      placeholder="Search within code"
                      className="h-full min-w-0 flex-1 bg-transparent pl-9 pr-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
                    />
                  </label>
                  <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
                    <HugeiconsIcon icon={__SettingsHugeIcon} className="size-4.5" />
                  </button>
                </div>
                
                <div className="flex w-full flex-col overflow-y-auto">
                  {filteredGroups.map((group) => {
                    return (
                      <ChangeGroupCard
                        key={group.groupId}
                        group={group}
                        gitCwd={gitCwd}
                        previousCheckpointGroupId={previousCheckpointGroupIds.get(group.groupId) ?? null}
                        commentCounts={commentCounts ?? {}}
                        viewerUserId={convexUserId}
                        selectedFilePath={selectedFilePath}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </CheckpointDiffWorkerProvider>
  )
}
