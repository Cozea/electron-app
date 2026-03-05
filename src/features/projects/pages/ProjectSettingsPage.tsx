import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { buildLegacyProjectPath, buildProjectPath } from '@/features/projects/lib/projectRoutes'
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
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react'

type SettingsSectionId = 'general' | 'danger'

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'danger', label: 'Danger' },
]

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

export function ProjectSettingsPage() {
  const navigate = useViewTransitionNavigate()
  const { section: sectionParam } = useParams<{ section?: string }>()
  const { convexUserId } = useAuth()
  const { project, projectIdParam, slugParam } = useAccessibleProject()

  const currentSection: SettingsSectionId =
    sectionParam === 'danger' ? sectionParam : 'general'

  const buildSettingsPath = useCallback((section: SettingsSectionId) => {
    if (project?._id) return buildProjectPath(String(project._id), `settings/${section}`)
    if (projectIdParam) return buildProjectPath(projectIdParam, `settings/${section}`)
    return slugParam ? buildLegacyProjectPath(slugParam, `settings/${section}`) : null
  }, [project?._id, projectIdParam, slugParam])

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setSaveError(null)
    setArchiveError(null)
    setDeleteError(null)
    setDeleteConfirmName('')
  }, [project?._id, project?.name, project?.description, project])

  const isManager = memberRole === 'project_manager'
  const canEditGeneral = memberRole !== null && memberRole !== undefined && memberRole !== 'viewer'

  const projectName = project?.name ?? ''
  const projectDescription = project?.description ?? ''
  const hasChanges = Boolean(project) && (name !== projectName || description !== projectDescription)
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
      })
    } catch (error) {
      setSaveError(cleanConvexError(error, 'Failed to save project settings'))
    } finally {
      setIsSaving(false)
    }
  }, [convexUserId, description, hasChanges, name, project, updateProject])

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

  const handleDelete = useCallback(async () => {
    if (!project || !convexUserId || deleteConfirmName !== project.name) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await removeProject({
        projectId: project._id,
        userId: convexUserId,
        confirmName: deleteConfirmName,
      })
      setShowDeleteDialog(false)
      setDeleteConfirmName('')
      navigate('/projects')
    } catch (error) {
      setDeleteError(cleanConvexError(error, 'Failed to delete project'))
    } finally {
      setIsDeleting(false)
    }
  }, [convexUserId, deleteConfirmName, navigate, project, removeProject])

  const headerActions = useMemo(() => {
    if (currentSection !== 'general') return null
    return (
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
    )
  }, [canSave, currentSection, handleSave, isSaving])

  useProjectHeader(headerActions)

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="w-full min-h-full px-4 py-6 xl:px-3">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-border/60 bg-card/50 p-2">
              <div className="space-y-1">
                {SETTINGS_SECTIONS.map((section) => {
                  const isActive = currentSection === section.id
                  const targetPath = buildSettingsPath(section.id)
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`flex h-9 w-full items-center rounded-lg px-3 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      }`}
                      onClick={() => {
                        if (targetPath) navigate(targetPath, { replace: true })
                      }}
                    >
                      {section.label}
                    </button>
                  )
                })}
              </div>
            </aside>

            <section className="space-y-5">
              {currentSection === 'general' ? (
                <div className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-5">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value)
                      }}
                      placeholder="My Project"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value)
                      }}
                      placeholder="A brief description of your project..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="slug">Project Slug</Label>
                    <Input id="slug" value={project.slug || ''} disabled />
                    <p className="text-xs text-muted-foreground">
                      Slug is retained for compatibility links. Canonical routes use project id.
                    </p>
                  </div>

                  {saveError ? (
                    <p className="text-xs text-destructive">{saveError}</p>
                  ) : null}
                </div>
              ) : null}

              {currentSection === 'danger' ? (
                <div className="space-y-4">
                  <h3 className="text-base font-medium flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Danger Zone
                  </h3>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-destructive/5 p-5">
                    <div>
                      <h4 className="font-medium">Archive Project</h4>
                      <p className="text-sm text-muted-foreground">
                        Archive this project. It can be restored later.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="text-orange-500 hover:text-orange-600"
                      disabled={!convexUserId || !isManager || project.status === 'archived'}
                      onClick={() => {
                        setShowArchiveDialog(true)
                        setArchiveError(null)
                      }}
                    >
                      {project.status === 'archived' ? 'Archived' : 'Archive Project'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-destructive/5 p-5">
                    <div>
                      <h4 className="font-medium">Delete Project</h4>
                      <p className="text-sm text-muted-foreground">
                        Permanently delete this project and all its data. This action cannot be undone.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      disabled={!convexUserId}
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
              ) : null}
            </section>
          </div>
        </div>
      </ScrollArea>

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

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setDeleteConfirmName('')
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Type <span className="font-mono font-semibold">{project.name}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-delete-project">Confirm project name</Label>
            <Input
              id="confirm-delete-project"
              value={deleteConfirmName}
              onChange={(event) => {
                setDeleteConfirmName(event.target.value)
              }}
              placeholder={project.name}
            />
            {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={isDeleting || deleteConfirmName !== project.name}
              className="bg-destructive text-white hover:bg-destructive/90 disabled:bg-destructive/70 disabled:text-white disabled:opacity-100"
            >
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
