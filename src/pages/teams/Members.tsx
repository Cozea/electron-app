import { useMemo, useState } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { featureFlags } from '@/lib/featureFlags'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
import { useAuth } from '../../contexts/AuthContext'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useCachedQuery } from '../../stores/useQueryCache'
import type { Id } from '../../../convex/_generated/dataModel'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { Checkbox } from '../../components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import {
  UserPlus,
  MoreVertical,
  User,
  Loader2,
  XCircle,
  Trash,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Send,
  Trash2,
  ArrowUpDown,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'

import { IconFilter } from '@tabler/icons-react'

type TableRowData = {
  id: string
  type: 'member' | 'invite'
  email: string
  name: string
  role: string
  status: 'active' | 'pending'
  date: number
  avatarUrl?: string
  workosInvitationId?: string // For revoking WorkOS invitations
  workosMembershipId?: string // For removing members via WorkOS
}

type SortField = 'name' | 'role' | 'date'
type SortDirection = 'asc' | 'desc'

// Permission check helper based on role
type Role = 'admin' | 'member' | 'viewer'
type Permission = 'members:invite' | 'members:remove' | 'members:update_role' | 'invitations:revoke'

const PERMISSION_MATRIX: Record<Permission, Role[]> = {
  'members:invite': ['admin'],
  'members:remove': ['admin'],
  'members:update_role': ['admin'],
  'invitations:revoke': ['admin'],
}

function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false
  return PERMISSION_MATRIX[permission]?.includes(role) ?? false
}

export function Members() {
  const navigate = useViewTransitionNavigate()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const { user, logout, currentOrganization, convexUserId } = useAuth()
  const { inviteMember, revokeInvitation: revokeWorkosInvitation, removeMember: removeWorkosMember, updateMemberRole: updateWorkosMemberRole } = useOrganization()
  const [selected, setSelected] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(10)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteMembers, setInviteMembers] = useState<{ email: string, role: 'admin' | 'member' | 'viewer' }[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Filter state
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Get Convex organization by WorkOS ID (with caching to prevent loading flash)
  const freshOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )
  const convexOrg = useCachedQuery(
    `members-org-${currentOrganization?.organizationId}`,
    freshOrg
  )

  // Convex queries for members and invitations (with caching)
  const freshMembers = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )
  const members = useCachedQuery(
    `members-list-${convexOrg?._id}`,
    freshMembers
  )

  const freshInvites = useQuery(
    api.invitations.listForOrganization,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )
  const pendingInvites = useCachedQuery(
    `members-invites-${convexOrg?._id}`,
    freshInvites
  )

  const seatManagement = useQuery(
    api.billing.getSeatManagement,
    convexOrg?._id && convexUserId
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip'
  )

  // Current user's role in the organization
  const currentUserRole = currentOrganization?.role as Role | undefined
  const hasInvitePermission = hasPermission(currentUserRole, 'members:invite')
  const canInvite = hasInvitePermission
  const canRemove = hasPermission(currentUserRole, 'members:remove')
  const canUpdateRole = hasPermission(currentUserRole, 'members:update_role')
  const canRevokeInvite = hasPermission(currentUserRole, 'invitations:revoke')

  // Convex mutations
  const createInvitation = useMutation(api.invitations.create)
  const revokeInvitationMutation = useMutation(api.invitations.revoke)
  const removeMemberMutation = useMutation(api.organizations.removeMember)
  const updateMemberRoleMutation = useMutation(api.organizations.updateMemberRole)

  const isLoading = members === undefined || pendingInvites === undefined

  const filteredRows = useMemo(() => {
    const tableRows: TableRowData[] = [
      ...(members ?? []).map((member): TableRowData => ({
        id: member._id,
        type: 'member',
        email: member.user?.email || '',
        name:
          `${member.user?.firstName || ''} ${member.user?.lastName || ''}`.trim() ||
          member.user?.email?.split('@')[0] ||
          'Unknown',
        role: member.role || 'member',
        status: 'active',
        date: member.joinedAt,
        avatarUrl: member.user?.profileImageUrl || undefined,
        workosMembershipId: member.workosId,
      })),
      ...(pendingInvites ?? []).map((invite): TableRowData => ({
        id: invite._id,
        type: 'invite',
        email: invite.email,
        name: invite.email.split('@')[0],
        role: invite.role,
        status: 'pending',
        date: invite.createdAt,
        workosInvitationId: invite.workosInvitationId,
      })),
    ]

    const roleFilteredRows = tableRows.filter((row) => {
      if (roleFilter === 'all') return true
      return row.role === roleFilter
    })

    return [...roleFilteredRows].sort((left, right) => {
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
  }, [members, pendingInvites, roleFilter, sortDirection, sortField])

  // Pagination
  const totalPages = Math.ceil(filteredRows.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedRows = filteredRows.slice(startIndex, endIndex)

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).replace(/\//g, '-')
  }

  const toggleAll = () => {
    setSelected(selected.length === paginatedRows.length ? [] : paginatedRows.map((d) => d.id))
  }

  const toggleRow = (id: string) => {
    setSelected(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    )
  }

  const handleAddEmail = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && emailInput.trim()) {
      e.preventDefault()
      const email = emailInput.trim().replace(',', '')
      if (email && !inviteMembers.some(m => m.email === email) && email.includes('@')) {
        setInviteMembers([...inviteMembers, { email, role: 'member' }])
        setEmailInput('')
      }
    }
  }

  const handleRemoveFromInviteList = (index: number) => {
    setInviteMembers(inviteMembers.filter((_, i) => i !== index))
  }

  const handleUpdateRole = (index: number, role: 'admin' | 'member' | 'viewer') => {
    setInviteMembers(inviteMembers.map((m, i) => i === index ? { ...m, role } : m))
  }

  const handleSendInvites = async () => {
    if (inviteMembers.length === 0 || !currentOrganization?.organizationId || !convexOrg?._id || !convexUserId) return

    setIsSubmitting(true)
    setInviteError(null)

    try {
      // Dual-write: Send invites via both WorkOS (sends email) and Convex (tracks state)
      const results = await Promise.all(
        inviteMembers.map(async (member) => {
          try {
            // 1. Send via WorkOS (this sends the actual email)
            const workosResult = await inviteMember(currentOrganization.organizationId, member.email, member.role)

            // Check for errors in the response
            if (!workosResult || workosResult.error) {
              const errorMsg = workosResult?.error || 'Unknown error'
              // Check for "already invited" error
              if (errorMsg.toLowerCase().includes('already invited')) {
                return { success: false, email: member.email, error: 'already_invited' }
              }
              return { success: false, email: member.email, error: errorMsg }
            }

            // 2. Track in Convex (for local display) with WorkOS invitation ID for revocation
            try {
              await createInvitation({
                orgId: convexOrg._id,
                invitedBy: convexUserId,
                email: member.email,
                role: member.role,
                workosInvitationId: workosResult.invitationId || undefined,
              })
            } catch (convexErr) {
              // Convex might fail if invitation already exists locally - log but don't fail
              // since the WorkOS invite was sent successfully
              console.warn(`Convex invitation tracking failed for ${member.email}:`, convexErr)
            }

            return { success: true, email: member.email }
          } catch (err) {
            console.error(`Failed to invite ${member.email}:`, err)
            return { success: false, email: member.email, error: 'unknown' }
          }
        })
      )

      const failed = results.filter((r) => !r.success)
      const alreadyInvited = failed.filter((r) => r.error === 'already_invited')
      const otherErrors = failed.filter((r) => r.error !== 'already_invited')

      if (failed.length > 0) {
        const errorMessages: string[] = []
        if (alreadyInvited.length > 0) {
          const emails = alreadyInvited.map((r) => r.email).join(', ')
          errorMessages.push(`Already invited: ${emails}`)
        }
        if (otherErrors.length > 0) {
          errorMessages.push(`Failed to send ${otherErrors.length} invitation(s)`)
        }
        setInviteError(errorMessages.join('. '))
      } else {
        // Convex queries auto-refresh, so just close modal
        setInviteMembers([])
        setEmailInput('')
        setIsInviteOpen(false)
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invitations')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevokeInvite = async (invitationId: string, workosInvitationId?: string) => {
    if (!convexUserId) return

    try {
      // 1. Revoke in WorkOS first (invalidates the email link)
      if (workosInvitationId) {
        await revokeWorkosInvitation(workosInvitationId)
      }

      // 2. Delete from Convex (removes from UI)
      await revokeInvitationMutation({
        invitationId: invitationId as Id<'invitations'>,
        userId: convexUserId,
      })
      // Convex queries auto-refresh
    } catch (err) {
      console.error('Failed to revoke invitation:', err)
    }
  }

  const handleRemoveMember = async (memberId: string, workosMembershipId?: string) => {
    if (!convexUserId || !convexOrg?._id || !currentOrganization?.organizationId) return

    try {
      // 1. Remove from WorkOS first
      if (workosMembershipId) {
        await removeWorkosMember(currentOrganization.organizationId, workosMembershipId)
      }

      // 2. Remove from Convex
      await removeMemberMutation({
        orgId: convexOrg._id,
        memberId: memberId as Id<'members'>,
        removedBy: convexUserId,
      })
      // Convex queries auto-refresh
    } catch (err) {
      console.error('Failed to remove member:', err)
    }
  }

  const handleChangeRole = async (memberId: string, workosMembershipId: string | undefined, newRole: 'admin' | 'member' | 'viewer') => {
    if (!convexUserId || !convexOrg?._id || !currentOrganization?.organizationId) return

    try {
      // 1. Update in WorkOS first
      if (workosMembershipId) {
        await updateWorkosMemberRole(currentOrganization.organizationId, workosMembershipId, newRole)
      }

      // 2. Update in Convex
      await updateMemberRoleMutation({
        orgId: convexOrg._id,
        memberId: memberId as Id<'members'>,
        newRole,
        updatedBy: convexUserId,
      })
      // Convex queries auto-refresh
    } catch (err) {
      console.error('Failed to change member role:', err)
    }
  }

  const handleBulkDelete = async () => {
    const selectedInvites = paginatedRows.filter(
      (row) => selected.includes(row.id) && row.type === 'invite'
    )

    for (const invite of selectedInvites) {
      await handleRevokeInvite(invite.id, invite.workosInvitationId)
    }

    setSelected([])
  }

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, '...', totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
      }
    }
    return pages
  }

  const seatCounts = seatManagement?.entitlement?.seatCounts
  const paidSeatTotal = seatCounts?.total ?? 0
  const paidSeatAssigned = seatCounts?.assigned ?? 0
  const seatManagedEntitlement = Boolean(
    seatManagement &&
      (
        seatManagement.entitlement.source === 'legacy' ||
        seatManagement.entitlement.source === 'trial' ||
        seatManagement.entitlement.plan === 'startup' ||
        seatManagement.entitlement.plan === 'enterprise'
      )
  )

  // Circular progress component for paid-seat usage
  const seatPercentage = paidSeatTotal > 0
    ? Math.min((paidSeatAssigned / paidSeatTotal) * 100, 100)
    : 0
  const circumference = 2 * Math.PI * 8 // radius = 8
  const strokeDashoffset = circumference - (seatPercentage / 100) * circumference

  const breadcrumbAddon = (
    <>
      {seatManagement === undefined ? (
        <Badge variant="secondary" className="text-xs font-normal">
          --
        </Badge>
      ) : paidSeatTotal > 0 && (
        <Badge
          variant="secondary"
          className="flex items-center gap-1.5 text-xs font-normal pl-1.5 pr-2 py-0.5"
          title={`${paidSeatAssigned} / ${paidSeatTotal} paid seats assigned`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-muted-foreground/30"
            />
            {/* Progress circle */}
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={paidSeatAssigned >= paidSeatTotal ? 'text-destructive' : paidSeatAssigned >= paidSeatTotal - 1 ? 'text-amber-500' : 'text-primary'}
            />
          </svg>
          <span>{paidSeatAssigned}/{paidSeatTotal}</span>
        </Badge>
      )}
    </>
  )

  const headerContent = (
    <div className="flex items-center gap-2">
      {selected.length > 0 && (
        <Button variant="destructive" size="sm" className="h-7 rounded-full" onClick={handleBulkDelete}>
          <Trash className="mr-2 h-4 w-4" />
          Delete ({selected.length})
        </Button>
      )}
      {/* Role Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <IconFilter className="h-3.5 w-3.5" />
            {roleFilter === 'all' ? 'All Roles' : roleFilter.charAt(0).toUpperCase() + roleFilter.slice(1)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setRoleFilter('all'); setCurrentPage(1) }}>All Roles</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setRoleFilter('admin'); setCurrentPage(1) }}>Admin</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setRoleFilter('member'); setCurrentPage(1) }}>Member</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setRoleFilter('viewer'); setCurrentPage(1) }}>Viewer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort By */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortField === 'date' ? 'Date' : sortField === 'name' ? 'Name' : 'Role'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setSortField('date'); setCurrentPage(1) }}>Date Joined</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setSortField('name'); setCurrentPage(1) }}>Name</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setSortField('role'); setCurrentPage(1) }}>Role</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort Direction */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2 h-7 px-2 text-xs rounded-full focus:z-10">
            {sortDirection === 'asc' ? '↑ Asc' : '↓ Desc'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setSortDirection('asc'); setCurrentPage(1) }}>Ascending</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setSortDirection('desc'); setCurrentPage(1) }}>Descending</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogTrigger asChild>
          <Button className="gap-2 h-7 px-2 text-xs rounded-full" disabled={!canInvite}>
            <UserPlus className="h-3.5 w-3.5" />
            Invite
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite members</DialogTitle>
            <DialogDescription>
              Invited members will receive an invitation to join your workspace
            </DialogDescription>
          </DialogHeader>

          {inviteError && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {inviteError}
            </div>
          )}

          {/* Email input */}
          <div className="relative">
            <Input
              type="email"
              placeholder="Enter email addresses..."
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleAddEmail}
              disabled={isSubmitting}
            />
          </div>

          {/* Members list with role dropdowns */}
          {inviteMembers.length > 0 && (
            <div className="relative">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-background to-transparent z-10" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-background to-transparent z-10" />
              <div className="app-scrollbar max-h-64 overflow-y-auto py-2 space-y-1">
                {inviteMembers.map((member, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-1"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="text-sm">
                          {member.email.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{member.email.split('@')[0]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1">
                            {member.role}
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleUpdateRole(i, 'admin')}>
                            admin
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdateRole(i, 'member')}>
                            member
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdateRole(i, 'viewer')}>
                            viewer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromInviteList(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        disabled={isSubmitting}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer with count and button */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{inviteMembers.length}</span> members added
            </span>
            <Button
              onClick={handleSendInvites}
              disabled={inviteMembers.length === 0 || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send invites
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Teams' }, { label: 'Members' }]}
      breadcrumbAddon={breadcrumbAddon}
      header={headerContent}
    >
      <div className={featureFlags.contentVisibility ? 'perf-contain-auto' : undefined}>
        {seatManagement?.entitlement.source === 'legacy' && (
          <Alert className="mb-4">
            <AlertTitle>Legacy workspace billing is active</AlertTitle>
            <AlertDescription>
              This workspace still uses legacy billing entitlements. Migrate and manage explicit paid seats in{' '}
              <Button
                variant="link"
                className="h-auto p-0 underline"
                onClick={() => openSettingsDrawer('/settings/billing')}
              >
                Billing Settings
              </Button>
              {' '}(Startup seat billing).
            </AlertDescription>
          </Alert>
        )}

        {seatManagement && seatManagedEntitlement && seatManagement.entitlement.source !== 'legacy' && seatManagement.entitlement.seatCounts.total > 0 && (
          <Alert className="mb-4">
            <AlertTitle>Paid seat coverage</AlertTitle>
            <AlertDescription>
              {seatManagement.entitlement.seatCounts.assigned}/{seatManagement.entitlement.seatCounts.total} paid seats assigned.
              Members can still join this workspace without a paid seat, but AI and sync require seat assignment.
            </AlertDescription>
          </Alert>
        )}

        {seatManagement && seatManagedEntitlement && !seatManagement.entitlement.canUseAi && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>No paid seat assigned to you</AlertTitle>
            <AlertDescription>
              Ask {seatManagement.billingUser?.email || 'the billing owner'} to assign your seat in{' '}
              <Button
                variant="link"
                className="h-auto p-0 text-destructive underline"
                onClick={() => openSettingsDrawer('/settings/billing')}
              >
                Billing Settings
              </Button>
              .
            </AlertDescription>
          </Alert>
        )}

        {/* Table */}
        <div
          className={[
            featureFlags.contentVisibility ? 'perf-contain-card' : '',
            'overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1',
          ].join(' ').trim()}
        >
          <Table className="[&_th]:px-4 [&_td]:px-4">
            <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selected.length === paginatedRows.length && paginatedRows.length > 0}
                    onCheckedChange={toggleAll}
                    disabled={paginatedRows.length === 0}
                  />
                </TableHead>
                <TableHead>Member Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
              {paginatedRows.length > 0 ? (
                paginatedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={row.avatarUrl} />
                          <AvatarFallback className="text-xs">
                            {row.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{row.name}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">{row.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge className="border-0 bg-primary/10 text-primary">
                          {row.role.charAt(0).toUpperCase() + row.role.slice(1)}
                        </Badge>
                        {row.email === user?.email ? (
                          <>
                            <span className="h-4 w-px bg-border/70" aria-hidden="true" />
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                              you
                            </span>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${row.status === 'active' ? 'bg-green-500' : 'bg-amber-500'
                            }`}
                        />
                        <span className={row.status === 'active' ? 'text-green-600' : 'text-amber-600'}>
                          {row.status === 'active' ? 'Active' : 'Pending'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(row.date)}
                    </TableCell>
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
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger disabled={!canUpdateRole || row.email === user?.email}>
                                  <Shield className="h-4 w-4 mr-2" />
                                  Change Role
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem
                                    onClick={() => handleChangeRole(row.id, row.workosMembershipId, 'admin')}
                                    disabled={row.role === 'admin'}
                                  >
                                    Admin
                                    {row.role === 'admin' && <span className="ml-2 text-muted-foreground">(current)</span>}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleChangeRole(row.id, row.workosMembershipId, 'member')}
                                    disabled={row.role === 'member'}
                                  >
                                    Member
                                    {row.role === 'member' && <span className="ml-2 text-muted-foreground">(current)</span>}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleChangeRole(row.id, row.workosMembershipId, 'viewer')}
                                    disabled={row.role === 'viewer'}
                                  >
                                    Viewer
                                    {row.role === 'viewer' && <span className="ml-2 text-muted-foreground">(current)</span>}
                                  </DropdownMenuItem>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuItem onClick={() => navigate(`/teams/members/${row.id}`)}>
                                <User className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                disabled={!canRemove || row.email === user?.email}
                                onClick={() => handleRemoveMember(row.id, row.workosMembershipId)}
                              >
                                <Trash className="h-4 w-4 mr-2" />
                                {row.email === user?.email ? "Can't remove yourself" : 'Remove'}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem disabled>
                                <User className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                disabled={!canRevokeInvite}
                                onClick={() => handleRevokeInvite(row.id, row.workosInvitationId)}
                              >
                                <XCircle className="h-4 w-4 mr-2" />
                                Revoke
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    {isLoading
                      ? 'Loading members...'
                      : 'No members found. Invite members to get started.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!isLoading && filteredRows.length > 0 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium">{startIndex + 1}-{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-medium">{filteredRows.length}</span> entries
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {getPageNumbers().map((page, i) => (
                typeof page === 'number' ? (
                  <Button
                    key={i}
                    variant={currentPage === page ? 'default' : 'secondary'}
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </Button>
                ) : (
                  <span key={i} className="px-2 text-muted-foreground">...</span>
                )
              ))}
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
