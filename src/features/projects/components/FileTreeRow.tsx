import type { DragEvent, MouseEvent, RefObject } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SidebarMenuButton, SidebarMenuSubButton } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { getFileIcon, getFolderIcon } from '@/lib/fileExplorer/fileIcons'
import type { VisibleTreeRow } from '@/lib/fileExplorer/visibleRows'

interface FileTreeRowProps {
  row: VisibleTreeRow
  selectedPath: string | null
  selectedResource: string | null
  createKind: 'file' | 'folder'
  createName: string
  createError: string | null
  isCreating: boolean
  createInputRef: RefObject<HTMLInputElement | null>
  renameTarget: ExplorerItem | null
  renameValue: string
  renameError: string | null
  renameInputRef: RefObject<HTMLInputElement | null>
  onCreateNameChange: (value: string) => void
  onCreateCommit: () => void
  onCreateCancel: () => void
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onToggleDirectory: (item: ExplorerItem, open: boolean) => void
  onSelect: (item: ExplorerItem) => void
  onContextMenu?: (item: ExplorerItem, event: MouseEvent) => void
  onDragStart?: (item: ExplorerItem, event: DragEvent) => void
  onDragEnd?: (event: DragEvent) => void
  onDragOver?: (item: ExplorerItem, event: DragEvent) => void
  onDrop?: (item: ExplorerItem, event: DragEvent) => void
}

function rowIndentStyle(depth: number) {
  return { paddingLeft: `${8 + depth * 14}px` }
}

function lineageLeft(depth: number): string {
  // Draw guide line slightly left of the row icon for nested entries.
  return `${8 + Math.max(0, depth - 1) * 14 + 7}px`
}

function isPathSelected(itemResource: string, selectedPath: string | null): boolean {
  if (selectedPath == null) return false
  return itemResource.replace(/\\/g, '/') === selectedPath.replace(/\\/g, '/')
}

export function FileTreeRow({
  row,
  selectedPath,
  selectedResource,
  createKind,
  createName,
  createError,
  isCreating,
  createInputRef,
  renameTarget,
  renameValue,
  renameError,
  renameInputRef,
  onCreateNameChange,
  onCreateCommit,
  onCreateCancel,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onToggleDirectory,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: FileTreeRowProps) {
  const renderLineage = (depth: number) => {
    if (depth <= 0) return null
    return Array.from({ length: depth }, (_, index) => {
      const level = index + 1
      return (
        <div
          key={`lineage-${level}`}
          className="file-tree-lineage pointer-events-none absolute inset-y-0 border-l border-border/80"
          style={{ left: lineageLeft(level) }}
        />
      )
    })
  }

  if (row.kind === 'loadingPlaceholder') {
    return (
      <div className="relative">
        {renderLineage(row.depth)}
        <div className="flex h-7 items-center text-muted-foreground text-xs" style={rowIndentStyle(row.depth)}>
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          Loading...
        </div>
      </div>
    )
  }

  if (row.kind === 'emptyPlaceholder') {
    return (
      <div className="relative">
        {renderLineage(row.depth)}
        <div className="flex h-7 items-center text-muted-foreground text-xs" style={rowIndentStyle(row.depth)}>
          Empty
        </div>
      </div>
    )
  }

  if (row.kind === 'inlineCreate') {
    const displayName = createName.trim().split(/[\\/]/).filter(Boolean).slice(-1)[0] || 'New'
    const icon = createKind === 'folder'
      ? getFolderIcon(displayName, false)
      : getFileIcon(displayName)

    const input = (
      <div className="flex w-full items-center gap-2" style={rowIndentStyle(row.depth)}>
        {icon}
        <Input
          ref={createInputRef}
          value={createName}
          onChange={(event) => onCreateNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onCreateCommit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onCreateCancel()
            }
          }}
          onBlur={() => onCreateCancel()}
          disabled={isCreating}
          placeholder={createKind === 'folder' ? 'New Folder' : 'New File'}
          className="h-6 px-2 text-xs"
        />
      </div>
    )

    return (
      <div className="py-0.5">
        <div className="relative">
          {renderLineage(row.depth)}
          {row.depth === 0 ? (
            <SidebarMenuButton asChild>
              <div>{input}</div>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuSubButton asChild className="w-full">
              <div>{input}</div>
            </SidebarMenuSubButton>
          )}
        </div>
        {createError && (
          <div className="px-2 text-xs text-destructive" style={rowIndentStyle(row.depth)}>
            {createError}
          </div>
        )}
      </div>
    )
  }

  const { item, depth, isExpanded } = row
  const isSelected = isPathSelected(item.resource, selectedPath)
  const isActive = isSelected || (selectedResource != null && selectedResource === item.resource)
  const isRenaming = renameTarget?.resource === item.resource

  const label = !isRenaming
    ? <span className="truncate">{item.name}</span>
    : (
      <div className="flex min-w-0 flex-1 flex-col">
        <Input
          ref={renameInputRef}
          value={renameValue}
          onChange={(event) => onRenameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onRenameCommit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onRenameCancel()
            }
          }}
          onBlur={() => onRenameCancel()}
          className="h-6 px-2 text-xs"
        />
        {renameError && (
          <span className="text-[10px] text-destructive">{renameError}</span>
        )}
      </div>
    )

  const icon = item.isDirectory
    ? getFolderIcon(item.name, isExpanded)
    : getFileIcon(item.name)

  const content = (
    <div className="flex w-full min-w-0 items-center justify-start gap-2 text-left" style={rowIndentStyle(depth)}>
      {icon}
      <div className="min-w-0 flex-1">{label}</div>
      {item.isDirectory && (
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            isExpanded && '-rotate-90'
          )}
        />
      )}
    </div>
  )

  const handleClick = () => {
    onSelect(item)
    if (item.isDirectory) {
      onToggleDirectory(item, !isExpanded)
    }
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (!onContextMenu) return
    onContextMenu(item, event)
  }

  const handleDragStart = (event: DragEvent) => {
    if (!onDragStart) return
    onDragStart(item, event)
  }

  const handleDragOver = (event: DragEvent) => {
    if (!onDragOver) return
    onDragOver(item, event)
  }

  const handleDrop = (event: DragEvent) => {
    if (!onDrop) return
    onDrop(item, event)
  }

  if (depth === 0) {
    return (
      <div className="relative">
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
          {content}
        </SidebarMenuButton>
      </div>
    )
  }

  return (
    <div className="relative">
      {renderLineage(depth)}
      <SidebarMenuSubButton
        isActive={isActive}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="group w-full text-left"
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {content}
      </SidebarMenuSubButton>
    </div>
  )
}
