import { HugeiconsIcon } from '@hugeicons/react'
import {
  Clock01Icon as __ClockHugeIcon,
  LayoutTwoColumnIcon as __SplitViewHugeIcon,
  LayoutTwoRowIcon as __StackedViewHugeIcon,
  PanelLeftIcon as __SidebarHugeIcon,
  Search01Icon as __SearchHugeIcon,
  FilterMailIcon as __FilterHugeIcon,
  MoreVerticalIcon as __MoreVerticalHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
} from '@hugeicons/core-free-icons'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery } from 'convex/react'
import type { ContextMenuItem } from '@cozea/assistant-contracts'
import type { GitChangeFileSummary, GitChangesScope } from '@shared/electronApiTypes'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useOptionalProjectRouteContext } from '@/features/projects/contexts/ProjectRouteContext'
import { useOptionalProjectSyncContext } from '@/features/projects/contexts/ProjectSyncContext'
import { projectOpenDesktopClient } from '@/features/projects/lib/projectOpenDesktopClient'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { CheckpointDiffWorkerProvider } from '../components/changes/CheckpointDiffWorkerProvider'
import { useTranslation } from '@/lib/i18n'
import { formatActorDisplayName } from '@/lib/userDisplay'
import { showDesktopContextMenu } from '@/lib/desktopBridgeClient'
import { useTheme } from '@/contexts/ThemeContext'
import {
  buildPatchCacheKey,
  resolveDiffThemeName,
} from '@/features/projects/components/assistant/lib/diffRendering'
import {
  CHANGES_TILE_MIN_WIDTH_COLLAPSED,
  CHANGES_TILE_MIN_WIDTH_EXPANDED,
} from '@/features/projects/lib/changesTileSizing'

import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { ChangedFilesTree, type ChangedFilesTreeFile } from '../components/changes/ChangedFilesTree'

const CHECKPOINT_PATCH_CACHE_MAX_ENTRIES = 48
type ChangesScope = 'current' | 'lastTurn' | 'branch' | 'history'
type ChangesDiffStyle = 'split' | 'unified'

const CHANGE_GROUP_DIFF_UNSAFE_CSS = `
[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
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
}): string {
  return [
    input.gitCwd,
    input.previousCheckpointGroupId ?? 'head',
    input.groupId,
  ].join('\0')
}

function parseCheckpointPatch(
  patch: string,
  groupId: string,
): FileDiffMetadata[] {
  const normalizedPatch = patch.trim()
  if (!normalizedPatch) return []

  const parsedPatches = parsePatchFiles(
    normalizedPatch,
    buildPatchCacheKey(normalizedPatch, `changes:${groupId}`),
  )
  return parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
}

async function loadCheckpointPatch(input: {
  gitCwd: string
  groupId: string
  previousCheckpointGroupId: string | null
}): Promise<CheckpointPatchCacheEntry> {
  const cacheKey = buildCheckpointPatchCacheKey(input)
  const cached = readCheckpointPatchCache(cacheKey)
  if (cached) return cached

  const inFlight = checkpointPatchRequests.get(cacheKey)
  if (inFlight) return inFlight

  const request = projectOpenDesktopClient.sync
    .gitDiffCheckpoints({
      projectPath: input.gitCwd,
      fromCheckpointId: input.previousCheckpointGroupId ?? undefined,
      toCheckpointId: input.groupId,
    })
    .then((result) => {
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load patch.')
      }

      const patch = result.diff ?? ''
      const entry: CheckpointPatchCacheEntry = {
        patch,
        parsedFiles: parseCheckpointPatch(patch, input.groupId),
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

interface ScopeOption {
  value: ChangesScope
  label: string
  count: number | null
}

function gitStatusToChangeType(status: GitChangeFileSummary['status']): ChangedFilesTreeFile['changeType'] {
  switch (status) {
    case 'added':
      return 'create'
    case 'deleted':
      return 'delete'
    case 'renamed':
      return 'rename'
    case 'modified':
    default:
      return 'modify'
  }
}

function gitFileToTreeFile(file: GitChangeFileSummary): ChangedFilesTreeFile {
  return {
    filePath: file.path,
    changeType: gitStatusToChangeType(file.status),
  }
}

function getUniqueFilesForItems(items: readonly ActivityFeedItem[]): ActivityFeedItem[] {
  const uniqueFilesByPath = new Map<string, ActivityFeedItem>()
  for (const item of items) {
    const existingFile = uniqueFilesByPath.get(item.filePath)
    if (existingFile) {
      existingFile.additions = (existingFile.additions ?? 0) + (item.additions ?? 0)
      existingFile.deletions = (existingFile.deletions ?? 0) + (item.deletions ?? 0)
    } else {
      uniqueFilesByPath.set(item.filePath, { ...item })
    }
  }

  return Array.from(uniqueFilesByPath.values()).sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )
}

function ScopeCountBadge({ count }: { count: number | null }) {
  if (count === null) return null

  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
      {count}
    </span>
  )
}

function formatScopeCountSublabel(count: number | null): string | undefined {
  if (count === null) return undefined
  return `${count} ${count === 1 ? 'file' : 'files'}`
}

function buildChangesScopeMenuItems(
  options: readonly ScopeOption[],
  scope: ChangesScope,
): ContextMenuItem<ChangesScope>[] {
  return options.map((option) => ({
    id: option.value,
    label: option.label,
    sublabel: formatScopeCountSublabel(option.count),
    type: 'radio',
    checked: option.value === scope,
  }))
}

function ChangesScopeMenu(props: {
  scope: ChangesScope
  options: readonly ScopeOption[]
  onScopeChange: (scope: ChangesScope) => void
}) {
  const { scope, options, onScopeChange } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === scope) ?? options[0]

  const handleOpenMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (options.length === 0) return

      const rect = event.currentTarget.getBoundingClientRect()
      const position = {
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
      }
      const items = buildChangesScopeMenuItems(options, scope)

      setMenuOpen(true)
      try {
        const selectedScope = await showDesktopContextMenu(items, position)
        if (selectedScope && selectedScope !== scope) {
          onScopeChange(selectedScope)
        }
      } finally {
        setMenuOpen(false)
      }
    },
    [onScopeChange, options, scope],
  )

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-7 max-w-[14rem] items-center gap-2 rounded-md px-1.5 text-foreground transition-colors hover:bg-muted/70"
        onClick={handleOpenMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="truncate text-[13px] font-medium">{selectedOption?.label ?? 'Current'}</span>
        <ScopeCountBadge count={selectedOption?.count ?? null} />
        <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </div>
  )
}

interface GitChangesSnapshot {
  cacheKey: string
  files: GitChangeFileSummary[]
  patch: string
  loaded: boolean
  error: string | null
  baseRef?: string
  headRef?: string
}

type GitChangesSnapshotCache = Partial<Record<GitChangesScope, GitChangesSnapshot>>

const EMPTY_GIT_CHANGES_SNAPSHOT: GitChangesSnapshot = {
  cacheKey: '',
  files: [],
  patch: '',
  loaded: false,
  error: null,
}

function buildGitChangesSnapshotCacheKey(input: {
  gitCwd: string
  scope: GitChangesScope
  refreshKey: number
}): string {
  return [input.gitCwd, input.scope, input.refreshKey].join('\0')
}

function useActiveGitChanges(
  gitCwd: string | null,
  scope: GitChangesScope | null,
  refreshKey: number,
): { active: GitChangesSnapshot; cache: GitChangesSnapshotCache } {
  const [cache, setCache] = useState<GitChangesSnapshotCache>({})
  const cacheRef = useRef(cache)
  const mountedRef = useRef(true)
  const requestedKeysRef = useRef(new Set<string>())

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    cacheRef.current = cache
  }, [cache])

  useEffect(() => {
    if (!gitCwd || !scope) return

    const cacheKey = buildGitChangesSnapshotCacheKey({ gitCwd, scope, refreshKey })
    const cached = cacheRef.current[scope]
    if (cached?.cacheKey === cacheKey && cached.loaded) return
    if (requestedKeysRef.current.has(cacheKey)) return

    requestedKeysRef.current.add(cacheKey)
    setCache((current) => ({
      ...current,
      [scope]: {
        cacheKey,
        files: current[scope]?.files ?? [],
        patch: current[scope]?.patch ?? '',
        loaded: false,
        error: null,
        baseRef: current[scope]?.baseRef,
        headRef: current[scope]?.headRef,
      },
    }))

    void projectOpenDesktopClient.sync
      .gitReadChanges({
        projectPath: gitCwd,
        scope,
      })
      .then((result) => {
        if (!mountedRef.current) return

        setCache((current) => ({
          ...current,
          [scope]: {
            cacheKey,
            files: result.success ? result.files : [],
            patch: result.success ? (result.diff ?? '') : '',
            loaded: true,
            error: result.success ? null : (result.error ?? 'Failed to load git changes.'),
            baseRef: result.baseRef,
            headRef: result.headRef,
          },
        }))
      })
      .catch((requestError) => {
        if (!mountedRef.current) return

        setCache((current) => ({
          ...current,
          [scope]: {
            cacheKey,
            files: [],
            patch: '',
            loaded: true,
            error: requestError instanceof Error ? requestError.message : 'Failed to load git changes.',
          },
        }))
      })
      .finally(() => {
        requestedKeysRef.current.delete(cacheKey)
      })
  }, [gitCwd, refreshKey, scope])

  const activeCacheKey =
    gitCwd && scope ? buildGitChangesSnapshotCacheKey({ gitCwd, scope, refreshKey }) : null
  const activeSnapshot = scope ? cache[scope] : null
  const active =
    activeSnapshot && activeSnapshot.cacheKey === activeCacheKey
      ? activeSnapshot
      : EMPTY_GIT_CHANGES_SNAPSHOT

  return { active, cache }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [delayMs, value])

  return debouncedValue
}

interface ChangesPageProps {
  presentation?: 'modal' | 'embedded'
  projectPath?: string | null
  onRequestClose?: (() => void) | null
  setChromeControlsNode?: (node: React.ReactNode) => void
  setChromeTitleContent?: (node: React.ReactNode) => void
  setDockviewMinimumWidth?: (minimumWidth: number) => void
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
}

interface ChangesPageData {
  groups: ChangeGroup[]
  uniqueFiles: ActivityFeedItem[]
  groupsByFilePath: ReadonlyMap<string, ChangeGroup[]>
  previousCheckpointGroupIds: ReadonlyMap<string, string | null>
}

const EMPTY_CHANGE_GROUPS: ChangeGroup[] = []
const EMPTY_CHANGES_PAGE_DATA: ChangesPageData = {
  groups: EMPTY_CHANGE_GROUPS,
  uniqueFiles: [],
  groupsByFilePath: new Map<string, ChangeGroup[]>(),
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

  for (const item of items) {
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
    groupsByFilePath,
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

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function getFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? ""}->${fileDiff.name}`;
}

interface SearchableFileDiff {
  fileDiff: FileDiffMetadata
  filePath: string
  searchText: string
}

function buildFileDiffSearchText(fileDiff: FileDiffMetadata, filePath: string): string {
  return [
    filePath,
    fileDiff.name,
    fileDiff.prevName ?? '',
    ...fileDiff.additionLines,
    ...fileDiff.deletionLines,
  ].join('\n').toLowerCase()
}

function toSearchableFileDiffs(parsedFiles: readonly FileDiffMetadata[]): SearchableFileDiff[] {
  return parsedFiles.map((fileDiff) => {
    const filePath = resolveFileDiffPath(fileDiff)
    return {
      fileDiff,
      filePath,
      searchText: buildFileDiffSearchText(fileDiff, filePath),
    }
  })
}

function getVisibleSearchableFileDiffs(input: {
  fileDiffs: readonly SearchableFileDiff[]
  selectedFilePath: string | null
  codeSearchQuery: string
}): SearchableFileDiff[] {
  const normalizedQuery = input.codeSearchQuery.trim().toLowerCase()
  let fileDiffs = input.fileDiffs

  if (input.selectedFilePath) {
    fileDiffs = fileDiffs.filter((fileDiff) => fileDiff.filePath === input.selectedFilePath)
  }

  if (normalizedQuery) {
    fileDiffs = fileDiffs.filter((fileDiff) => fileDiff.searchText.includes(normalizedQuery))
  }

  return [...fileDiffs]
}

function ChangeGroupHeaderPrefix({ group }: { group: ChangeGroup }) {
  const displayUserName = formatActorDisplayName(group.userName);

  return (
    <div className="flex min-w-0 items-center gap-2 border-r border-border/60 pr-3">
      <span className="truncate text-sm font-semibold text-foreground">{displayUserName}</span>
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
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const { gitCwd, groupId, previousCheckpointGroupId } = input
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
  }
  const cacheKey = buildCheckpointPatchCacheKey(cacheInput)
  const cached = readCheckpointPatchCache(cacheKey)
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
  failedToLoadPatchMessage: string
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const {
    gitCwd,
    groupId,
    previousCheckpointGroupId,
    failedToLoadPatchMessage,
    noLocalCheckpointMessage,
  } = input
  const [state, setState] = useState<CheckpointPatchState>(() =>
    createCheckpointPatchState({
      gitCwd,
      groupId,
      previousCheckpointGroupId,
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
    })
    const cached = readCheckpointPatchCache(cacheKey)
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
  ])

  return state
}

function highlightTextNodes(root: Node, query: string) {
  if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const container = root as Element | DocumentFragment;
    
    const marks = Array.from(container.querySelectorAll('mark.search-highlight'));
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    }

    const elements = container.querySelectorAll('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el.hasAttribute('data-diffs-header')) continue;
      if (el.shadowRoot) {
        highlightTextNodes(el.shadowRoot, query);
      }
    }
    
    if ('shadowRoot' in container && (container as Element).shadowRoot) {
      highlightTextNodes((container as Element).shadowRoot!, query);
    }
  }

  if (!query) return;

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodesToProcess: Text[] = [];
  
  let node;
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node as Text);
  }

  for (const textNode of nodesToProcess) {
    let text = textNode.nodeValue;
    if (!text || !text.toLowerCase().includes(lowerQuery)) continue;
    
    const parentNode = textNode.parentNode;
    if (parentNode) {
      const nodeName = parentNode.nodeName.toLowerCase();
      if (nodeName === 'style' || nodeName === 'script') continue;
      if (parentNode instanceof Element && parentNode.closest('[data-diffs-header]')) continue;
    }
    
    const fragment = document.createDocumentFragment();
    let lowerText = text.toLowerCase();
    
    while (true) {
      const index = lowerText.indexOf(lowerQuery);
      if (index === -1) {
        if (text) fragment.appendChild(document.createTextNode(text));
        break;
      }
      
      const matchText = text.substring(index, index + query.length);
      const beforeText = text.substring(0, index);
      
      if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
      
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.style.backgroundColor = 'rgba(234, 179, 8, 0.4)';
      mark.style.borderRadius = '2px';
      mark.style.color = 'inherit';
      mark.style.padding = '0 1px';
      mark.style.margin = '0 -1px';
      mark.textContent = matchText;
      fragment.appendChild(mark);
      
      text = text.substring(index + query.length);
      lowerText = lowerText.substring(index + query.length);
    }
    
    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

function scheduleSearchHighlight(node: HTMLElement, query: string): void {
  const normalizedQuery = query.trim()
  node.dataset.cozeaSearchQuery = normalizedQuery

  const run = () => {
    if (!node.isConnected) return
    if (node.dataset.cozeaSearchQuery !== normalizedQuery) return
    highlightTextNodes(node, normalizedQuery)
  }

  if (normalizedQuery && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 250 })
    return
  }

  run()
}

function resolveChangesDiffThemeMode(theme: ReturnType<typeof useTheme>['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') {
    return theme
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }

  return 'light'
}

const ChangesFileDiffBlock = memo(function ChangesFileDiffBlock(props: {
  fileDiff: FileDiffMetadata
  renderHeaderPrefix?: (fileDiff: FileDiffMetadata) => React.ReactNode
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const { fileDiff, renderHeaderPrefix, diffStyle, codeSearchQuery } = props
  const { theme } = useTheme()
  const themeType = resolveChangesDiffThemeMode(theme)
  const diffThemeName = resolveDiffThemeName(themeType)

  const diffOptions = useMemo(() => ({
    diffStyle,
    lineDiffType: "none" as const,
    overflow: "scroll" as const,
    theme: diffThemeName,
    themeType,
    unsafeCSS: CHANGE_GROUP_DIFF_UNSAFE_CSS,
    onPostRender: (node: HTMLElement) => scheduleSearchHighlight(node, codeSearchQuery),
  }), [codeSearchQuery, diffStyle, diffThemeName, themeType])

  return (
    <div className="relative min-w-0 bg-card">
      <FileDiff
        fileDiff={fileDiff}
        renderHeaderPrefix={renderHeaderPrefix}
        options={diffOptions}
      />
    </div>
  )
})

function ChangesFileDiffList({ children }: { children: React.ReactNode }) {
  return (
    <Virtualizer
      className="min-h-0 flex-1 overflow-y-auto bg-card"
      contentClassName="flex min-h-full flex-col"
      config={{
        overscrollSize: 600,
        intersectionObserverMargin: 1200,
      }}
    >
      {children}
    </Virtualizer>
  )
}

const FileDiffsView = memo(function FileDiffsView(props: {
  parsedFiles: FileDiffMetadata[]
  loaded: boolean
  patchError: string | null
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const { parsedFiles, loaded, patchError, selectedFilePath, diffStyle, codeSearchQuery } = props

  const searchableFileDiffs = useMemo(() => toSearchableFileDiffs(parsedFiles), [parsedFiles])
  const visibleFileDiffs = useMemo(() => {
    return getVisibleSearchableFileDiffs({
      fileDiffs: searchableFileDiffs,
      selectedFilePath,
      codeSearchQuery,
    })
  }, [codeSearchQuery, searchableFileDiffs, selectedFilePath])

  if (patchError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {patchError}
      </div>
    )
  }

  if (!loaded) {
    return <div className="min-h-0 flex-1" aria-hidden="true" />
  }

  if (visibleFileDiffs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {codeSearchQuery ? 'No matching diff lines.' : 'No changes in this scope.'}
      </div>
    )
  }

  return (
    <ChangesFileDiffList>
      {visibleFileDiffs.map(({ fileDiff }, index) => (
        <div
          key={`${getFileDiffRenderKey(fileDiff)}:${index}`}
          className="min-w-0"
        >
          <ChangesFileDiffBlock
            fileDiff={fileDiff}
            diffStyle={diffStyle}
            codeSearchQuery={codeSearchQuery}
          />
        </div>
      ))}
    </ChangesFileDiffList>
  )
})

const HistoryChangeGroupDiffs = memo(function HistoryChangeGroupDiffs(props: {
  group: ChangeGroup
  gitCwd: string | null
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const {
    group,
    gitCwd,
    previousCheckpointGroupId,
    selectedFilePath,
    diffStyle,
    codeSearchQuery,
  } = props
  const { t } = useTranslation()
  const { patch, parsedFiles, patchError } = useCheckpointPatch({
    gitCwd,
    groupId: group.groupId,
    previousCheckpointGroupId,
    failedToLoadPatchMessage: t('changes.error.failedToLoadPatch'),
    noLocalCheckpointMessage: t('changes.error.noLocalCheckpoint'),
  })

  const searchableFileDiffs = useMemo(() => toSearchableFileDiffs(parsedFiles), [parsedFiles])
  const visibleFileDiffs = useMemo(() => {
    return getVisibleSearchableFileDiffs({
      fileDiffs: searchableFileDiffs,
      selectedFilePath,
      codeSearchQuery,
    })
  }, [codeSearchQuery, searchableFileDiffs, selectedFilePath])
  const renderHeaderPrefix = useCallback(() => <ChangeGroupHeaderPrefix group={group} />, [group])

  if (patchError) {
    return (
      <div className="min-w-0 bg-card">
        <div className="flex min-h-10 items-center gap-2 px-3 py-2">
          <ChangeGroupHeaderPrefix group={group} />
        </div>
        <div className="px-3 pb-3 text-xs text-destructive">{patchError}</div>
      </div>
    )
  }

  if (patch === null || visibleFileDiffs.length === 0) {
    return null
  }

  return (
    <>
      {visibleFileDiffs.map(({ fileDiff }, index) => (
        <div
          key={`${group.groupId}:${getFileDiffRenderKey(fileDiff)}:${index}`}
          className="min-w-0"
        >
          <ChangesFileDiffBlock
            fileDiff={fileDiff}
            renderHeaderPrefix={renderHeaderPrefix}
            diffStyle={diffStyle}
            codeSearchQuery={codeSearchQuery}
          />
        </div>
      ))}
    </>
  )
})

const HistoryChangesView = memo(function HistoryChangesView(props: {
  groups: ChangeGroup[]
  gitCwd: string | null
  previousCheckpointGroupIds: ReadonlyMap<string, string | null>
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const {
    groups,
    gitCwd,
    previousCheckpointGroupIds,
    selectedFilePath,
    diffStyle,
    codeSearchQuery,
  } = props

  return (
    <ChangesFileDiffList>
      {groups.map((group) => (
        <HistoryChangeGroupDiffs
          key={group.groupId}
          group={group}
          gitCwd={gitCwd}
          previousCheckpointGroupId={previousCheckpointGroupIds.get(group.groupId) ?? null}
          selectedFilePath={selectedFilePath}
          diffStyle={diffStyle}
          codeSearchQuery={codeSearchQuery}
        />
      ))}
    </ChangesFileDiffList>
  )
})

const ParsedPatchDiffView = memo(function ParsedPatchDiffView(props: {
  patch: string | null
  loaded: boolean
  patchError: string | null
  cacheScope: string
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const { patch, loaded, patchError, cacheScope, selectedFilePath, diffStyle, codeSearchQuery } = props
  const parsedFiles = useMemo(() => {
    if (!loaded || patch === null || !patch.trim()) return []
    const normalizedPatch = patch.trim()
    return parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    ).flatMap((parsedPatch) => parsedPatch.files)
  }, [cacheScope, loaded, patch])

  return (
    <FileDiffsView
      parsedFiles={parsedFiles}
      loaded={loaded}
      patchError={patchError}
      selectedFilePath={selectedFilePath}
      diffStyle={diffStyle}
      codeSearchQuery={codeSearchQuery}
    />
  )
})

const LastTurnChangesView = memo(function LastTurnChangesView(props: {
  gitCwd: string | null
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
  latestGroup: ChangeGroup | null
  previousCheckpointGroupId: string | null
}) {
  const {
    gitCwd,
    selectedFilePath,
    diffStyle,
    codeSearchQuery,
    latestGroup,
    previousCheckpointGroupId,
  } = props
  const [patch, setPatch] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)

  useEffect(() => {
    setPatch(null)
    setPatchError(null)

    if (!gitCwd) {
      setPatchError('Project path is unavailable.')
      return
    }

    let cancelled = false
    const request = latestGroup?.groupId
      ? projectOpenDesktopClient.sync.gitDiffCheckpoints({
          projectPath: gitCwd,
          fromCheckpointId: previousCheckpointGroupId ?? undefined,
          toCheckpointId: latestGroup.groupId,
        })
      : Promise.resolve({
          success: true,
          diff: '',
          error: undefined,
        })

    void request
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setPatch('')
          setPatchError(result.error ?? 'Failed to load diff.')
          return
        }
        setPatch(result.diff ?? '')
        setPatchError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setPatch('')
        setPatchError(error instanceof Error ? error.message : 'Failed to load diff.')
      })

    return () => {
      cancelled = true
    }
  }, [gitCwd, latestGroup?.groupId, previousCheckpointGroupId])

  return (
    <ParsedPatchDiffView
      patch={patch}
      loaded={patch !== null || patchError !== null}
      patchError={patchError}
      cacheScope={`changes:lastTurn:${latestGroup?.groupId ?? 'none'}`}
      selectedFilePath={selectedFilePath}
      diffStyle={diffStyle}
      codeSearchQuery={codeSearchQuery}
    />
  )
})

export function ChangesPage(_props: ChangesPageProps) {
  const { t } = useTranslation()
  const { project } = useAccessibleProject()
  const routeContext = useOptionalProjectRouteContext()
  const syncContext = useOptionalProjectSyncContext()
  const gitCwd =
    _props.projectPath ??
    routeContext?.activeLane?.projectPath ??
    routeContext?.gitCwd ??
    syncContext?.gitCwd ??
    null

  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 200 } : 'skip',
  ) as ActivityFeedItem[] | undefined

  const hasActivityLoaded = activity !== undefined;
  const changesPageData = useMemo(() => deriveChangesPageData(activity), [activity]);
  const {
    groups,
    uniqueFiles: historyFiles,
    groupsByFilePath,
    previousCheckpointGroupIds,
  } = changesPageData;

  const latestGroup = groups[0] ?? null;
  const lastTurnFiles = useMemo(
    () => getUniqueFilesForItems(latestGroup?.items ?? []),
    [latestGroup?.items],
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [codeSearchQuery, setCodeSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [diffStyle, setDiffStyle] = useState<ChangesDiffStyle>('unified');
  const [changesScope, setChangesScope] = useState<ChangesScope>('current');
  const [gitRefreshKey, setGitRefreshKey] = useState(0);
  const debouncedCodeSearchQuery = useDebouncedValue(codeSearchQuery, 120);
  const activeGitScope: GitChangesScope | null =
    changesScope === 'current' || changesScope === 'branch' ? changesScope : null;
  const { active: activeGitChanges, cache: gitChangesCache } = useActiveGitChanges(
    gitCwd,
    activeGitScope,
    gitRefreshKey,
  );

  useEffect(() => {
    if (!gitCwd) return;

    let disposed = false;
    void window.electronAPI.sync
      .subscribeGitDirtyState({ projectPath: gitCwd })
      .then(() => {
        if (!disposed) {
          setGitRefreshKey((key) => key + 1);
        }
      })
      .catch(() => undefined);

    const unsubscribeChange = window.electronAPI.sync.onGitDirtyStateChange((snapshot) => {
      if (snapshot.projectPath === gitCwd) {
        setGitRefreshKey((key) => key + 1);
      }
    });

    return () => {
      disposed = true;
      unsubscribeChange();
      void window.electronAPI.sync.unsubscribeGitDirtyState({ projectPath: gitCwd }).catch(() => undefined);
    };
  }, [gitCwd]);

  const currentFiles = useMemo(
    () => (gitChangesCache.current?.files ?? []).map(gitFileToTreeFile),
    [gitChangesCache.current],
  );
  const branchFiles = useMemo(
    () => (gitChangesCache.branch?.files ?? []).map(gitFileToTreeFile),
    [gitChangesCache.branch],
  );

  const activeFiles: readonly ChangedFilesTreeFile[] = useMemo(() => {
    switch (changesScope) {
      case 'current':
        return currentFiles;
      case 'lastTurn':
        return lastTurnFiles;
      case 'branch':
        return branchFiles;
      case 'history':
        return historyFiles;
      default:
        return historyFiles;
    }
  }, [branchFiles, changesScope, currentFiles, historyFiles, lastTurnFiles]);

  const activeFilesLoaded =
    changesScope === 'current'
      ? activeGitChanges.loaded || !gitCwd
      : changesScope === 'branch'
        ? activeGitChanges.loaded || !gitCwd
        : hasActivityLoaded;
  const activeGitChangesError = !gitCwd
    ? 'Project path is unavailable.'
    : activeGitChanges.error;
  const activeGitChangesLoaded = !gitCwd || activeGitChanges.loaded;

  const visibleFiles = useMemo(() => {
    if (!fileFilterQuery.trim()) return activeFiles;
    return activeFiles.filter((file) => matchesFileFilter(file.filePath, fileFilterQuery));
  }, [activeFiles, fileFilterQuery]);

  const activeFilePathSet = useMemo(
    () => new Set(activeFiles.map((file) => file.filePath)),
    [activeFiles],
  );

  useEffect(() => {
    if (!selectedFilePath) return;

    if (!activeFilePathSet.has(selectedFilePath)) {
      setSelectedFilePath(null);
    }
  }, [activeFilePathSet, selectedFilePath]);

  const handleFileFilterChange = useCallback((filePath: string | null) => {
    setSelectedFilePath(filePath);
  }, []);

  const { setChromeControlsNode, setChromeTitleContent, setDockviewMinimumWidth } = _props;

  const scopeOptions = useMemo<ScopeOption[]>(() => [
    {
      value: 'current',
      label: 'Current',
      count: gitChangesCache.current?.loaded ? gitChangesCache.current.files.length : null,
    },
    {
      value: 'lastTurn',
      label: 'Last turn',
      count: hasActivityLoaded ? lastTurnFiles.length : null,
    },
    {
      value: 'branch',
      label: 'Branch',
      count: gitChangesCache.branch?.loaded ? gitChangesCache.branch.files.length : null,
    },
    {
      value: 'history',
      label: 'History',
      count: hasActivityLoaded ? historyFiles.length : null,
    },
  ], [
    gitChangesCache.branch,
    gitChangesCache.current,
    hasActivityLoaded,
    historyFiles.length,
    lastTurnFiles.length,
  ]);

  useLayoutEffect(() => {
    setDockviewMinimumWidth?.(
      sidebarCollapsed
        ? CHANGES_TILE_MIN_WIDTH_COLLAPSED
        : CHANGES_TILE_MIN_WIDTH_EXPANDED,
    );
  }, [setDockviewMinimumWidth, sidebarCollapsed]);

  useLayoutEffect(() => {
    if (!setChromeTitleContent) return;

    setChromeTitleContent(
      <ChangesScopeMenu
        scope={changesScope}
        options={scopeOptions}
        onScopeChange={setChangesScope}
      />,
    );
  }, [changesScope, scopeOptions, setChromeTitleContent]);

  useEffect(() => {
    return () => {
      setChromeTitleContent?.(null);
    };
  }, [setChromeTitleContent]);

  useLayoutEffect(() => {
    if (!setChromeControlsNode) return;

    setChromeControlsNode(
      <div className="flex h-full w-full items-center gap-2 px-1">
        <div className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border/40 bg-muted/60 transition-colors focus-within:border-border/60 focus-within:bg-background">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(prev => !prev)}
            className="flex h-full w-7 shrink-0 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            aria-label={sidebarCollapsed ? "Expand files sidebar" : "Collapse files sidebar"}
          >
            <HugeiconsIcon icon={__SidebarHugeIcon} className="size-4" />
          </button>
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none ml-1 size-3.5 shrink-0 text-muted-foreground/70"
          />
          <input
            value={codeSearchQuery}
            onChange={(e) => setCodeSearchQuery(e.target.value)}
            placeholder="Search within code"
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={() => setDiffStyle((prev) => prev === 'split' ? 'unified' : 'split')}
            className="flex h-full w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            title={diffStyle === 'split' ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
            aria-label={diffStyle === 'split' ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
          >
            <HugeiconsIcon icon={diffStyle === 'split' ? __StackedViewHugeIcon : __SplitViewHugeIcon} className="size-4" />
          </button>
          <button
            type="button"
            className="flex h-full w-7 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            aria-label="Settings"
          >
            <HugeiconsIcon icon={__MoreVerticalHugeIcon} className="size-4" />
          </button>
        </div>
      </div>
    );
  }, [setChromeControlsNode, sidebarCollapsed, codeSearchQuery, diffStyle, t]);

  const filteredGroups = useMemo(() => {
    if (!selectedFilePath) return groups;
    return groupsByFilePath.get(selectedFilePath) ?? EMPTY_CHANGE_GROUPS;
  }, [groups, groupsByFilePath, selectedFilePath]);

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
              <div
                className="flex flex-col shrink-0 overflow-hidden border-r border-border/70 will-change-transform"
                style={{
                  width: 260,
                  transform: sidebarCollapsed ? 'translateX(-100%)' : 'translateX(0)',
                  marginRight: sidebarCollapsed ? -260 : 0,
                  transition: 'transform 150ms ease-out, margin-right 150ms ease-out',
                }}
              >
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
                     activeFilesLoaded ? (
                       <div className="px-4 py-3 text-xs text-muted-foreground">
                         {t('changes.empty.noMatchingFiles')}
                       </div>
                     ) : null
                   )}
                 </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col bg-background">
	                {changesScope === 'history' ? (
	                  filteredGroups.length > 0 ? (
	                    <HistoryChangesView
	                      groups={filteredGroups}
	                      gitCwd={gitCwd}
	                      previousCheckpointGroupIds={previousCheckpointGroupIds}
                      selectedFilePath={selectedFilePath}
                      diffStyle={diffStyle}
                      codeSearchQuery={debouncedCodeSearchQuery}
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
                  )
                ) : changesScope === 'lastTurn' ? (
                  <LastTurnChangesView
                    gitCwd={gitCwd}
                    selectedFilePath={selectedFilePath}
                    diffStyle={diffStyle}
                    codeSearchQuery={debouncedCodeSearchQuery}
                    latestGroup={latestGroup}
                    previousCheckpointGroupId={
                      latestGroup ? (previousCheckpointGroupIds.get(latestGroup.groupId) ?? null) : null
                    }
                  />
                ) : (
                  <ParsedPatchDiffView
                    patch={activeGitChanges.patch}
                    loaded={activeGitChangesLoaded}
                    patchError={activeGitChangesError}
                    cacheScope={`changes:${changesScope}`}
                    selectedFilePath={selectedFilePath}
                    diffStyle={diffStyle}
                    codeSearchQuery={debouncedCodeSearchQuery}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </CheckpointDiffWorkerProvider>
  )
}
