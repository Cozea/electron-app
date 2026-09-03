import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { api } from '../../../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useTranslation } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n/en'
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
import type { ContextMenuItem } from '@shared/assistant-contracts/ipc'
import { showDesktopContextMenu } from '@/lib/desktopBridgeClient'
import { getNativeMenuIcon } from '@/lib/nativeMenuIcons'

import { HugeiconsIcon } from '@hugeicons/react'
import { MoreVerticalIcon as __MoreVerticalHugeIcon, ArrowUpDownIcon as __ArrowUpDownHugeIcon, Delete02Icon as __Trash2HugeIcon, FilterIcon as __FilterHugeIcon, Refresh01Icon as __RotateCcwHugeIcon, Shield01Icon as __ShieldHugeIcon, UserMinus01Icon as __UserMinusHugeIcon } from '@hugeicons/core-free-icons'

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

const ROLE_OPTIONS: Array<{ value: ProjectRole; labelKey: TranslationKey }> = [
  { value: 'project_manager', labelKey: 'team.role.project_manager' },
  { value: 'developer', labelKey: 'team.role.developer' },
  { value: 'designer', labelKey: 'team.role.designer' },
  { value: 'viewer', labelKey: 'team.role.viewer' },
]

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

function getRoleLabel(role: ProjectRole | null | undefined, t: any): string {
  if (!role) return t('team.role.unknown')
  const match = ROLE_OPTIONS.find((option) => option.value === role)
  return match?.labelKey ? t(match.labelKey) : role.replace(/_/g, ' ')
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
  const { t } = useTranslation()

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
        setTeamError(cleanConvexError(error, t('team.error.updateRole')))
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
        setTeamError(cleanConvexError(error, t('team.error.removeMember')))
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
        setTeamError(cleanConvexError(error, t('team.error.cancelInvite')))
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
        setTeamError(cleanConvexError(error, t('team.error.resendInvite')))
      } finally {
        setTeamActionKey(null)
      }
    },
    [canManageTeam, convexUserId, resendInvite, project]
  )

  const handleOpenRoleFilterMenu = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
      const items: ContextMenuItem<string>[] = [
        {
          id: 'all',
          label: t('team.filter.allRoles'),
          type: 'radio',
          checked: roleFilter === 'all',
          icon: getNativeMenuIcon('filter'),
        },
        ...ROLE_OPTIONS.map((option) => ({
          id: option.value,
          label: t(option.labelKey),
          type: 'radio' as const,
          checked: roleFilter === option.value,
          icon: getNativeMenuIcon('shield'),
        })),
      ]
      const action = await showDesktopContextMenu(items, position)
      if (action) setRoleFilter(action as 'all' | ProjectRole)
    },
    [roleFilter, t]
  )

  const handleOpenSortFieldMenu = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
      const items: ContextMenuItem<string>[] = [
        { id: 'date', label: t('team.sort.date'), type: 'radio', checked: sortField === 'date', icon: getNativeMenuIcon('sort') },
        { id: 'name', label: t('team.sort.name'), type: 'radio', checked: sortField === 'name', icon: getNativeMenuIcon('sort') },
        { id: 'role', label: t('team.sort.role'), type: 'radio', checked: sortField === 'role', icon: getNativeMenuIcon('sort') },
      ]
      const action = await showDesktopContextMenu(items, position)
      if (action) setSortField(action as SortField)
    },
    [sortField, t]
  )

  const handleOpenSortDirectionMenu = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
      const items: ContextMenuItem<string>[] = [
        { id: 'asc', label: t('team.sort.ascending'), type: 'radio', checked: sortDirection === 'asc', icon: getNativeMenuIcon('move-up') },
        { id: 'desc', label: t('team.sort.descending'), type: 'radio', checked: sortDirection === 'desc', icon: getNativeMenuIcon('move-down') },
      ]
      const action = await showDesktopContextMenu(items, position)
      if (action) setSortDirection(action as SortDirection)
    },
    [sortDirection, t]
  )

  const headerActions = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="h-7 gap-2 rounded-full px-2 text-[11px]"
          onClick={handleOpenRoleFilterMenu}
        >
          <HugeiconsIcon icon={__FilterHugeIcon} className="h-3.5 w-3.5" />
          {roleFilter === 'all' ? t('team.filter.allRoles') : getRoleLabel(roleFilter, t)}
        </Button>

        <Button
          variant="secondary"
          className="h-7 gap-2 rounded-full px-2 text-[11px]"
          onClick={handleOpenSortFieldMenu}
        >
          <HugeiconsIcon icon={__ArrowUpDownHugeIcon} className="h-3.5 w-3.5" />
          {sortField === 'date' ? t('team.sort.date') : sortField === 'name' ? t('team.sort.name') : t('team.sort.role')}
        </Button>

        <Button
          variant="secondary"
          className="h-7 gap-2 rounded-full px-2 text-[11px]"
          onClick={handleOpenSortDirectionMenu}
        >
          {sortDirection === 'asc' ? t('team.sort.asc') : t('team.sort.desc')}
        </Button>
      </div>
    )
  }, [
    handleOpenRoleFilterMenu,
    handleOpenSortDirectionMenu,
    handleOpenSortFieldMenu,
    roleFilter,
    sortDirection,
    sortField,
    t,
  ])

  const handleOpenRowMenu = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>, row: TeamTableRow) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }

      const items: ContextMenuItem<string>[] = []
      const roleActionKey = row.userId ? `role:${row.userId}` : null
      const removeActionKey = row.userId ? `remove:${row.userId}` : null
      const resendActionKey = row.inviteId ? `resend:${row.inviteId}` : null
      const cancelActionKey = row.inviteId ? `cancel:${row.inviteId}` : null

      if (row.type === 'member') {
        const roleSubmenu: ContextMenuItem<string>[] = ROLE_OPTIONS.map((option) => ({
          id: `role:${option.value}`,
          label: `${t(option.labelKey)}${row.role === option.value ? ` (${t('team.action.current')})` : ''}`,
          type: 'radio' as const,
          checked: row.role === option.value,
          enabled: Boolean(
            canManageTeam &&
              !row.isSelf &&
              row.userId &&
              row.role !== option.value &&
              teamActionKey !== roleActionKey
          ),
        }))

        items.push({
          id: 'change-role',
          label: t('team.action.changeRole'),
          enabled: Boolean(canManageTeam && !row.isSelf && row.userId),
          icon: getNativeMenuIcon('shield'),
          submenu: roleSubmenu,
        })
        items.push({ id: 'sep', type: 'separator' })
        items.push({
          id: 'remove',
          label: row.isSelf ? t('team.action.cantRemove') : t('team.action.remove'),
          destructive: true,
          icon: getNativeMenuIcon('user-minus'),
          enabled: Boolean(
            canManageTeam &&
              !row.isSelf &&
              row.userId &&
              teamActionKey !== removeActionKey
          ),
        })
      } else {
        items.push({
          id: 'resend',
          label: t('team.action.resend'),
          enabled: Boolean(canManageTeam && row.inviteId && teamActionKey !== resendActionKey),
          icon: getNativeMenuIcon('restore'),
        })
        items.push({
          id: 'cancel',
          label: t('team.action.cancel'),
          destructive: true,
          enabled: Boolean(canManageTeam && row.inviteId && teamActionKey !== cancelActionKey),
          icon: getNativeMenuIcon('close'),
        })
      }

      const action = await showDesktopContextMenu(items, position)
      if (!action) return

      if (action.startsWith('role:')) {
        const newRole = action.replace('role:', '') as ProjectRole
        if (row.userId) void handleRoleChange(row.userId, newRole)
      } else if (action === 'remove') {
        if (row.userId) void handleRemoveMember(row.userId)
      } else if (action === 'resend') {
        if (row.inviteId) void handleResendInvite(row.inviteId)
      } else if (action === 'cancel') {
        if (row.inviteId) void handleCancelInvite(row.inviteId)
      }
    },
    [canManageTeam, handleCancelInvite, handleRemoveMember, handleResendInvite, handleRoleChange, t, teamActionKey]
  )

  useProjectHeader(headerActions)

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="loader mr-2" />
        {t('team.loading')}
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('team.error.projectNotFound')}
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
              <TableHead className="w-[40%]">{t('team.header.collaborator')}</TableHead>
              <TableHead className="w-[22%]">{t('team.sort.role')}</TableHead>
              <TableHead className="w-[16%]">{t('team.header.project')}</TableHead>
              <TableHead className="w-[16%]">{t('team.sort.date')}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => {
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
                          <span className="truncate">{getRoleLabel(row.role, t)}</span>
                        </Badge>
                        {row.isSelf ? (
                          <>
                            <span className="h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              {t('team.badge.you')}
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
                          {row.status === 'active' ? t('team.status.active') : t('team.status.pending')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Member options"
                        onClick={(e) => void handleOpenRowMenu(e, row)}
                      >
                        {teamActionKey &&
                        (teamActionKey === `role:${row.userId}` ||
                          teamActionKey === `remove:${row.userId}` ||
                          teamActionKey === `resend:${row.inviteId}` ||
                          teamActionKey === `cancel:${row.inviteId}`) ? (
                          <div className="loader" />
                        ) : (
                          <HugeiconsIcon icon={__MoreVerticalHugeIcon} className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : hasResolvedTeamRows ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  {t('team.empty.noMembers')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
