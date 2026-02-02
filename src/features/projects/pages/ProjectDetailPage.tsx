import { useEffect, useState } from 'react'
import { Link, useSearchParams, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { FileViewer } from '../components/FileViewer'
import { UnsavedChangesDialog } from '@/components/editor/UnsavedChangesDialog'
import { useFileTabsStore, pathsReferToSameFile } from '@/stores/useFileTabsStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Code,
  Settings,
  Users,
  Clock,
  FolderOpen,
  X,
  MousePointerClick,
  MoreHorizontal,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

export function ProjectDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentOrganization } = useAuth()

  const filePath = searchParams.get('path')

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  const projectId = slug || ''

  // File tabs store
  const fileTabsStore = useFileTabsStore()
  const { openFiles, activeFile } = projectId
    ? fileTabsStore.actions.getProjectTabs(projectId)
    : { openFiles: [], activeFile: null }
  const { setActiveFile, closeFile, openFile } = fileTabsStore.actions

  // Editor store for dirty state
  const editorModels = useEditorStore((state) => state.models)
  const editorActions = useEditorStore((state) => state.actions)

  // Unsaved changes dialog state
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)

  // Sync URL -> Store (open file and set as active so tree/tabs show selection)
  useEffect(() => {
    if (filePath && projectId) {
      openFile(projectId, filePath)
      setActiveFile(projectId, filePath)
    }
  }, [filePath, projectId, openFile, setActiveFile])

  // Sync Store -> URL
  const handleTabClick = (path: string) => {
    if (projectId) {
      setActiveFile(projectId, path)
      setSearchParams({ path })
    }
  }

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    if (!projectId) return

    // Check if file has unsaved changes
    const model = editorModels[path]
    if (model?.isDirty) {
      setPendingClosePath(path)
      setShowUnsavedDialog(true)
      return
    }

    // Clean close
    editorActions.closeFile(path)
    closeFile(projectId, path)
  }

  // Handle dialog actions
  const handleDiscardAndClose = () => {
    if (pendingClosePath && projectId) {
      editorActions.closeFile(pendingClosePath)
      closeFile(projectId, pendingClosePath)
    }
    setShowUnsavedDialog(false)
    setPendingClosePath(null)
  }

  const handleSaveAndClose = async () => {
    if (pendingClosePath && projectId) {
      await editorActions.saveFile(pendingClosePath)
      editorActions.closeFile(pendingClosePath)
      closeFile(projectId, pendingClosePath)
    }
    setShowUnsavedDialog(false)
    setPendingClosePath(null)
  }

  const handleCancelClose = () => {
    setShowUnsavedDialog(false)
    setPendingClosePath(null)
  }

  // Close all tabs (only closes saved files, warns about unsaved)
  const handleCloseAll = () => {
    if (!projectId) return

    // Check if any files have unsaved changes
    const hasUnsaved = openFiles.some(path => editorModels[path]?.isDirty)

    if (hasUnsaved) {
      // For simplicity, close saved ones first, then user handles unsaved individually
      openFiles.forEach(path => {
        if (!editorModels[path]?.isDirty) {
          editorActions.closeFile(path)
          closeFile(projectId, path)
        }
      })
    } else {
      // All saved, close everything
      openFiles.forEach(path => {
        editorActions.closeFile(path)
        closeFile(projectId, path)
      })
    }
  }

  // Close only saved tabs
  const handleCloseAllSaved = () => {
    if (!projectId) return

    openFiles.forEach(path => {
      if (!editorModels[path]?.isDirty) {
        editorActions.closeFile(path)
        closeFile(projectId, path)
      }
    })
  }

  // Sync Store Active File -> URL (don't overwrite URL when user navigated with ?path= - let Sync URL -> Store win)
  useEffect(() => {
    const urlPath = searchParams.get('path')
    if (activeFile) {
      if (urlPath !== activeFile && !pathsReferToSameFile(activeFile, urlPath ?? '')) {
        // Only push store to URL when URL has no path (e.g. user opened tab from tree earlier)
        // If URL has a path, user may have navigated with ?path= - don't overwrite; Sync URL -> Store will update the store
        if (!urlPath) {
          setSearchParams({ path: activeFile })
        }
      }
    } else if (openFiles.length === 0 && urlPath) {
      // All files closed, clear path
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('path')
      setSearchParams(newParams)
    }
  }, [activeFile, openFiles.length, searchParams])

  // Loading state - show shell immediately
  // Only show 404 if we are loaded (project === null) and explicitly not found
  if (project === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 space-y-4">
        <FolderOpen className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Project not found</h2>
        <p className="text-muted-foreground">
          The project you're looking for doesn't exist or has been deleted.
        </p>
        <Button asChild>
          <Link to="/projects">View all projects</Link>
        </Button>
      </div>
    )
  }

  // Ensure stores are initialized even if project is loading (we have the slug)
  if (!slug) return null

  // Editor Layout - always shown, with tabs when files are open
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Editor Tabs - only show when files are open */}
      {openFiles.length > 0 && (
        <div className="relative flex items-center h-9 bg-muted/20">
          {/* Scrollable tabs area */}
          <div className="flex-1 flex items-center h-full overflow-x-auto scrollbar-hide">
            {openFiles.map(path => {
              const isActive = path === activeFile || (activeFile != null && pathsReferToSameFile(path, activeFile))
              const fileName = path.split('/').pop() || 'file'
              const model = editorModels[path]
              const isDirty = model?.isDirty ?? false
              return (
                <div
                  key={path}
                  onClick={() => handleTabClick(path)}
                  className={cn(
                    "flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] shrink-0 text-xs border-r border-border cursor-pointer select-none group",
                    isActive ? "bg-muted/30 text-foreground border-t-2 border-t-primary" : "bg-muted/40 text-muted-foreground hover:bg-background/50 border-b border-border"
                  )}
                >
                  {getFileIcon(fileName, { width: 14, height: 14 })}
                  <span className="truncate flex-1">{fileName}</span>
                  {/* Dirty indicator */}
                  {isDirty && (
                    <span
                      className="w-2 h-2 rounded-full bg-amber-500 shrink-0"
                      title="Unsaved changes"
                    />
                  )}
                  <button
                    onClick={(e) => handleCloseTab(e, path)}
                    className={cn(
                      "rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all",
                      isActive && "opacity-100",
                      isDirty && "group-hover:opacity-100"
                    )}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Fixed menu button on the right */}
          <div className="shrink-0 flex items-center h-full bg-muted/20 border-l border-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCloseAll}>
                  Close All
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCloseAllSaved}>
                  Close All Saved
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 min-h-0 relative">
        {activeFile ? (
          <FileViewer key={activeFile} path={activeFile} />
        ) : (
          <Empty className="h-full py-0">
            <EmptyHeader>
              <EmptyMedia>
                <MousePointerClick className="h-8 w-8" />
              </EmptyMedia>
              <EmptyTitle>No file selected</EmptyTitle>
              <EmptyDescription>
                Select a file from the sidebar to start editing.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      {/* Unsaved Changes Dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        fileName={pendingClosePath?.split('/').pop() || 'file'}
        onCancel={handleCancelClose}
        onDiscard={handleDiscardAndClose}
        onSave={handleSaveAndClose}
      />
    </div>
  )
}

// Dashboard component - can be used separately or on a different route
export function ProjectDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  // Format dates
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now()
    const diffMs = now - timestamp
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    return formatDate(timestamp)
  }

  if (!project) return null

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground">{project.description || 'No description'}</p>
        </div>
        <Button asChild>
          <Link to={`/projects/${slug}?path=README.md`}>
            <Code className="h-4 w-4 mr-2" />
            Open Editor
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-sm">Team Members</span>
          </div>
          <p className="text-2xl font-bold mt-2">1</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Code className="h-4 w-4" />
            <span className="text-sm">Template</span>
          </div>
          <p className="text-lg font-semibold mt-2 capitalize">{project.template || 'Custom'}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Created</span>
          </div>
          <p className="text-lg font-semibold mt-2">{formatDate(project.createdAt)}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Last Updated</span>
          </div>
          <p className="text-lg font-semibold mt-2">{formatRelativeTime(project.updatedAt)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to={`/projects/${slug}?path=README.md`}
          className="p-6 rounded-lg border bg-card hover:bg-accent transition-colors"
        >
          <Code className="h-6 w-6 mb-2" />
          <h3 className="font-semibold">Open in Editor</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Edit project code and configurations
          </p>
        </Link>
        <Link
          to={`/projects/${slug}/settings`}
          className="p-6 rounded-lg border bg-card hover:bg-accent transition-colors"
        >
          <Settings className="h-6 w-6 mb-2" />
          <h3 className="font-semibold">Project Settings</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure project options and integrations
          </p>
        </Link>
      </div>
    </div>
  )
}
