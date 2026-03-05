/**
 * FileTree - VS Code-style file explorer
 *
 * Uses a virtual renderer by default (react-virtuoso) and can fall back
 * to the legacy recursive tree through localStorage:
 * `cozea.fileTree.renderer = "legacy" | "virtual"`.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFileExplorer } from '@/hooks/useFileExplorer'
import { ExplorerItem } from '@/lib/fileExplorer/explorerModel'
import { buildVisibleTreeRows, type VisibleTreeRow } from '@/lib/fileExplorer/visibleRows'
import { FileTreeNode } from './FileTreeNode'
import { FileTreeRow } from './FileTreeRow'
import { Loader2, FolderOpen } from 'lucide-react'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { useFileTabsStore } from '@/stores/useFileTabsStore'
import { Input } from '@/components/ui/input'
import { getFileIcon, getFolderIcon } from '@/lib/fileExplorer/fileIcons'
import { useFileTreeExternalSync } from '../hooks/useFileTreeExternalSync'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenu,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'

const FILE_TREE_RENDERER_KEY = 'cozea.fileTree.renderer'

export interface FileTreeHandle {
  refresh: () => void
  isLoading: boolean
  startCreateFile: () => void
  startCreateFolder: () => void
}

interface FileTreeProps {
  isVisible?: boolean
  scrollParent?: HTMLElement | null
}

function parseRendererMode(value: string | null): 'legacy' | 'virtual' {
  return value === 'legacy' ? 'legacy' : 'virtual'
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { isVisible = true, scrollParent = null },
  ref
) {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const syncContext = useOptionalProjectSyncContext()
  const [lastSelectedItem, setLastSelectedItem] = useState<ExplorerItem | null>(null)
  const [selectedResource, setSelectedResource] = useState<string | null>(null)
  const [createKind, setCreateKind] = useState<'file' | 'folder'>('file')
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createTarget, setCreateTarget] = useState<ExplorerItem | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const [renameTarget, setRenameTarget] = useState<ExplorerItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [dragItem, setDragItem] = useState<ExplorerItem | null>(null)
  const [nodeLoadingPaths, setNodeLoadingPaths] = useState<Set<string>>(new Set())
  const [rendererMode, setRendererMode] = useState<'legacy' | 'virtual'>(() => {
    if (typeof window === 'undefined') return 'virtual'
    return parseRendererMode(window.localStorage.getItem(FILE_TREE_RENDERER_KEY))
  })

  // Use file explorer hook
  const {
    root,
    isLoading,
    error,
    treeVersion,
    expandNode,
    collapseNode,
    refresh,
    refreshNode,
    expandedPaths,
    findNodeByResource,
    upsertResource,
    removeResource,
  } = useFileExplorer({
    rootPath: syncContext?.projectPath ?? null,
  })

  const rootPath = syncContext?.projectPath ?? null
  const inlineCreateTarget = createTarget?.resource ?? null
  const isVirtualRenderer = rendererMode === 'virtual'

  useFileTreeExternalSync({
    rootPath,
    isVisible,
    expandedPaths,
    findNodeByResource,
    upsertResource,
    removeResource,
    refreshNode,
  })

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== FILE_TREE_RENDERER_KEY) return
      setRendererMode(parseRendererMode(event.newValue))
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    setNodeLoadingPaths(new Set())
  }, [rootPath])

  const getCreateTarget = useCallback((): ExplorerItem | null => {
    if (!syncContext?.projectPath) return null
    if (lastSelectedItem?.isDirectory) return lastSelectedItem
    if (lastSelectedItem?.parent) return lastSelectedItem.parent
    return root
  }, [lastSelectedItem, root, syncContext?.projectPath])

  const getCreateTargetForItem = useCallback((item: ExplorerItem): ExplorerItem | null => {
    if (!syncContext?.projectPath) return null
    if (item.isDirectory) return item
    return item.parent ?? root
  }, [root, syncContext?.projectPath])

  // Expose refresh and isLoading via ref
  useImperativeHandle(ref, () => ({
    refresh,
    isLoading,
    startCreateFile: () => {
      setRenameTarget(null)
      setRenameValue('')
      setRenameError(null)
      setCreateKind('file')
      setCreateName('')
      setCreateError(null)
      const target = getCreateTarget()
      if (!target) return
      setCreateTarget(target)
    },
    startCreateFolder: () => {
      setRenameTarget(null)
      setRenameValue('')
      setRenameError(null)
      setCreateKind('folder')
      setCreateName('')
      setCreateError(null)
      const target = getCreateTarget()
      if (!target) return
      setCreateTarget(target)
    },
  }), [refresh, isLoading, getCreateTarget])

  // Handle file selection
  const handleSelectFile = useCallback((item: ExplorerItem) => {
    setLastSelectedItem(item)
    setSelectedResource(item.resource)
    if (!item.isDirectory) {
      setSearchParams({ path: item.resource })
    }
  }, [setSearchParams])

  const setDirectoryLoading = useCallback((resource: string, isLoadingState: boolean) => {
    setNodeLoadingPaths((prev) => {
      const next = new Set(prev)
      if (isLoadingState) {
        next.add(resource)
      } else {
        next.delete(resource)
      }
      return next
    })
  }, [])

  const handleToggleDirectory = useCallback(async (item: ExplorerItem, open: boolean) => {
    if (!item.isDirectory) return

    if (!open) {
      collapseNode(item)
      setDirectoryLoading(item.resource, false)
      return
    }

    if (!item.isDirectoryResolved) {
      setDirectoryLoading(item.resource, true)
      try {
        await expandNode(item)
      } finally {
        setDirectoryLoading(item.resource, false)
      }
      return
    }

    await expandNode(item)
  }, [collapseNode, expandNode, setDirectoryLoading])

  useEffect(() => {
    if (createTarget) {
      requestAnimationFrame(() => createInputRef.current?.focus())
    }
  }, [createTarget])

  useEffect(() => {
    if (renameTarget) {
      requestAnimationFrame(() => renameInputRef.current?.focus())
    }
  }, [renameTarget])

  useEffect(() => {
    if (createTarget) {
      void expandNode(createTarget)
    }
  }, [createTarget, expandNode])

  useEffect(() => {
    setCreateTarget(null)
    setCreateName('')
    setCreateError(null)
    setRenameTarget(null)
    setRenameValue('')
    setRenameError(null)
  }, [rootPath])

  const normalizedRootPath = useMemo(
    () => (syncContext?.projectPath ?? '').replace(/\\/g, '/'),
    [syncContext?.projectPath]
  )

  const createTargetRelative = useMemo(() => {
    if (!createTarget || !normalizedRootPath) return ''
    const normalizedBase = createTarget.resource.replace(/\\/g, '/')
    if (!normalizedBase.startsWith(normalizedRootPath)) return ''
    return normalizedBase.slice(normalizedRootPath.length).replace(/^\/+/, '')
  }, [createTarget, normalizedRootPath])

  const validateCreateName = useCallback((value: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) return 'Name is required.'
    const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized) return 'Name is required.'
    if (normalized.startsWith('/')) return 'Path must be relative.'
    if (/(\0)/.test(normalized)) return 'Name contains invalid characters.'
    if (/(^|\/)\.\.(\/|$)/.test(normalized)) return 'Name cannot include "..".'
    return null
  }, [])

  const validateRenameName = useCallback((value: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) return 'Name is required.'
    if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot include path separators.'
    if (trimmed.includes('\0')) return 'Name contains invalid characters.'
    if (trimmed === '.' || trimmed === '..') return 'Name is invalid.'
    return null
  }, [])

  const normalizePath = useCallback((value: string) => value.replace(/\\/g, '/'), [])

  const toRelativePath = useCallback((absolutePath: string): string => {
    if (!rootPath) return absolutePath
    const normalizedAbsolute = normalizePath(absolutePath)
    const normalizedRoot = normalizePath(rootPath)
    if (normalizedAbsolute === normalizedRoot) return ''
    if (normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
      return normalizedAbsolute.slice(normalizedRoot.length + 1)
    }
    return normalizedAbsolute
  }, [normalizePath, rootPath])

  const toAbsolutePath = useCallback((relativePath: string): string => {
    if (!rootPath) return relativePath
    const normalizedRoot = normalizePath(rootPath)
    if (!relativePath) return normalizedRoot
    return `${normalizedRoot}/${relativePath}`
  }, [normalizePath, rootPath])

  const isAncestorPath = useCallback((ancestor: string, candidate: string): boolean => {
    const normalizedAncestor = normalizePath(ancestor).replace(/\/+$/, '')
    const normalizedCandidate = normalizePath(candidate)
    return normalizedCandidate === normalizedAncestor || normalizedCandidate.startsWith(`${normalizedAncestor}/`)
  }, [normalizePath])

  const handleCreate = useCallback(async () => {
    if (!syncContext?.projectPath) {
      setCreateError('Project path is not available yet.')
      return
    }
    if (!createTarget) {
      setCreateError('Select a folder or file to create inside.')
      return
    }
    const validationError = validateCreateName(createName)
    if (validationError) {
      setCreateError(validationError)
      return
    }

    const normalizedName = createName
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')

    const baseDirRelative = createTargetRelative ? `${createTargetRelative}/` : ''
    const relativeTarget = `${baseDirRelative}${normalizedName}`
    const filePath =
      createKind === 'folder'
        ? `${relativeTarget}/.gitkeep`
        : relativeTarget

    try {
      setIsCreating(true)
      setCreateError(null)
      const result = await window.electronAPI.project.writeFile({
        projectPath: syncContext.projectPath,
        filePath,
        content: '',
      })

      if (!result.success) {
        setCreateError(result.error ?? 'Failed to create item.')
        return
      }

      setCreateName('')
      setCreateError(null)
      setCreateTarget(null)

      await refreshNode(createTarget)
      await expandNode(createTarget)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create item.')
    } finally {
      setIsCreating(false)
    }
  }, [
    createKind,
    createName,
    createTarget,
    createTargetRelative,
    expandNode,
    refreshNode,
    syncContext?.projectPath,
    validateCreateName,
  ])

  const startRename = useCallback((item: ExplorerItem) => {
    setCreateTarget(null)
    setCreateName('')
    setCreateError(null)
    setRenameTarget(item)
    setRenameValue(item.name)
    setRenameError(null)
  }, [])

  const cancelRename = useCallback(() => {
    if (isRenaming) return
    setRenameTarget(null)
    setRenameValue('')
    setRenameError(null)
  }, [isRenaming])

  const handleRename = useCallback(async () => {
    if (!syncContext?.projectPath) {
      setRenameError('Project path is not available yet.')
      return
    }
    if (!renameTarget) return

    const validationError = validateRenameName(renameValue)
    if (validationError) {
      setRenameError(validationError)
      return
    }

    const parentRelative = renameTarget.parent ? toRelativePath(renameTarget.parent.resource) : ''
    const newRelativePath = parentRelative ? `${parentRelative}/${renameValue.trim()}` : renameValue.trim()
    const oldRelativePath = toRelativePath(renameTarget.resource)

    if (newRelativePath === oldRelativePath) {
      cancelRename()
      return
    }

    try {
      setIsRenaming(true)
      setRenameError(null)
      const result = await window.electronAPI.project.renameFile({
        projectPath: syncContext.projectPath,
        oldPath: oldRelativePath,
        newPath: newRelativePath,
      })

      if (!result.success) {
        setRenameError(result.error ?? 'Failed to rename item.')
        return
      }

      const newAbsolute = toAbsolutePath(newRelativePath)
      setSelectedResource(newAbsolute)
      setRenameTarget(null)
      setRenameValue('')
      setRenameError(null)

      if (renameTarget.parent) {
        await refreshNode(renameTarget.parent)
        await expandNode(renameTarget.parent)
      } else {
        await refresh()
      }
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename item.')
    } finally {
      setIsRenaming(false)
    }
  }, [
    cancelRename,
    expandNode,
    refresh,
    refreshNode,
    renameTarget,
    renameValue,
    syncContext?.projectPath,
    toAbsolutePath,
    toRelativePath,
    validateRenameName,
  ])

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value)
    if (renameError) {
      setRenameError(null)
    }
  }, [renameError])

  const handleDelete = useCallback(async (item: ExplorerItem) => {
    if (!syncContext?.projectPath) return
    const confirmed = window.confirm(`Delete ${item.isDirectory ? 'folder' : 'file'} "${item.name}"?`)
    if (!confirmed) return

    const targetRelative = toRelativePath(item.resource)
    const result = await window.electronAPI.project.deletePath({
      projectPath: syncContext.projectPath,
      targetPath: targetRelative,
    })

    if (!result.success) {
      console.warn('[FileTree] Delete failed:', result.error)
      return
    }

    if (item.parent) {
      await refreshNode(item.parent)
    } else {
      await refresh()
    }
  }, [refresh, refreshNode, syncContext?.projectPath, toRelativePath])

  const getSiblingNames = useCallback((item: ExplorerItem): Set<string> => {
    const parent = item.parent ?? root
    if (!parent) return new Set()
    return new Set(Array.from(parent.children.values()).map((child) => child.name.toLowerCase()))
  }, [root])

  const getAvailableName = useCallback((name: string, isDirectory: boolean, existingNames: Set<string>): string => {
    if (!existingNames.has(name.toLowerCase())) {
      return name
    }

    if (!isDirectory) {
      const lastDot = name.lastIndexOf('.')
      const base = lastDot > 0 ? name.slice(0, lastDot) : name
      const ext = lastDot > 0 ? name.slice(lastDot) : ''
      let candidate = `${base} copy${ext}`
      let counter = 2
      while (existingNames.has(candidate.toLowerCase())) {
        candidate = `${base} copy ${counter}${ext}`
        counter += 1
      }
      return candidate
    }

    let candidate = `${name} copy`
    let counter = 2
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${name} copy ${counter}`
      counter += 1
    }
    return candidate
  }, [])

  const getDuplicateName = useCallback((item: ExplorerItem): string => {
    return getAvailableName(item.name, item.isDirectory, getSiblingNames(item))
  }, [getAvailableName, getSiblingNames])

  const handleDuplicate = useCallback(async (item: ExplorerItem) => {
    if (!syncContext?.projectPath) return
    const parent = item.parent ?? root
    if (!parent) return

    const newName = getDuplicateName(item)
    const parentRelative = parent ? toRelativePath(parent.resource) : ''
    const sourceRelative = toRelativePath(item.resource)
    const destinationRelative = parentRelative ? `${parentRelative}/${newName}` : newName

    const result = await window.electronAPI.project.copyPath({
      projectPath: syncContext.projectPath,
      sourcePath: sourceRelative,
      destinationPath: destinationRelative,
    })

    if (!result.success) {
      console.warn('[FileTree] Duplicate failed:', result.error)
      return
    }

    await refreshNode(parent)
    await expandNode(parent)
  }, [expandNode, getDuplicateName, refreshNode, root, syncContext?.projectPath, toRelativePath])

  const handleCopyToTarget = useCallback(async (source: ExplorerItem, target: ExplorerItem) => {
    if (!syncContext?.projectPath) return
    const targetDirectory = target.isDirectory ? target : target.parent ?? root
    if (!targetDirectory) return

    if (source.isDirectory && isAncestorPath(source.resource, targetDirectory.resource)) return

    const existingNames = new Set(
      Array.from(targetDirectory.children.values()).map((child) => child.name.toLowerCase())
    )
    const newName = getAvailableName(source.name, source.isDirectory, existingNames)
    const sourceRelative = toRelativePath(source.resource)
    const targetRelative = toRelativePath(targetDirectory.resource)
    const destinationRelative = targetRelative ? `${targetRelative}/${newName}` : newName

    const result = await window.electronAPI.project.copyPath({
      projectPath: syncContext.projectPath,
      sourcePath: sourceRelative,
      destinationPath: destinationRelative,
    })

    if (!result.success) {
      console.warn('[FileTree] Copy failed:', result.error)
      return
    }

    await refreshNode(targetDirectory)
    await expandNode(targetDirectory)
  }, [expandNode, getAvailableName, isAncestorPath, refreshNode, root, syncContext?.projectPath, toRelativePath])

  const handleMove = useCallback(async (source: ExplorerItem, target: ExplorerItem) => {
    if (!syncContext?.projectPath) return
    const targetDirectory = target.isDirectory ? target : target.parent ?? root
    if (!targetDirectory) return

    if (source.resource === targetDirectory.resource) return
    if (source.isDirectory && isAncestorPath(source.resource, targetDirectory.resource)) return

    const sourceRelative = toRelativePath(source.resource)
    const targetRelative = toRelativePath(targetDirectory.resource)
    const destinationRelative = targetRelative ? `${targetRelative}/${source.name}` : source.name

    if (destinationRelative === sourceRelative) return

    const result = await window.electronAPI.project.renameFile({
      projectPath: syncContext.projectPath,
      oldPath: sourceRelative,
      newPath: destinationRelative,
    })

    if (!result.success) {
      console.warn('[FileTree] Move failed:', result.error)
      return
    }

    if (source.parent) {
      await refreshNode(source.parent)
    }
    await refreshNode(targetDirectory)
    await expandNode(targetDirectory)
  }, [expandNode, isAncestorPath, refreshNode, root, syncContext?.projectPath, toRelativePath])

  const handleContextMenu = useCallback(async (item: ExplorerItem, event: MouseEvent) => {
    event.preventDefault()
    setLastSelectedItem(item)
    setSelectedResource(item.resource)

    const result = await window.electronAPI.contextMenu.showFileTreeMenu({
      targetPath: item.resource,
      isDirectory: item.isDirectory,
      x: event.clientX,
      y: event.clientY,
    })

    if (!result?.action) return

    if (result.action === 'new-file' || result.action === 'new-folder') {
      setCreateKind(result.action === 'new-file' ? 'file' : 'folder')
      setCreateName('')
      setCreateError(null)
      const target = getCreateTargetForItem(item)
      if (target) {
        setCreateTarget(target)
      }
      return
    }

    if (result.action === 'rename') {
      startRename(item)
      return
    }

    if (result.action === 'delete') {
      void handleDelete(item)
      return
    }

    if (result.action === 'duplicate') {
      void handleDuplicate(item)
      return
    }

    if (result.action === 'copy-relative-path') {
      const relativePath = toRelativePath(item.resource)
      if (relativePath) {
        void navigator.clipboard.writeText(relativePath)
      }
    }
  }, [getCreateTargetForItem, handleDelete, handleDuplicate, startRename, toRelativePath])

  const handleDragStart = useCallback((item: ExplorerItem, event: React.DragEvent) => {
    setDragItem(item)
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('text/plain', item.resource)
  }, [])

  const handleDragEnd = useCallback((_event?: React.DragEvent) => {
    setDragItem(null)
  }, [])

  const handleDragOver = useCallback((item: ExplorerItem, event: React.DragEvent) => {
    const targetDirectory = item.isDirectory ? item : item.parent ?? root
    if (!targetDirectory) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.altKey || event.ctrlKey ? 'copy' : 'move'
  }, [root])

  const handleDrop = useCallback(async (item: ExplorerItem, event: React.DragEvent) => {
    event.preventDefault()
    const dragPath = event.dataTransfer.getData('text/plain')
    const source = dragItem ?? (dragPath ? findNodeByResource(dragPath) : null)
    if (!source) return
    const shouldCopy = event.altKey || event.ctrlKey
    if (shouldCopy) {
      await handleCopyToTarget(source, item)
    } else {
      await handleMove(source, item)
    }
    setDragItem(null)
  }, [dragItem, findNodeByResource, handleCopyToTarget, handleMove])

  const cancelCreate = useCallback(() => {
    if (isCreating) return
    setCreateName('')
    setCreateError(null)
    setCreateTarget(null)
  }, [isCreating])

  const inlineCreateRow = useCallback(
    (depth: number) => {
      const Wrapper = depth === 0 ? SidebarMenuItem : SidebarMenuSubItem
      const Button = depth === 0 ? SidebarMenuButton : SidebarMenuSubButton
      const displayName = createName.trim().split(/[\\/]/).filter(Boolean).slice(-1)[0] || 'New'
      const icon =
        createKind === 'folder'
          ? getFolderIcon(displayName, false)
          : getFileIcon(displayName)

      return (
        <Wrapper key="inline-create">
          <Button asChild>
            <div className="flex items-center gap-2 w-full">
              {icon}
              <Input
                ref={createInputRef}
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value)
                  if (createError) setCreateError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreate()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelCreate()
                  }
                }}
                onBlur={() => cancelCreate()}
                disabled={isCreating}
                placeholder={createKind === 'folder' ? 'New Folder' : 'New File'}
                className="h-6 px-2 text-xs"
              />
            </div>
          </Button>
          {createError && (
            <div className="px-2 text-xs text-destructive">{createError}</div>
          )}
        </Wrapper>
      )
    },
    [cancelCreate, createError, createKind, createName, handleCreate, isCreating]
  )

  // When opening a file (from URL or elsewhere), expand ancestor folders and ensure it's selected
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

  const visibleRows = useMemo(() => {
    if (!root) return [] as VisibleTreeRow[]
    void treeVersion
    return buildVisibleTreeRows({
      root,
      expandedPaths,
      inlineCreateTarget,
      loadingPaths: nodeLoadingPaths,
    })
  }, [expandedPaths, inlineCreateTarget, nodeLoadingPaths, root, treeVersion])

  const renderVirtualRow = useCallback((row: VisibleTreeRow) => {
    return (
      <FileTreeRow
        row={row}
        selectedPath={selectedPathForHighlight}
        selectedResource={selectedResource}
        createKind={createKind}
        createName={createName}
        createError={createError}
        isCreating={isCreating}
        createInputRef={createInputRef}
        renameTarget={renameTarget}
        renameValue={renameValue}
        renameError={renameError}
        renameInputRef={renameInputRef}
        onCreateNameChange={(value) => {
          setCreateName(value)
          if (createError) setCreateError(null)
        }}
        onCreateCommit={() => void handleCreate()}
        onCreateCancel={cancelCreate}
        onRenameChange={handleRenameChange}
        onRenameCommit={() => void handleRename()}
        onRenameCancel={cancelRename}
        onToggleDirectory={(item, open) => {
          void handleToggleDirectory(item, open)
        }}
        onSelect={handleSelectFile}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />
    )
  }, [
    cancelCreate,
    cancelRename,
    createError,
    createKind,
    createName,
    handleCreate,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleRename,
    handleRenameChange,
    handleSelectFile,
    handleContextMenu,
    handleToggleDirectory,
    isCreating,
    renameError,
    renameTarget,
    renameValue,
    selectedPathForHighlight,
    selectedResource,
  ])

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
    <SidebarGroup className="py-0 h-full">
      <SidebarGroupContent className="h-full">
        <SidebarMenu className="h-full">
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
          {root && isVirtualRenderer && (
            <Virtuoso
              data={visibleRows}
              customScrollParent={scrollParent ?? undefined}
              defaultItemHeight={28}
              increaseViewportBy={{ top: 280, bottom: 420 }}
              computeItemKey={(_index, row) => row.id}
              style={scrollParent ? undefined : { height: '100%' }}
              itemContent={(_index, row) => renderVirtualRow(row)}
            />
          )}

          {root && !isVirtualRenderer && createTarget && createTarget.resource === root.resource && inlineCreateRow(0)}
          {root && !isVirtualRenderer && root.sortedChildren.map(child => (
            <FileTreeNode
              key={child.resource}
              item={child}
              depth={0}
              isExpanded={expandedPaths.has(child.resource)}
              selectedPath={selectedPathForHighlight}
              selectedResource={selectedResource}
              onExpand={expandNode}
              onCollapse={collapseNode}
              onSelect={handleSelectFile}
              onContextMenu={handleContextMenu}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              expandedPaths={expandedPaths}
              inlineCreateTarget={createTarget?.resource ?? null}
              renderInlineCreateRow={inlineCreateRow}
              renameTarget={renameTarget}
              renameValue={renameValue}
              renameError={renameError}
              renameInputRef={renameInputRef}
              onRenameChange={handleRenameChange}
              onRenameCommit={handleRename}
              onRenameCancel={cancelRename}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
})
