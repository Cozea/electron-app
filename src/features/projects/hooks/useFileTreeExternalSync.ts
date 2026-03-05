import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'

interface UseFileTreeExternalSyncOptions {
  rootPath: string | null
  isVisible: boolean
  expandedPaths: Set<string>
  findNodeByResource: (resource: string) => ExplorerItem | null
  upsertResource: (
    resource: string,
    options: { isDirectory?: boolean; mtime?: number; size?: number }
  ) => boolean
  removeResource: (resource: string) => boolean
  refreshNode: (item: ExplorerItem) => Promise<void>
}

type PendingTreeEvent =
  | {
      kind: 'upsert'
      resource: string
      isDirectory?: boolean
      size?: number
    }
  | {
      kind: 'delete'
      resource: string
    }

const VISIBLE_FLUSH_MS = 120
const HIDDEN_FLUSH_MS = 1000
const VISIBLE_RECONCILE_MS = 3000
const HIDDEN_RECONCILE_MS = 15000
const RECONCILE_BUDGET = 6

function normalizePath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/')
  if (normalized.length > 1) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized
}

function parentPath(pathValue: string): string | null {
  const normalized = normalizePath(pathValue)
  const index = normalized.lastIndexOf('/')
  if (index === -1) return null
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

function toProjectResource(pathValue: string, projectRoot: string | null): string | null {
  if (!projectRoot) return null
  const normalizedRoot = normalizePath(projectRoot)
  const normalizedPath = normalizePath(pathValue)
  if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath
  }
  return null
}

export function useFileTreeExternalSync({
  rootPath,
  isVisible,
  expandedPaths,
  findNodeByResource,
  upsertResource,
  removeResource,
  refreshNode,
}: UseFileTreeExternalSyncOptions): void {
  const pendingEventsRef = useRef<Map<string, PendingTreeEvent>>(new Map())
  const reconcileParentsRef = useRef<Set<string>>(new Set())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expandedPathsRef = useRef(expandedPaths)

  useEffect(() => {
    expandedPathsRef.current = expandedPaths
  }, [expandedPaths])

  const flushDelay = isVisible ? VISIBLE_FLUSH_MS : HIDDEN_FLUSH_MS
  const reconcileInterval = isVisible ? VISIBLE_RECONCILE_MS : HIDDEN_RECONCILE_MS

  const normalizedRoot = useMemo(
    () => (rootPath ? normalizePath(rootPath) : null),
    [rootPath]
  )

  const consumeReconcileQueue = useCallback(async () => {
    if (!normalizedRoot || reconcileParentsRef.current.size === 0) return

    const batch = Array.from(reconcileParentsRef.current).slice(0, RECONCILE_BUDGET)
    for (const parentResource of batch) {
      reconcileParentsRef.current.delete(parentResource)
      const node = findNodeByResource(parentResource)
      if (!node || !node.isDirectory) continue
      if (!node.isDirectoryResolved && !expandedPathsRef.current.has(node.resource)) continue
      await refreshNode(node)
    }
  }, [findNodeByResource, normalizedRoot, refreshNode])

  const flushPendingEvents = useCallback(async () => {
    flushTimerRef.current = null
    if (!normalizedRoot || pendingEventsRef.current.size === 0) return

    const queuedEvents = Array.from(pendingEventsRef.current.values())
    pendingEventsRef.current.clear()

    for (const event of queuedEvents) {
      if (event.kind === 'delete') {
        const didRemove = removeResource(event.resource)
        const candidateParent = parentPath(event.resource)
        if (!didRemove && candidateParent) {
          reconcileParentsRef.current.add(candidateParent)
        }
        continue
      }

      const didUpsert = upsertResource(event.resource, {
        isDirectory: event.isDirectory,
        size: event.size,
      })
      const candidateParent = parentPath(event.resource)
      if ((!didUpsert || event.isDirectory) && candidateParent) {
        reconcileParentsRef.current.add(candidateParent)
      }
    }
  }, [normalizedRoot, removeResource, upsertResource])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
    }
    flushTimerRef.current = setTimeout(() => {
      void flushPendingEvents()
    }, flushDelay)
  }, [flushDelay, flushPendingEvents])

  useEffect(() => {
    if (!normalizedRoot) return

    const unsubscribeMeta = window.electronAPI.yjs.onExternalFileMetaChange((payload) => {
      const projectResource = toProjectResource(payload.filePath, normalizedRoot)
      if (!projectResource) return

      pendingEventsRef.current.set(projectResource, {
        kind: 'upsert',
        resource: projectResource,
        isDirectory: payload.isDirectory,
        size: payload.sizeBytes,
      })
      scheduleFlush()
    })

    const unsubscribeDelete = window.electronAPI.yjs.onExternalFileDelete((payload) => {
      const projectResource = toProjectResource(payload.filePath, normalizedRoot)
      if (!projectResource) return

      pendingEventsRef.current.set(projectResource, {
        kind: 'delete',
        resource: projectResource,
      })
      scheduleFlush()
    })

    return () => {
      unsubscribeMeta()
      unsubscribeDelete()
    }
  }, [normalizedRoot, scheduleFlush])

  useEffect(() => {
    if (!normalizedRoot) return
    const interval = setInterval(() => {
      void consumeReconcileQueue()
    }, reconcileInterval)
    return () => clearInterval(interval)
  }, [consumeReconcileQueue, normalizedRoot, reconcileInterval])

  useEffect(() => {
    if (!isVisible) return
    if (pendingEventsRef.current.size === 0) return
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    void flushPendingEvents()
  }, [flushPendingEvents, isVisible])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [])
}
