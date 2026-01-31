/**
 * FileTree - VS Code-style file explorer
 *
 * Uses the new file explorer architecture with:
 * - Lazy loading (directories load on expand)
 * - Automatic filtering (node_modules, .git, etc.)
 * - Proper state management via useFileExplorer hook
 */

import { useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useFileExplorer } from '@/hooks/useFileExplorer'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { FileTreeNode } from './FileTreeNode'
import { Loader2, FolderOpen } from 'lucide-react'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { useFileTabsStore } from '@/stores/useFileTabsStore'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from '@/components/ui/sidebar'

export interface FileTreeHandle {
  refresh: () => void
  isLoading: boolean
}

export const FileTree = forwardRef<FileTreeHandle>(function FileTree(_, ref) {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const syncContext = useOptionalProjectSyncContext()

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId
      ? { workosId: currentOrganization.organizationId }
      : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  // Use file explorer hook
  const {
    root,
    isLoading,
    error,
    expandNode,
    collapseNode,
    refresh,
    expandedPaths,
  } = useFileExplorer({
    rootPath: syncContext?.projectPath ?? null,
  })

  // Debug logging
  console.log('[FileTree] project:', project?.name, 'localPath:', syncContext?.projectPath)
  console.log('[FileTree] root:', root?.name, 'children:', root?.sortedChildren.length, 'isLoading:', isLoading, 'error:', error)

  // Expose refresh and isLoading via ref
  useImperativeHandle(ref, () => ({
    refresh,
    isLoading,
  }), [refresh, isLoading])

  // Handle file selection
  const handleSelectFile = useCallback((item: ExplorerItem) => {
    if (!item.isDirectory) {
      setSearchParams({ path: item.resource })
    }
  }, [setSearchParams])

  // When opening a file (from URL or elsewhere), expand ancestor folders and ensure it's selected
  const rootPath = syncContext?.projectPath ?? null
  const activeFileFromStore = useFileTabsStore((state) =>
    slug ? state.projectTabs[slug]?.activeFile ?? null : null
  )
  const selectedPathFromUrl = searchParams.get('path')
  // Use active tab from store when available so tree stays in sync when switching tabs
  const effectiveSelectedPath = activeFileFromStore ?? selectedPathFromUrl

  // Normalize selected path for highlight: resolve to full path and forward slashes so it matches item.resource
  const selectedPathForHighlight = (() => {
    if (!effectiveSelectedPath) return null
    const n = effectiveSelectedPath.replace(/\\/g, '/')
    const r = rootPath ? rootPath.replace(/\\/g, '/') : ''
    if (r && (n === r || n.startsWith(r + '/'))) return n
    if (r && !n.startsWith('/') && !/^[a-zA-Z]:/.test(n)) return r + '/' + n
    return n
  })()

  const selectedPath = effectiveSelectedPath
  useEffect(() => {
    if (!selectedPath || !rootPath || !root) return

    const normalizedSelected = selectedPath.replace(/\\/g, '/')
    const normalizedRoot = rootPath.replace(/\\/g, '/')
    const relative = normalizedSelected.startsWith(normalizedRoot)
      ? normalizedSelected.slice(normalizedRoot.length).replace(/^\/+/, '')
      : normalizedSelected
    const segments = relative.split('/').filter(Boolean)
    const directorySegments = segments.slice(0, -1) // all but the file name

    let current: ExplorerItem | null = root
    const expandToFile = async () => {
      for (const segment of directorySegments) {
        if (!current?.isDirectory) break
        const child = current.getChild(segment)
        if (!child?.isDirectory) break
        await expandNode(child)
        current = child
      }
    }
    void expandToFile()
  }, [selectedPath, rootPath, root, expandNode])

  // No local path configured
  if (!syncContext?.projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground p-4">
        <FolderOpen className="h-8 w-8 mb-2 opacity-50" />
        <span className="text-center">Preparing local project folder...</span>
        <span className="text-xs text-center mt-1 opacity-70">
          If this is your first time opening the project, syncing will download the files.
        </span>
      </div>
    )
  }

  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Loading state */}
          {isLoading && !root && (
            <div className="flex h-10 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center justify-center h-20 text-sm p-4">
              <span className="text-destructive text-center">{error}</span>
              <button
                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => refresh()}
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && root && root.sortedChildren.length === 0 && (
            <div className="flex h-10 items-center justify-center text-sm text-muted-foreground">
              Empty folder
            </div>
          )}

          {/* File tree */}
          {root && root.sortedChildren.map(child => (
            <FileTreeNode
              key={child.resource}
              item={child}
              depth={0}
              isExpanded={expandedPaths.has(child.resource)}
              selectedPath={selectedPathForHighlight}
              onExpand={expandNode}
              onCollapse={collapseNode}
              onSelect={handleSelectFile}
              expandedPaths={expandedPaths}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
})
