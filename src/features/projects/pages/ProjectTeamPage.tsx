import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { useWorkspaceSourceControl } from '@/hooks/useWorkspaceSourceControl'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useProjectWorkspaceContext } from '@/features/projects/hooks/useProjectWorkspaceContext'
import { syncProjectRepositoryAccess } from '@/lib/git/projectRepoAutomation'
import {
  resolveProjectIntegrationProvider,
  resolveProjectRepoAccessStatus,
} from '@/lib/git/projectRepoAccess'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowPathIcon as Loader2, ArrowPathIcon as RotateCcw, ArrowsUpDownIcon as ArrowUpDown, EllipsisVerticalIcon as MoreVertical, FunnelIcon as Filter, ShieldCheckIcon as Shield, TrashIcon as Trash2, UserMinusIcon as UserMinus, UserPlusIcon as UserPlus } from "@heroicons/react/24/outline"

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type SortField = 'name' | 'role' | 'date'
type SortDirection = 'asc' | 'desc'

interface TeamTableRow {
  key: string
  type: 'member' | 'invite'
  email: string
  name: string
  role: ProjectRole
  status: 'active' | 'pending'
  date: number
  avatarUrl?: string | null
  isSelf: boolean
  userId?: Id<'users'>
  inviteId?: Id<'projectInvites'>
  repoAccess?: {
    state: 'pending' | 'granted' | 'needs_identity' | 'manual_required' | 'revoked' | 'error'
    errorMessage?: string
    providerAccountHandle?: string
  }
}

interface WorkspaceMemberRecord {
  userId: Id<'users'>
  user?: {
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
}

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

function getRoleLabel(role: ProjectRole | null | undefined): string {
  if (!role) return 'Unknown'
  const match = ROLE_OPTIONS.find((option) => option.value === role)
  return match?.label ?? role.replace(/_/g, ' ')
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

function formatInviteeName(invite: {
  email: string
  user?: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null
}): string {
  const first = invite.user?.firstName?.trim() ?? ''
  const last = invite.user?.lastName?.trim() ?? ''
  const fullName = `${first} ${last}`.trim()
  if (fullName) return fullName
  if (invite.user?.email) return invite.user.email
  return invite.email.split('@')[0] ?? invite.email
}

function formatDate(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-')
}

function getRepoAccessBadgePresentation(
  repoAccess: TeamTableRow['repoAccess'] | undefined,
  provider?: 'github' | 'gitlab'
): { label: string; className: string } {
  if (!provider) {
    return {
      label: 'No repo sync',
      className: 'border-border/60 bg-secondary/60 text-muted-foreground',
    }
  }

  switch (repoAccess?.state) {
    case 'granted':
      return {
        label: 'Granted',
        className: 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      }
    case 'pending':
      return {
        label: 'Pending',
        className: 'border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300',
      }
    case 'needs_identity':
      return {
        label: provider === 'github' ? 'Needs GitHub handle' : 'Needs identity',
        className: 'border-0 bg-orange-500/15 text-orange-700 dark:text-orange-300',
      }
    case 'manual_required':
      return {
        label: 'Manual',
        className: 'border-0 bg-secondary text-muted-foreground',
      }
    case 'error':
      return {
        label: 'Error',
        className: 'border-0 bg-destructive/15 text-destructive',
      }
    case 'revoked':
      return {
        label: 'Revoked',
        className: 'border-0 bg-secondary text-muted-foreground',
      }
    default:
      return {
        label: 'Not synced',
        className: 'border-border/60 bg-secondary/60 text-muted-foreground',
      }
  }
}

export function ProjectTeamPage() {
  const convex = useConvex()
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()
  const projectWorkspace = useProjectWorkspaceContext(project)
  const isPersonalWorkspace = projectWorkspace.isPersonalWorkspace
  const projectOrganizationId = projectWorkspace.organizationId
  const hasResolvedWorkspaceContext = project !== undefined && !projectWorkspace.isLoading

  const addMember = useMutation(api.projectMembers.addMember)
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
    project?._id && convexUserId ? { projectId: project._id, viewerUserId: convexUserId } : 'skip'
  )
  const currentWorkspaceAccess = useQuery(
    api.organizations.getCurrentMemberAccess,
    hasResolvedWorkspaceContext && !isPersonalWorkspace && projectOrganizationId && convexUserId
      ? { orgId: projectOrganizationId, viewerUserId: convexUserId }
      : 'skip'
  )
  const workspaceMembers = useQuery(
    api.organizations.getMembers,
    hasResolvedWorkspaceContext &&
    !isPersonalWorkspace &&
    projectOrganizationId &&
    convexUserId &&
    (currentWorkspaceAccess?.permissions.includes('members:view') ?? false)
      ? { orgId: projectOrganizationId, viewerUserId: convexUserId }
      : 'skip'
  )
  const pendingInvites = useQuery(
    api.projectInvites.listForProject,
    hasResolvedWorkspaceContext && project?._id && convexUserId && isPersonalWorkspace
      ? { projectId: project._id, viewerUserId: convexUserId }
      : 'skip'
  )
  const repoAccessRecords = useQuery(
    api.projectRepoAccess.listForProject,
    project?._id && convexUserId
      ? { projectId: project._id, viewerUserId: convexUserId }
      : 'skip'
  )
  const { getConnection } = useWorkspaceSourceControl({
    route: '/settings/source-control',
    enabled: Boolean(project?.organizationId && convexUserId),
  })
  const repoIntegrationProvider = resolveProjectIntegrationProvider(project ?? null)
  const repoIntegration = repoIntegrationProvider
    ? getConnection(repoIntegrationProvider)
    : null
  const repoAccessStatus = useMemo(
    () =>
      resolveProjectRepoAccessStatus({
        project,
        sourceControlConnection: repoIntegration,
        isPersonalWorkspace,
      }),
    [isPersonalWorkspace, project, repoIntegration]
  )

  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamActionKey, setTeamActionKey] = useState<string | null>(null)
  const [selectedWorkspaceMemberId, setSelectedWorkspaceMemberId] = useState('')
  const [selectedWorkspaceMemberRole, setSelectedWorkspaceMemberRole] =
    useState<ProjectRole>('developer')

  const [roleFilter, setRoleFilter] = useState<'all' | ProjectRole>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const hasResolvedTeamRows = members !== undefined && (!isPersonalWorkspace || pendingInvites !== undefined)

  const isManager = memberRole === 'project_manager'
  const canManageTeam = Boolean(convexUserId) && (
    isPersonalWorkspace
      ? isManager
      : currentWorkspaceAccess?.permissions.includes('projects:share') ?? false
  )
  const repoAutomationProvider =
    repoAccessStatus.supportsProviderAutomation &&
    (repoAccessStatus.provider === 'github' || repoAccessStatus.provider === 'gitlab')
      ? repoAccessStatus.provider
      : undefined
  const assignableWorkspaceMembers = useMemo(() => {
    if (isPersonalWorkspace) return []

    const assignedUserIds = new Set((members ?? []).map((member) => String(member.userId)))
    return ((workspaceMembers ?? []) as WorkspaceMemberRecord[])
      .filter((member) => member.user && !assignedUserIds.has(String(member.userId)))
      .sort((left, right) =>
        formatMemberName(left).localeCompare(formatMemberName(right))
      )
  }, [isPersonalWorkspace, members, workspaceMembers])
  const repoAccessByUserId = useMemo(() => {
    const next = new Map<string, NonNullable<typeof repoAccessRecords>[number]>()
    for (const record of repoAccessRecords ?? []) {
      if (!record.memberUserId) continue
      next.set(String(record.memberUserId), record)
    }
    return next
  }, [repoAccessRecords])
  const repoAccessByEmail = useMemo(() => {
    const next = new Map<string, NonNullable<typeof repoAccessRecords>[number]>()
    for (const record of repoAccessRecords ?? []) {
      if (!record.inviteEmail) continue
      next.set(record.inviteEmail.trim().toLowerCase(), record)
    }
    return next
  }, [repoAccessRecords])

  useEffect(() => {
    if (
      selectedWorkspaceMemberId &&
      assignableWorkspaceMembers.some(
        (member) => String(member.userId) === selectedWorkspaceMemberId,
      )
    ) {
      return
    }

    setSelectedWorkspaceMemberId(
      assignableWorkspaceMembers[0] ? String(assignableWorkspaceMembers[0].userId) : '',
    )
  }, [assignableWorkspaceMembers, selectedWorkspaceMemberId])

  const filteredRows = useMemo(() => {
    const memberRows: TeamTableRow[] = (members ?? []).map((member) => {
      const email = member.user?.email ?? ''
      const normalizedEmail = email.trim().toLowerCase()
      const repoAccess =
        repoAccessByUserId.get(String(member.userId)) ??
        (normalizedEmail ? repoAccessByEmail.get(normalizedEmail) : undefined)
      return {
        key: `member:${String(member.userId)}`,
        type: 'member',
        email,
        name: formatMemberName(member),
        role: member.role,
        status: 'active',
        date: member.addedAt,
        avatarUrl: member.user?.profileImageUrl ?? null,
        isSelf: convexUserId === member.userId,
        userId: member.userId,
        repoAccess: repoAccess
          ? {
              state: repoAccess.accessState,
              errorMessage: repoAccess.errorMessage,
              providerAccountHandle: repoAccess.providerAccountHandle,
            }
          : undefined,
      }
    })

    const inviteRows: TeamTableRow[] = isPersonalWorkspace
      ? (pendingInvites ?? []).map((invite) => {
      const email = invite.email
      const repoAccess = repoAccessByEmail.get(email.trim().toLowerCase())
      return {
        key: `invite:${String(invite._id)}`,
        type: 'invite',
        email,
        name: formatInviteeName(invite),
        role: invite.role,
        status: 'pending',
        date: invite.invitedAt,
        avatarUrl: invite.user?.profileImageUrl ?? null,
        isSelf: false,
        inviteId: invite._id,
        repoAccess: repoAccess
          ? {
              state: repoAccess.accessState,
              errorMessage: repoAccess.errorMessage,
              providerAccountHandle: repoAccess.providerAccountHandle,
            }
          : undefined,
      }
    })
      : []

    const rows = [...memberRows, ...inviteRows].filter((row) => {
      if (roleFilter === 'all') return true
      return row.role === roleFilter
    })

    return rows.sort((left, right) => {
      let comparison = 0
      switch (sortField) {
        case 'name':
          comparison = left.name.localeCompare(right.name)
          break
        case 'role':
          comparison = left.role.localeCompare(right.role)
          break
        case 'date':
          comparison = left.date - right.date
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [
    convexUserId,
    isPersonalWorkspace,
    members,
    pendingInvites,
    repoAccessByEmail,
    repoAccessByUserId,
    roleFilter,
    sortDirection,
    sortField,
  ])

  const handleAddWorkspaceMember = useCallback(async () => {
    if (!project?._id || !project || !convexUserId || !canManageTeam || !selectedWorkspaceMemberId) return

    setTeamActionKey('add-member')
    setTeamError(null)
    try {
      await addMember({
        projectId: project._id,
        actorUserId: convexUserId,
        memberUserId: selectedWorkspaceMemberId as Id<'users'>,
        role: selectedWorkspaceMemberRole,
      })
    } catch (error) {
      setTeamError(cleanConvexError(error, 'Failed to add workspace member'))
    } finally {
      setTeamActionKey(null)
    }
  }, [
    addMember,
    canManageTeam,
    convexUserId,
    project,
    selectedWorkspaceMemberId,
    selectedWorkspaceMemberRole,
  ])

  const handleRoleChange = useCallback(
    async (memberUserId: Id<'users'>, nextRole: ProjectRole) => {
      if (!project?._id || !project || !convexUserId || !canManageTeam) return
      const actionKey = `role:${String(memberUserId)}`
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
    },
    [
      canManageTeam,
      convexUserId,
      project,
      updateMemberRole,
    ]
  )

  const handleRemoveMember = useCallback(
    async (memberUserId: Id<'users'>) => {
      if (!project?._id || !project || !convexUserId || !canManageTeam) return
      const actionKey = `remove:${String(memberUserId)}`
      setTeamActionKey(actionKey)
      setTeamError(null)
      try {
        const member = (members ?? []).find((entry) => entry.userId === memberUserId)
        const repoAccess =
          repoAccessByUserId.get(String(memberUserId)) ??
          (member?.user?.email
            ? repoAccessByEmail.get(member.user.email.trim().toLowerCase())
            : undefined)
        await removeMember({
          projectId: project._id,
          actorUserId: convexUserId,
          memberUserId,
        })

        const syncOutcome = await syncProjectRepositoryAccess({
          convex,
          project,
          actorUserId: convexUserId,
          subjectType: 'member',
          memberUserId,
          inviteEmail: member?.user?.email ?? undefined,
          providerAccountHandle: repoAccess?.providerAccountHandle,
          role: member?.role ?? 'developer',
          action: 'revoke',
          isPersonalWorkspace,
        })

        if (!syncOutcome.success && syncOutcome.error) {
          setTeamError(syncOutcome.error)
        }
      } catch (error) {
        setTeamError(cleanConvexError(error, 'Failed to remove member'))
      } finally {
        setTeamActionKey(null)
      }
    },
    [
      canManageTeam,
      convex,
      convexUserId,
      isPersonalWorkspace,
      members,
      project,
      removeMember,
      repoAccessByEmail,
      repoAccessByUserId,
    ]
  )

  const handleCancelInvite = useCallback(
    async (inviteId: Id<'projectInvites'>) => {
      if (!project || !convexUserId || !canManageTeam) return
      const actionKey = `cancel:${String(inviteId)}`
      setTeamActionKey(actionKey)
      setTeamError(null)
      try {
        const invite = (pendingInvites ?? []).find((entry) => entry._id === inviteId)
        const repoAccess = invite?.email
          ? repoAccessByEmail.get(invite.email.trim().toLowerCase())
          : undefined
        await cancelInvite({
          inviteId,
          cancelledBy: convexUserId,
        })

        if (invite?.email) {
          const syncOutcome = await syncProjectRepositoryAccess({
            convex,
            project,
            actorUserId: convexUserId,
            subjectType: 'invite',
            inviteEmail: invite.email,
            providerAccountHandle: repoAccess?.providerAccountHandle,
            role: invite.role,
            action: 'revoke',
            isPersonalWorkspace,
          })

          if (!syncOutcome.success && syncOutcome.error) {
            setTeamError(syncOutcome.error)
          }
        }
      } catch (error) {
        setTeamError(cleanConvexError(error, 'Failed to cancel invite'))
      } finally {
        setTeamActionKey(null)
      }
    },
    [cancelInvite, canManageTeam, convex, convexUserId, isPersonalWorkspace, pendingInvites, project, repoAccessByEmail]
  )

  const handleResendInvite = useCallback(
    async (inviteId: Id<'projectInvites'>) => {
      if (!project || !convexUserId || !canManageTeam) return
      const actionKey = `resend:${String(inviteId)}`
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
    },
    [canManageTeam, convexUserId, resendInvite, project]
  )

  const handleRetryRepoAccess = useCallback(
    async (row: TeamTableRow) => {
      if (!project || !convexUserId || !canManageTeam || !repoAutomationProvider) return

      let providerAccountHandle = row.repoAccess?.providerAccountHandle
      if (repoAutomationProvider === 'github' && !providerAccountHandle) {
        const provided = window.prompt(
          'Enter the collaborator’s GitHub username for repository access.'
        )
        if (!provided?.trim()) {
          return
        }
        providerAccountHandle = provided.trim()
      }

      const actionKey = `repo:${row.key}`
      setTeamActionKey(actionKey)
      setTeamError(null)

      try {
        const syncOutcome = await syncProjectRepositoryAccess({
          convex,
          project,
          actorUserId: convexUserId,
          subjectType: row.type === 'member' ? 'member' : 'invite',
          memberUserId: row.userId,
          inviteEmail: row.email,
          providerAccountHandle,
          role: row.role,
          action: 'grant',
          isPersonalWorkspace,
        })

        if (!syncOutcome.success && syncOutcome.error) {
          setTeamError(syncOutcome.error)
        }
      } catch (error) {
        setTeamError(cleanConvexError(error, 'Failed to sync repository access'))
      } finally {
        setTeamActionKey(null)
      }
    },
    [canManageTeam, convex, convexUserId, isPersonalWorkspace, project, repoAutomationProvider]
  )

  const headerActions = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-xs">
              <Filter className="h-3.5 w-3.5" />
              {roleFilter === 'all' ? 'All Roles' : getRoleLabel(roleFilter)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRoleFilter('all')}>All Roles</DropdownMenuItem>
            {ROLE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => setRoleFilter(option.value)}>
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortField === 'date' ? 'Date' : sortField === 'name' ? 'Name' : 'Role'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSortField('date')}>Date</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortField('name')}>Name</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortField('role')}>Role</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-xs">
              {sortDirection === 'asc' ? '↑ Asc' : '↓ Desc'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSortDirection('asc')}>Ascending</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortDirection('desc')}>Descending</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }, [roleFilter, sortDirection, sortField])

  useProjectHeader(headerActions)

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading project team…
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
    <div className="h-full p-6">
      {teamError ? (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {teamError}
        </div>
      ) : null}

      {repoAccessStatus.state !== 'not_configured' ? (
        <div className="mb-4 rounded-2xl border border-border/60 bg-card/50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-medium">{repoAccessStatus.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{repoAccessStatus.description}</p>
            </div>
            {repoAccessStatus.state === 'integration_missing' || repoAccessStatus.state === 'integration_mismatch' ? (
              <Button
                type="button"
                variant="secondary"
                className="rounded-xl"
                onClick={() => {
                  navigate('/settings/source-control')
                }}
              >
                {repoAccessStatus.state === 'integration_mismatch' ? 'Fix Source Control' : 'Connect Source Control'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!projectWorkspace.isLoading && !isPersonalWorkspace ? (
        <div className="mb-4 rounded-2xl border border-border/60 bg-card/50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-base font-medium">Workspace member assignment</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Organization projects only accept existing workspace members. Add people to the
                workspace first, then assign them to this project.
              </p>
            </div>

            {canManageTeam ? (
              assignableWorkspaceMembers.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={selectedWorkspaceMemberId}
                    onValueChange={setSelectedWorkspaceMemberId}
                  >
                    <SelectTrigger className="w-full min-w-[240px] justify-between rounded-xl bg-secondary/80">
                      <SelectValue placeholder="Select workspace member" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableWorkspaceMembers.map((member) => (
                        <SelectItem key={String(member.userId)} value={String(member.userId)}>
                          {formatMemberName(member)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedWorkspaceMemberRole}
                    onValueChange={(value) => setSelectedWorkspaceMemberRole(value as ProjectRole)}
                  >
                    <SelectTrigger className="w-full min-w-[180px] justify-between rounded-xl bg-secondary/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    type="button"
                    className="gap-2 rounded-xl"
                    disabled={!selectedWorkspaceMemberId || teamActionKey === 'add-member'}
                    onClick={() => {
                      void handleAddWorkspaceMember()
                    }}
                  >
                    {teamActionKey === 'add-member' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Add member
                  </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All workspace members already have project access.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                You need workspace project-sharing access to change this team.
              </p>
            )}
          </div>
        </div>
      ) : null}

        <div className="overflow-hidden">
          <Table className="[&_th]:px-4 [&_td]:px-4">
          <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
            <TableRow>
              <TableHead className="w-[34%]">Member Name</TableHead>
              <TableHead className="w-[20%]">Role</TableHead>
              <TableHead className="w-[14%]">Project</TableHead>
              <TableHead className="w-[16%]">Repo</TableHead>
              <TableHead className="w-[12%]">Date</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => {
                const roleActionKey =
                  row.type === 'member' && row.userId ? `role:${String(row.userId)}` : null
                const removeActionKey =
                  row.type === 'member' && row.userId ? `remove:${String(row.userId)}` : null
                const resendActionKey =
                  row.type === 'invite' && row.inviteId ? `resend:${String(row.inviteId)}` : null
                const cancelActionKey =
                  row.type === 'invite' && row.inviteId ? `cancel:${String(row.inviteId)}` : null

                return (
                  <TableRow key={row.key}>
                    <TableCell className="overflow-hidden">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={row.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {row.name
                              .split(' ')
                              .map((namePart) => namePart[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{row.name}</span>
                          </div>
                          <div className="truncate text-sm text-muted-foreground">{row.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <Badge className="max-w-full shrink justify-start border-0 bg-primary/10 text-primary">
                          <span className="truncate">{getRoleLabel(row.role)}</span>
                        </Badge>
                        {row.isSelf ? (
                          <>
                            <span className="h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              you
                            </span>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            row.status === 'active' ? 'bg-green-500' : 'bg-amber-500'
                          }`}
                        />
                        <span
                          className={`truncate ${
                            row.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {row.status === 'active' ? 'Active' : 'Pending'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="min-w-0 space-y-1">
                        {(() => {
                          const repoBadge = getRepoAccessBadgePresentation(
                            row.repoAccess,
                            repoAutomationProvider
                          )
                          return (
                            <Badge className={repoBadge.className}>
                              {repoBadge.label}
                            </Badge>
                          )
                        })()}
                        {row.repoAccess?.providerAccountHandle ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {row.repoAccess.providerAccountHandle}
                          </div>
                        ) : null}
                        {row.repoAccess?.errorMessage ? (
                          <div className="line-clamp-2 text-xs text-muted-foreground">
                            {row.repoAccess.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {row.type === 'member' ? (
                            <>
                              {repoAutomationProvider ? (
                                <>
                                  <DropdownMenuItem
                                    disabled={!canManageTeam || teamActionKey === `repo:${row.key}`}
                                    onClick={() => {
                                      void handleRetryRepoAccess(row)
                                    }}
                                  >
                                    {teamActionKey === `repo:${row.key}` ? (
                                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                    )}
                                    Retry Repo Access
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              ) : null}
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                  disabled={!canManageTeam || row.isSelf || !row.userId}
                                >
                                  <Shield className="mr-2 h-4 w-4" />
                                  Change Role
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {ROLE_OPTIONS.map((option) => (
                                    <DropdownMenuItem
                                      key={option.value}
                                      disabled={
                                        !row.userId ||
                                        row.role === option.value ||
                                        teamActionKey === roleActionKey
                                      }
                                      onClick={() => {
                                        if (!row.userId) return
                                        void handleRoleChange(row.userId, option.value)
                                      }}
                                    >
                                      {teamActionKey === roleActionKey && row.role !== option.value ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                      ) : null}
                                      {option.label}
                                      {row.role === option.value ? (
                                        <span className="ml-2 text-muted-foreground">(current)</span>
                                      ) : null}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={
                                  !canManageTeam ||
                                  row.isSelf ||
                                  !row.userId ||
                                  teamActionKey === removeActionKey
                                }
                                onClick={() => {
                                  if (!row.userId) return
                                  void handleRemoveMember(row.userId)
                                }}
                              >
                                {teamActionKey === removeActionKey ? (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <UserMinus className="mr-2 h-3.5 w-3.5" />
                                )}
                                {row.isSelf ? "Can't remove yourself" : 'Remove'}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              {repoAutomationProvider ? (
                                <>
                                  <DropdownMenuItem
                                    disabled={!canManageTeam || teamActionKey === `repo:${row.key}`}
                                    onClick={() => {
                                      void handleRetryRepoAccess(row)
                                    }}
                                  >
                                    {teamActionKey === `repo:${row.key}` ? (
                                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                    )}
                                    Retry Repo Access
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              ) : null}
                              <DropdownMenuItem
                                disabled={!canManageTeam || !row.inviteId || teamActionKey === resendActionKey}
                                onClick={() => {
                                  if (!row.inviteId) return
                                  void handleResendInvite(row.inviteId)
                                }}
                              >
                                {teamActionKey === resendActionKey ? (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                )}
                                Resend
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={!canManageTeam || !row.inviteId || teamActionKey === cancelActionKey}
                                onClick={() => {
                                  if (!row.inviteId) return
                                  void handleCancelInvite(row.inviteId)
                                }}
                              >
                                {teamActionKey === cancelActionKey ? (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                )}
                                Cancel
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : hasResolvedTeamRows ? (
              <TableRow>
                <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                  No members or pending invites yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
