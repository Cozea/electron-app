import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { ProjectDiffBadge } from '@/components/projects/ProjectDiffBadge'
import { cn } from '@/lib/utils'

// Types based on what we saw in the schema and Projects.tsx
interface ProjectCardProps {
    project: any // We'll use any for now to avoid strict type issues with the complex Convex schema, but ideally this matches the schema
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

export function ProjectCard({ project, userId }: ProjectCardProps & { userId?: string }) {
    const navigate = useNavigate()
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [deleteConfirmName, setDeleteConfirmName] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [syncState, setSyncState] = useState<SyncState>('idle')
    const [syncMessage, setSyncMessage] = useState('')
    const deleteProject = useMutation(api.projects.deleteProject)
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
    const [localPath, setLocalPath] = useState<string | null>(null)

    // Get cloud manifest for sync check
    const cloudManifest = useQuery(
        api.projectFiles.getManifestForProject,
        project.status !== 'draft' ? { projectId: project._id } : 'skip'
    )

    // Get preview image URL
    const previewImageUrl = useQuery(
        api.projects.getPreviewImageUrl,
        project.status !== 'draft' ? { projectId: project._id } : 'skip'
    )
    const [imageLoaded, setImageLoaded] = useState(false)
    const [imageError, setImageError] = useState(false)

    useEffect(() => {
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
    }, [project.slug, project.status])

    const handleCardClick = useCallback(async () => {
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
                    userId: userId as any,
                    localPath: effectiveLocalPath,
                })
            }

            // Quick check if sync is needed
            if (effectiveLocalPath && cloudManifest) {
                setSyncMessage('Checking files...')
                const localResult = await window.electronAPI.sync.getLocalManifest({
                    projectPath: effectiveLocalPath,
                })

                const hasChanges = localResult.totalFiles !== cloudManifest.length

                if (hasChanges) {
                    setSyncState('syncing')
                    setSyncMessage('Syncing files...')
                    // Let the actual sync happen after navigation
                }
            }

            // Navigate to project
            setSyncState('ready')
            setSyncMessage('Opening project...')

            // Small delay to show the ready state
            setTimeout(() => {
                navigate(`/projects/${project.slug}`)
            }, 200)

        } catch (error) {
            console.error('[ProjectCard] Sync check failed:', error)
            setSyncState('error')
            setSyncMessage(error instanceof Error ? error.message : 'Failed to prepare project')

            // Reset after showing error
            setTimeout(() => {
                setSyncState('idle')
                setSyncMessage('')
            }, 2000)
        }
    }, [project, userId, cloudManifest, navigate, updateMemberLocalPath])

    const handleDelete = async () => {
        if (!userId || deleteConfirmName !== project.name) return
        setIsDeleting(true)
        setDeleteError(null)
        try {
            await deleteProject({
                projectId: project._id,
                userId: userId as any,
                confirmName: deleteConfirmName,
            })
            setShowDeleteDialog(false)
            setDeleteConfirmName('')
        } catch (error) {
            console.error('Failed to delete project:', error)
            const message = error instanceof Error ? error.message : 'Failed to delete project'
            // Extract the actual error message from Convex error format
            const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
            setDeleteError(cleanMessage)
        } finally {
            setIsDeleting(false)
        }
    }

    // Derived state
    const isBuilding = project.status === 'building' || project.status === 'generating'
    const isDraft = project.status === 'draft'

    const stackBadges = []
    if (project.stack?.backend) stackBadges.push(project.stack.backend)
    if (project.stack?.hosting) stackBadges.push(project.stack.hosting)

    // Color tag logic (mimicking the design's "Developer", "Designer" tags)
    // We'll map the project type or stack to a color
    const tagColor =
        project.stack?.backend ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" :
            project.stack?.hosting ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" :
                "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"

    const primaryTag = stackBadges[0] || "Project"

    return (
        <div className="h-full">
            <Card
                className={cn(
                    "group relative flex flex-col h-full hover:shadow-md transition-all duration-200 border-border/50 bg-card/50 hover:bg-card overflow-visible p-0 gap-0",
                    syncState !== 'idle' && "pointer-events-none"
                )}
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
                        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm rounded-t-xl flex flex-col items-center justify-center gap-2">
                            {syncState === 'error' ? (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                        <Cloud className="h-5 w-5 text-destructive" />
                                    </div>
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

                    {/* Sync Badge positioned over preview */}
                    {project.status !== 'draft' && localPath && syncState === 'idle' && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute top-2 right-2 z-10">
                            <ProjectDiffBadge
                                projectId={project._id}
                                projectSlug={project.slug}
                                localPath={localPath}
                                lastSyncAt={project.lastSyncAt}
                            />
                        </div>
                    )}
                </div>

                {/* Progress bar at the border between preview and content */}
                <div className="relative h-0.5 w-full bg-border/50">
                    {syncState !== 'idle' && syncState !== 'error' && (
                        <div
                            className={cn(
                                "absolute inset-0 h-full transition-all duration-300",
                                syncState === 'ready' ? "bg-green-500" : "bg-primary"
                            )}
                            style={{
                                width: syncState === 'ready' ? '100%' : syncState === 'syncing' ? '70%' : '30%',
                                animation: syncState !== 'ready' ? 'pulse 1.5s ease-in-out infinite' : 'none'
                            }}
                        />
                    )}
                </div>

                {/* Content Section - Bottom Half */}
                <div className="flex flex-col flex-1">
                    <CardHeader className="px-3 pt-4 pb-0 space-y-0.5">
                        <div className="flex items-start justify-between">
                            <Badge
                                variant="secondary"
                                className={cn("rounded-md px-2 py-0 text-[10px] font-medium border-0", tagColor)}
                            >
                                {primaryTag}
                            </Badge>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground -mr-1 -mt-1">
                                        <MoreHorizontal className="h-3 w-3" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(`/projects/${project.slug}`)
                                    }}>
                                        Open Project
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(`/projects/${project.slug}/settings`)
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
                                            setShowDeleteDialog(true)
                                        }}
                                        className="text-destructive focus:text-destructive"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <div>
                            <CardTitle className="text-base font-bold leading-tight mb-1 truncate">
                                {project.name}
                            </CardTitle>
                            <CardDescription className="line-clamp-2 text-xs h-8">
                                {project.description || "No description provided."}
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="px-3 pb-3 pt-0 mt-auto">
                        <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-2">
                            {isBuilding ? (
                                <div className="flex items-center gap-2 text-xs text-blue-500 font-medium animate-pulse">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Building...
                                </div>
                            ) : (
                                <div className="text-xs text-muted-foreground font-medium">
                                    {isDraft ? 'Draft' : 'Active'}
                                </div>
                            )}

                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatRelativeTime(project.updatedAt)}
                                </div>
                                <div className="flex items-center gap-1">
                                    <FileCode className="h-3 w-3" />
                                    {project.stats?.fileCount || Math.floor(Math.random() * 20) + 1}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={(open) => {
                setShowDeleteDialog(open)
                if (!open) {
                    setDeleteConfirmName('')
                    setDeleteError(null)
                }
            }}>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Project</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the project
                            <span className="font-semibold"> {project.name}</span> and all associated data.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-muted-foreground mb-2">
                            Type <span className="font-mono font-semibold">{project.name}</span> to confirm:
                        </p>
                        <Input
                            value={deleteConfirmName}
                            onChange={(e) => setDeleteConfirmName(e.target.value)}
                            placeholder="Project name"
                            className="w-full"
                        />
                        {deleteError && (
                            <p className="text-sm text-destructive mt-2">
                                {deleteError}
                            </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleteConfirmName !== project.name || isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Project'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
