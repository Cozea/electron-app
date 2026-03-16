import { useState, useCallback, useEffect, useRef } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useCachedQuery } from '@/stores/useQueryCache'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
    Clock,
    MoreHorizontal,
    FileCode,
    Loader2,
    Trash2,
    Cloud,
    Check,
    ImageOff,
    FolderOpen,
    Settings,
    Archive,
    RotateCcw
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectDiffBadge } from '@/components/projects/ProjectDiffBadge'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
import { cn } from '@/lib/utils'
import { useInViewportOnce } from '@/hooks/useInViewportOnce'
import { buildProjectPath } from '../lib/projectRoutes'
import { prepareGitProjectForOpen, type ProjectOpenGitProjectLike } from '../lib/projectOpenGitSync'
import { formatProjectCloudAccessError } from '../lib/projectCloudAccessPresentation'

// Types based on what we saw in the schema and Projects.tsx
interface ProjectSummary extends ProjectOpenGitProjectLike {
    name: string
    template?: string | null
    status: string
    description?: string | null
    updatedAt?: number
    lastSyncAt?: number
    createdBy?: string
    stats?: {
        fileCount?: number
    }
    stack?: {
        backend?: string
        hosting?: string
    }
    frameworkInfo?: {
        framework: string
        devCommand?: string
        devPort?: number
    }
}

interface ProjectCardProps {
    project: ProjectSummary
    userId?: Id<'users'>
    workspaceScoped: boolean
}

function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    if (minutes > 0) return `${minutes}m`
    return 'now'
}

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

const preloadProjectDetailPage = () => import('@/features/projects/pages/ProjectDetailPage')
const preloadNewProjectPage = () => import('@/pages/NewProject')

export function ProjectCard({ project, userId, workspaceScoped }: ProjectCardProps) {
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isInViewport = useInViewportOnce(cardRef)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isOpeningFolder, setIsOpeningFolder] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncDetail, setSyncDetail] = useState<string | null>(null)
  const [syncErrorActionHref, setSyncErrorActionHref] = useState<string | null>(null)
  const [syncErrorActionLabel, setSyncErrorActionLabel] = useState<string | null>(null)
  const [syncHydrationRequested, setSyncHydrationRequested] = useState(false)
  const deleteProject = useMutation(api.projects.deleteProject)
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const [localPath, setLocalPath] = useState<string | null>(null)

    // Get preview image URL
    const freshPreviewImageUrl = useQuery(
        api.projects.getPreviewImageUrl,
        project.status !== 'draft' && userId ? { projectId: project._id, userId } : 'skip'
    )
    const previewImageUrl = useCachedQuery(
        `project-preview-img-${project._id}`,
        freshPreviewImageUrl
    )
  const [imageError, setImageError] = useState(false)
  const shouldHydrateSyncStatus = syncHydrationRequested || isInViewport || syncState !== 'idle'

  useEffect(() => {
    setImageError(false)
  }, [previewImageUrl, project._id])

  useEffect(() => {
    if (!shouldHydrateSyncStatus) return

    let cancelled = false

        const loadLocalPath = async () => {
            if (project.status === 'draft') {
                if (!cancelled) setLocalPath(null)
                return
            }

            const path = project.localPath ?? await window.electronAPI.project.getLocalPath({
                slug: project.slug,
                projectId: String(project._id),
            })
            if (!cancelled) setLocalPath(path)
        }

    void loadLocalPath()
    return () => {
      cancelled = true
    }
  }, [project._id, project.localPath, project.slug, project.status, shouldHydrateSyncStatus])

    const preloadProjectDestination = useCallback(() => {
    setSyncHydrationRequested(true)
    if (project.status === 'draft') {
      void preloadNewProjectPage()
      return
        }
        void preloadProjectDetailPage()
    }, [project.status])

    const handleCardClick = useCallback(async () => {
        if (syncState !== 'idle') {
            return
        }

        preloadProjectDestination()

        // Draft projects go straight to wizard
        if (project.status === 'draft') {
            navigate(`/projects/new?resume=${project._id}`)
            return
        }

        // Start sync check
        setSyncState('checking')
        setSyncMessage('Preparing project...')
        setSyncDetail(null)
        setSyncErrorActionHref(null)
        setSyncErrorActionLabel(null)

        try {
            const gitOpenResult = await prepareGitProjectForOpen({
                convex,
                project,
                localPath,
                userId,
                onProgress: (message) => {
                    setSyncMessage(message)
                },
                updateMemberLocalPath,
            })

            if (gitOpenResult.cancelled) {
                if (gitOpenResult.needsConflictResolution) {
                    navigate(buildProjectPath(String(project._id), 'conflicts'), {
                        state: {
                            projectId: String(project._id),
                            projectSlug: project.slug,
                            projectName: project.name,
                            projectTemplate: project.template ?? undefined,
                            syncMode: 'git',
                        },
                    })
                    return
                }
                setSyncState('idle')
                setSyncMessage('')
                setSyncDetail(null)
                setSyncErrorActionHref(null)
                setSyncErrorActionLabel(null)
                return
            }

            setLocalPath(gitOpenResult.localPath)
            setSyncState('ready')
            setSyncMessage('Opening project...')
            setSyncDetail(null)
            setSyncErrorActionHref(null)
            setSyncErrorActionLabel(null)

            setTimeout(() => {
                navigate(buildProjectPath(String(project._id)), {
                    state: {
                        projectId: String(project._id),
                        projectSlug: project.slug,
                        projectName: project.name,
                        projectTemplate: project.template ?? undefined,
                        syncMode: 'git',
                    },
                })
            }, 200)

        } catch (error) {
            console.error('[ProjectCard] Sync check failed:', error)
            const presentation = formatProjectCloudAccessError(error, 'Failed to prepare project', {
                workspaceScoped,
            })
            setSyncState('error')
            setSyncMessage(presentation.summary)
            setSyncDetail(presentation.detail)
            setSyncErrorActionHref(presentation.actionHref)
            setSyncErrorActionLabel(presentation.actionLabel)
            if (!presentation.isAccessError) {
                setTimeout(() => {
                    setSyncState('idle')
                    setSyncMessage('')
                    setSyncDetail(null)
                    setSyncErrorActionHref(null)
                    setSyncErrorActionLabel(null)
                }, 2000)
            }
        }
    }, [convex, localPath, navigate, preloadProjectDestination, project, syncState, updateMemberLocalPath, userId, workspaceScoped])

    const handleDelete = async () => {
        if (!userId) return

        const result = await window.electronAPI.dialog.showMessageBox({
            type: 'warning',
            buttons: ['Cancel', 'Delete Project'],
            defaultId: 0,
            cancelId: 0,
            title: 'Delete Project',
            message: `Delete ${project.name}?`,
            detail: `This action cannot be undone. This will permanently delete the project and all associated data.`,
        })

        if (result.response !== 1) {
            return
        }

        setIsDeleting(true)
        try {
            await deleteProject({
                projectId: project._id,
                userId,
                confirmName: project.name, // Since we bypass typing, pass the exact name
            })
        } catch (error) {
            console.error('Failed to delete project:', error)
            const message = error instanceof Error ? error.message : 'Failed to delete project'
            // Extract the actual error message from Convex error format
            const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
            
            // Show error in another native dialog since we don't have the UI anymore
            await window.electronAPI.dialog.showMessageBox({
                type: 'error',
                title: 'Delete Failed',
                message: 'Failed to delete project',
                detail: cleanMessage
            })
        } finally {
            setIsDeleting(false)
        }
    }

  const handleArchive = async () => {
    if (!userId || isArchiving) return

    const result = await window.electronAPI.dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Archive Project'],
      defaultId: 0,
      cancelId: 0,
      title: 'Archive Project',
      message: `Archive ${project.name}?`,
      detail: 'The project will be hidden from active views and can be restored later.',
    })

    if (result.response !== 1) {
      return
    }

    setIsArchiving(true)
    try {
      await archiveProject({
        projectId: project._id,
        userId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive project'
      const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
      await window.electronAPI.dialog.showMessageBox({
        type: 'error',
        title: 'Archive Failed',
        message: 'Failed to archive project',
        detail: cleanMessage,
      })
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRestore = async () => {
    if (!userId || isRestoring) return

    const result = await window.electronAPI.dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancel', 'Restore Project'],
      defaultId: 1,
      cancelId: 0,
      title: 'Restore Project',
      message: `Restore ${project.name}?`,
      detail: 'The project will return to active views.',
    })

    if (result.response !== 1) {
      return
    }

    setIsRestoring(true)
    try {
      await restoreProject({
        projectId: project._id,
        userId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore project'
      const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
      await window.electronAPI.dialog.showMessageBox({
        type: 'error',
        title: 'Restore Failed',
        message: 'Failed to restore project',
        detail: cleanMessage,
      })
    } finally {
      setIsRestoring(false)
    }
  }

  const handleOpenFolder = async () => {
    if (isOpeningFolder) return

    setIsOpeningFolder(true)
    try {
      const resolvedLocalPath =
        localPath ??
        await window.electronAPI.project.getLocalPath({
          slug: project.slug,
          projectId: String(project._id),
        })

      if (!resolvedLocalPath) {
        throw new Error('Project folder is not available on this device.')
      }

      setLocalPath(resolvedLocalPath)

      const result = await window.electronAPI.project.openFolder({
        projectPath: resolvedLocalPath,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to open project folder.')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open project folder.'
      await window.electronAPI.dialog.showMessageBox({
        type: 'error',
        title: 'Open Folder Failed',
        message: 'Failed to open project folder',
        detail: message,
      })
    } finally {
      setIsOpeningFolder(false)
    }
  }

    // Derived state
    const isBuilding = project.status === 'building' || project.status === 'generating'
    const isDraft = project.status === 'draft'
    const isArchiveActionPending = isArchiving || isRestoring
    return (
        <div className="self-start">
                <Card
                    ref={cardRef}
                    className={cn(
                    "group relative flex flex-col shadow-none hover:shadow-none transition-all duration-200 border-border/50 bg-card/50 hover:bg-card overflow-visible p-0 gap-0",
                    syncState !== 'idle' && !(syncState === 'error' && syncErrorActionHref) && "pointer-events-none"
                )}
                onMouseEnter={preloadProjectDestination}
                onFocus={preloadProjectDestination}
                onPointerDown={preloadProjectDestination}
                onClick={handleCardClick}
            >
                {/* Preview Section - Top Half */}
                <div className="h-40 w-full bg-muted/50 flex items-center justify-center relative overflow-hidden group-hover:bg-muted/70 transition-colors rounded-t-xl">
                    {/* Preview Image or Placeholder */}
                    {previewImageUrl && !imageError ? (
                        <>
                            <img
                                src={previewImageUrl}
                                alt={`${project.name} preview`}
                                className="w-full h-full object-cover object-top"
                                onError={() => setImageError(true)}
                            />
                        </>
                    ) : imageError ? (
                        <div className="text-muted-foreground/20">
                            <ImageOff className="h-12 w-12" />
                        </div>
                    ) : (
                        <div className="text-muted-foreground/20">
                            <FileCode className="h-12 w-12" />
                        </div>
                    )}

                    {/* Sync Loader Overlay - only on preview section */}
                    {syncState !== 'idle' && (
                        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm rounded-t-xl flex flex-col items-center justify-center gap-2 pointer-events-auto">
                            {syncState === 'error' ? (
                                <>
                                    {syncErrorActionHref ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 px-3"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                openSettingsDrawer(syncErrorActionHref)
                                            }}
                                        >
                                            {syncErrorActionLabel ?? 'Open Billing'}
                                        </Button>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                            <Cloud className="h-5 w-5 text-destructive" />
                                        </div>
                                    )}
                                    <div className="px-4 text-center">
                                        <p className="text-xs text-destructive font-medium">{syncMessage}</p>
                                        {syncDetail ? (
                                            <p className="mt-1 text-[11px] text-destructive/80">{syncDetail}</p>
                                        ) : null}
                                    </div>
                                </>
                            ) : syncState === 'ready' ? (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                                        <Check className="h-5 w-5 text-green-500" />
                                    </div>
                                    <p className="text-xs text-muted-foreground font-medium">{syncMessage}</p>
                                </>
                            ) : (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                        <Loader2 className="h-5 w-5 text-primary animate-spin" />
                                    </div>
                                    <p className="text-xs text-muted-foreground font-medium">{syncMessage}</p>
                                </>
                            )}
                        </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 rounded-t-xl border-x border-t border-black/[0.08] dark:border-transparent" />
                </div>

                {/* Progress bar at the border between preview and content */}
                <div className="relative h-0.5 w-full bg-border/50 overflow-hidden">
                    {syncState !== 'idle' && syncState !== 'error' && (
                        <div
                            className={cn(
                                "absolute left-0 top-0 h-full transition-all duration-300",
                                syncState === 'ready' ? "bg-green-500" : "bg-primary",
                                syncState !== 'ready' && "animate-pulse"
                            )}
                            style={{
                                width: syncState === 'ready' ? '100%' : syncState === 'syncing' ? '70%' : '30%'
                            }}
                        />
                    )}
                </div>

                {/* Content Section - Bottom Half */}
                <div className="flex flex-col rounded-b-xl bg-secondary/80 dark:bg-secondary/40">
                    <CardHeader className="px-3 pt-3 pb-0">
                        <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <CardTitle className="mb-1 truncate text-base leading-tight font-bold">
                                    {project.name}
                                </CardTitle>
                                <CardDescription className="line-clamp-2 h-10 overflow-hidden text-xs leading-5">
                                    {project.description || "No description provided."}
                                </CardDescription>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground -mr-1 -mt-1">
                                        <MoreHorizontal className="h-3 w-3" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        void handleCardClick()
                                    }}>
                                        <FileCode className="mr-2 h-4 w-4" />
                                        Open Project
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            void handleOpenFolder()
                                        }}
                                        disabled={isOpeningFolder}
                                    >
                                        {isOpeningFolder ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <FolderOpen className="mr-2 h-4 w-4" />
                                        )}
                                        Open Folder
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(buildProjectPath(String(project._id), 'settings'))
                                    }}>
                                        <Settings className="mr-2 h-4 w-4" />
                                        Settings
                                    </DropdownMenuItem>
                                    {project.status === 'archived' ? (
                                        <DropdownMenuItem
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                void handleRestore()
                                            }}
                                            disabled={isArchiveActionPending || !userId}
                                        >
                                            {isRestoring ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <RotateCcw className="mr-2 h-4 w-4" />
                                            )}
                                            Restore
                                        </DropdownMenuItem>
                                    ) : (
                                        <DropdownMenuItem
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                void handleArchive()
                                            }}
                                            className="text-destructive focus:text-destructive"
                                            disabled={isArchiveActionPending || !userId}
                                        >
                                            {isArchiving ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Archive className="mr-2 h-4 w-4" />
                                            )}
                                            Archive
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation()
                                    void handleDelete()
                                }}
                                className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                                disabled={isDeleting}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </CardHeader>

                    <CardContent className="px-3 pb-3 pt-0">
                        <div className="flex items-center justify-between border-t border-border/40 pt-2">
                            {isBuilding ? (
                                <div className="flex items-center gap-2 text-xs text-blue-500 font-medium animate-pulse">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Building...
                                </div>
                            ) : (
                                <div className="text-xs text-muted-foreground font-medium">
                                    {isDraft ? 'Draft' : 'Active'}
                                </div>
                            )}

                            <div className="flex items-center text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    <span>{project.updatedAt ? formatRelativeTime(project.updatedAt) : 'now'}</span>
                                    {project.status !== 'draft' && shouldHydrateSyncStatus && localPath ? (
                                        <div onClick={(e) => e.stopPropagation()}>
                                            <ProjectDiffBadge
                                                projectId={project._id}
                                                projectSlug={project.slug}
                                                localPath={localPath}
                                                lastSyncAt={project.lastSyncAt}
                                                size="compact"
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>
        </div>
    )
}
