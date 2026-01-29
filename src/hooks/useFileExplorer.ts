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
  expandNode: (item: ExplorerItem) => Promise<void>
  collapseNode: (item: ExplorerItem) => void
  toggleNode: (item: ExplorerItem) => Promise<void>
  refresh: () => Promise<void>
  refreshNode: (item: ExplorerItem) => Promise<void>
  expandedPaths: Set<string>
  isExpanded: (item: ExplorerItem) => boolean
}

export function useFileExplorer({
  rootPath,
  excludePatterns,
}: UseFileExplorerOptions): UseFileExplorerReturn {
  const [root, setRoot] = useState<ExplorerItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [_updateTrigger, setUpdateTrigger] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const fileServiceRef = useRef<FileService | null>(null)
  const dataSourceRef = useRef<ExplorerDataSource | null>(null)
  const cancellationRef = useRef<ReturnType<typeof createCancellationTokenSource> | null>(null)

  // Initialize services when excludePatterns change
  useEffect(() => {
    console.log('[useFileExplorer] Initializing FileService and DataSource')
    fileServiceRef.current = new FileService({ excludePatterns })
    dataSourceRef.current = new ExplorerDataSource(fileServiceRef.current)
  }, [excludePatterns])

  // Load root when path changes
  useEffect(() => {
    if (!rootPath) {
      setRoot(null)
      setExpandedPaths(new Set())
      return
    }

    // Cancel any pending operation
    if (cancellationRef.current) {
      cancellationRef.current.cancel()
    }

    const loadRoot = async () => {
      console.log('[useFileExplorer] loadRoot called with path:', rootPath)
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

        console.log('[useFileExplorer] Created root item:', rootItem.name)

        // Pre-load first level
        if (dataSourceRef.current) {
          console.log('[useFileExplorer] Loading children via dataSource...')
          const children = await dataSourceRef.current.getChildren(rootItem, cts.token)
          console.log('[useFileExplorer] Loaded children:', children.length, children.map(c => c.name))
        } else {
          console.warn('[useFileExplorer] dataSourceRef.current is null!')
        }

        if (!cts.token.isCancellationRequested) {
          console.log('[useFileExplorer] Setting root with', rootItem.sortedChildren.length, 'children')
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
  }, [rootPath, refreshTrigger])

  // Force update helper (triggers re-render)
  const forceUpdate = useCallback(() => {
    setUpdateTrigger((prev) => prev + 1)
  }, [])

  // Expand a node
  const expandNode = useCallback(async (item: ExplorerItem) => {
    if (!item.isDirectory) return

    // Load children if not resolved
    if (!item.isDirectoryResolved && dataSourceRef.current) {
      try {
        await dataSourceRef.current.getChildren(item)
        forceUpdate()
      } catch (err) {
        console.error('Failed to expand node:', err)
      }
    }

    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.add(item.resource)
      return next
    })
  }, [forceUpdate])

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
      await dataSourceRef.current.refresh(item)
      forceUpdate()
    } catch (err) {
      console.error('Failed to refresh node:', err)
    }
  }, [forceUpdate])

  return {
    root,
    isLoading,
    error,
    expandNode,
    collapseNode,
    toggleNode,
    refresh,
    refreshNode,
    expandedPaths,
    isExpanded,
  }
}
