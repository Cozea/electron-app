/**
 * useFileExplorer - React hook for file tree state management
 *
 * Manages:
 * - Root item and tree state
 * - Loading states
 * - Expanded/collapsed paths
 * - File selection
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { FileService, createCancellationTokenSource } from '@/lib/fileExplorer/fileService'
import { ExplorerDataSource } from '@/lib/fileExplorer/explorerDataSource'

interface UseFileExplorerOptions {
  rootPath: string | null
  excludePatterns?: string[]
}

interface UseFileExplorerReturn {
  root: ExplorerItem | null
  isLoading: boolean
  error: string | null
  treeVersion: number
  expandNode: (item: ExplorerItem) => Promise<void>
  collapseNode: (item: ExplorerItem) => void
  toggleNode: (item: ExplorerItem) => Promise<void>
  refresh: () => Promise<void>
  refreshNode: (item: ExplorerItem) => Promise<void>
  expandedPaths: Set<string>
  isExpanded: (item: ExplorerItem) => boolean
  findNodeByResource: (resource: string) => ExplorerItem | null
  upsertResource: (
    resource: string,
    options: { isDirectory?: boolean; mtime?: number; size?: number }
  ) => boolean
  removeResource: (resource: string) => boolean
  touchTree: () => void
}

function normalizeResourcePath(value: string): string {
  if (!value) return value
  const normalized = value.replace(/\\/g, '/')
  if (normalized.length > 1) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized
}

function getParentResourcePath(resource: string): string | null {
  const normalized = normalizeResourcePath(resource)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return null
  if (lastSlash === 0) return '/'
  return normalized.slice(0, lastSlash)
}

export function useFileExplorer({
  rootPath,
  excludePatterns,
}: UseFileExplorerOptions): UseFileExplorerReturn {
  const [root, setRoot] = useState<ExplorerItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [treeVersion, setTreeVersion] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const fileServiceRef = useRef<FileService | null>(null)
  const dataSourceRef = useRef<ExplorerDataSource | null>(null)
  const cancellationRef = useRef<ReturnType<typeof createCancellationTokenSource> | null>(null)
  const resourceIndexRef = useRef<Map<string, ExplorerItem>>(new Map())

  const touchTree = useCallback(() => {
    setTreeVersion((prev) => prev + 1)
  }, [])

  const indexSubtree = useCallback((item: ExplorerItem) => {
    const stack: ExplorerItem[] = [item]
    while (stack.length > 0) {
      const current = stack.pop()!
      resourceIndexRef.current.set(normalizeResourcePath(current.resource), current)
      for (const child of current.children.values()) {
        stack.push(child)
      }
    }
  }, [])

  const unindexSubtree = useCallback((item: ExplorerItem) => {
    const stack: ExplorerItem[] = [item]
    while (stack.length > 0) {
      const current = stack.pop()!
      resourceIndexRef.current.delete(normalizeResourcePath(current.resource))
      for (const child of current.children.values()) {
        stack.push(child)
      }
    }
  }, [])

  const rebuildIndex = useCallback((nextRoot: ExplorerItem | null) => {
    resourceIndexRef.current.clear()
    if (nextRoot) {
      indexSubtree(nextRoot)
    }
  }, [indexSubtree])

  // Initialize services when excludePatterns change
  useEffect(() => {
    fileServiceRef.current = new FileService({ excludePatterns })
    dataSourceRef.current = new ExplorerDataSource(fileServiceRef.current)
  }, [excludePatterns])

  // Load root when path changes
  useEffect(() => {
    if (!rootPath) {
      setRoot(null)
      setExpandedPaths(new Set())
      rebuildIndex(null)
      return
    }

    // Cancel any pending operation
    if (cancellationRef.current) {
      cancellationRef.current.cancel()
    }

    const loadRoot = async () => {
      setIsLoading(true)
      setError(null)

      const cts = createCancellationTokenSource()
      cancellationRef.current = cts

      try {
        // Extract folder name from path
        const parts = rootPath.split(/[/\\]/)
        const name = parts[parts.length - 1] || rootPath

        const rootItem = new ExplorerItem({
          resource: rootPath,
          name,
          isDirectory: true,
        })

        // Pre-load first level
        if (dataSourceRef.current) {
          await dataSourceRef.current.getChildren(rootItem, cts.token)
        }

        if (!cts.token.isCancellationRequested) {
          rebuildIndex(rootItem)
          setRoot(rootItem)
        }
      } catch (err) {
        if (!cts.token.isCancellationRequested) {
          const message = err instanceof Error ? err.message : 'Failed to load directory'
          setError(message)
          console.error('[useFileExplorer] Failed to load file tree:', err)
        }
      } finally {
        if (!cts.token.isCancellationRequested) {
          setIsLoading(false)
        }
      }
    }

    loadRoot()

    return () => {
      if (cancellationRef.current) {
        cancellationRef.current.cancel()
      }
    }
  }, [rebuildIndex, rootPath, refreshTrigger])

  // Expand a node
  const expandNode = useCallback(async (item: ExplorerItem) => {
    if (!item.isDirectory) return

    let didLoadChildren = false
    // Load children if not resolved
    if (!item.isDirectoryResolved && dataSourceRef.current) {
      try {
        await dataSourceRef.current.getChildren(item)
        indexSubtree(item)
        didLoadChildren = true
      } catch (err) {
        console.error('Failed to expand node:', err)
      }
    }

    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(item.resource)
      return next
    })

    if (didLoadChildren) {
      touchTree()
    }
  }, [indexSubtree, touchTree])

  // Collapse a node
  const collapseNode = useCallback((item: ExplorerItem) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.delete(item.resource)
      return next
    })
  }, [])

  // Toggle a node
  const toggleNode = useCallback(async (item: ExplorerItem) => {
    if (expandedPaths.has(item.resource)) {
      collapseNode(item)
    } else {
      await expandNode(item)
    }
  }, [expandedPaths, expandNode, collapseNode])

  // Check if a node is expanded
  const isExpanded = useCallback((item: ExplorerItem) => {
    return expandedPaths.has(item.resource)
  }, [expandedPaths])

  // Refresh the entire tree
  const refresh = useCallback(async () => {
    if (!rootPath) return

    console.log('[useFileExplorer] refresh called')

    // Clear expanded paths
    setExpandedPaths(new Set())

    // Increment refresh trigger to re-run the loadRoot effect
    setRefreshTrigger(prev => prev + 1)
  }, [rootPath])

  // Refresh a specific node
  const refreshNode = useCallback(async (item: ExplorerItem) => {
    if (!item.isDirectory || !dataSourceRef.current) return

    try {
      for (const child of item.children.values()) {
        unindexSubtree(child)
      }
      await dataSourceRef.current.refresh(item)
      indexSubtree(item)
      touchTree()
    } catch (err) {
      console.error('Failed to refresh node:', err)
    }
  }, [indexSubtree, touchTree, unindexSubtree])

  const findNodeByResource = useCallback((resource: string): ExplorerItem | null => {
    if (!resource) return null
    const normalizedResource = normalizeResourcePath(resource)
    return resourceIndexRef.current.get(normalizedResource) ?? null
  }, [])

  const upsertResource = useCallback((
    resource: string,
    options: { isDirectory?: boolean; mtime?: number; size?: number }
  ): boolean => {
    if (!root) return false
    const normalizedResource = normalizeResourcePath(resource)
    const existing = resourceIndexRef.current.get(normalizedResource)

    if (existing) {
      const didChange = existing.updateMetadata({
        mtime: options.mtime,
        size: options.size,
      })
      if (didChange) {
        touchTree()
      }
      return true
    }

    const parentResource = getParentResourcePath(normalizedResource)
    if (!parentResource) return false

    const parent = resourceIndexRef.current.get(normalizeResourcePath(parentResource))
    if (!parent || !parent.isDirectory || !parent.isDirectoryResolved) {
      return false
    }

    const name = normalizedResource.split('/').filter(Boolean).pop()
    if (!name) return false

    const newItem = new ExplorerItem({
      resource: normalizedResource,
      name,
      isDirectory: options.isDirectory ?? false,
      mtime: options.mtime,
      size: options.size,
    })

    parent.addChild(newItem)
    indexSubtree(newItem)
    touchTree()
    return true
  }, [indexSubtree, root, touchTree])

  const removeResource = useCallback((resource: string): boolean => {
    const normalizedResource = normalizeResourcePath(resource)
    const existing = resourceIndexRef.current.get(normalizedResource)
    if (!existing || !existing.parent) {
      return false
    }

    const parent = existing.parent
    parent.removeChild(existing)
    unindexSubtree(existing)
    touchTree()

    setExpandedPaths((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const pathValue of prev) {
        const normalizedPath = normalizeResourcePath(pathValue)
        if (
          normalizedPath === normalizedResource ||
          normalizedPath.startsWith(`${normalizedResource}/`)
        ) {
          next.delete(pathValue)
          changed = true
        }
      }
      return changed ? next : prev
    })

    return true
  }, [touchTree, unindexSubtree])

  return {
    root,
    isLoading,
    error,
    treeVersion,
    expandNode,
    collapseNode,
    toggleNode,
    refresh,
    refreshNode,
    expandedPaths,
    isExpanded,
    findNodeByResource,
    upsertResource,
    removeResource,
    touchTree,
  }
}
