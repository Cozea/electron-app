import { useState, useEffect } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { WorkspaceIdentityPicker } from '@/components/workspaces/WorkspaceIdentityPicker'
import { useScopedGeneralData } from '@/hooks/useScopedGeneralData'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
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
import {
  sanitizeWorkspaceIdentityInput,
  type WorkspaceIdentityInput,
} from '@shared/workspaceIdentity.ts'

export function General() {
  const navigate = useViewTransitionNavigate()
  const {
    settingsPage,
    user,
    logout,
    convexUserId,
    convexOrg,
    workspaceOrganizationId,
    canManageGeneral,
    updateWorkosOrganization,
    deleteWorkosOrganization,
    isLoading,
  } = useScopedGeneralData()

  // Form state
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [workspaceIdentity, setWorkspaceIdentity] = useState<WorkspaceIdentityInput>({})
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
      setWorkspaceIdentity(
        sanitizeWorkspaceIdentityInput({
          iconKey: convexOrg.iconKey,
          iconColor: convexOrg.iconColor,
        })
      )
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
    if (!convexOrg || !convexUserId || !canManageGeneral) return

    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const isWorkspaceScoped = settingsPage.workspaceScoped

      // Update WorkOS first if name changed (WorkOS is source of truth for shared workspace names)
      if (isWorkspaceScoped && workspaceOrganizationId && workspaceName !== convexOrg.name) {
        const workosResult = await updateWorkosOrganization(
          workspaceOrganizationId,
          workspaceName
        )
        if (!workosResult) {
          throw new Error('Failed to update organization in WorkOS')
        }
      }

      // Then update Convex for name, slug, and identity.
      await updateOrganization({
        orgId: convexOrg._id,
        userId: convexUserId,
        name: workspaceName,
        slug: isWorkspaceScoped ? workspaceSlug : undefined,
        iconKey: workspaceIdentity.iconKey ?? null,
        iconColor: workspaceIdentity.iconKey
          ? workspaceIdentity.iconColor ?? null
          : null,
      })
      setSaveSuccess(true)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!convexOrg || !convexUserId || !workspaceOrganizationId || !canManageGeneral) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      // Verify name matches before proceeding
      if (deleteConfirmName !== convexOrg.name) {
        throw new Error('Workspace name does not match')
      }

      // Delete from WorkOS first (source of truth)
      const workosResult = await deleteWorkosOrganization(workspaceOrganizationId)
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

  const hasChanges = isFormInitialized && (
    workspaceName !== convexOrg?.name ||
    (settingsPage.workspaceScoped && workspaceSlug !== convexOrg?.slug) ||
    (workspaceIdentity.iconKey ?? null) !== (convexOrg?.iconKey ?? null) ||
    (workspaceIdentity.iconColor ?? null) !== (convexOrg?.iconColor ?? null)
  )

  const isWorkspaceScoped = settingsPage.workspaceScoped



  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={settingsPage.breadcrumbs}
    >
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Workspace access required"
          description="You do not have permission to view this workspace."
        />
      ) : (
      <div className="flex min-h-[calc(100vh-8rem)] gap-0">
        <div className="w-full max-w-2xl space-y-6 pr-0 xl:pr-10">
          {isLoading && (
            <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              Loading workspace settings...
            </div>
          )}
          {!isLoading && !canManageGeneral ? (
            <div className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              You can view workspace details, but only owners or admins with organization update access can edit them.
            </div>
          ) : null}

          {/* Workspace Details */}
          <Card className="border-none shadow-none bg-transparent">
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="name">Workspace Name</Label>
                <Input
                  id="name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  disabled={isLoading || !canManageGeneral}
                />
              </div>
              {isWorkspaceScoped ? (
                <div className="space-y-2">
                  <Label htmlFor="slug">Workspace URL</Label>
                  <div className="flex items-stretch">
                    <span className="flex items-center text-sm text-muted-foreground bg-secondary/80 dark:bg-secondary/40 px-3 rounded-l-2xl">
                      app.cozea.io/
                    </span>
                    <Input
                      id="slug"
                      value={workspaceSlug}
                      onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className="rounded-l-none"
                      disabled={isLoading || !canManageGeneral}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This is your workspace&apos;s unique identifier
                  </p>
                </div>
              ) : null}
              <WorkspaceIdentityPicker
                workspaceType={isWorkspaceScoped ? 'organization' : 'personal'}
                workspaceName={workspaceName || 'Workspace'}
                value={workspaceIdentity}
                onChange={setWorkspaceIdentity}
                disabled={isLoading || !canManageGeneral}
              />

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

              <Button onClick={handleSave} disabled={isLoading || isSaving || !hasChanges || !canManageGeneral}>
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

          {/* Danger Zone */}
          {isWorkspaceScoped ? (
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
              <div className="flex items-center justify-between p-5 rounded-2xl bg-destructive/5">
                <div>
                  <h4 className="font-medium">Delete Workspace</h4>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete this workspace and all its data
                  </p>
                </div>
                <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="gap-2" disabled={!canManageGeneral}>
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
          ) : null}
        </div>

      </div>
      )}
    </DashboardLayout>
  )
}
