/**
 * FileTree - VS Code-style file explorer
 *
 * Uses the new file explorer architecture with:
 * - Lazy loading (directories load on expand)
 * - Automatic filtering (node_modules, .git, etc.)
 * - Proper state management via useFileExplorer hook
 */

import { useCallback, useImperativeHandle, forwardRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useFileExplorer } from '@/hooks/useFileExplorer'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { FileTreeNode } from './FileTreeNode'
import { Loader2, FolderOpen } from 'lucide-react'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
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
              selectedPath={searchParams.get('path')}
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
