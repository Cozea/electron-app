import { useState, useCallback, useEffect, useRef } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation } from 'convex/react'
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
    Check
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
import { runProjectOpenReplicaCheck } from '../lib/projectOpenReplicaCheck'
import type { ProjectOpenReplicaCheckResult } from '../lib/projectOpenReplicaCheck'
import type { ProjectOpenSyncReviewRequest } from '../lib/projectOpenSyncReview'
import { buildProjectPath } from '../lib/projectRoutes'

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

const preloadProjectDetailPage = () => import('@/features/projects/pages/ProjectDetailPage')
const preloadNewProjectPage = () => import('@/pages/NewProject')

interface ProjectSummary {
    _id: Id<'projects'>
    slug: string
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
    onRequireSyncReview?: (request: ProjectOpenSyncReviewRequest) => void
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

export function ProjectListRow({
  project,
  userId,
  creatorName,
  creatorImage,
  onRequireSyncReview,
}: ProjectListRowProps) {
  const navigate = useViewTransitionNavigate()
  const rowRef = useRef<HTMLTableRowElement | null>(null)
  const isInViewport = useInViewportOnce(rowRef)
    const [isDeleting, setIsDeleting] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncHydrationRequested, setSyncHydrationRequested] = useState(false)
    const deleteProject = useMutation(api.projects.deleteProject)
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const [showMenu, setShowMenu] = useState(false)
  const [localPath, setLocalPath] = useState<string | null>(null)
  const shouldHydrateSyncStatus = syncHydrationRequested || isInViewport || syncState !== 'idle'

  useEffect(() => {
        if (!shouldHydrateSyncStatus) return

        let cancelled = false

        const loadLocalPath = async () => {
            if (project.status === 'draft') {
                if (!cancelled) setLocalPath(null)
                return
            }

            const path = await window.electronAPI.project.getLocalPath(project.slug)
            if (!cancelled) setLocalPath(path)
        }

        void loadLocalPath()
        return () => {
            cancelled = true
        }
    }, [project.slug, project.status, shouldHydrateSyncStatus])

    const preloadProjectDestination = useCallback(() => {
        setSyncHydrationRequested(true)
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

        try {
            // Determine the real local path for this machine (project.localPath is not per-user).
            let effectiveLocalPath = await window.electronAPI.project.getLocalPath(project.slug)

            if (!effectiveLocalPath) {
                setSyncMessage('Creating local folder...')
                const result = await window.electronAPI.project.createFolder({
                    slug: project.slug,
                    initGit: true,
                })

                if (!result.success || !result.localPath) {
                    throw new Error(result.error || 'Failed to create folder')
                }

                effectiveLocalPath = result.localPath
                setLocalPath(effectiveLocalPath)
            } else {
                setLocalPath(effectiveLocalPath)
            }

            // Save per-user local path in database (machine-specific)
            if (effectiveLocalPath && userId) {
                await updateMemberLocalPath({
                    projectId: project._id,
                    userId,
                    localPath: effectiveLocalPath,
                })
            }

            let gateSyncScreen = false
            let openCheck: ProjectOpenReplicaCheckResult | null = null

            // Full ReplicaGit check before opening, same as card view.
            if (effectiveLocalPath) {
                setSyncMessage('Checking sync status...')
                const check = await runProjectOpenReplicaCheck({
                    projectId: String(project._id),
                    projectPath: effectiveLocalPath,
                })
                openCheck = check
                gateSyncScreen = check.gateSyncScreen

                if (check.totalChanges > 0) {
                    setSyncState('syncing')
                    if (check.hasConflicts) {
                        setSyncMessage(`${check.plan.conflicts.length} conflict${check.plan.conflicts.length === 1 ? '' : 's'} detected`)
                    } else if (check.likelyLocalWipe) {
                        setSyncMessage('Local files missing. Opening recovery...')
                    } else {
                        setSyncMessage('Sync changes detected')
                    }
                }
            }

            // Navigate to project
            setSyncState('ready')
            setSyncMessage(gateSyncScreen ? 'Opening sync review...' : 'Opening project...')

            // Small delay to show the ready state
            setTimeout(() => {
                if (gateSyncScreen && effectiveLocalPath && onRequireSyncReview && openCheck) {
                    void onRequireSyncReview({
                        projectId: project._id,
                        projectSlug: project.slug,
                        projectName: project.name,
                        projectTemplate: project.template ?? undefined,
                        projectPath: effectiveLocalPath,
                        check: openCheck,
                    })
                    setSyncState('idle')
                    setSyncMessage('')
                    return
                }

                navigate(buildProjectPath(String(project._id)), {
                    state: {
                        projectSlug: project.slug,
                        projectName: project.name,
                        projectTemplate: project.template ?? undefined,
                        gateSyncScreen,
                    },
                })
            }, 200)

        } catch (error) {
            console.error('[ProjectListRow] Sync check failed:', error)
            setSyncState('error')
            setSyncMessage(error instanceof Error ? error.message : 'Failed to prepare project')

            // Reset after showing error
            setTimeout(() => {
                setSyncState('idle')
                setSyncMessage('')
            }, 2000)
        }
    }, [project, userId, navigate, updateMemberLocalPath, preloadProjectDestination, onRequireSyncReview])

    const isBuilding = project.status === 'building' || project.status === 'generating'

    return (
            <TableRow
                ref={rowRef}
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
                                Open Project
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation()
                                navigate(buildProjectPath(String(project._id), 'settings'))
                            }}>
                                Settings
                            </DropdownMenuItem>
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
}
