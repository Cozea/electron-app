import { HugeiconsIcon } from '@hugeicons/react'
import {
  Clock01Icon as __ClockHugeIcon,
  CheckmarkCircle01Icon as __CleanHugeIcon,
  BubbleChatIcon as __ChatHugeIcon,
  GitBranchIcon as __BranchHugeIcon,
  HierarchyFilesIcon as __SidebarHugeIcon,
  SearchList02Icon as __SearchHugeIcon,
  FilterMailIcon as __FilterHugeIcon,
  MoreVerticalIcon as __MoreVerticalHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
} from '@hugeicons/core-free-icons'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import type { GitChangeFileSummary, GitChangesScope } from '@shared/electronApiTypes'
import type { ContextMenuItem } from '@cozea/assistant-contracts'

import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useOptionalProjectRouteContext } from '@/features/projects/contexts/ProjectRouteContext'
import { useOptionalProjectSyncContext } from '@/features/projects/contexts/ProjectSyncContext'
import { markSyncFeedAsSeen } from '../syncFeedSeen'
import { CheckpointDiffWorkerProvider } from '../components/changes/CheckpointDiffWorkerProvider'
import { useTranslation } from '@/lib/i18n'
import { useGitChangesStore } from '@/stores/useGitChangesStore'
import { useChangesSidebarStore } from '@/stores/useChangesSidebarStore'
import { formatActorDisplayName } from '@/lib/userDisplay'
import { useTheme } from '@/contexts/ThemeContext'
import { showDesktopContextMenu } from '@/lib/desktopBridgeClient'
import {
  buildPatchCacheKey,
  resolveDiffThemeName,
} from '@/features/projects/components/assistant/lib/diffRendering'
import {
  CHANGES_TILE_MIN_WIDTH_COLLAPSED,
} from '@/features/projects/lib/changesTileSizing'

import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import type { ChangedFilesTreeFile } from '../components/changes/ChangedFilesTree'

const CHECKPOINT_PATCH_CACHE_MAX_ENTRIES = 48
import { ChangesHeaderControls } from '../components/changes/ChangesHeaderControls'
import { ChangesTreeView } from '../components/changes/ChangesTreeView'
import type { ChangesDiffStyle, ChangesScope } from '../components/changes/ChangesTypes'

type ChangesScopeMenuAction = ChangesScope | `changes-scope:separator-${number}`

const CHANGE_GROUP_DIFF_UNSAFE_CSS = `
[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
}

[data-diffs-header] [data-change-icon] {
  display: none !important;
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
  workspaceId: string
  groupId: string
  previousCheckpointGroupId: string | null
}): string {
  return [
    input.workspaceId,
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
  workspaceId: string
  groupId: string
  previousCheckpointGroupId: string | null
}): Promise<CheckpointPatchCacheEntry> {
  const cacheKey = buildCheckpointPatchCacheKey(input)
  const cached = readCheckpointPatchCache(cacheKey)
  if (cached) return cached

  const inFlight = checkpointPatchRequests.get(cacheKey)
  if (inFlight) return inFlight

  const request = window.electronAPI.workspaceSync
    .gitDiffCheckpoints({
      workspaceId: input.workspaceId,
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

function ChangesEmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  title: string
  subtitle: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <HugeiconsIcon icon={icon} className="size-8 text-muted-foreground/35" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function ChangesScopeMenu(props: {
  scope: ChangesScope
  options: readonly ScopeOption[]
  onScopeChange: (scope: ChangesScope) => void
}) {
  const { scope, options, onScopeChange } = props
  const selectedOption = options.find((option) => option.value === scope) ?? options[0]

  const handleOpenMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const rect = event.currentTarget.getBoundingClientRect()
      const items = options.flatMap((option, index): ContextMenuItem<ChangesScopeMenuAction>[] => {
        const item: ContextMenuItem<ChangesScopeMenuAction> = {
          id: option.value,
          type: 'radio',
          label: option.label,
          checked: option.value === scope,
        }

        if (index === options.length - 1) {
          return [item]
        }

        return [
          item,
          {
            id: `changes-scope:separator-${index}`,
            type: 'separator',
          },
        ]
      })

      const action = await showDesktopContextMenu<ChangesScopeMenuAction>(
        items,
        {
          x: Math.round(rect.left),
          y: Math.round(rect.bottom + 4),
        },
      )

      if (action === 'current' || action === 'lastTurn' || action === 'branch' || action === 'history') {
        onScopeChange(action)
      }
    },
    [onScopeChange, options, scope],
  )

  return (
    <button
      type="button"
      aria-haspopup="menu"
      className="flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md px-1.5 text-foreground outline-none transition-colors hover:bg-muted/70"
      onClick={handleOpenMenu}
    >
      <span className="truncate text-[13px] font-medium">{selectedOption?.label ?? 'Current'}</span>
      <ScopeCountBadge count={selectedOption?.count ?? null} />
      <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3 shrink-0 text-muted-foreground" />
    </button>
  )
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
  workspaceId?: string | null
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
  workspaceId: string | null
  groupId: string
  previousCheckpointGroupId: string | null
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const { workspaceId, groupId, previousCheckpointGroupId } = input
  if (!workspaceId || !groupId) {
    return {
      cacheKey: null,
      patch: null,
      parsedFiles: [],
      patchError: input.noLocalCheckpointMessage,
    }
  }

  const cacheInput = {
    workspaceId,
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
  workspaceId: string | null
  groupId: string
  previousCheckpointGroupId: string | null
  failedToLoadPatchMessage: string
  noLocalCheckpointMessage: string
}): CheckpointPatchState {
  const {
    workspaceId,
    groupId,
    previousCheckpointGroupId,
    failedToLoadPatchMessage,
    noLocalCheckpointMessage,
  } = input
  const [state, setState] = useState<CheckpointPatchState>(() =>
    createCheckpointPatchState({
      workspaceId,
      groupId,
      previousCheckpointGroupId,
      noLocalCheckpointMessage,
    }),
  )

  useLayoutEffect(() => {
    if (!workspaceId || !groupId) {
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
      workspaceId,
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
      workspaceId,
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
    workspaceId,
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
      contentClassName="flex min-h-full flex-col -space-y-2"
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
  emptyStateNode?: ReactNode
}) {
  const { parsedFiles, loaded, patchError, selectedFilePath, diffStyle, codeSearchQuery, emptyStateNode } = props

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
    return null
  }

  if (visibleFileDiffs.length === 0) {
    if (codeSearchQuery) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No matching diff lines.
        </div>
      )
    }
    return <>{emptyStateNode ?? <div className="min-h-0 flex-1" />}</>
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
  workspaceId: string | null
  previousCheckpointGroupId: string | null
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const {
    group,
    workspaceId,
    previousCheckpointGroupId,
    selectedFilePath,
    diffStyle,
    codeSearchQuery,
  } = props
  const { t } = useTranslation()
  const { patch, parsedFiles, patchError } = useCheckpointPatch({
    workspaceId,
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
  workspaceId: string | null
  previousCheckpointGroupIds: ReadonlyMap<string, string | null>
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
}) {
  const {
    groups,
    workspaceId,
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
          workspaceId={workspaceId}
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
  emptyStateNode?: ReactNode
}) {
  const { patch, loaded, patchError, cacheScope, selectedFilePath, diffStyle, codeSearchQuery, emptyStateNode } = props
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
      emptyStateNode={emptyStateNode}
    />
  )
})

const LastTurnChangesView = memo(function LastTurnChangesView(props: {
  workspaceId: string | null
  selectedFilePath: string | null
  diffStyle: ChangesDiffStyle
  codeSearchQuery: string
  latestGroup: ChangeGroup | null
  previousCheckpointGroupId: string | null
  emptyStateNode?: ReactNode
}) {
  const {
    workspaceId,
    selectedFilePath,
    diffStyle,
    codeSearchQuery,
    latestGroup,
    previousCheckpointGroupId,
    emptyStateNode,
  } = props
  const [patch, setPatch] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)

  useEffect(() => {
    setPatch(null)
    setPatchError(null)

    if (!workspaceId) {
      setPatchError('Project path is unavailable.')
      return
    }

    let cancelled = false
    const request = latestGroup?.groupId
      ? window.electronAPI.workspaceSync.gitDiffCheckpoints({
          workspaceId: workspaceId,
          fromCheckpointId: previousCheckpointGroupId ?? undefined,
          toCheckpointId: latestGroup.groupId,
        })
      : Promise.resolve({
          success: true,
          diff: '',
          error: undefined,
        })

    void request
    .then((result: { success: boolean; diff?: string; error?: string }) => {
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
  }, [workspaceId, latestGroup?.groupId, previousCheckpointGroupId])

  return (
    <ParsedPatchDiffView
      patch={patch}
      loaded={patch !== null || patchError !== null}
      patchError={patchError}
      cacheScope={`changes:lastTurn:${latestGroup?.groupId ?? 'none'}`}
      selectedFilePath={selectedFilePath}
      diffStyle={diffStyle}
      codeSearchQuery={codeSearchQuery}
      emptyStateNode={emptyStateNode}
    />
  )
})

export function ChangesPage(_props: ChangesPageProps) {
  const { t } = useTranslation()
  const { project } = useAccessibleProject()
  const routeContext = useOptionalProjectRouteContext()
  const syncContext = useOptionalProjectSyncContext()
  const workspaceId =
    _props.workspaceId ??
    routeContext?.activeLane?.workspaceId ??
    routeContext?.workspaceId ??
    syncContext?.workspaceId ??
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
  const viewMode = useChangesSidebarStore((state) => state.viewMode);
  const setViewMode = useChangesSidebarStore((state) => state.actions.setViewMode);
  const [diffStyle, setDiffStyle] = useState<ChangesDiffStyle>('unified');
  const [changesScope, setChangesScope] = useState<ChangesScope>('current');
  const debouncedCodeSearchQuery = useDebouncedValue(codeSearchQuery, 120);
  const activeGitScope: GitChangesScope | null =
    changesScope === 'current' || changesScope === 'branch' ? changesScope : null;

  const projectState = useGitChangesStore((state) => workspaceId ? state.projects[workspaceId] : undefined)
  const currentSnapshot = projectState?.current?.snapshot
  const branchSnapshot = projectState?.branch?.snapshot
  const activeGitChanges = activeGitScope === 'current' ? currentSnapshot : activeGitScope === 'branch' ? branchSnapshot : null

  const watchGitStatus = useGitChangesStore((state) => state.actions.watchGitStatus)

  useEffect(() => {
    if (!workspaceId || !activeGitScope) return
    return watchGitStatus(workspaceId, activeGitScope)
  }, [workspaceId, activeGitScope, watchGitStatus])

  const currentFiles = useMemo(
    () => (currentSnapshot?.files ?? []).map(gitFileToTreeFile),
    [currentSnapshot],
  );
  const branchFiles = useMemo(
    () => (branchSnapshot?.files ?? []).map(gitFileToTreeFile),
    [branchSnapshot],
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
      ? activeGitChanges?.loaded || !workspaceId
      : changesScope === 'branch'
        ? activeGitChanges?.loaded || !workspaceId
        : hasActivityLoaded;
  const activeGitChangesError = !workspaceId
    ? 'Project path is unavailable.'
    : activeGitChanges?.error ?? null;
  const activeGitChangesLoaded = !workspaceId || (activeGitChanges?.loaded ?? false);

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

  const { setChromeControlsNode, setChromeTitleContent, setDockviewMinimumWidth } = _props;

  const scopeOptions = useMemo<ScopeOption[]>(() => [
    {
      value: 'current',
      label: 'Current',
      count: currentSnapshot?.loaded ? currentSnapshot.files.length : null,
    },
    {
      value: 'lastTurn',
      label: 'Last turn',
      count: hasActivityLoaded ? lastTurnFiles.length : null,
    },
    {
      value: 'branch',
      label: 'Branch',
      count: branchSnapshot?.loaded ? branchSnapshot.files.length : null,
    },
    {
      value: 'history',
      label: 'History',
      count: hasActivityLoaded ? historyFiles.length : null,
    },
  ], [
    branchSnapshot,
    currentSnapshot,
    hasActivityLoaded,
    historyFiles.length,
    lastTurnFiles.length,
  ]);

  useLayoutEffect(() => {
    setDockviewMinimumWidth?.(CHANGES_TILE_MIN_WIDTH_COLLAPSED);
  }, [setDockviewMinimumWidth]);

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
      <ChangesHeaderControls
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={viewMode === 'tree' ? fileFilterQuery : codeSearchQuery}
        setSearchQuery={viewMode === 'tree' ? setFileFilterQuery : setCodeSearchQuery}
        diffStyle={diffStyle}
        setDiffStyle={setDiffStyle}
        onRefresh={() => {
          if (workspaceId && activeGitScope) {
            window.electronAPI.workspaceSync.subscribeGitChanges({ workspaceId: workspaceId, scope: activeGitScope }).catch(() => {})
          }
        }}
      />
    );
  }, [setChromeControlsNode, codeSearchQuery, diffStyle, viewMode, activeGitScope, workspaceId]);

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
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {!project ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              {t('changes.empty.projectUnavailable')}
            </div>
          ) : (
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              {viewMode === 'tree' ? (
                <div className="flex w-full min-w-0 flex-1 flex-col">
                  <ChangesTreeView
                    visibleFiles={visibleFiles}
                    activeFilesLoaded={activeFilesLoaded}
                    selectedFilePath={selectedFilePath}
                    onFileFilterChange={(path) => {
                      setSelectedFilePath(path)
                      if (path) setViewMode('diff')
                    }}
                  />
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col">
	                {changesScope === 'history' ? (
	                  filteredGroups.length > 0 ? (
	                    <HistoryChangesView
	                      groups={filteredGroups}
	                      workspaceId={workspaceId}
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
                    workspaceId={workspaceId}
                    selectedFilePath={selectedFilePath}
                    diffStyle={diffStyle}
                    codeSearchQuery={debouncedCodeSearchQuery}
                    latestGroup={latestGroup}
                    previousCheckpointGroupId={
                      latestGroup ? (previousCheckpointGroupIds.get(latestGroup.groupId) ?? null) : null
                    }
                    emptyStateNode={
                      <ChangesEmptyState
                        icon={__ChatHugeIcon}
                        title="No changes last turn"
                        subtitle="The last agent response made no file edits."
                      />
                    }
                  />
                ) : (
                  <ParsedPatchDiffView
                    patch={activeGitChanges?.patch ?? null}
                    loaded={activeGitChangesLoaded}
                    patchError={activeGitChangesError}
                    cacheScope={`changes:${changesScope}`}
                    selectedFilePath={selectedFilePath}
                    diffStyle={diffStyle}
                    codeSearchQuery={debouncedCodeSearchQuery}
                    emptyStateNode={
                      changesScope === 'branch' ? (
                        <ChangesEmptyState
                          icon={__BranchHugeIcon}
                          title="No branch changes"
                          subtitle="This branch has no changes from its base."
                        />
                      ) : (
                        <ChangesEmptyState
                          icon={__CleanHugeIcon}
                          title="Working tree clean"
                          subtitle="All changes have been committed."
                        />
                      )
                    }
                  />
                )}
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </CheckpointDiffWorkerProvider>
  )
}
