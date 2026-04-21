import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

import { HugeiconsIcon } from '@hugeicons/react'
import { MoreVerticalIcon as __MoreVerticalHugeIcon, ArrowUpDownIcon as __ArrowUpDownHugeIcon, Delete02Icon as __Trash2HugeIcon, FilterIcon as __FilterHugeIcon, Refresh01Icon as __Loader2HugeIcon, Refresh01Icon as __RotateCcwHugeIcon, Shield01Icon as __ShieldHugeIcon, UserMinus01Icon as __UserMinusHugeIcon } from '@hugeicons/core-free-icons'

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'
type SortField = 'name' | 'role' | 'date'
type SortDirection = 'asc' | 'desc'

interface TeamTableRow {
  key: string
  type: 'member' | 'invite'
  secondaryLabel: string
  name: string
  role: ProjectRole
  status: 'active' | 'pending'
  date: number
  avatarUrl?: string | null
  isSelf: boolean
  userId?: Id<'users'>
  inviteId?: Id<'projectInvites'>
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
  displayName?: string | null
  secondaryLabel?: string | null
  contactEmail?: string | null
  user?: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null
  userId: Id<'users'>
}): string {
  if (member.displayName?.trim()) return member.displayName.trim()
  const first = member.user?.firstName?.trim() ?? ''
  const last = member.user?.lastName?.trim() ?? ''
  const fullName = `${first} ${last}`.trim()
  if (fullName) return fullName
  if (member.contactEmail) return member.contactEmail
  if (member.secondaryLabel) return member.secondaryLabel
  if (member.user?.email) return member.user.email
  return String(member.userId)
}

function formatMemberSecondaryLabel(member: {
  secondaryLabel?: string | null
  contactEmail?: string | null
  user?: {
    email?: string | null
  } | null
}): string {
  return (
    member.secondaryLabel?.trim() ??
    member.contactEmail?.trim() ??
    member.user?.email?.trim() ??
    ''
  )
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

export function ProjectTeamPage() {
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()

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
  const pendingInvites = useQuery(
    api.projectInvites.listForProject,
    project?._id && convexUserId
      ? { projectId: project._id, viewerUserId: convexUserId }
      : 'skip'
  )

  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamActionKey, setTeamActionKey] = useState<string | null>(null)

  const [roleFilter, setRoleFilter] = useState<'all' | ProjectRole>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const hasResolvedTeamRows = members !== undefined && pendingInvites !== undefined

  const isManager = memberRole === 'project_manager'
  const canManageTeam = Boolean(convexUserId) && isManager

  const filteredRows = useMemo(() => {
    const memberRows: TeamTableRow[] = (members ?? []).map((member) => {
      return {
        key: `member:${String(member.userId)}`,
        type: 'member',
        secondaryLabel: formatMemberSecondaryLabel(member),
        name: formatMemberName(member),
        role: member.role,
        status: 'active',
        date: member.addedAt,
        avatarUrl: member.user?.profileImageUrl ?? null,
        isSelf: convexUserId === member.userId,
        userId: member.userId,
      }
    })

    const inviteRows: TeamTableRow[] = (pendingInvites ?? []).map((invite) => {
      return {
        key: `invite:${String(invite._id)}`,
        type: 'invite',
        secondaryLabel: invite.email,
        name: formatInviteeName(invite),
        role: invite.role,
        status: 'pending',
        date: invite.invitedAt,
        avatarUrl: invite.user?.profileImageUrl ?? null,
        isSelf: false,
        inviteId: invite._id,
      }
    })

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
    members,
    pendingInvites,
    roleFilter,
    sortDirection,
    sortField,
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
    },
    [
      canManageTeam,
      convexUserId,
      project,
      removeMember,
    ]
  )

  const handleCancelInvite = useCallback(
    async (inviteId: Id<'projectInvites'>) => {
      if (!project || !convexUserId || !canManageTeam) return
      const actionKey = `cancel:${String(inviteId)}`
      setTeamActionKey(actionKey)
      setTeamError(null)
      try {
        await cancelInvite({
          inviteId,
          actorUserId: convexUserId,
        })
      } catch (error) {
        setTeamError(cleanConvexError(error, 'Failed to cancel invite'))
      } finally {
        setTeamActionKey(null)
      }
    },
    [cancelInvite, canManageTeam, convexUserId, project]
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
          actorUserId: convexUserId,
        })
      } catch (error) {
        setTeamError(cleanConvexError(error, 'Failed to resend invite'))
      } finally {
        setTeamActionKey(null)
      }
    },
    [canManageTeam, convexUserId, resendInvite, project]
  )

  const headerActions = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-[11px]">
              <HugeiconsIcon icon={__FilterHugeIcon} className="h-3.5 w-3.5" />
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
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-[11px]">
              <HugeiconsIcon icon={__ArrowUpDownHugeIcon} className="h-3.5 w-3.5" />
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
            <Button variant="secondary" className="h-7 gap-2 rounded-full px-2 text-[11px]">
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
        <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" />
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

        <div className="overflow-hidden">
          <Table className="[&_th]:px-4 [&_td]:px-4">
          <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
            <TableRow>
              <TableHead className="w-[40%]">Collaborator</TableHead>
              <TableHead className="w-[22%]">Role</TableHead>
              <TableHead className="w-[16%]">Project</TableHead>
              <TableHead className="w-[16%]">Date</TableHead>
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
                          <div className="truncate text-sm text-muted-foreground">{row.secondaryLabel}</div>
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
                    <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <HugeiconsIcon icon={__MoreVerticalHugeIcon} className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {row.type === 'member' ? (
                            <>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                  disabled={!canManageTeam || row.isSelf || !row.userId}
                                >
                                  <HugeiconsIcon icon={__ShieldHugeIcon} className="mr-2 h-4 w-4" />
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
                                        <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
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
                                  <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <HugeiconsIcon icon={__UserMinusHugeIcon} className="mr-2 h-3.5 w-3.5" />
                                )}
                                {row.isSelf ? "Can't remove yourself" : 'Remove'}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem
                                disabled={!canManageTeam || !row.inviteId || teamActionKey === resendActionKey}
                                onClick={() => {
                                  if (!row.inviteId) return
                                  void handleResendInvite(row.inviteId)
                                }}
                              >
                                {teamActionKey === resendActionKey ? (
                                  <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <HugeiconsIcon icon={__RotateCcwHugeIcon} className="mr-2 h-3.5 w-3.5" />
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
                                  <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <HugeiconsIcon icon={__Trash2HugeIcon} className="mr-2 h-3.5 w-3.5" />
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
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
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
