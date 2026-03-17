import { useCallback, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { FileViewer } from '../components/FileViewer'
import { useFileTabsStore } from '@/stores/useFileTabsStore'
import { Button } from '@/components/ui/button'
import { TerminalPanel } from '../components/TerminalPanel'
import { TaskFocusOverlay } from '../components/TaskFocusOverlay'
import {
  ArrowLeft,
  Code,
  Settings,
  Users,
  Clock,
  FolderOpen,
  MousePointerClick,
} from 'lucide-react'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import type { TaskOverlayLocationState, TaskOverlayPayload } from '@/features/projects/lib/taskFocusOverlay'

export function ProjectDetailPage() {
  const { project, slugParam, projectIdParam } = useAccessibleProject()
  const location = useLocation()
  const [, setSearchParams] = useSearchParams()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const projectKey = project?.slug ?? slugParam ?? projectIdParam ?? ''
  const locationState = (location.state as TaskOverlayLocationState | null) ?? null
  const [taskOverlay, setTaskOverlay] = useState<TaskOverlayPayload | null>(
    () => locationState?.taskOverlay ?? null,
  )

  const [prevTaskOverlay, setPrevTaskOverlay] = useState(locationState?.taskOverlay)
  if (locationState?.taskOverlay !== prevTaskOverlay) {
    setPrevTaskOverlay(locationState?.taskOverlay)
    if (locationState?.taskOverlay) {
      setTaskOverlay(locationState.taskOverlay)
    }
  }

  const handleOpenFile = useCallback((file: string, line?: number, column?: number) => {
    const normalizedFile = file.replace(/\\/g, '/')
    const normalizedProject = projectPath
      ? projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
      : null
    const isAbsolute = normalizedFile.startsWith('/') || /^[A-Za-z]:\//.test(normalizedFile)

    const pathForUrl = normalizedProject
      ? (isAbsolute || normalizedFile.startsWith(normalizedProject))
        ? normalizedFile
        : `${normalizedProject}/${normalizedFile.replace(/^\/+/, '')}`
      : normalizedFile

    const params = new URLSearchParams()
    params.set('path', pathForUrl)
    if (line) params.set('line', String(line))
    if (column) params.set('column', String(column))
    setSearchParams(params)
  }, [projectPath, setSearchParams])

  // File tabs store
  const fileTabsStore = useFileTabsStore()
  const { activeFile } = projectKey
    ? fileTabsStore.actions.getProjectTabs(projectKey)
    : { activeFile: null }

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
  if (!projectKey) return null

  // Editor Layout - always shown, with tabs when files are open
  return (
    <div className="flex flex-col h-[calc(100%+2.5rem)] -mt-10 bg-background overflow-hidden">
      {/* Editor Content */}
      <div className="flex-1 min-h-0 relative pt-10">
        {activeFile ? (
          <FileViewer path={activeFile} />
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
        {taskOverlay?.context.kind === 'file' ? <TaskFocusOverlay task={taskOverlay} /> : null}
      </div>

      {projectPath && (
        <TerminalPanel projectPath={projectPath} onOpenFile={handleOpenFile} />
      )}

    </div>
  )
}

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

// Dashboard component - can be used separately or on a different route
export function ProjectDashboard() {
  const { project } = useAccessibleProject()

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
          <Link to={`${buildProjectPath(String(project._id))}?path=README.md`}>
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
          to={`${buildProjectPath(String(project._id))}?path=README.md`}
          className="p-6 rounded-lg border bg-card hover:bg-accent transition-colors"
        >
          <Code className="h-6 w-6 mb-2" />
          <h3 className="font-semibold">Open in Editor</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Edit project code and configurations
          </p>
        </Link>
        <Link
          to={buildProjectPath(String(project._id), 'settings')}
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
