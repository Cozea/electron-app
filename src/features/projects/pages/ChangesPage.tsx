import { HugeiconsIcon } from '@hugeicons/react'
import {
  BubbleChatIcon as __MessageSquareHugeIcon,
  Clock01Icon as __ClockHugeIcon,
  LayoutTwoColumnIcon as __SplitViewHugeIcon,
  LayoutTwoRowIcon as __StackedViewHugeIcon,
  PanelLeftIcon as __SidebarHugeIcon,
  Search01Icon as __SearchHugeIcon,
  FilterMailIcon as __FilterHugeIcon,
  Settings02Icon as __SettingsHugeIcon,
} from '@hugeicons/core-free-icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { ChangedFilesTree } from '../components/changes/ChangedFilesTree'

const EMPTY_COMMENT_COUNTS: Record<string, number> = {}
const CHECKPOINT_PATCH_CACHE_MAX_ENTRIES = 48

const CHANGE_GROUP_DIFF_UNSAFE_CSS = `
[data-diffs-header] {
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

interface CheckpointPatchCacheEntry {
  patch: string
  parsedFiles: FileDiffMetadata[]
}

const checkpointPatchCache = new Map<string, CheckpointPatchCacheEntry>()
const checkpointPatchRequests = new Map<string, Promise<CheckpointPatchCacheEntry>>()

function readCheckpointPatchCache(key: string): CheckpointPatchCacheEntry | null {
  const cached = checkpointPatchCache.get(key)
  if (!cached) return null

  checkpointPatchCache.delete(key)
  checkpointPatchCache.set(key, cached)
  return cached
}

function writeCheckpointPatchCache(key: string, entry: CheckpointPatchCacheEntry): void {
  checkpointPatchCache.set(key, entry)

  while (checkpointPatchCache.size > CHECKPOINT_PATCH_CACHE_MAX_ENTRIES) {
    const oldestKey = checkpointPatchCache.keys().next().value
    if (!oldestKey) break
    checkpointPatchCache.delete(oldestKey)
  }
}

function buildCheckpointPatchCacheKey(input: {
  gitCwd: string
  groupId: string
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
}): string {
  return [
    input.gitCwd,
    input.previousCheckpointGroupId ?? 'head',
    input.groupId,
    input.selectedFilePath ?? '*',
  ].join('\0')
}

function parseCheckpointPatch(
  patch: string,
  groupId: string,
  selectedFilePath: string | null,
): FileDiffMetadata[] {
  const normalizedPatch = patch.trim()
  if (!normalizedPatch) return []

  const cacheScope = selectedFilePath ? selectedFilePath : 'all'
  const parsedPatches = parsePatchFiles(normalizedPatch, `changes:${groupId}:${cacheScope}`)
  return parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
}

function filterCheckpointPatchEntryForFile(
  entry: CheckpointPatchCacheEntry,
  selectedFilePath: string,
): CheckpointPatchCacheEntry {
  return {
    patch: entry.patch,
    parsedFiles: entry.parsedFiles.filter(
      (fileDiff) => resolveFileDiffPath(fileDiff) === selectedFilePath,
    ),
  }
}

function readCheckpointPatchEntryForInput(input: {
  gitCwd: string
  groupId: string
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
}): CheckpointPatchCacheEntry | null {
  const cacheKey = buildCheckpointPatchCacheKey(input)
  const cached = readCheckpointPatchCache(cacheKey)
  if (cached) return cached

  if (!input.selectedFilePath) return null

  const fullPatchCacheKey = buildCheckpointPatchCacheKey({
    ...input,
    selectedFilePath: null,
  })
  const fullPatchCached = readCheckpointPatchCache(fullPatchCacheKey)
  if (!fullPatchCached) return null

  const entry = filterCheckpointPatchEntryForFile(fullPatchCached, input.selectedFilePath)
  writeCheckpointPatchCache(cacheKey, entry)
  return entry
}

async function loadCheckpointPatch(input: {
  gitCwd: string
  groupId: string
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
}): Promise<CheckpointPatchCacheEntry> {
  const cacheKey = buildCheckpointPatchCacheKey(input)
  const cached = readCheckpointPatchCache(cacheKey)
  if (cached) return cached

  const inFlight = checkpointPatchRequests.get(cacheKey)
  if (inFlight) return inFlight

  if (input.selectedFilePath) {
    const fullPatchCacheKey = buildCheckpointPatchCacheKey({
      ...input,
      selectedFilePath: null,
    })
    const fullPatchCached = readCheckpointPatchCache(fullPatchCacheKey)
    if (fullPatchCached) {
      const entry = filterCheckpointPatchEntryForFile(fullPatchCached, input.selectedFilePath)
      writeCheckpointPatchCache(cacheKey, entry)
      return entry
    }

    const fullPatchInFlight = checkpointPatchRequests.get(fullPatchCacheKey)
    if (fullPatchInFlight) {
      const request = fullPatchInFlight
        .then((entry) => {
          const filteredEntry = filterCheckpointPatchEntryForFile(entry, input.selectedFilePath!)
          writeCheckpointPatchCache(cacheKey, filteredEntry)
          return filteredEntry
        })
        .finally(() => {
          checkpointPatchRequests.delete(cacheKey)
        })

      checkpointPatchRequests.set(cacheKey, request)
      return request
    }
  }

  const request = projectOpenDesktopClient.sync
    .gitDiffCheckpoints({
      projectPath: input.gitCwd,
      fromCheckpointId: input.previousCheckpointGroupId ?? undefined,
      toCheckpointId: input.groupId,
      filePath: input.selectedFilePath ?? undefined,
    })
    .then((result) => {
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load patch.')
      }

      const patch = result.diff ?? ''
      const entry: CheckpointPatchCacheEntry = {
        patch,
        parsedFiles: parseCheckpointPatch(patch, input.groupId, input.selectedFilePath),
      }
      writeCheckpointPatchCache(cacheKey, entry)
      return entry
    })
    .finally(() => {
      checkpointPatchRequests.delete(cacheKey)
    })

  checkpointPatchRequests.set(cacheKey, request)
  return request
}

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
}

interface ChangesPageData {
  groups: ChangeGroup[]
  uniqueFiles: ActivityFeedItem[]
  filePathSet: ReadonlySet<string>
  groupsByFilePath: ReadonlyMap<string, ChangeGroup[]>
  changeIds: Id<'fileChanges'>[]
  changeIdsByFilePath: ReadonlyMap<string, Id<'fileChanges'>[]>
  previousCheckpointGroupIds: ReadonlyMap<string, string | null>
}

const EMPTY_CHANGE_GROUPS: ChangeGroup[] = []
const EMPTY_CHANGE_IDS: Id<'fileChanges'>[] = []
const EMPTY_CHANGES_PAGE_DATA: ChangesPageData = {
  groups: EMPTY_CHANGE_GROUPS,
  uniqueFiles: [],
  filePathSet: new Set<string>(),
  groupsByFilePath: new Map<string, ChangeGroup[]>(),
  changeIds: EMPTY_CHANGE_IDS,
  changeIdsByFilePath: new Map<string, Id<'fileChanges'>[]>(),
  previousCheckpointGroupIds: new Map<string, string | null>(),
}

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key)
  if (values) {
    values.push(value)
    return
  }

  map.set(key, [value])
}

function deriveChangesPageData(items: readonly ActivityFeedItem[] | undefined): ChangesPageData {
  if (!items || items.length === 0) return EMPTY_CHANGES_PAGE_DATA

  const groupsMap = new Map<string, ChangeGroup>();
  const orderedGroups: ChangeGroup[] = [];
  const uniqueFilesByPath = new Map<string, ActivityFeedItem>();
  const changeIds: Id<'fileChanges'>[] = [];
  const changeIdsByFilePath = new Map<string, Id<'fileChanges'>[]>();

  for (const item of items) {
    const changeId = item.id as Id<'fileChanges'>;
    changeIds.push(changeId);
    appendMapValue(changeIdsByFilePath, item.filePath, changeId);

    const existingFile = uniqueFilesByPath.get(item.filePath);
    if (existingFile) {
      existingFile.additions = (existingFile.additions ?? 0) + (item.additions ?? 0);
      existingFile.deletions = (existingFile.deletions ?? 0) + (item.deletions ?? 0);
    } else {
      uniqueFilesByPath.set(item.filePath, { ...item });
    }

    if (!item.checkpointGroupId) continue;
    let group = groupsMap.get(item.checkpointGroupId);
    if (!group) {
      group = {
        groupId: item.checkpointGroupId,
        items: [],
        timestamp: item.timestamp,
        userName: item.userName,
        userColor: item.userColor,
      };
      groupsMap.set(item.checkpointGroupId, group);
      orderedGroups.push(group);
    }
    group.items.push(item);
  }

  const previousCheckpointGroupIds = new Map<string, string | null>()
  const groupsByFilePath = new Map<string, ChangeGroup[]>()

  for (let index = 0; index < orderedGroups.length; index += 1) {
    const group = orderedGroups[index]
    previousCheckpointGroupIds.set(group.groupId, orderedGroups[index + 1]?.groupId ?? null)

    const seenFilePaths = new Set<string>()
    for (const item of group.items) {
      if (seenFilePaths.has(item.filePath)) continue
      seenFilePaths.add(item.filePath)
      appendMapValue(groupsByFilePath, item.filePath, group)
    }
  }

  const uniqueFiles = Array.from(uniqueFilesByPath.values()).sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  )

  return {
    groups: orderedGroups,
    uniqueFiles,
    filePathSet: new Set(uniqueFilesByPath.keys()),
    groupsByFilePath,
    changeIds,
    changeIdsByFilePath,
    previousCheckpointGroupIds,
  }
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
              <div className="flex flex-col items-center shrink-0">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white font-bold text-xs z-10 mt-1"
                  style={{ backgroundColor: comment.userColor || '#666' }}
                >
                  {comment.userName.charAt(0).toUpperCase()}
                </span>
                {showLine && (
                  <div className="w-[2px] bg-border/60 grow my-1" />
                )}
              </div>
              
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
            <div className="flex flex-col items-center shrink-0">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs z-10 mt-1"
              >
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-3.5" />
              </span>
            </div>
            
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

function getFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return `${fileDiff.prevName ?? ""}->${fileDiff.name}`;
}

function hasFileDiffBody(fileDiff: FileDiffMetadata): boolean {
  return fileDiff.hunks.length > 0;
}

function getFileDiffLineStats(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

function ChangeGroupIdentityHeader({ group }: { group: ChangeGroup }) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b border-border/70 bg-card px-3 py-2">
      <ChangeGroupHeaderPrefix group={group} />
    </div>
  )
}

function ChangeGroupHeaderPrefix({ group }: { group: ChangeGroup }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-r border-border/60 pr-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: group.userColor || '#666' }}
      >
        {group.userName.charAt(0).toUpperCase()}
      </span>
      <span className="truncate text-sm font-semibold text-foreground">{group.userName}</span>
      <span className="text-sm text-muted-foreground">·</span>
      <span className="shrink-0 text-sm text-muted-foreground">{formatRelativeTime(group.timestamp)}</span>
    </div>
  )
}

interface CheckpointPatchState {
  cacheKey: string | null
  patch: string | null
  parsedFiles: FileDiffMetadata[]
  patchError: string | null
}

function createCheckpointPatchState(input: {
  gitCwd: string | null
  groupId: string
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const { gitCwd, groupId, previousCheckpointGroupId, selectedFilePath } = input
  if (!gitCwd || !groupId) {
    return {
      cacheKey: null,
      patch: null,
      parsedFiles: [],
      patchError: input.noLocalCheckpointMessage,
    }
  }

  const cacheInput = {
    gitCwd,
    groupId,
    previousCheckpointGroupId,
    selectedFilePath,
  }
  const cacheKey = buildCheckpointPatchCacheKey(cacheInput)
  const cached = readCheckpointPatchEntryForInput(cacheInput)
  if (cached) {
    return {
      cacheKey,
      patch: cached.patch,
      parsedFiles: cached.parsedFiles,
      patchError: null,
    }
  }

  return {
    cacheKey,
    patch: null,
    parsedFiles: [],
    patchError: null,
  }
}

function useCheckpointPatch(input: {
  gitCwd: string | null
  groupId: string
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
  failedToLoadPatchMessage: string
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const {
    gitCwd,
    groupId,
    previousCheckpointGroupId,
    selectedFilePath,
    failedToLoadPatchMessage,
    noLocalCheckpointMessage,
  } = input
  const [state, setState] = useState<CheckpointPatchState>(() =>
    createCheckpointPatchState({
      gitCwd,
      groupId,
      previousCheckpointGroupId,
      selectedFilePath,
      noLocalCheckpointMessage,
    }),
  )

  useLayoutEffect(() => {
    if (!gitCwd || !groupId) {
      setState({
        cacheKey: null,
        patch: null,
        parsedFiles: [],
        patchError: noLocalCheckpointMessage,
      })
      return
    }

    let cancelled = false
    const cacheKey = buildCheckpointPatchCacheKey({
      gitCwd,
      groupId,
      previousCheckpointGroupId,
      selectedFilePath,
    })
    const cached = readCheckpointPatchEntryForInput({
      gitCwd,
      groupId,
      previousCheckpointGroupId,
      selectedFilePath,
    })
    if (cached) {
      setState({
        cacheKey,
        patch: cached.patch,
        parsedFiles: cached.parsedFiles,
        patchError: null,
      })
      return
    }

    setState((current) => {
      if (
        current.cacheKey === cacheKey &&
        current.patch === null &&
        current.parsedFiles.length === 0 &&
        current.patchError === null
      ) {
        return current
      }

      return {
        cacheKey,
        patch: null,
        parsedFiles: [],
        patchError: null,
      }
    })

    void loadCheckpointPatch({
      gitCwd,
      groupId,
      previousCheckpointGroupId,
      selectedFilePath,
    })
      .then((entry) => {
        if (cancelled) return
        setState({
          cacheKey,
          patch: entry.patch,
          parsedFiles: entry.parsedFiles,
          patchError: null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          cacheKey,
          patch: null,
          parsedFiles: [],
          patchError: error instanceof Error ? error.message : failedToLoadPatchMessage,
        })
      })

    return () => {
      cancelled = true
    }
  }, [
    failedToLoadPatchMessage,
    gitCwd,
    groupId,
    noLocalCheckpointMessage,
    previousCheckpointGroupId,
    selectedFilePath,
  ])

  return state
}

const ChangeGroupRow = memo(function ChangeGroupRow(props: {
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
  
  const [showComments, setShowComments] = useState(false)
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split")
  const { t } = useTranslation()
  const { patch, parsedFiles, patchError } = useCheckpointPatch({
    gitCwd,
    groupId: group.groupId,
    previousCheckpointGroupId,
    selectedFilePath,
    failedToLoadPatchMessage: t('changes.error.failedToLoadPatch'),
    noLocalCheckpointMessage: t('changes.error.noLocalCheckpoint'),
  })

  const totalComments = group.items.reduce((acc, item) => acc + (commentCounts[String(item.id)] ?? 0), 0);

  const selectedFileDiff = useMemo(() => {
    if (!selectedFilePath || parsedFiles.length === 0) return null;
    return parsedFiles.find((f) => resolveFileDiffPath(f) === selectedFilePath) ?? null;
  }, [parsedFiles, selectedFilePath]);

  const visibleFileDiffs = useMemo(() => {
    if (!selectedFilePath) return parsedFiles;
    return selectedFileDiff ? [selectedFileDiff] : [];
  }, [parsedFiles, selectedFileDiff, selectedFilePath]);

  const hasLoadedPatch = patch !== null;
  const hasVisibleDiffFiles = visibleFileDiffs.length > 0;
  const hasVisibleDiffBody = visibleFileDiffs.some(hasFileDiffBody);
  const isBodylessLoadedDiff = hasLoadedPatch && (!hasVisibleDiffFiles || !hasVisibleDiffBody);
  const showRowActions = !isBodylessLoadedDiff;
  const primaryFileDiff = visibleFileDiffs[0] ?? null;

  const selectedItem = useMemo(() => {
    if (!selectedFilePath) return null;
    return group.items.find(item => item.filePath === selectedFilePath) ?? null;
  }, [group.items, selectedFilePath]);

  const renderHeaderPrefix = useCallback(() => (
    <ChangeGroupHeaderPrefix group={group} />
  ), [group]);

  const renderHeaderMetadata = useCallback((fileDiff: FileDiffMetadata) => {
    const { additions, deletions } = getFileDiffLineStats(fileDiff);
    if (additions === 0 && deletions === 0) return null;
    return <DiffStatBlocks additions={additions} deletions={deletions} />;
  }, []);

  const headerDiffOptions = useMemo(() => ({
    collapsed: true,
    diffStyle,
    lineDiffType: "none" as const,
    overflow: "wrap" as const,
    themeType: "dark" as const,
    unsafeCSS: CHANGE_GROUP_DIFF_UNSAFE_CSS,
  }), [diffStyle]);

  const firstBodyDiffOptions = useMemo(() => ({
    disableFileHeader: true,
    diffStyle,
    lineDiffType: "none" as const,
    overflow: "wrap" as const,
    themeType: "dark" as const,
    unsafeCSS: CHANGE_GROUP_DIFF_UNSAFE_CSS,
  }), [diffStyle]);

  const bodyDiffOptions = useMemo(() => ({
    diffStyle,
    lineDiffType: "none" as const,
    overflow: "wrap" as const,
    themeType: "dark" as const,
    unsafeCSS: CHANGE_GROUP_DIFF_UNSAFE_CSS,
  }), [diffStyle]);

  if (!patchError && !primaryFileDiff) {
    return (
      <article
        aria-hidden="true"
        className={hasLoadedPatch ? "h-px border-b border-border/70" : "h-[450px] border-b border-border/70"}
      />
    );
  }

  return (
    <article className="relative flex min-w-0 flex-col border-b border-border/70 transition-colors hover:bg-muted/5">
      <div className={`relative flex flex-col overflow-hidden ${isBodylessLoadedDiff ? "h-auto min-h-0" : "h-[450px]"}`}>
        {primaryFileDiff ? (
          <FileDiff
            fileDiff={primaryFileDiff}
            renderHeaderPrefix={renderHeaderPrefix}
            renderHeaderMetadata={renderHeaderMetadata}
            options={headerDiffOptions}
          />
        ) : (
          <ChangeGroupIdentityHeader group={group} />
        )}

        {patchError ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto bg-card">
            <div className="flex flex-col min-h-full">
              <div className="m-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {patchError}
              </div>
            </div>
          </div>
        ) : visibleFileDiffs.length > 0 ? (
          <Virtualizer
            className="relative min-h-0 flex-1 overflow-y-auto bg-card"
            contentClassName="flex flex-col min-h-full"
            config={{
              overscrollSize: 600,
              intersectionObserverMargin: 1200,
            }}
          >
            {visibleFileDiffs.map((fileDiff, index) => (
              <FileDiff
                key={`${getFileDiffRenderKey(fileDiff)}:${index}`}
                fileDiff={fileDiff}
                renderHeaderMetadata={renderHeaderMetadata}
                options={index === 0 ? firstBodyDiffOptions : bodyDiffOptions}
              />
            ))}
          </Virtualizer>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-y-auto bg-card" />
        )}

        {showRowActions ? (
          <div className="absolute bottom-2 right-2 z-20 flex w-fit items-center gap-4 rounded-md border border-border/50 bg-secondary px-3 py-1.5 text-secondary-foreground/80">
            <div className="flex items-center gap-6">
              <button 
                className="flex items-center gap-1.5 text-[14px] hover:text-secondary-foreground transition-colors group"
                onClick={() => setShowComments((prev) => !prev)}
              >
                <HugeiconsIcon icon={__MessageSquareHugeIcon} className="size-4.5" />
                {totalComments > 0 && <span className="font-medium">{totalComments}</span>}
              </button>
            </div>

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
        ) : null}
      </div>

      {showComments && selectedItem ? (
        <ChangeComments
          changeId={selectedItem.id}
          viewerUserId={viewerUserId}
          count={commentCounts[String(selectedItem.id)] ?? 0}
          expanded={true}
        />
      ) : null}
    </article>
  )
})

const ChangeGroupsList = memo(function ChangeGroupsList(props: {
  groups: ChangeGroup[]
  gitCwd: string | null
  previousCheckpointGroupIds: ReadonlyMap<string, string | null>
  commentCounts: Record<string, number>
  viewerUserId: Id<'users'> | null
  selectedFilePath: string | null
}) {
  const {
    groups,
    gitCwd,
    previousCheckpointGroupIds,
    commentCounts,
    viewerUserId,
    selectedFilePath,
  } = props
  const scrollParentRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 450,
    overscan: 10,
    getItemKey: (index) => groups[index]?.groupId ?? index,
  })

  return (
    <div ref={scrollParentRef} className="flex-1 min-h-0 w-full overflow-y-auto">
      <div
        className="relative w-full"
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const group = groups[virtualItem.index]
          if (!group) return null

          return (
            <div
              key={virtualItem.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <ChangeGroupRow
                group={group}
                gitCwd={gitCwd}
                previousCheckpointGroupId={previousCheckpointGroupIds.get(group.groupId) ?? null}
                commentCounts={commentCounts}
                viewerUserId={viewerUserId}
                selectedFilePath={selectedFilePath}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})

export function ChangesPage(_props: ChangesPageProps) {
  const { t } = useTranslation()
  const { project, convexUserId } = useAccessibleProject()
  const routeContext = useOptionalProjectRouteContext()
  const gitCwd = routeContext?.gitCwd ?? null

  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 200 } : 'skip',
  ) as ActivityFeedItem[] | undefined

  const hasActivityLoaded = activity !== undefined;
  const changesPageData = useMemo(() => deriveChangesPageData(activity), [activity]);
  const {
    groups,
    uniqueFiles,
    filePathSet,
    groupsByFilePath,
    changeIds,
    changeIdsByFilePath,
    previousCheckpointGroupIds,
  } = changesPageData;

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileFilterQuery, setFileFilterQuery] = useState("");

  const visibleFiles = useMemo(() => {
    if (!fileFilterQuery.trim()) return uniqueFiles;
    return uniqueFiles.filter((file) => matchesFileFilter(file.filePath, fileFilterQuery));
  }, [fileFilterQuery, uniqueFiles]);

  useEffect(() => {
    if (!selectedFilePath) return;

    if (!filePathSet.has(selectedFilePath)) {
      setSelectedFilePath(null);
    }
  }, [filePathSet, selectedFilePath]);

  const handleFileFilterChange = useCallback((filePath: string | null) => {
    setSelectedFilePath(filePath);
  }, []);

  const filteredGroups = useMemo(() => {
    if (!selectedFilePath) return groups;
    return groupsByFilePath.get(selectedFilePath) ?? EMPTY_CHANGE_GROUPS;
  }, [groups, groupsByFilePath, selectedFilePath]);

  const commentChangeIds = selectedFilePath
    ? (changeIdsByFilePath.get(selectedFilePath) ?? EMPTY_CHANGE_IDS)
    : changeIds;
  
  const commentCounts = useQuery(
    api.activity.getCommentCountsForChanges,
    project?._id && commentChangeIds.length > 0
      ? { projectId: project._id, changeIds: commentChangeIds }
      : 'skip',
  ) as Record<string, number> | undefined

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
                       onFileFilterChange={handleFileFilterChange}
                       selectedFilePath={selectedFilePath}
                     />
                   ) : (
                     hasActivityLoaded ? (
                       <div className="px-4 py-3 text-xs text-muted-foreground">
                         {t('changes.empty.noMatchingFiles')}
                       </div>
                     ) : null
                   )}
                 </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col bg-background">
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
                
                {filteredGroups.length > 0 ? (
                  <ChangeGroupsList
                    groups={filteredGroups}
                    gitCwd={gitCwd}
                    previousCheckpointGroupIds={previousCheckpointGroupIds}
                    commentCounts={commentCounts ?? EMPTY_COMMENT_COUNTS}
                    viewerUserId={convexUserId}
                    selectedFilePath={selectedFilePath}
                  />
                ) : hasActivityLoaded ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                    <HugeiconsIcon icon={__ClockHugeIcon} className="size-8 text-muted-foreground/35" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{t('changes.empty.title')}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('changes.empty.desc')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </CheckpointDiffWorkerProvider>
  )
}
