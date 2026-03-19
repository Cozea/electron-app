import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useConvex, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
    MoreHorizontal,
    Trash2,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Archive,
    Pencil,
    Cloud,
    Check,
    RotateCcw,
    Settings,
    FileCode
} from 'lucide-react'
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    TableCell,
    TableRow,
} from '@/components/ui/table'

import { ProjectSyncStats } from './ProjectSyncStats'
import { cn } from '@/lib/utils'
import { useInViewportOnce } from '@/hooks/useInViewportOnce'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
import { buildProjectPath } from '../lib/projectRoutes'
import { prepareGitProjectForOpen, type ProjectOpenGitProjectLike } from '../lib/projectOpenGitSync'
import { formatProjectCloudAccessError } from '../lib/projectCloudAccessPresentation'

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

const preloadProjectDetailPage = () => import('@/features/projects/pages/ProjectDetailPage')
const preloadNewProjectPage = () => import('@/pages/NewProject')

interface ProjectSummary extends ProjectOpenGitProjectLike {
    name: string
    template?: string | null
    status: string
    updatedAt: number
    createdBy?: string
    lastSyncAt?: number
    stack?: {
        backend?: string
        hosting?: string
    }
}

interface ProjectListRowProps {
    project: ProjectSummary
    userId?: Id<'users'>
    creatorName?: string
    creatorImage?: string
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

export const ProjectListRow = memo(function ProjectListRow({
  project,
  userId,
  creatorName,
  creatorImage,
  workspaceScoped,
}: ProjectListRowProps) {
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const rowRef = useRef<HTMLTableRowElement | null>(null)
  const isInViewport = useInViewportOnce(rowRef)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncErrorActionHref, setSyncErrorActionHref] = useState<string | null>(null)
  const [syncErrorActionLabel, setSyncErrorActionLabel] = useState<string | null>(null)
  const deleteProject = useMutation(api.projects.deleteProject)
  const archiveProject = useMutation(api.projects.archive)
  const restoreProject = useMutation(api.projects.restore)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const [showMenu, setShowMenu] = useState(false)
  const [localPath, setLocalPath] = useState<string | null>(project.localPath ?? null)
  const shouldHydrateSyncStatus = isInViewport || syncState !== 'idle'

  useEffect(() => {
    setLocalPath(project.localPath ?? null)
  }, [project._id, project.localPath])

    const preloadProjectDestination = useCallback(() => {
        if (project.status === 'draft') {
            void preloadNewProjectPage()
            return
        }
        void preloadProjectDetailPage()
    }, [project.status])

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
                confirmName: project.name,
            })
        } catch (error) {
            console.error('Failed to delete project:', error)
            const message = error instanceof Error ? error.message : 'Failed to delete project'
            const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
            
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

    const handleRowClick = useCallback(async () => {
        preloadProjectDestination()

        // Draft projects go straight to wizard
        if (project.status === 'draft') {
            navigate(`/projects/new?resume=${project._id}`)
            return
        }

        // Start sync check
        setSyncState('checking')
        setSyncMessage('Preparing project...')
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
                setSyncErrorActionHref(null)
                setSyncErrorActionLabel(null)
                return
            }

            setLocalPath(gitOpenResult.localPath)
            setSyncState('ready')
            setSyncMessage('Opening project...')
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
            console.error('[ProjectListRow] Sync check failed:', error)
            const presentation = formatProjectCloudAccessError(error, 'Failed to prepare project', {
                workspaceScoped,
            })
            setSyncState('error')
            setSyncMessage(presentation.detail ?? presentation.summary)
            setSyncErrorActionHref(presentation.actionHref)
            setSyncErrorActionLabel(presentation.actionLabel)
            if (!presentation.isAccessError) {
                setTimeout(() => {
                    setSyncState('idle')
                    setSyncMessage('')
                    setSyncErrorActionHref(null)
                    setSyncErrorActionLabel(null)
                }, 2000)
            }
        }
    }, [convex, localPath, navigate, preloadProjectDestination, project, updateMemberLocalPath, userId, workspaceScoped])

    const isBuilding = project.status === 'building' || project.status === 'generating'
    const isArchiveActionPending = isArchiving || isRestoring

    return (
            <TableRow
                ref={rowRef}
                data-interactive="true"
                className={cn(
                    "group cursor-pointer",
                    syncState !== 'idle' && "pointer-events-none"
                )}
                onMouseEnter={preloadProjectDestination}
                onFocus={preloadProjectDestination}
                onPointerDown={preloadProjectDestination}
                onClick={handleRowClick}
            >
                <TableCell className="min-w-0">
                    <div className="flex min-w-0 flex-col justify-center gap-1">
                        <span className="truncate font-medium text-sm">
                            {project.name}
                        </span>
                        {syncState !== 'idle' && (
                            <div className="flex items-center gap-1.5 text-xs">
                                {syncState === 'error' ? (
                                    <>
                                        <Cloud className="h-3.5 w-3.5 text-destructive" />
                                        <span className="truncate text-destructive">{syncMessage}</span>
                                        {syncErrorActionHref ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-6 px-2 text-[10px]"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    openSettingsDrawer(syncErrorActionHref)
                                                }}
                                            >
                                                {syncErrorActionLabel ?? 'Billing'}
                                            </Button>
                                        ) : null}
                                    </>
                                ) : syncState === 'ready' ? (
                                    <>
                                        <Check className="h-3.5 w-3.5 text-green-500" />
                                        <span className="truncate text-muted-foreground">{syncMessage}</span>
                                    </>
                                ) : (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                        <span className="truncate text-muted-foreground">{syncMessage}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </TableCell>

                <TableCell className="text-center">
                    <div className="flex items-center justify-center">
                        {isBuilding && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        {project.status === 'active' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {project.status === 'draft' && <Pencil className="h-4 w-4 text-muted-foreground" />}
                        {project.status === 'archived' && <Archive className="h-4 w-4 text-muted-foreground" />}
                        {project.status === 'failed' && <AlertCircle className="h-4 w-4 text-destructive" />}
                    </div>
                </TableCell>

                <TableCell className="hidden min-w-0 md:table-cell">
                    <div className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                        <Avatar className="h-5 w-5">
                            <AvatarImage src={creatorImage} />
                            <AvatarFallback className="text-[10px]">
                                {creatorName?.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <span className="truncate">{creatorName || project.createdBy || 'Unknown'}</span>
                    </div>
                </TableCell>

                <TableCell className="hidden text-center lg:table-cell">
                    {project.status !== 'draft' && shouldHydrateSyncStatus && localPath ? (
                        <div onClick={(e) => e.stopPropagation()}>
                            <ProjectSyncStats
                                projectId={project._id}
                                projectSlug={project.slug}
                                localPath={localPath}
                                lastSyncAt={project.lastSyncAt}
                            />
                        </div>
                    ) : (
                        <span className="text-xs text-muted-foreground/30">--</span>
                    )}
                </TableCell>

                <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                    {formatRelativeTime(project.updatedAt)}
                </TableCell>

                <TableCell className="text-right">
                    <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation()
                                void handleRowClick()
                            }}>
                                <FileCode className="mr-2 h-4 w-4" />
                                Open Project
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
                                className="text-destructive focus:text-destructive cursor-pointer"
                                disabled={isDeleting}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </TableCell>
            </TableRow>
    )
})
