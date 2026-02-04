import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Separator } from '../../components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import { AlertTriangle, Trash2, Loader2, Check, X } from 'lucide-react'

export function General() {
  const navigate = useNavigate()
  const { user, logout, currentOrganization, convexUserId } = useAuth()
  const {
    updateOrganization: updateWorkosOrganization,
    deleteOrganization: deleteWorkosOrganization,
  } = useOrganization()

  // Form state
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [description, setDescription] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `workspace-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Mutations
  const updateOrganization = useMutation(api.organizations.updateOrganization)
  const deleteOrganization = useMutation(api.organizations.deleteOrganization)

  // Initialize form with org data
  const [isFormInitialized, setIsFormInitialized] = useState(false)

  // Initialize form with org data - only once to prevent overwriting user edits and flashing
  useEffect(() => {
    if (convexOrg && !isFormInitialized) {
      setWorkspaceName(convexOrg.name)
      setWorkspaceSlug(convexOrg.slug)
      setDescription(convexOrg.description || '')
      setIsFormInitialized(true)
    }
  }, [convexOrg, isFormInitialized])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveSuccess])

  const handleSave = async () => {
    if (!convexOrg || !convexUserId || !currentOrganization) return

    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      // Update WorkOS first if name changed (WorkOS is source of truth for name)
      if (workspaceName !== convexOrg.name) {
        const workosResult = await updateWorkosOrganization(
          currentOrganization.organizationId,
          workspaceName
        )
        if (!workosResult) {
          throw new Error('Failed to update organization in WorkOS')
        }
      }

      // Then update Convex (for name, slug, and description)
      await updateOrganization({
        orgId: convexOrg._id,
        userId: convexUserId,
        name: workspaceName,
        slug: workspaceSlug,
        description: description || undefined,
      })
      setSaveSuccess(true)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!convexOrg || !convexUserId || !currentOrganization) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      // Verify name matches before proceeding
      if (deleteConfirmName !== convexOrg.name) {
        throw new Error('Workspace name does not match')
      }

      // Delete from WorkOS first (source of truth)
      const workosResult = await deleteWorkosOrganization(currentOrganization.organizationId)
      if (!workosResult) {
        throw new Error('Failed to delete organization from WorkOS')
      }

      // Then delete from Convex
      await deleteOrganization({
        orgId: convexOrg._id,
        userId: convexUserId,
        confirmName: deleteConfirmName,
      })

      // Redirect to login after successful deletion
      await logout()
      navigate('/')
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete workspace')
      setIsDeleting(false)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const isLoading = convexOrg === undefined

  if (isLoading) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[{ label: 'Workspace' }, { label: 'General' }]}
      >
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  const hasChanges = isFormInitialized && (
    workspaceName !== convexOrg?.name ||
    workspaceSlug !== convexOrg?.slug ||
    description !== (convexOrg?.description || '')
  )



  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'General' }]}
    >
      <div className="max-w-2xl space-y-6">
        {/* Workspace Details */}
        <Card className="border-none shadow-none bg-transparent">
          <CardContent className="space-y-4 pt-0">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace Name</Label>
              <Input
                id="name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Workspace URL</Label>
              <div className="flex items-stretch">
                <span className="flex items-center text-sm text-muted-foreground bg-muted px-3 rounded-l-md border border-r-0">
                  app.cozea.io/
                </span>
                <Input
                  id="slug"
                  value={workspaceSlug}
                  onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="rounded-l-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This is your workspace's unique identifier
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="A short description of your workspace"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {saveError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <X className="h-4 w-4" />
                {saveError}
              </div>
            )}

            {saveSuccess && (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <Check className="h-4 w-4" />
                Changes saved successfully
              </div>
            )}

            <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Workspace Info */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Workspace Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Workspace ID</span>
              <code className="text-sm bg-muted px-2 py-1 rounded font-mono">
                {convexOrg?._id}
              </code>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Created</span>
              <span>{convexOrg?.createdAt ? formatDate(convexOrg.createdAt) : 'Unknown'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible and destructive actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
              <div>
                <h4 className="font-medium">Delete Workspace</h4>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this workspace and all its data
                </p>
              </div>
              <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Workspace</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. All projects, data, and members will be permanently removed.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>
                        Type <span className="font-semibold">{convexOrg?.name}</span> to confirm
                      </Label>
                      <Input
                        placeholder={convexOrg?.name}
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                      />
                    </div>
                    {deleteError && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <X className="h-4 w-4" />
                        {deleteError}
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDeleteDialogOpen(false)
                        setDeleteConfirmName('')
                        setDeleteError(null)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={isDeleting || deleteConfirmName !== convexOrg?.name}
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        'Delete Workspace'
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
