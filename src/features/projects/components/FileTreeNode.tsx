/**
 * FileTreeNode - recursive tree node component
 *
 * Renders a single node in the file tree with:
 * - Expand/collapse for directories
 * - Loading state during fetch
 * - File selection
 * - Recursive children rendering
 */

import { useState, useCallback } from 'react'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { getFileIcon, getFolderIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2 } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar'

interface FileTreeNodeProps {
  item: ExplorerItem
  depth: number
  isExpanded: boolean
  selectedPath: string | null
  onExpand: (item: ExplorerItem) => Promise<void>
  onCollapse: (item: ExplorerItem) => void
  onSelect: (item: ExplorerItem) => void
  expandedPaths: Set<string>
}

export function FileTreeNode({
  item,
  depth,
  isExpanded,
  selectedPath,
  onExpand,
  onCollapse,
  onSelect,
  expandedPaths,
}: FileTreeNodeProps) {
  const [isLoading, setIsLoading] = useState(false)
  // Normalize both paths (forward slashes) so highlight works when URL and item.resource differ in format
  const isSelected =
    selectedPath != null &&
    item.resource.replace(/\\/g, '/') === selectedPath.replace(/\\/g, '/')

  const handleToggle = useCallback(async (open: boolean) => {
    if (open) {
      setIsLoading(true)
      try {
        await onExpand(item)
      } finally {
        setIsLoading(false)
      }
    } else {
      onCollapse(item)
    }
  }, [item, onExpand, onCollapse])

  const handleClick = useCallback(() => {
    onSelect(item)
  }, [item, onSelect])

  // File node (not a directory)
  if (!item.isDirectory) {
    // Use appropriate component based on depth
    if (depth === 0) {
      return (
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={isSelected}
            onClick={handleClick}
            className="group"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {getFileIcon(item.name)}
              <span className="truncate">{item.name}</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    }

    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          isActive={isSelected}
          onClick={handleClick}
          className="group"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {getFileIcon(item.name)}
            <span className="truncate">{item.name}</span>
          </div>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    )
  }

  // Directory node
  const children = item.sortedChildren

  // Top-level directory
  if (depth === 0) {
    return (
      <Collapsible
        open={isExpanded}
        onOpenChange={handleToggle}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton className="group">
              {getFolderIcon(item.name, isExpanded)}
              <span className="truncate flex-1">{item.name}</span>
              {isLoading ? (
                <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 transition-transform text-muted-foreground',
                    isExpanded && '-rotate-90'
                  )}
                />
              )}
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {isLoading && !item.isDirectoryResolved && (
                <SidebarMenuSubItem>
                  <div className="flex h-8 items-center px-2 text-muted-foreground text-xs">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Loading...
                  </div>
                </SidebarMenuSubItem>
              )}
              {!isLoading && item.isDirectoryResolved && children.length === 0 && (
                <SidebarMenuSubItem>
                  <div className="flex h-8 items-center px-2 text-muted-foreground text-xs">
                    Empty
                  </div>
                </SidebarMenuSubItem>
              )}
              {children.map(child => (
                <FileTreeNode
                  key={child.resource}
                  item={child}
                  depth={depth + 1}
                  isExpanded={expandedPaths.has(child.resource)}
                  selectedPath={selectedPath}
                  onExpand={onExpand}
                  onCollapse={onCollapse}
                  onSelect={onSelect}
                  expandedPaths={expandedPaths}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    )
  }

  // Nested directory (depth > 0)
  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={handleToggle}
      className="group/collapsible"
    >
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton className="group">
            {getFolderIcon(item.name, isExpanded)}
            <span className="truncate flex-1">{item.name}</span>
            {isLoading ? (
              <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown
                className={cn(
                  'ml-auto h-4 w-4 shrink-0 transition-transform text-muted-foreground',
                  isExpanded && '-rotate-90'
                )}
              />
            )}
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {isLoading && !item.isDirectoryResolved && (
              <SidebarMenuSubItem>
                <div className="flex h-8 items-center px-2 text-muted-foreground text-xs">
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Loading...
                </div>
              </SidebarMenuSubItem>
            )}
            {!isLoading && item.isDirectoryResolved && children.length === 0 && (
              <SidebarMenuSubItem>
                <div className="flex h-8 items-center px-2 text-muted-foreground text-xs">
                  Empty
                </div>
              </SidebarMenuSubItem>
            )}
            {children.map(child => (
              <FileTreeNode
                key={child.resource}
                item={child}
                depth={depth + 1}
                isExpanded={expandedPaths.has(child.resource)}
                selectedPath={selectedPath}
                onExpand={onExpand}
                onCollapse={onCollapse}
                onSelect={onSelect}
                expandedPaths={expandedPaths}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}
