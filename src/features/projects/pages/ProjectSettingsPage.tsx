import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { buildLegacyProjectPath, buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle,
  Loader2,
  Save,
  Trash2,
  Users,
  Send,
  RotateCcw,
  UserMinus,
} from 'lucide-react'

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type SettingsSectionId = 'general' | 'team' | 'danger'

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'team', label: 'Team' },
  { id: 'danger', label: 'Danger' },
]

const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'viewer', label: 'Viewer' },
]

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Unknown'
  return role.replace(/_/g, ' ')
}

function formatMemberName(member: {
  user?: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null
  userId: Id<'users'>
}): string {
  const first = member.user?.firstName?.trim() ?? ''
  const last = member.user?.lastName?.trim() ?? ''
  const fullName = `${first} ${last}`.trim()
  if (fullName) return fullName
  if (member.user?.email) return member.user.email
  return String(member.userId)
}

export function ProjectSettingsPage() {
  const navigate = useViewTransitionNavigate()
  const { section: sectionParam } = useParams<{ section?: string }>()
  const { convexUserId } = useAuth()
  const { project, projectIdParam, slugParam } = useAccessibleProject()

  const currentSection: SettingsSectionId =
    sectionParam === 'team' || sectionParam === 'danger' ? sectionParam : 'general'

  const buildSettingsPath = useCallback((section: SettingsSectionId) => {
    if (project?._id) return buildProjectPath(String(project._id), `settings/${section}`)
    if (projectIdParam) return buildProjectPath(projectIdParam, `settings/${section}`)
    return slugParam ? buildLegacyProjectPath(slugParam, `settings/${section}`) : null
  }, [project?._id, projectIdParam, slugParam])

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)
  const inviteMember = useMutation(api.projectInvites.inviteMember)
  const cancelInvite = useMutation(api.projectInvites.cancelInvite)
  const resendInvite = useMutation(api.projectInvites.resendInvite)
  const updateMemberRole = useMutation(api.projectMembers.updateRole)
  const removeMember = useMutation(api.projectMembers.removeMember)

  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    project?._id && convexUserId
      ? { projectId: project._id, userId: convexUserId }
      : 'skip'
  )
  const members = useQuery(
    api.projectMembers.listMembers,
    project?._id ? { projectId: project._id } : 'skip'
  )
  const pendingInvites = useQuery(
    api.projectInvites.listForProject,
    project?._id ? { projectId: project._id } : 'skip'
  )

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('developer')
  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamActionKey, setTeamActionKey] = useState<string | null>(null)

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

  const sortedMembers = useMemo(
    () => (members ? [...members].sort((a, b) => a.addedAt - b.addedAt) : []),
    [members]
  )
  const sortedPendingInvites = useMemo(
    () => (pendingInvites ? [...pendingInvites].sort((a, b) => b.invitedAt - a.invitedAt) : []),
    [pendingInvites]
  )

  const isManager = memberRole === 'project_manager'
  const canEditGeneral = memberRole !== null && memberRole !== undefined && memberRole !== 'viewer'
  const canManageTeam = isManager && Boolean(convexUserId)

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

  const handleInviteMember = useCallback(async () => {
    if (!project?._id || !convexUserId || !canManageTeam) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setTeamError('Enter a valid email address.')
      return
    }

    setTeamActionKey('invite')
    setTeamError(null)
    try {
      await inviteMember({
        projectId: project._id,
        email,
        role: inviteRole,
        invitedBy: convexUserId,
      })
      setInviteEmail('')
      setInviteRole('developer')
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to send invite'))
    } finally {
      setTeamActionKey(null)
    }
  }, [canManageTeam, convexUserId, inviteEmail, inviteMember, inviteRole, project?._id])

  const handleRoleChange = useCallback(async (memberUserId: Id<'users'>, nextRole: ProjectRole) => {
    if (!project?._id || !convexUserId || !canManageTeam) return
    const actionKey = `role:${memberUserId}`
    setTeamActionKey(actionKey)
    setTeamError(null)
    try {
      await updateMemberRole({
        projectId: project._id,
        actorUserId: convexUserId,
        memberUserId,
        newRole: nextRole,
      })
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to update member role'))
    } finally {
      setTeamActionKey(null)
    }
  }, [canManageTeam, convexUserId, project?._id, updateMemberRole])

  const handleRemoveMember = useCallback(async (memberUserId: Id<'users'>) => {
    if (!project?._id || !convexUserId || !canManageTeam) return
    const actionKey = `remove:${memberUserId}`
    setTeamActionKey(actionKey)
    setTeamError(null)
    try {
      await removeMember({
        projectId: project._id,
        actorUserId: convexUserId,
        memberUserId,
      })
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to remove member'))
    } finally {
      setTeamActionKey(null)
    }
  }, [canManageTeam, convexUserId, project?._id, removeMember])

  const handleCancelInvite = useCallback(async (inviteId: Id<'projectInvites'>) => {
    if (!convexUserId || !canManageTeam) return
    const actionKey = `cancel:${inviteId}`
    setTeamActionKey(actionKey)
    setTeamError(null)
    try {
      await cancelInvite({
        inviteId,
        cancelledBy: convexUserId,
      })
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to cancel invite'))
    } finally {
      setTeamActionKey(null)
    }
  }, [cancelInvite, canManageTeam, convexUserId])

  const handleResendInvite = useCallback(async (inviteId: Id<'projectInvites'>) => {
    if (!convexUserId || !canManageTeam) return
    const actionKey = `resend:${inviteId}`
    setTeamActionKey(actionKey)
    setTeamError(null)
    try {
      await resendInvite({
        inviteId,
        resentBy: convexUserId,
      })
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to resend invite'))
    } finally {
      setTeamActionKey(null)
    }
  }, [canManageTeam, convexUserId, resendInvite])

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

              {currentSection === 'team' ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/50 p-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Project Team</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        Your role: {formatRoleLabel(memberRole)}
                      </Badge>
                      {!canManageTeam ? (
                        <Badge variant="outline">Read only</Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card/50 overflow-hidden">
                    <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">Members</div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Added</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedMembers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                              No members found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedMembers.map((member) => {
                            const isSelf = convexUserId === member.userId
                            const roleActionKey = `role:${String(member.userId)}`
                            const removeActionKey = `remove:${String(member.userId)}`
                            return (
                              <TableRow key={String(member.userId)}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-medium">{formatMemberName(member)}</span>
                                    {member.user?.email ? (
                                      <span className="text-xs text-muted-foreground">{member.user.email}</span>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {canManageTeam && !isSelf ? (
                                    <Select
                                      value={member.role}
                                      onValueChange={(value) => {
                                        void handleRoleChange(member.userId, value as ProjectRole)
                                      }}
                                      disabled={teamActionKey === roleActionKey}
                                    >
                                      <SelectTrigger className="h-8 w-[180px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {ROLE_OPTIONS.map((role) => (
                                          <SelectItem key={role.value} value={role.value}>
                                            {role.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Badge variant="secondary" className="capitalize">
                                      {formatRoleLabel(member.role)}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(member.addedAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    disabled={!canManageTeam || isSelf || teamActionKey === removeActionKey}
                                    onClick={() => {
                                      void handleRemoveMember(member.userId)
                                    }}
                                  >
                                    {teamActionKey === removeActionKey ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <UserMinus className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card/50 overflow-hidden">
                    <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">Pending Invites</div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Invited</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedPendingInvites.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                              No pending invites.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedPendingInvites.map((invite) => {
                            const resendActionKey = `resend:${String(invite._id)}`
                            const cancelActionKey = `cancel:${String(invite._id)}`
                            return (
                              <TableRow key={String(invite._id)}>
                                <TableCell className="font-medium">{invite.email}</TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className="capitalize">
                                    {formatRoleLabel(invite.role)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(invite.invitedAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2"
                                      disabled={!canManageTeam || teamActionKey === resendActionKey}
                                      onClick={() => {
                                        void handleResendInvite(invite._id)
                                      }}
                                    >
                                      {teamActionKey === resendActionKey ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2 text-destructive hover:text-destructive"
                                      disabled={!canManageTeam || teamActionKey === cancelActionKey}
                                      onClick={() => {
                                        void handleCancelInvite(invite._id)
                                      }}
                                    >
                                      {teamActionKey === cancelActionKey ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border/60 bg-card/50 p-4">
                    <h3 className="text-sm font-medium">Invite by Email</h3>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                      <Input
                        placeholder="teammate@example.com"
                        value={inviteEmail}
                        onChange={(event) => {
                          setInviteEmail(event.target.value)
                        }}
                        disabled={!canManageTeam}
                      />
                      <Select
                        value={inviteRole}
                        onValueChange={(value) => {
                          setInviteRole(value as ProjectRole)
                        }}
                        disabled={!canManageTeam}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        className="h-9 gap-1.5"
                        onClick={() => {
                          void handleInviteMember()
                        }}
                        disabled={!canManageTeam || teamActionKey === 'invite'}
                      >
                        {teamActionKey === 'invite' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Invite
                      </Button>
                    </div>
                    {!canManageTeam ? (
                      <p className="text-xs text-muted-foreground">
                        Only project managers can send and manage invites.
                      </p>
                    ) : null}
                    {teamError ? <p className="text-xs text-destructive">{teamError}</p> : null}
                  </div>
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
