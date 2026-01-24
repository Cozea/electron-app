import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
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
  Search,
  UserPlus,
  MoreVertical,
  Users,
  User,
  Loader2,
  XCircle,
  Trash,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Send,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'

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

type FilterTab = 'all' | 'active' | 'pending'
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
  const navigate = useNavigate()
  const { user, logout, currentOrganization, convexUserId } = useAuth()
  const { inviteMember, revokeInvitation: revokeWorkosInvitation, removeMember: removeWorkosMember, updateMemberRole: updateWorkosMemberRole } = useOrganization()
  const [selected, setSelected] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(10)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteMembers, setInviteMembers] = useState<{email: string, role: 'admin' | 'member' | 'viewer'}[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Filter dialog state
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [roleFilters, setRoleFilters] = useState<Role[]>([])
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Get Convex organization by WorkOS ID
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Convex queries for members and invitations
  const members = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  const pendingInvites = useQuery(
    api.invitations.listForOrganization,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  // Seat limit status
  const seatStatus = useQuery(
    api.organizations.getSeatStatus,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip'
  )

  // Current user's role in the organization
  const currentUserRole = currentOrganization?.role as Role | undefined
  const hasInvitePermission = hasPermission(currentUserRole, 'members:invite')
  const canInvite = hasInvitePermission && (seatStatus?.allowed ?? true)
  const canRemove = hasPermission(currentUserRole, 'members:remove')
  const canUpdateRole = hasPermission(currentUserRole, 'members:update_role')
  const canRevokeInvite = hasPermission(currentUserRole, 'invitations:revoke')

  // Convex mutations
  const createInvitation = useMutation(api.invitations.create)
  const revokeInvitationMutation = useMutation(api.invitations.revoke)
  const removeMemberMutation = useMutation(api.organizations.removeMember)
  const updateMemberRoleMutation = useMutation(api.organizations.updateMemberRole)

  const isLoading = members === undefined || pendingInvites === undefined

  // Combine members and invites into unified table rows
  const tableRows: TableRowData[] = [
    ...(members ?? []).map((m): TableRowData => ({
      id: m._id,
      type: 'member',
      email: m.user?.email || '',
      name: `${m.user?.firstName || ''} ${m.user?.lastName || ''}`.trim() || m.user?.email?.split('@')[0] || 'Unknown',
      role: m.role || 'member',
      status: 'active',
      date: m.joinedAt,
      avatarUrl: m.user?.profileImageUrl || undefined,
      workosMembershipId: m.workosId,
    })),
    ...(pendingInvites ?? []).map((i): TableRowData => ({
      id: i._id,
      type: 'invite',
      email: i.email,
      name: i.email.split('@')[0],
      role: i.role,
      status: 'pending',
      date: i.createdAt,
      workosInvitationId: i.workosInvitationId,
    })),
  ]

  // Calculate counts for tabs
  const activeCount = tableRows.filter(r => r.status === 'active').length
  const pendingCount = tableRows.filter(r => r.status === 'pending').length

  // Filter by tab
  const tabFilteredRows = tableRows.filter((row) => {
    if (filterTab === 'all') return true
    return row.status === filterTab
  })

  // Filter by role
  const roleFilteredRows = tabFilteredRows.filter((row) => {
    if (roleFilters.length === 0) return true
    return roleFilters.includes(row.role as Role)
  })

  // Filter by search
  const searchFilteredRows = roleFilteredRows.filter((row) =>
    row.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    row.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Sort rows
  const filteredRows = [...searchFilteredRows].sort((a, b) => {
    let comparison = 0
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'role':
        comparison = a.role.localeCompare(b.role)
        break
      case 'date':
        comparison = a.date - b.date
        break
    }
    return sortDirection === 'asc' ? comparison : -comparison
  })

  // Calculate active filter count for badge
  const activeFilterCount = roleFilters.length + (sortField !== 'date' || sortDirection !== 'desc' ? 1 : 0)

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

  const toggleRoleFilter = (role: Role) => {
    setRoleFilters(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    )
    setCurrentPage(1)
  }

  const resetFilters = () => {
    setRoleFilters([])
    setSortField('date')
    setSortDirection('desc')
    setCurrentPage(1)
  }

  const hasActiveFilters = roleFilters.length > 0 || sortField !== 'date' || sortDirection !== 'desc'

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

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Teams' }, { label: 'Members' }]}
    >
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Members</h1>
            {seatStatus && (
              <p className="text-sm text-muted-foreground mt-1">
                {seatStatus.limit > 0
                  ? `${seatStatus.current} / ${seatStatus.limit} seats used`
                  : `${seatStatus.current} members`
                }
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash className="mr-2 h-4 w-4" />
                Delete ({selected.length})
              </Button>
            )}
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" disabled={!canInvite}>
                  <UserPlus className="h-4 w-4" />
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
                    <div className="max-h-64 overflow-y-auto py-2 space-y-1">
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
        </div>

        {/* Seat limit warnings */}
        {seatStatus && seatStatus.limit > 0 && (
          <>
            {seatStatus.overLimit ? (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Over seat limit</AlertTitle>
                <AlertDescription>
                  You have {seatStatus.current} members but your plan allows {seatStatus.limit}.
                  Remove {seatStatus.current - seatStatus.limit} member(s) or{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-destructive underline"
                    onClick={() => navigate('/workspace/billing')}
                  >
                    upgrade your plan
                  </Button>{' '}
                  to invite more.
                </AlertDescription>
              </Alert>
            ) : seatStatus.current >= seatStatus.limit ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Seat limit reached</AlertTitle>
                <AlertDescription>
                  You've used all {seatStatus.limit} seats on your plan.{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-destructive underline"
                    onClick={() => navigate('/workspace/billing')}
                  >
                    Upgrade to add more members
                  </Button>
                </AlertDescription>
              </Alert>
            ) : seatStatus.current >= seatStatus.limit - 1 ? (
              <Alert className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>1 seat remaining</AlertTitle>
                <AlertDescription>
                  {seatStatus.current}/{seatStatus.limit} seats used. You can invite one more member.
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        )}

        {/* Filter tabs and search row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
            <button
              onClick={() => { setFilterTab('all'); setCurrentPage(1) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filterTab === 'all'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => { setFilterTab('active'); setCurrentPage(1) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filterTab === 'active'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => { setFilterTab('pending'); setCurrentPage(1) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                filterTab === 'pending'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pending ({pendingCount})
            </button>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
                className="pl-10"
              />
            </div>
            <Dialog open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <SlidersHorizontal className="h-4 w-4" />
                  {hasActiveFilters && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Filter & Sort</DialogTitle>
                  <DialogDescription>
                    Filter members by role and customize sorting
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* Role Filter */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Filter by Role</Label>
                    <div className="flex flex-wrap gap-2">
                      {(['admin', 'member', 'viewer'] as Role[]).map((role) => (
                        <button
                          key={role}
                          onClick={() => toggleRoleFilter(role)}
                          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                            roleFilters.includes(role)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-border'
                          }`}
                        >
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sort Options */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Sort by</Label>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { value: 'name', label: 'Name' },
                        { value: 'role', label: 'Role' },
                        { value: 'date', label: 'Date Joined' },
                      ] as { value: SortField; label: string }[]).map((option) => (
                        <button
                          key={option.value}
                          onClick={() => { setSortField(option.value); setCurrentPage(1) }}
                          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                            sortField === option.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-border'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sort Direction */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Sort Direction</Label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setSortDirection('asc'); setCurrentPage(1) }}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          sortDirection === 'asc'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-border'
                        }`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        Ascending
                      </button>
                      <button
                        onClick={() => { setSortDirection('desc'); setCurrentPage(1) }}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          sortDirection === 'desc'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-border'
                        }`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        Descending
                      </button>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    disabled={!hasActiveFilters}
                    className="text-muted-foreground"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                  <Button onClick={() => setIsFilterOpen(false)}>
                    Apply
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : paginatedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium">No members found</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'Try a different search term' : 'Invite members to get started'}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selected.length === paginatedRows.length && paginatedRows.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Member Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((row) => (
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
                              {row.email === user?.email && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                  you
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">{row.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {row.role.charAt(0).toUpperCase() + row.role.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              row.status === 'active' ? 'bg-green-500' : 'bg-amber-500'
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
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium">{startIndex + 1}-{Math.min(endIndex, filteredRows.length)}</span> of <span className="font-medium">{filteredRows.length}</span> entries
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {getPageNumbers().map((page, i) => (
                  typeof page === 'number' ? (
                    <Button
                      key={i}
                      variant={currentPage === page ? 'default' : 'outline'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  ) : (
                    <span key={i} className="px-2 text-muted-foreground">...</span>
                  )
                ))}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
