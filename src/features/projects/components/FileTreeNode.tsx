/**
 * FileTreeNode - recursive tree node component
 *
 * Renders a single node in the file tree with:
 * - Expand/collapse for directories
 * - Loading state during fetch
 * - File selection
 * - Recursive children rendering
 */

import { useState, useCallback, type MouseEvent, type DragEvent } from 'react'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { getFileIcon, getFolderIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
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
  selectedResource: string | null
  onExpand: (item: ExplorerItem) => Promise<void>
  onCollapse: (item: ExplorerItem) => void
  onSelect: (item: ExplorerItem) => void
  onContextMenu?: (item: ExplorerItem, event: MouseEvent) => void
  onDragStart?: (item: ExplorerItem, event: DragEvent) => void
  onDragEnd?: (event: DragEvent) => void
  onDragOver?: (item: ExplorerItem, event: DragEvent) => void
  onDrop?: (item: ExplorerItem, event: DragEvent) => void
  expandedPaths: Set<string>
  inlineCreateTarget?: string | null
  renderInlineCreateRow?: (depth: number) => React.ReactNode
  renameTarget?: ExplorerItem | null
  renameValue?: string
  renameError?: string | null
  renameInputRef?: React.RefObject<HTMLInputElement | null>
  onRenameChange?: (value: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
}

export function FileTreeNode({
  item,
  depth,
  isExpanded,
  selectedPath,
  selectedResource,
  onExpand,
  onCollapse,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  expandedPaths,
  inlineCreateTarget,
  renderInlineCreateRow,
  renameTarget,
  renameValue,
  renameError,
  renameInputRef,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: FileTreeNodeProps) {
  const [isLoading, setIsLoading] = useState(false)
  // Normalize both paths (forward slashes) so highlight works when URL and item.resource differ in format
  const isSelected =
    selectedPath != null &&
    item.resource.replace(/\\/g, '/') === selectedPath.replace(/\\/g, '/')
  const isActive = isSelected || (selectedResource != null && selectedResource === item.resource)

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

  const handleContextMenu = useCallback((event: MouseEvent) => {
    if (!onContextMenu) return
    onContextMenu(item, event)
  }, [item, onContextMenu])

  const handleDragStart = useCallback((event: DragEvent) => {
    if (!onDragStart) return
    onDragStart(item, event)
  }, [item, onDragStart])

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!onDragOver) return
    onDragOver(item, event)
  }, [item, onDragOver])

  const handleDrop = useCallback((event: DragEvent) => {
    if (!onDrop) return
    onDrop(item, event)
  }, [item, onDrop])

  const isRenaming = renameTarget?.resource === item.resource

  const renderLabel = () => {
    if (!isRenaming) {
      return <span className="truncate">{item.name}</span>
    }

    return (
      <div className="flex flex-1 min-w-0 flex-col">
        <Input
          ref={renameInputRef}
          value={renameValue ?? ''}
          onChange={(event) => onRenameChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onRenameCommit?.()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onRenameCancel?.()
            }
          }}
          onBlur={() => onRenameCancel?.()}
          className="h-6 px-2 text-xs"
        />
        {renameError && (
          <span className="text-[10px] text-destructive">{renameError}</span>
        )}
      </div>
    )
  }

  // File node (not a directory)
  if (!item.isDirectory) {
    // Use appropriate component based on depth
    if (depth === 0) {
      return (
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={isActive}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className="group"
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {getFileIcon(item.name)}
              {renderLabel()}
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    }

    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          isActive={isActive}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className="group"
          draggable={!isRenaming}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {getFileIcon(item.name)}
            {renderLabel()}
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
            <SidebarMenuButton
              className="group"
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              isActive={isActive}
              draggable={!isRenaming}
              onDragStart={handleDragStart}
              onDragEnd={onDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {getFolderIcon(item.name, isExpanded)}
              {isRenaming ? renderLabel() : <span className="truncate flex-1">{item.name}</span>}
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
              {inlineCreateTarget === item.resource && renderInlineCreateRow
                ? renderInlineCreateRow(depth + 1)
                : null}
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
                  selectedResource={selectedResource}
                  onExpand={onExpand}
                  onCollapse={onCollapse}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  expandedPaths={expandedPaths}
                  inlineCreateTarget={inlineCreateTarget}
                  renderInlineCreateRow={renderInlineCreateRow}
                  renameTarget={renameTarget}
                  renameValue={renameValue}
                  renameError={renameError}
                  renameInputRef={renameInputRef}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
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
          <SidebarMenuSubButton
            className="group"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            isActive={isActive}
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {getFolderIcon(item.name, isExpanded)}
            {isRenaming ? renderLabel() : <span className="truncate flex-1">{item.name}</span>}
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
            {inlineCreateTarget === item.resource && renderInlineCreateRow
              ? renderInlineCreateRow(depth + 1)
              : null}
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
                selectedResource={selectedResource}
                onExpand={onExpand}
                onCollapse={onCollapse}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
                expandedPaths={expandedPaths}
                inlineCreateTarget={inlineCreateTarget}
                renderInlineCreateRow={renderInlineCreateRow}
                renameTarget={renameTarget}
                renameValue={renameValue}
                renameError={renameError}
                renameInputRef={renameInputRef}
                onRenameChange={onRenameChange}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}
