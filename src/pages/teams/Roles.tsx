import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'

import { api } from '../../../convex/_generated/api'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import {

  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Textarea } from '../../components/ui/textarea'
import { useOrganization } from '../../contexts/OrganizationContext'
import {
  ORGANIZATION_WORKSPACE_PERMISSION_GROUPS,
  ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS,
  formatOrganizationWorkspaceRole,
  type OrganizationWorkspacePermission,
  type OrganizationWorkspaceResolvedRole,
  type OrganizationWorkspaceRole,
} from '@/lib/workspaces/organizationRoles'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  SettingsFooterActions,
  SettingsPageBody,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/components/settings/SettingsChrome'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { useScopedWorkspacePeopleData } from '@/hooks/useScopedWorkspacePeopleData'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon as __PlusHugeIcon, Delete02Icon as __Trash2HugeIcon, Edit01Icon as __PencilHugeIcon, LockIcon as __LockHugeIcon, Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

interface RoleDraft {
  name: string
  description: string
  baseRole: OrganizationWorkspaceRole
  permissions: OrganizationWorkspacePermission[]
}

interface AccessRow {
  id: string
  type: 'member' | 'invite'
  name: string
  email: string
  avatarUrl?: string
  roleKey: string
  roleId?: string | null
  roleName?: string | null
  roleBaseRole: OrganizationWorkspaceRole
  inheritedPermissions: OrganizationWorkspacePermission[]
  directGrants: OrganizationWorkspacePermission[]
  directDenies: OrganizationWorkspacePermission[]
  permissions: OrganizationWorkspacePermission[]
  status: 'active' | 'pending'
  workosMembershipId?: string
  workosInvitationId?: string
}

interface RoleGroup {
  key: string
  name: string
  description: string
  roleId?: string | null
  baseRole: OrganizationWorkspaceRole
  permissions: OrganizationWorkspacePermission[]
  isSystem: boolean
  principals: AccessRow[]
  resolvedRole?: OrganizationWorkspaceResolvedRole
}

type PermissionOverrideMode = 'inherit' | 'grant' | 'deny'
type PermissionOverrideDraft = Record<OrganizationWorkspacePermission, PermissionOverrideMode>

const ROLE_RANK: Record<OrganizationWorkspaceRole, number> = {
  admin: 0,
  member: 1,
  viewer: 2,
}

const HIDDEN_WORKSPACE_PERMISSIONS = new Set<OrganizationWorkspacePermission>([
  'tooling:view',
  'tooling:manage',
])

function getVisiblePermissions(permissions: OrganizationWorkspacePermission[]) {
  return permissions.filter((permission) => !HIDDEN_WORKSPACE_PERMISSIONS.has(permission))
}

function makeDefaultDraft(
  baseRole: OrganizationWorkspaceRole = 'member',
): RoleDraft {
  return {
    name: '',
    description: '',
    baseRole,
    permissions: [...ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS[baseRole].permissions],
  }
}

function getInitials(name: string, email: string) {
  const trimmedName = name.trim()
  if (trimmedName.length > 0) {
    return trimmedName
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function buildPermissionOverrideDraft(row: AccessRow): PermissionOverrideDraft {
  const draft = {} as PermissionOverrideDraft
  for (const group of ORGANIZATION_WORKSPACE_PERMISSION_GROUPS) {
    for (const permission of group.permissions) {
      if (row.directGrants.includes(permission.key)) {
        draft[permission.key] = 'grant'
      } else if (row.directDenies.includes(permission.key)) {
        draft[permission.key] = 'deny'
      } else {
        draft[permission.key] = 'inherit'
      }
    }
  }
  return draft
}

function summarizeDirectOverrides(row: AccessRow) {
  if (row.directGrants.length === 0 && row.directDenies.length === 0) {
    return []
  }

  return [
    ...getVisiblePermissions(row.directGrants).map((permission) => ({
      key: `grant:${permission}`,
      label: `+ ${permission}`,
    })),
    ...getVisiblePermissions(row.directDenies).map((permission) => ({
      key: `deny:${permission}`,
      label: `- ${permission}`,
    })),
  ]
}

function getEffectivePermissionCount(row: AccessRow) {
  if (row.permissions.length > 0) {
    return new Set(getVisiblePermissions(row.permissions)).size
  }
  if (row.inheritedPermissions.length > 0) {
    return new Set(getVisiblePermissions(row.inheritedPermissions)).size
  }
  return 0
}

interface RolesProps {
  surface?: 'page' | 'drawer'
  route?: string
}

export function Roles({ surface = 'page', route = '/teams/roles' }: RolesProps = {}) {
  const {
    updateInvitationRole: updateWorkosInvitationRole,
    updateMemberRole: updateWorkosMemberRole,
  } = useOrganization()
  const {
    settingsPage,
    convexUserId,
    convexOrg,
    workspaceOrganizationId,
    workspaceName,
    members,
    pendingInvites,
    organizationRoles: persistedRoles,
    roleOptions,
    canManageRoles,
    canAssignRoles,
    isRefreshing,
    hasResolvedData,
  } = useScopedWorkspacePeopleData({
    route,
    surfaceId: 'roles',
  })

  const [roleSheetOpen, setRoleSheetOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingRole, setEditingRole] = useState<OrganizationWorkspaceResolvedRole | null>(null)
  const [draft, setDraft] = useState<RoleDraft>(makeDefaultDraft())
  const [accessActionError, setAccessActionError] = useState<string | null>(null)
  const [updatingPrincipalId, setUpdatingPrincipalId] = useState<string | null>(null)
  const [principalSheetOpen, setPrincipalSheetOpen] = useState(false)
  const [overrideSubmitting, setOverrideSubmitting] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [editingAccessRow, setEditingAccessRow] = useState<AccessRow | null>(null)
  const searchQuery = ''
  const [overrideDraft, setOverrideDraft] = useState<PermissionOverrideDraft>(() => {
    const initial = {} as PermissionOverrideDraft
    for (const group of ORGANIZATION_WORKSPACE_PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        initial[permission.key] = 'inherit'
      }
    }
    return initial
  })

  const createRole = useMutation(api.organizations.createRole)
  const updateRole = useMutation(api.organizations.updateRole)
  const deleteRole = useMutation(api.organizations.deleteRole)
  const updateMemberRoleMutation = useMutation(api.organizations.updateMemberRole)
  const updateMemberPermissionOverridesMutation = useMutation(
    api.organizations.updateMemberPermissionOverrides,
  )
  const updateInvitationPermissionOverridesMutation = useMutation(
    api.invitations.updatePermissionOverrides,
  )

  const resolvedRoles = useMemo<OrganizationWorkspaceResolvedRole[]>(
    () => ((persistedRoles as OrganizationWorkspaceResolvedRole[] | undefined) ?? []),
    [persistedRoles],
  )
  const accessRows = useMemo<AccessRow[]>(() => {
    const memberRows: AccessRow[] = (members ?? []).map((member) => ({
      id: member._id,
      type: 'member',
      name:
        `${member.user?.firstName || ''} ${member.user?.lastName || ''}`.trim() ||
        member.user?.email?.split('@')[0] ||
        'Unknown',
      email: member.user?.email || '',
      avatarUrl: member.user?.profileImageUrl || undefined,
      roleKey: member.roleKey || member.role || 'member',
      roleId: member.roleId || null,
      roleName: member.roleName || null,
      roleBaseRole: (member.roleBaseRole || member.role || 'member') as OrganizationWorkspaceRole,
      inheritedPermissions: (member.inheritedPermissions ?? []) as OrganizationWorkspacePermission[],
      directGrants: (member.directGrants ?? []) as OrganizationWorkspacePermission[],
      directDenies: (member.directDenies ?? []) as OrganizationWorkspacePermission[],
      permissions: (member.permissions ?? []) as OrganizationWorkspacePermission[],
      status: 'active',
      workosMembershipId: member.workosId,
    }))

    const activeEmails = new Set(
      memberRows.map((row) => row.email.trim().toLowerCase()).filter(Boolean),
    )

    const inviteRows: AccessRow[] = (pendingInvites ?? [])
      .filter((invite) => !activeEmails.has(invite.email.trim().toLowerCase()))
      .reduce<AccessRow[]>((rows, invite) => {
        const normalizedEmail = invite.email.trim().toLowerCase()
        if (rows.some((row) => row.email.trim().toLowerCase() === normalizedEmail)) {
          return rows
        }
        rows.push({
          id: invite._id,
          type: 'invite',
          name: invite.email.split('@')[0],
          email: invite.email,
          roleKey: invite.roleKey || invite.role,
          roleId: invite.roleId || null,
          roleName: invite.roleName || null,
          roleBaseRole: (invite.roleBaseRole || invite.role || 'member') as OrganizationWorkspaceRole,
          inheritedPermissions: (invite.inheritedPermissions ?? []) as OrganizationWorkspacePermission[],
          directGrants: (invite.directGrants ?? []) as OrganizationWorkspacePermission[],
          directDenies: (invite.directDenies ?? []) as OrganizationWorkspacePermission[],
          permissions: (invite.permissions ?? []) as OrganizationWorkspacePermission[],
          status: 'pending',
          workosInvitationId: invite.workosInvitationId,
        })
        return rows
      }, [])

    return [...memberRows, ...inviteRows].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
  }, [members, pendingInvites])

  const roleGroups = useMemo<RoleGroup[]>(() => {
    const groups = new Map<string, RoleGroup>()

    for (const role of resolvedRoles) {
      groups.set(role.key, {
        key: role.key,
        name: role.name,
        description:
          role.description ||
          `Role based on ${formatOrganizationWorkspaceRole(role.baseRole)} permissions.`,
        roleId: role._id ?? null,
        baseRole: role.baseRole,
        permissions: role.permissions,
        isSystem: !!role.isSystem,
        principals: [],
        resolvedRole: role,
      })
    }

    for (const row of accessRows) {
      const fallbackRole = row.roleId
        ? resolvedRoles.find((role) => role._id === row.roleId)
        : resolvedRoles.find(
            (role) => role.isSystem && role.baseRole === row.roleBaseRole,
          )
      const groupKey = fallbackRole?.key ?? row.roleKey

      const existing = groups.get(groupKey)
      if (existing) {
        existing.principals.push(row)
        continue
      }

      groups.set(groupKey, {
        key: groupKey,
        name:
          fallbackRole?.name ??
          formatOrganizationWorkspaceRole(row.roleBaseRole, row.roleName),
        description:
          fallbackRole?.description || 'Role binding currently assigned to workspace principals.',
        roleId: fallbackRole?._id ?? row.roleId ?? null,
        baseRole: fallbackRole?.baseRole ?? row.roleBaseRole,
        permissions:
          fallbackRole?.permissions ??
          (row.inheritedPermissions.length > 0 ? row.inheritedPermissions : row.permissions),
        isSystem: fallbackRole?.isSystem ?? !row.roleId,
        principals: [row],
        resolvedRole: fallbackRole,
      })
    }

    return Array.from(groups.values()).sort((left, right) => {
      const roleDelta = ROLE_RANK[left.baseRole] - ROLE_RANK[right.baseRole]
      if (roleDelta !== 0) return roleDelta
      return left.name.localeCompare(right.name)
    })
  }, [accessRows, resolvedRoles])

  const filteredRoleGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return roleGroups

    return roleGroups
      .map((group) => {
        const groupMatches =
          group.name.toLowerCase().includes(query) ||
          group.key.toLowerCase().includes(query) ||
          group.description.toLowerCase().includes(query) ||
          group.permissions.some((permission) => permission.toLowerCase().includes(query))

        if (groupMatches) {
          return group
        }

        const filteredPrincipals = group.principals.filter((row) =>
          [row.name, row.email, row.roleName ?? '', row.status].some((value) =>
            value.toLowerCase().includes(query),
          ),
        )

        if (filteredPrincipals.length === 0) {
          return null
        }

        return {
          ...group,
          principals: filteredPrincipals,
        }
      })
      .filter((group): group is RoleGroup => group !== null)
  }, [roleGroups, searchQuery])

  function openCreateRoleSheet() {
    setEditingRole(null)
    setDraft(makeDefaultDraft())
    setError(null)
    setRoleSheetOpen(true)
  }

  function openEditRoleSheet(role: OrganizationWorkspaceResolvedRole) {
    setEditingRole(role)
    setDraft({
      name: role.name,
      description: role.description,
      baseRole: role.baseRole,
      permissions: getVisiblePermissions(role.permissions),
    })
    setError(null)
    setRoleSheetOpen(true)
  }

  function closeRoleSheet() {
    setRoleSheetOpen(false)
    setEditingRole(null)
    setError(null)
    setDraft(makeDefaultDraft())
  }

  function openPrincipalSheet(row: AccessRow) {
    setEditingAccessRow(row)
    setOverrideDraft(buildPermissionOverrideDraft(row))
    setOverrideError(null)
    setPrincipalSheetOpen(true)
  }

  function closePrincipalSheet() {
    setPrincipalSheetOpen(false)
    setEditingAccessRow(null)
    setOverrideError(null)
  }

  function togglePermission(permission: OrganizationWorkspacePermission) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((entry) => entry !== permission)
        : [...current.permissions, permission],
    }))
  }

  async function handleSubmit() {
    if (!convexOrg?._id || !convexUserId) return
    if (!draft.name.trim()) {
      setError('Role name is required')
      return
    }
    if (draft.permissions.length === 0) {
      setError('Select at least one permission')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (editingRole?._id) {
        await updateRole({
          orgId: convexOrg._id,
          userId: convexUserId,
          roleId: editingRole._id as never,
          name: draft.name.trim(),
          description: draft.description.trim(),
          baseRole: draft.baseRole,
          permissions: draft.permissions,
        })
      } else {
        await createRole({
          orgId: convexOrg._id,
          userId: convexUserId,
          name: draft.name.trim(),
          description: draft.description.trim(),
          baseRole: draft.baseRole,
          permissions: draft.permissions,
        })
      }

      closeRoleSheet()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save role')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(role: OrganizationWorkspaceResolvedRole) {
    if (!convexOrg?._id || !convexUserId || !role._id) return
    if (!window.confirm(`Delete role "${role.name}"?`)) return

    try {
      await deleteRole({
        orgId: convexOrg._id,
        userId: convexUserId,
        roleId: role._id as never,
      })
      closeRoleSheet()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete role')
      setRoleSheetOpen(true)
    }
  }

  async function handleAccessRoleChange(row: AccessRow, nextRoleValue: string) {
    if (
      !convexOrg?._id ||
      !convexUserId ||
      !workspaceOrganizationId
    ) {
      return
    }

    const selectedRole = roleOptions.find((role) => role.value === nextRoleValue)
    if (!selectedRole) return

    const roleAlreadyAssigned = row.roleId
      ? row.roleId === selectedRole.roleId
      : row.roleBaseRole === selectedRole.baseRole
    if (roleAlreadyAssigned) return

    setUpdatingPrincipalId(row.id)
    setAccessActionError(null)

    try {
      if (row.type === 'member' && row.workosMembershipId) {
        const workosUpdated = await updateWorkosMemberRole(
          workspaceOrganizationId,
          row.workosMembershipId,
          selectedRole.baseRole,
          selectedRole.roleId,
        )
        if (!workosUpdated) {
          throw new Error('Failed to update workspace member role')
        }

        await updateMemberRoleMutation({
          orgId: convexOrg._id,
          memberId: row.id as Id<'members'>,
          newRole: selectedRole.baseRole,
          newRoleId: selectedRole.roleId
            ? (selectedRole.roleId as Id<'organizationRoles'>)
            : undefined,
          updatedBy: convexUserId,
        })
      }

      if (row.type === 'invite' && row.workosInvitationId) {
        const workosUpdated = await updateWorkosInvitationRole(
          row.workosInvitationId,
          selectedRole.baseRole,
          selectedRole.roleId,
        )
        if (!workosUpdated) {
          throw new Error('Failed to update invitation role')
        }
      }

      setEditingAccessRow((current) =>
        current?.id === row.id
          ? {
              ...current,
              roleKey: selectedRole.value,
              roleId: selectedRole.roleId ?? null,
              roleName: selectedRole.label,
              roleBaseRole: selectedRole.baseRole,
            }
          : current,
      )
    } catch (updateError) {
      setAccessActionError(
        updateError instanceof Error ? updateError.message : 'Failed to update role',
      )
    } finally {
      setUpdatingPrincipalId(null)
    }
  }

  async function handleOverrideSubmit() {
    if (!convexOrg?._id || !convexUserId || !editingAccessRow) return

    const permissionGrants = Object.entries(overrideDraft)
      .filter(([, mode]) => mode === 'grant')
      .map(([permission]) => permission as OrganizationWorkspacePermission)
    const permissionDenies = Object.entries(overrideDraft)
      .filter(([, mode]) => mode === 'deny')
      .map(([permission]) => permission as OrganizationWorkspacePermission)

    setOverrideSubmitting(true)
    setOverrideError(null)

    try {
      if (editingAccessRow.type === 'member') {
        await updateMemberPermissionOverridesMutation({
          orgId: convexOrg._id,
          userId: convexUserId,
          memberId: editingAccessRow.id as Id<'members'>,
          permissionGrants,
          permissionDenies,
        })
      } else {
        await updateInvitationPermissionOverridesMutation({
          orgId: convexOrg._id,
          userId: convexUserId,
          invitationId: editingAccessRow.id as Id<'invitations'>,
          permissionGrants,
          permissionDenies,
        })
      }

      closePrincipalSheet()
    } catch (submitError) {
      setOverrideError(
        submitError instanceof Error ? submitError.message : 'Failed to update direct permissions',
      )
    } finally {
      setOverrideSubmitting(false)
    }
  }

  const content = (
    <>
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Roles access required"
          description="You do not have permission to view workspace roles."
        />
      ) : (
      <div className="space-y-5">
        <div className="min-w-0">
          <SettingsSectionTitle className="px-0">Roles</SettingsSectionTitle>
          <SettingsSectionDescription className="mb-0 px-0">
            Manage workspace roles and the people assigned to them.
          </SettingsSectionDescription>
          {isRefreshing ? (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Refreshing role assignments in the background.
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
            {accessActionError ? (
              <div className="rounded-[14px] bg-muted px-4 py-3 text-sm text-destructive">
                {accessActionError}
              </div>
            ) : null}
            {filteredRoleGroups.length === 0 ? (
              <div className="rounded-[14px] bg-muted px-5 py-10 text-center text-sm text-muted-foreground">
                {hasResolvedData
                  ? 'No roles or principals match this filter.'
                  : 'Roles and assignments will appear here once the workspace directory is ready.'}
              </div>
            ) : (
              filteredRoleGroups.map((group) => {
                const editableRole = group.resolvedRole
                return (
                  <section key={group.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-4 px-1">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm text-foreground">{group.name}</h3>
                      </div>
                      {canManageRoles && editableRole ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 rounded-full px-0 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditRoleSheet(editableRole)}
                          aria-label="Edit role"
                        >
                          <HugeiconsIcon icon={__PencilHugeIcon} className="h-4 w-4" />
                        </Button>
                      ) : !canManageRoles ? (
                        <div className="flex items-center justify-end">
                          <HugeiconsIcon icon={__LockHugeIcon} className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ) : null}
                    </div>
                    <div className="overflow-hidden rounded-[14px] bg-muted">
                      <div className="overflow-x-auto">
                        <Table className="[&_td]:px-4 [&_td:last-child]:pr-5 [&_th]:px-4 [&_th]:font-normal [&_th]:text-muted-foreground [&_th:last-child]:pr-5">
                          <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                            <TableRow>
                              <TableHead className="w-[32%]">Principal</TableHead>
                              <TableHead className="w-[22%]">Name</TableHead>
                              <TableHead className="w-[30%]">Inheritance</TableHead>
                              <TableHead className="w-[56px] text-right" />
                            </TableRow>
                          </TableHeader>
                          <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                            {group.principals.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={4}
                                  className="py-8 text-center text-sm text-muted-foreground"
                                >
                                  No principals assigned.
                                </TableCell>
                              </TableRow>
                            ) : (
                              group.principals.map((row) => {
                                const directOverrideLabels = summarizeDirectOverrides(row)
                                const permissionCount = getEffectivePermissionCount(row)
                                const canEditPrincipal = canAssignRoles
                                const showPrincipalLock = !canAssignRoles
                                return (
                                  <TableRow
                                    key={`${group.key}:${row.type}:${row.id}`}
                                    className="group"
                                  >
                                    <TableCell>
                                      <div className="flex min-w-0 items-center gap-2">
                                        <div className="truncate text-sm text-foreground">{row.email}</div>
                                        {row.type === 'invite' ? (
                                          <Badge variant="outline">Pending</Badge>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="truncate text-sm text-foreground">{row.name}</div>
                                    </TableCell>
                                    <TableCell className="[&>div]:overflow-visible">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm text-muted-foreground">
                                          {permissionCount} permissions
                                        </span>
                                        {directOverrideLabels.slice(0, 2).map((override) => (
                                          <Badge key={override.key} variant="outline">
                                            {override.label}
                                          </Badge>
                                        ))}
                                        {directOverrideLabels.length > 2 ? (
                                          <Badge variant="outline">
                                            +{directOverrideLabels.length - 2}
                                          </Badge>
                                        ) : null}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {canEditPrincipal ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 rounded-full px-0 text-muted-foreground hover:text-foreground"
                                          onClick={() => openPrincipalSheet(row)}
                                          aria-label="Edit access"
                                        >
                                          <HugeiconsIcon icon={__PencilHugeIcon} className="h-4 w-4" />
                                        </Button>
                                      ) : showPrincipalLock ? (
                                        <div className="flex items-center justify-end">
                                          <HugeiconsIcon icon={__LockHugeIcon} className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      ) : null}
                                    </TableCell>
                                  </TableRow>
                                )
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </section>
                )
              })
            )}
            {canManageRoles ? (
              <SettingsFooterActions>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                  onClick={openCreateRoleSheet}
                >
                  <HugeiconsIcon icon={__PlusHugeIcon} className="h-3.5 w-3.5" />
                  New role
                </Button>
              </SettingsFooterActions>
            ) : null}
          </div>

        <Sheet
          open={roleSheetOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeRoleSheet()
              return
            }
            setRoleSheetOpen(true)
          }}
        >
          <SheetContent className="w-full sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{editingRole ? `Edit ${editingRole.name}` : 'Create role'}</SheetTitle>
              <SheetDescription>
                Update the role definition, base role, and permission set. This sheet controls the
                parent rows in the permissions table.
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-4 px-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="e.g. Billing Manager"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Base role</label>
                <div className="flex gap-2">
                  {(['admin', 'member', 'viewer'] as OrganizationWorkspaceRole[]).map((baseRole) => (
                    <Button
                      key={baseRole}
                      type="button"
                      variant={draft.baseRole === baseRole ? 'default' : 'secondary'}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          baseRole,
                          permissions:
                            editingRole && current.permissions.length > 0
                              ? current.permissions
                              : [...ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS[baseRole].permissions],
                        }))
                      }
                    >
                      {formatOrganizationWorkspaceRole(baseRole)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 px-4">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Describe what this role is for."
              />
            </div>

            <div className="space-y-4 overflow-y-auto px-4 pb-2">
              <div>
                <h3 className="text-sm font-medium">Permissions</h3>
                <p className="text-sm text-muted-foreground">
                  Select the permissions included in this role. Members inherit these by default.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {ORGANIZATION_WORKSPACE_PERMISSION_GROUPS.map((group) => (
                  <div key={group.category} className="space-y-3 rounded-xl border border-border/60 p-4">
                    <div>
                      <h4 className="font-medium">{group.category}</h4>
                    </div>
                    <div className="space-y-3">
                      {group.permissions.map((permission) => (
                        <label key={permission.key} className="flex items-start gap-3">
                          <Checkbox
                            checked={draft.permissions.includes(permission.key)}
                            onCheckedChange={() => togglePermission(permission.key)}
                          />
                          <div>
                            <div className="text-sm font-medium">{permission.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {permission.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}

            <SheetFooter className="border-t border-border/60">
              {canManageRoles && editingRole && !editingRole.isSystem ? (
                <Button
                  variant="outline"
                  className="mr-auto"
                  onClick={() => void handleDelete(editingRole)}
                  disabled={submitting}
                >
                  <HugeiconsIcon icon={__Trash2HugeIcon} className="mr-2 h-4 w-4" />
                  Delete role
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={closeRoleSheet}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving…' : editingRole ? 'Save role' : 'Create role'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet
          open={principalSheetOpen}
          onOpenChange={(open) => {
            if (!open) {
              closePrincipalSheet()
              return
            }
            setPrincipalSheetOpen(true)
          }}
        >
          <SheetContent className="w-full sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>
                {editingAccessRow
                  ? `Edit access to "${workspaceName}"`
                  : 'Edit access'}
              </SheetTitle>
              <SheetDescription>
                Change this principal’s role assignment and direct permission overrides.
              </SheetDescription>
            </SheetHeader>

            {editingAccessRow ? (
              <>
                <div className="space-y-4 overflow-y-auto px-4 pb-2">
                  <div className="grid gap-4 rounded-xl border border-border/60 p-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Principal
                      </div>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={editingAccessRow.avatarUrl} />
                          <AvatarFallback>
                            {getInitials(editingAccessRow.name, editingAccessRow.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium">{editingAccessRow.email}</div>
                          <div className="text-sm text-muted-foreground">{editingAccessRow.name}</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Workspace
                      </div>
                      <div className="font-medium">{workspaceName}</div>
                    </div>
                  </div>

                  {canAssignRoles ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Assigned role</label>
                      <Select
                        value={editingAccessRow.roleKey}
                        onValueChange={(nextRoleValue) =>
                          void handleAccessRoleChange(editingAccessRow, nextRoleValue)
                        }
                        disabled={updatingPrincipalId === editingAccessRow.id}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Inherited role: {formatOrganizationWorkspaceRole(editingAccessRow.roleBaseRole, editingAccessRow.roleName)}
                      </p>
                    </div>
                  ) : null}

                  {overrideError ? (
                    <p className="text-sm text-destructive">{overrideError}</p>
                  ) : null}

                  <div className="rounded-xl border border-border/60">
                    {ORGANIZATION_WORKSPACE_PERMISSION_GROUPS.map((group) => (
                      <div key={group.category} className="border-b border-border/60 last:border-b-0">
                        <div className="bg-secondary/50 px-4 py-3 font-medium">{group.category}</div>
                        <div className="divide-y divide-border/60">
                          {group.permissions.map((permission) => (
                            <div
                              key={permission.key}
                              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px]"
                            >
                              <div className="space-y-1">
                                <div className="font-medium">{permission.label}</div>
                                <div className="text-sm text-muted-foreground">
                                  {permission.description}
                                </div>
                              </div>
                              <Select
                                value={overrideDraft[permission.key]}
                                onValueChange={(value) =>
                                  setOverrideDraft((current) => ({
                                    ...current,
                                    [permission.key]: value as PermissionOverrideMode,
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">Inherit</SelectItem>
                                  <SelectItem value="grant">Grant</SelectItem>
                                  <SelectItem value="deny">Deny</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <SheetFooter className="border-t border-border/60">
                  <Button
                    variant="secondary"
                    onClick={closePrincipalSheet}
                  >
                    Cancel
                  </Button>
                  <Button onClick={() => void handleOverrideSubmit()} disabled={overrideSubmitting}>
                    {overrideSubmitting ? (
                      <>
                        <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" />
                        Saving
                      </>
                    ) : (
                      'Save access'
                    )}
                  </Button>
                </SheetFooter>
              </>
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
      )}
    </>
  )

  if (surface === 'drawer') {
    return content
  }

  return <SettingsPageBody>{content}</SettingsPageBody>
}

