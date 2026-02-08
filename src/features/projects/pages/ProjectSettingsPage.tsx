import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/hooks/useProjectHeader'
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

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

export function ProjectSettingsPage() {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization, convexUserId } = useAuth()

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

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)

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

  const projectName = project?.name ?? ''
  const projectDescription = project?.description ?? ''
  const hasChanges = Boolean(project) && (name !== projectName || description !== projectDescription)
  const canSave = Boolean(convexUserId) && !isSaving && hasChanges && name.trim().length > 0

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
      const updated = await updateProject({
        projectId: project._id,
        userId: convexUserId,
        name: nextName,
        description,
      })

      if (updated?.slug && slug && updated.slug !== slug) {
        navigate(`/projects/${updated.slug}/settings`, { replace: true })
      }
    } catch (error) {
      setSaveError(cleanConvexError(error, 'Failed to save project settings'))
    } finally {
      setIsSaving(false)
    }
  }, [convexUserId, description, hasChanges, name, navigate, project, slug, updateProject])

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

  const headerActions = useMemo(
    () => (
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
    ),
    [canSave, handleSave, isSaving]
  )

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
        <div className="w-full min-h-full px-4 py-6 xl:px-3" key={project._id}>
          <div className="flex min-h-[calc(100vh-5.5rem)] gap-0">
            <div className="w-full max-w-2xl space-y-8 pr-0 xl:pr-10">
              <div>
                <div className="space-y-4">
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
                    <Input
                      id="slug"
                      value={project.slug || ''}
                      placeholder="my-project"
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      The slug is used in URLs and cannot be changed.
                    </p>
                  </div>
                  {saveError ? (
                    <p className="text-xs text-destructive">{saveError}</p>
                  ) : null}
                </div>
              </div>

              <div className="pt-2">
                <h3 className="text-base font-medium mb-1 flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Danger Zone
                </h3>
                <div className="space-y-4 mt-4">
                  <div className="flex items-center justify-between gap-4 p-5 rounded-2xl bg-destructive/5">
                    <div>
                      <h4 className="font-medium">Archive Project</h4>
                      <p className="text-sm text-muted-foreground">
                        Archive this project. It can be restored later.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="text-orange-500 hover:text-orange-600"
                      disabled={!convexUserId || project.status === 'archived'}
                      onClick={() => {
                        setShowArchiveDialog(true)
                        setArchiveError(null)
                      }}
                    >
                      {project.status === 'archived' ? 'Archived' : 'Archive Project'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-4 p-5 rounded-2xl bg-destructive/5">
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
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Project
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative hidden xl:block min-w-0 flex-1 pl-6">
              <div className="absolute left-0 top-3 bottom-3 w-px bg-gradient-to-b from-transparent via-border/80 to-transparent" />
              <div
                className="h-full min-h-[560px] rounded-2xl bg-sidebar/35"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--muted-foreground) 38%, transparent) 1.15px, transparent 0)',
                  backgroundSize: '20px 20px',
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/55" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/35 via-transparent to-background/20" />
            </div>
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
          {archiveError ? (
            <p className="text-sm text-destructive">{archiveError}</p>
          ) : null}
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
            {deleteError ? (
              <p className="text-sm text-destructive">{deleteError}</p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={isDeleting || deleteConfirmName !== project.name}
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
