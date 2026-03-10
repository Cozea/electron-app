import { useState, useCallback, useEffect, useRef } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
    Clock,
    MoreHorizontal,
    FileCode,
    Loader2,
    Trash2,
    Cloud,
    Check,
    ImageOff
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
import { runProjectOpenReplicaCheck } from '../lib/projectOpenReplicaCheck'
import type { ProjectOpenReplicaCheckResult } from '../lib/projectOpenReplicaCheck'
import type { ProjectOpenSyncReviewRequest } from '../lib/projectOpenSyncReview'
import { formatReplicaSyncError, isReplicaSyncEntitlementError } from '../lib/replicaErrorPresentation'
import { markRecentProjectOpenSync } from '../lib/recentProjectOpenSync'
import { buildProjectPath } from '../lib/projectRoutes'

// Types based on what we saw in the schema and Projects.tsx
interface ProjectSummary {
    _id: Id<'projects'>
    slug: string
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

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

const preloadProjectDetailPage = () => import('@/features/projects/pages/ProjectDetailPage')
const preloadNewProjectPage = () => import('@/pages/NewProject')

export function ProjectCard({ project, userId, onRequireSyncReview }: ProjectCardProps) {
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isInViewport = useInViewportOnce(cardRef)
    const [isDeleting, setIsDeleting] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncErrorActionHref, setSyncErrorActionHref] = useState<string | null>(null)
  const [syncHydrationRequested, setSyncHydrationRequested] = useState(false)
  const deleteProject = useMutation(api.projects.deleteProject)
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
    const [localPath, setLocalPath] = useState<string | null>(null)

    // Get preview image URL
    const previewImageUrl = useQuery(
        api.projects.getPreviewImageUrl,
        project.status !== 'draft' ? { projectId: project._id } : 'skip'
    )
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const shouldHydrateSyncStatus = syncHydrationRequested || isInViewport || syncState !== 'idle'

  useEffect(() => {
    setImageLoaded(false)
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

    const executeAutoSyncBeforeOpen = useCallback(async (
        effectiveLocalPath: string,
        check: ProjectOpenReplicaCheckResult
    ): Promise<boolean> => {
        setSyncState('syncing')
        setSyncMessage(check.likelyLocalWipe ? 'Downloading cloud files...' : 'Syncing project files...')

        if (userId) {
            try {
                await updateSyncStatus({
                    projectId: project._id,
                    userId,
                    status: 'syncing',
                })
            } catch (statusError) {
                console.error('[ProjectCard] Failed to update syncing status:', statusError)
            }
        }

        const result = await window.electronAPI.sync.gitReplicaExecute({
            projectId: String(project._id),
            projectPath: effectiveLocalPath,
            sessionId: check.plan.sessionId,
        })

        const syncErrorPresentation = formatReplicaSyncError(
            result.error || 'Failed to sync project files',
            'Failed to sync project files'
        )
        const syncErrorMessage = syncErrorPresentation.summary
        const syncStatusDetail = syncErrorPresentation.detail
            ? `${syncErrorPresentation.summary} ${syncErrorPresentation.detail}`
            : syncErrorPresentation.summary

        if (userId) {
            try {
                await updateSyncStatus({
                    projectId: project._id,
                    userId,
                    status: result.success && result.applied ? 'synced' : 'error',
                    errorMessage: result.success && result.applied ? undefined : syncStatusDetail,
                })
            } catch (statusError) {
                console.error('[ProjectCard] Failed to update final sync status:', statusError)
            }
        }

        if (result.success && result.applied) {
            return true
        }

        if (result.requiresConflictResolution && onRequireSyncReview) {
            const refreshedCheck = await runProjectOpenReplicaCheck({
                projectId: String(project._id),
                projectPath: effectiveLocalPath,
            })
            onRequireSyncReview({
                projectId: project._id,
                projectSlug: project.slug,
                projectName: project.name,
                projectTemplate: project.template ?? undefined,
                projectPath: effectiveLocalPath,
                check: refreshedCheck,
            })
            setSyncState('idle')
            setSyncMessage('')
            return false
        }

        throw new Error(syncErrorMessage)
    }, [onRequireSyncReview, project._id, project.name, project.slug, project.template, updateSyncStatus, userId])

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
        setSyncErrorActionHref(null)

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

            let openCheck: ProjectOpenReplicaCheckResult | null = null

            // Pre-open sync plan check so real conflicts go through manual review,
            // while clean sync can finish inline from the card before navigation.
            if (effectiveLocalPath) {
                setSyncMessage('Checking sync status...')
                const check = await runProjectOpenReplicaCheck({
                    projectId: String(project._id),
                    projectPath: effectiveLocalPath,
                })
                openCheck = check

                if (check.totalChanges > 0) {
                    setSyncState('syncing')
                    if (check.hasConflicts) {
                        setSyncMessage(`${check.plan.conflicts.length} conflict${check.plan.conflicts.length === 1 ? '' : 's'} detected`)
                    } else if (check.likelyLocalWipe) {
                        setSyncMessage('Downloading cloud files...')
                    } else {
                        setSyncMessage('Syncing project files...')
                    }
                }
            }

            if (effectiveLocalPath && openCheck && openCheck.totalChanges > 0 && !openCheck.hasConflicts) {
                const shouldContinueToOpen = await executeAutoSyncBeforeOpen(effectiveLocalPath, openCheck)
                if (!shouldContinueToOpen) {
                    return
                }
            }

            setSyncState('ready')
            setSyncMessage(openCheck?.gateSyncScreen ? 'Opening sync review...' : 'Opening project...')
            setSyncErrorActionHref(null)

            // Small delay to show the ready state
            setTimeout(() => {
                if (!openCheck?.syncAccessBlocked) {
                    markRecentProjectOpenSync(String(project._id))
                }
                if (openCheck?.gateSyncScreen && effectiveLocalPath && onRequireSyncReview) {
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
                        projectId: String(project._id),
                        projectSlug: project.slug,
                        projectName: project.name,
                        projectTemplate: project.template ?? undefined,
                        gateSyncScreen: openCheck?.gateSyncScreen ?? false,
                        syncAccessBlocked: openCheck?.syncAccessBlocked ?? false,
                        skipInitialSyncCheck: !(openCheck?.gateSyncScreen ?? false),
                    },
                })
            }, 200)

        } catch (error) {
            console.error('[ProjectCard] Sync check failed:', error)
            const presentedError = formatReplicaSyncError(error, 'Failed to prepare project')
            setSyncState('error')
            setSyncMessage(presentedError.summary)
            setSyncErrorActionHref(
                isReplicaSyncEntitlementError(error) ? '/settings/billing' : null
            )

            if (!isReplicaSyncEntitlementError(error)) {
                setTimeout(() => {
                    setSyncState('idle')
                    setSyncMessage('')
                }, 2000)
            }
        }
    }, [executeAutoSyncBeforeOpen, project, userId, navigate, updateMemberLocalPath, preloadProjectDestination, onRequireSyncReview, syncState])

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

    // Derived state
    const isBuilding = project.status === 'building' || project.status === 'generating'
    const isDraft = project.status === 'draft'
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
                            {!imageLoaded && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
                                </div>
                            )}
                            <img
                                src={previewImageUrl}
                                alt={`${project.name} preview`}
                                className={cn(
                                    "w-full h-full object-cover object-top transition-opacity",
                                    imageLoaded ? "opacity-100" : "opacity-0"
                                )}
                                onLoad={() => setImageLoaded(true)}
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
                                            Open Billing
                                        </Button>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                            <Cloud className="h-5 w-5 text-destructive" />
                                        </div>
                                    )}
                                    <p className="text-xs text-destructive font-medium text-center px-4">{syncMessage}</p>
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
                                    Open Project
                                </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(buildProjectPath(String(project._id), 'settings'))
                                    }}>
                                        Settings
                                    </DropdownMenuItem>
                                    {project.status === 'archived' ? (
                                        <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                                            Restore
                                        </DropdownMenuItem>
                                    ) : (
                                        <DropdownMenuItem onClick={(e) => e.stopPropagation()} className="text-destructive focus:text-destructive">
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
