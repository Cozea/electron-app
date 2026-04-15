import { useCallback, useEffect, useMemo, useState } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceSourceControl } from '@/hooks/useWorkspaceSourceControl'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useProjectWorkspaceContext } from '@/features/projects/hooks/useProjectWorkspaceContext'
import { ProjectDeleteDialog } from '@/features/projects/components/ProjectDeleteDialog'
import { ProjectSettingsSourceControlPanel } from '@/features/projects/components/settings/ProjectSettingsSourceControlPanel'
import {
  resolveProjectRepoAccessStatus,
} from '@/lib/git/projectRepoAccess'
import { resolveProjectRepositoryIntegration } from '@/lib/git/projectRepositoryIntegration'
import {
  getDefaultVersionControlSetupMode,
  normalizeVersionControlProvider,
} from '@shared/versionControl'
import { formatProjectDeleteError } from '@/features/projects/lib/projectMutationPresentation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { Label } from '@/components/ui/label'
import { ArrowPathIcon as Loader2, BookmarkIcon as Save, ExclamationTriangleIcon as AlertTriangle, TrashIcon as Trash2, XMarkIcon as X } from "@heroicons/react/24/outline"
import { cn } from '@/lib/utils'
import type { ProjectGitRuntimeProjectLike } from '@/lib/git/projectGitRuntime'

export interface ProjectSettingsPageProps {
  presentation?: 'modal' | 'embedded'
  onRequestClose?: (() => void) | null
}

type VersionControlProviderOption = 'github' | 'local'

function normalizeProjectSettingsProviderOption(
  value: string | null | undefined
): VersionControlProviderOption {
  return normalizeVersionControlProvider(value) === 'github' ? 'github' : 'local'
}

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

export function ProjectSettingsPage({
  presentation = 'modal',
  onRequestClose = null,
}: ProjectSettingsPageProps = {}) {
  const isEmbedded = presentation === 'embedded'
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()
  const projectWorkspace = useProjectWorkspaceContext(project)

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)

  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    project?._id && convexUserId
      ? { projectId: project._id, userId: convexUserId }
      : 'skip'
  )

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<VersionControlProviderOption>('local')
  const [repoUrl, setRepoUrl] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const { getConnection } = useWorkspaceSourceControl({
    route: '/settings/source-control',
    enabled: Boolean(project?.organizationId && convexUserId),
  })
  const repoIntegration =
    project?.organizationId && provider === 'github'
      ? getConnection(provider)
      : null
  const setupMode = useMemo(
    () => project?.sourceControl?.setupMode ?? getDefaultVersionControlSetupMode(projectWorkspace.isPersonalWorkspace),
    [project?.sourceControl?.setupMode, projectWorkspace.isPersonalWorkspace]
  )
  const repositoryIntegration = useMemo(
    () => resolveProjectRepositoryIntegration(project),
    [project],
  )
  const normalizedRepoUrl = repoUrl.trim()
  const normalizedDefaultBranch = defaultBranch.trim() || 'main'
  const editableProject = useMemo<ProjectGitRuntimeProjectLike | null>(() => {
    if (!project) return null

    return {
      _id: project._id,
      organizationId: project.organizationId,
      gitRepository:
        provider !== 'local' && normalizedRepoUrl
          ? {
              provider,
              url: normalizedRepoUrl,
              defaultBranch: normalizedDefaultBranch,
            }
          : null,
      sourceControl: {
        ...project.sourceControl,
        provider,
        repoUrl: normalizedRepoUrl || undefined,
        defaultBranch: normalizedDefaultBranch,
        setupMode,
      },
    }
  }, [
    normalizedDefaultBranch,
    normalizedRepoUrl,
    project,
    provider,
    setupMode,
  ])
  const repoAccessStatus = useMemo(
    () =>
      resolveProjectRepoAccessStatus({
        project: editableProject,
        sourceControlConnection: repoIntegration,
        isPersonalWorkspace: projectWorkspace.isPersonalWorkspace,
      }),
    [editableProject, projectWorkspace.isPersonalWorkspace, repoIntegration]
  )

  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setProvider(normalizeProjectSettingsProviderOption(repositoryIntegration.provider))
    setRepoUrl(repositoryIntegration.repoUrl)
    setDefaultBranch(repositoryIntegration.defaultBranch)
    setSaveError(null)
    setArchiveError(null)
    setDeleteError(null)
  }, [
    project?._id,
    project?.description,
    project?.name,
    project,
    repositoryIntegration.defaultBranch,
    repositoryIntegration.provider,
    repositoryIntegration.repoUrl,
  ])

  const isManager = memberRole === 'project_manager'
  const canEditGeneral = memberRole !== null && memberRole !== undefined && memberRole !== 'viewer'

  const projectName = project?.name ?? ''
  const projectDescription = project?.description ?? ''
  const projectProvider = normalizeProjectSettingsProviderOption(repositoryIntegration.provider)
  const projectRepoUrl = repositoryIntegration.repoUrl
  const projectDefaultBranch = repositoryIntegration.defaultBranch
  const hasChanges = Boolean(project) && (
    name !== projectName ||
    description !== projectDescription ||
    provider !== projectProvider ||
    normalizedRepoUrl !== projectRepoUrl ||
    normalizedDefaultBranch !== projectDefaultBranch
  )
  const canSave = Boolean(convexUserId) && canEditGeneral && !isSaving && hasChanges && name.trim().length > 0


  const handleSave = useCallback(async () => {
    if (!project || !convexUserId) return

    const nextName = name.trim()
    if (!nextName) {
      setSaveError('Project name is required.')
      return
    }
    if (!hasChanges) return

    setIsSaving(true)
    setSaveError(null)

    try {
      await updateProject({
        projectId: project._id,
        userId: convexUserId,
        name: nextName,
        description,
        sourceControl: {
          provider,
          repoUrl: normalizedRepoUrl || undefined,
          defaultBranch: normalizedDefaultBranch,
          setupMode,
          workingCopyMode:
            provider === 'local'
              ? project.sourceControl?.workingCopyMode
              : repoIntegration.workingCopyMode,
        },
      })
    } catch (error) {
      setSaveError(cleanConvexError(error, 'Failed to save project settings'))
    } finally {
      setIsSaving(false)
    }
  }, [
    convexUserId,
    description,
    hasChanges,
    name,
    normalizedDefaultBranch,
    normalizedRepoUrl,
    project,
    provider,
    repoIntegration.workingCopyMode,
    setupMode,
    updateProject,
  ])

  const handleArchive = useCallback(async () => {
    if (!project || !convexUserId) return

    setIsArchiving(true)
    setArchiveError(null)
    try {
      await archiveProject({
        projectId: project._id,
        userId: convexUserId,
      })
      setShowArchiveDialog(false)
      navigate('/projects')
    } catch (error) {
      setArchiveError(cleanConvexError(error, 'Failed to archive project'))
    } finally {
      setIsArchiving(false)
    }
  }, [archiveProject, convexUserId, navigate, project])

  const handleDelete = useCallback(async (confirmName: string) => {
    if (!project || !convexUserId || confirmName !== project.name) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await removeProject({
        projectId: project._id,
        userId: convexUserId,
        confirmName,
      })
      setShowDeleteDialog(false)
      navigate('/projects')
    } catch (error) {
      const presentation = formatProjectDeleteError(error)
      setDeleteError(
        presentation.detail
          ? `${presentation.message} ${presentation.detail}`
          : presentation.message
      )
    } finally {
      setIsDeleting(false)
    }
  }, [convexUserId, navigate, project, removeProject])

  function closeSettingsModal(): void {
    if (isEmbedded) {
      onRequestClose?.()
      return
    }
    navigate('/projects')
  }

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading project settings…
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <>
      <div
        role={isEmbedded ? undefined : 'dialog'}
        aria-modal={isEmbedded ? undefined : true}
        className={cn(
          'relative flex h-full w-full flex-col overflow-hidden bg-background supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur',
          !isEmbedded &&
            'max-w-4xl mx-auto my-10 rounded-[24px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
        )}
        onClick={!isEmbedded ? (e) => e.stopPropagation() : undefined}
      >
        <button
          type="button"
          onClick={closeSettingsModal}
          className="absolute right-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close settings"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="w-full min-h-full px-6 pt-5 pb-6 mx-auto max-w-xl">
            <div className="w-full">
              <section className="space-y-5">
                <div className="min-w-0 space-y-6">
                  <section>
                    <h3 className="px-1 text-xs font-medium text-muted-foreground mb-1.5">
                      General
                    </h3>
                    <div className="flex flex-col overflow-hidden rounded-[14px] bg-muted">
                      <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
                        <Label htmlFor="name" className="text-xs font-medium text-foreground whitespace-nowrap">Project Name</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value)
                          }}
                          placeholder="My Project"
                          className="h-7 w-[240px] max-w-full border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 text-right"
                        />
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                        <Label htmlFor="description" className="text-xs font-medium text-foreground whitespace-nowrap">Description</Label>
                        <Input
                          id="description"
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value)
                          }}
                          placeholder="Short description..."
                          className="h-7 w-[240px] max-w-full border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 text-right"
                        />
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                        <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                          <Label htmlFor="slug" className="text-xs font-medium text-foreground">Project Slug</Label>
                          <p className="text-[11px] text-muted-foreground truncate">
                            Retained for compatibility links
                          </p>
                        </div>
                        <Input id="slug" value={project.slug || ''} disabled className="h-7 w-[180px] shrink-0 border-none bg-transparent px-0 text-sm shadow-none opacity-50 cursor-not-allowed text-right" />
                      </div>
                      {saveError ? (
                        <div className="border-t border-border/40 px-4 py-3">
                          <p className="text-xs text-destructive">{saveError}</p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>

                <div className="min-w-0 space-y-6">
                  <ProjectSettingsSourceControlPanel
                    project={project}
                  repoAccessStatus={repoAccessStatus}
                  repoIntegration={repoIntegration}
                  provider={provider}
                  onProviderChange={(next) => {
                    setProvider(next)
                    if (next === 'local') {
                      setRepoUrl('')
                      setDefaultBranch(projectDefaultBranch)
                    }
                  }}
                  onRepoUrlChange={setRepoUrl}
                  defaultBranch={defaultBranch}
                  onDefaultBranchChange={setDefaultBranch}
                  setupMode={setupMode}
                  normalizedRepoUrl={normalizedRepoUrl}
                  saveError={saveError}
                  onOpenWorkspaceSourceControlSettings={() => {
                    navigate('/settings/source-control')
                  }}
                />
                </div>

                <div className="min-w-0 space-y-6">
                  <section>
                    <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium text-destructive mb-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Danger Zone
                    </h3>
                    <div className="flex flex-col overflow-hidden rounded-[14px] bg-destructive/15 dark:bg-destructive/20">
                      <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Label className="text-xs font-medium text-foreground">Archive Project</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Archive this project. It can be restored later.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="h-7 text-[11px] text-orange-500 hover:text-orange-600 bg-background/50 border-destructive/20"
                          disabled={!convexUserId || !isManager || project.status === 'archived'}
                          onClick={() => {
                            setShowArchiveDialog(true)
                            setArchiveError(null)
                          }}
                        >
                          {project.status === 'archived' ? 'Archived' : 'Archive Project'}
                        </Button>
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-destructive/20 px-4 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Label className="text-xs font-medium text-foreground">Delete Project</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Permanently delete this project and all its data. This action cannot be undone.
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          disabled={!convexUserId}
                          className="h-7 text-[11px]"
                          onClick={() => {
                            setShowDeleteDialog(true)
                            setDeleteError(null)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Project
                        </Button>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="flex justify-end pt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                    onClick={() => {
                      void handleSave()
                    }}
                    disabled={!canSave}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <span className="font-semibold">{project.name}</span>. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? <p className="text-sm text-destructive">{archiveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleArchive()
              }}
              disabled={isArchiving}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isArchiving ? 'Archiving...' : 'Archive Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectDeleteDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setDeleteError(null)
          }
        }}
        projectName={project.name}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        errorMessage={deleteError}
      />
    </>
  )
}
