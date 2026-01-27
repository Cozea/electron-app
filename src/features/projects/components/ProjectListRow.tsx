import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
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

import { ProjectSyncStats } from './ProjectSyncStats'
import { cn } from '@/lib/utils'

type SyncState = 'idle' | 'checking' | 'syncing' | 'ready' | 'error'

interface ProjectListRowProps {
    project: any
    userId?: string
    creatorName?: string
    creatorImage?: string
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

export function ProjectListRow({ project, userId, creatorName, creatorImage }: ProjectListRowProps) {
    const navigate = useNavigate()
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [deleteConfirmName, setDeleteConfirmName] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [syncState, setSyncState] = useState<SyncState>('idle')
    const [syncMessage, setSyncMessage] = useState('')
    const deleteProject = useMutation(api.projects.deleteProject)
    const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
    const [showMenu, setShowMenu] = useState(false)
    const [localPath, setLocalPath] = useState<string | null>(null)

    // Get cloud manifest for sync check
    const cloudManifest = useQuery(
        api.projectFiles.getManifestForProject,
        project.status !== 'draft' ? { projectId: project._id } : 'skip'
    )

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
            const cleanMessage = message.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '')
            setDeleteError(cleanMessage)
        } finally {
            setIsDeleting(false)
        }
    }

    const handleRowClick = useCallback(async () => {
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
            console.error('[ProjectListRow] Sync check failed:', error)
            setSyncState('error')
            setSyncMessage(error instanceof Error ? error.message : 'Failed to prepare project')

            // Reset after showing error
            setTimeout(() => {
                setSyncState('idle')
                setSyncMessage('')
            }, 2000)
        }
    }, [project, userId, cloudManifest, navigate, updateMemberLocalPath])

    const isBuilding = project.status === 'building' || project.status === 'generating'

    return (
        <>
            <div className="relative">
                <div
                    className={cn(
                        "group grid grid-cols-12 items-center gap-4 py-3 px-4 border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer",
                        syncState !== 'idle' && "pointer-events-none"
                    )}
                    onClick={handleRowClick}
                >
                    {/* Sync status overlay text - only show when syncing */}
                    {syncState !== 'idle' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px] z-10">
                            <div className="flex items-center gap-2 text-xs font-medium">
                                {syncState === 'error' ? (
                                    <>
                                        <Cloud className="h-3.5 w-3.5 text-destructive" />
                                        <span className="text-destructive">{syncMessage}</span>
                                    </>
                                ) : syncState === 'ready' ? (
                                    <>
                                        <Check className="h-3.5 w-3.5 text-green-500" />
                                        <span className="text-muted-foreground">{syncMessage}</span>
                                    </>
                                ) : (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                                        <span className="text-muted-foreground">{syncMessage}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 min-w-0 col-span-8 sm:col-span-6 md:col-span-5 lg:col-span-4">
                        <div className="flex flex-col min-w-0 justify-center w-full">
                            <span className="font-medium truncate text-sm">
                                {project.name}
                            </span>
                        </div>
                    </div>

                    {/* Status Column */}
                    <div className="col-span-2 sm:col-span-2 md:col-span-1 flex items-center justify-center">
                        {isBuilding && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        {project.status === 'active' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {project.status === 'draft' && <Pencil className="h-4 w-4 text-muted-foreground" />}
                        {project.status === 'archived' && <Archive className="h-4 w-4 text-muted-foreground" />}
                        {project.status === 'failed' && <AlertCircle className="h-4 w-4 text-destructive" />}
                    </div>

                    {/* Owner/Status - Middle Column to Last Modified By */}
                    <div className="hidden md:flex md:col-span-4 lg:col-span-3 items-center text-sm text-muted-foreground truncate min-w-0">
                        <div className="flex items-center gap-2 truncate">
                            <Avatar className="h-5 w-5">
                                <AvatarImage src={creatorImage} />
                                <AvatarFallback className="text-[10px]">
                                    {creatorName?.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <span className="truncate">{creatorName || project.createdBy || 'Unknown'}</span>
                        </div>
                    </div>

                    {/* Sync Stats */}
                    <div className="hidden lg:flex lg:col-span-1 items-center justify-center">
                        {project.status !== 'draft' && localPath ? (
                            <div onClick={(e) => e.stopPropagation()}>
                                <ProjectSyncStats
                                    projectId={project._id}
                                    projectSlug={project.slug}
                                    localPath={localPath}
                                    lastSyncAt={project.lastSyncAt}
                                />
                            </div>
                        ) : (
                            <span className="text-muted-foreground/30 text-xs">--</span>
                        )}
                    </div>

                    {/* Last Modified */}
                    <div className="hidden sm:flex sm:col-span-3 md:col-span-2 items-center text-sm text-muted-foreground justify-end pr-4 min-w-0">
                        {formatRelativeTime(project.updatedAt)}
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-2 pr-2">
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
                </div>

                {/* Progress bar at the bottom of the row - spans full width */}
                {syncState !== 'idle' && syncState !== 'error' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/30 overflow-hidden">
                        <div
                            className={cn(
                                "h-full transition-all duration-300",
                                syncState === 'ready' ? "bg-green-500" : "bg-primary"
                            )}
                            style={{
                                width: syncState === 'ready' ? '100%' : syncState === 'syncing' ? '70%' : '30%',
                                animation: syncState !== 'ready' ? 'pulse 1.5s ease-in-out infinite' : 'none'
                            }}
                        />
                    </div>
                )}
            </div>

            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
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
        </>
    )
}
