import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Users, X, AlertCircle, UserPlus, ChevronDown, Trash2, ArrowRight, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WizardTeamMember, ProjectRole } from '@/hooks/useWizardState'

export interface OrgMember {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profileImageUrl?: string | null
  role?: string
}

interface TeamStepProps {
  team: WizardTeamMember[]
  onAddMember: (member: WizardTeamMember) => void
  onRemoveMember: (email: string) => void
  organizationMembers?: OrgMember[]
  currentUserEmail?: string
  allowEmailInvites?: boolean
  onContinue?: () => void
  canContinue?: boolean
}

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  project_manager: 'Full access, can manage team',
  developer: 'Can edit code, create branches',
  designer: 'Can edit assets, view code',
  viewer: 'Read-only access',
}

export function TeamStep({
  team,
  onAddMember,
  onRemoveMember,
  organizationMembers = [],
  currentUserEmail,
  allowEmailInvites = true,
  onContinue,
  canContinue = true,
}: TeamStepProps) {
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('developer')

  // Invite flow state (like Members page)
  const [inviteMembers, setInviteMembers] = useState<{ email: string; role: ProjectRole }[]>([])
  const [emailInput, setEmailInput] = useState('')
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  const hasPM = team.some((m) => m.role === 'project_manager')

  // Filter out members already in the team and match search query
  const availableOrgMembers = organizationMembers.filter(
    (orgMember) => {
      if (team.some((t) => t.email.toLowerCase() === orgMember.email.toLowerCase())) {
        return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const nameMatch = `${orgMember.firstName || ''} ${orgMember.lastName || ''}`.toLowerCase().includes(q)
        const emailMatch = orgMember.email.toLowerCase().includes(q)
        return nameMatch || emailMatch
      }
      return true
    }
  )

  // Pagination logic
  const pageSize = 5
  const totalPages = Math.ceil(availableOrgMembers.length / pageSize)
  const validCurrentPage = Math.min(Math.max(1, currentPage), Math.max(1, totalPages))
  const startIndex = (validCurrentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedMembers = availableOrgMembers.slice(startIndex, endIndex)

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (validCurrentPage <= 3) {
        pages.push(1, 2, 3, '...', totalPages)
      } else if (validCurrentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
      } else {
        pages.push(1, '...', validCurrentPage - 1, validCurrentPage, validCurrentPage + 1, '...', totalPages)
      }
    }
    return pages
  }

  const handleAddOrgMember = (orgMember: OrgMember, role: ProjectRole) => {
    const name = `${orgMember.firstName || ''} ${orgMember.lastName || ''}`.trim()
    onAddMember({
      email: orgMember.email,
      name: name || undefined,
      role,
      isCurrentUser: orgMember.email === currentUserEmail,
      profileImageUrl: orgMember.profileImageUrl,
    })
  }

  // Handle typing email and pressing Enter/comma
  const handleAddEmail = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && emailInput.trim()) {
      e.preventDefault()
      const email = emailInput.trim().replace(',', '')
      // Check if valid email and not already in invite list or team
      if (
        email &&
        email.includes('@') &&
        !inviteMembers.some((m) => m.email.toLowerCase() === email.toLowerCase()) &&
        !team.some((m) => m.email.toLowerCase() === email.toLowerCase())
      ) {
        setInviteMembers([...inviteMembers, { email, role: 'developer' }])
        setEmailInput('')
      }
    }
  }

  const handleRemoveFromInviteList = (index: number) => {
    setInviteMembers(inviteMembers.filter((_, i) => i !== index))
  }

  const handleUpdateInviteRole = (index: number, role: ProjectRole) => {
    setInviteMembers(inviteMembers.map((m, i) => (i === index ? { ...m, role } : m)))
  }

  const handleAddAllInvites = () => {
    inviteMembers.forEach((member) => {
      onAddMember({
        email: member.email,
        name: undefined,
        role: member.role,
      })
    })
    setInviteMembers([])
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="app-scrollbar flex-1 min-h-0 overflow-y-auto py-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <div className="space-y-10">
          <div className="space-y-8 max-w-2xl mx-auto">
        {/* Warning if no PM */}
        {!hasPM && (
          <Alert variant="destructive" className="border-destructive/20 bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              At least one Project Manager is required
            </AlertDescription>
          </Alert>
        )}

        {/* Team List & Empty State */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Team Members</Label>

          {team.length > 0 ? (
            <div className="rounded-xl divide-y bg-secondary/80 dark:bg-secondary/40 overflow-hidden">
              {team.map((member) => {
                const initials = member.name
                  ? member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  : (member.email).slice(0, 2).toUpperCase()
                return (
                <div key={member.email} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      {member.profileImageUrl && (
                        <AvatarImage src={member.profileImageUrl} alt={member.name || member.email} />
                      )}
                      <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        {member.name || member.email}
                        {member.isCurrentUser && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 px-1.5 py-0 font-normal border-transparent bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                          >
                            You
                          </Badge>
                        )}
                      </p>
                      {member.name && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className="font-normal capitalize border-transparent bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                    >
                      {member.role.replace('_', ' ')}
                    </Badge>
                    {!member.isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveMember(member.email)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="border-2 border-dashed rounded-xl p-10 text-center space-y-2 bg-muted/20">
              <div className="bg-muted rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No team members added yet</p>
              <p className="text-xs text-muted-foreground">
                You&apos;ll be added as Project Manager automatically
              </p>
            </div>
          )}
        </div>

        {/* Add from Organization Members */}
        {(organizationMembers.length - team.length > 0) && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Label className="text-base font-medium">Add from Workspace</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Add as:</span>
                <Select
                  value={selectedRole}
                  onValueChange={(value) => setSelectedRole(value as ProjectRole)}
                >
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project_manager">Project Manager</SelectItem>
                    <SelectItem value="developer">Developer</SelectItem>
                    <SelectItem value="designer">Designer</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search workspace members..."
                className="pl-8 bg-background dark:bg-background/80 h-8 text-sm"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </div>
            
            {availableOrgMembers.length > 0 ? (
              <>
            <div className="rounded-xl divide-y bg-secondary/80 dark:bg-secondary/40 overflow-hidden">
              {paginatedMembers.map((orgMember) => {
                const name = `${orgMember.firstName || ''} ${orgMember.lastName || ''}`.trim()
                const displayName = name || orgMember.email.split('@')[0]
                const initials = name
                  ? name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                  : orgMember.email.slice(0, 2).toUpperCase()

                return (
                  <div
                    key={orgMember.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                    onClick={() => handleAddOrgMember(orgMember, selectedRole)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={orgMember.profileImageUrl || undefined} />
                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{displayName}</p>
                        {name && (
                          <p className="text-xs text-muted-foreground">{orgMember.email}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 transition-opacity gap-1"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                )
              })}
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  Showing <span className="font-medium">{startIndex + 1}-{Math.min(endIndex, availableOrgMembers.length)}</span> of <span className="font-medium">{availableOrgMembers.length}</span> members
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={validCurrentPage === 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  {getPageNumbers().map((page, i) => (
                    typeof page === 'number' ? (
                      <Button
                        key={i}
                        variant={validCurrentPage === page ? 'default' : 'secondary'}
                        size="icon"
                        className="h-7 w-7 rounded-full text-xs"
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </Button>
                    ) : (
                      <span key={i} className="px-1 text-xs text-muted-foreground">...</span>
                    )
                  ))}
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={validCurrentPage === totalPages}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
              </>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                No workspace members match your search
              </div>
            )}
          </div>
        )}

        {allowEmailInvites ? (
          <div className="bg-secondary/80 dark:bg-secondary/40 p-6 rounded-xl space-y-4">
            <Label className="text-base font-medium">
              {availableOrgMembers.length > 0 ? 'Or Invite by Email' : 'Invite New Member'}
            </Label>

            <Input
              type="email"
              placeholder="Enter email addresses (press Enter to add)"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleAddEmail}
              className="bg-background dark:bg-background/80"
            />

            {inviteMembers.length > 0 && (
              <div className="rounded-lg divide-y bg-secondary/80 dark:bg-secondary/40 overflow-hidden">
                {inviteMembers.map((member, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2.5 px-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs">
                          {member.email.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{member.email.split('@')[0]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 h-8">
                            <span className="capitalize">{member.role.replace('_', ' ')}</span>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleUpdateInviteRole(i, 'project_manager')}>
                            Project Manager
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdateInviteRole(i, 'developer')}>
                            Developer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdateInviteRole(i, 'designer')}>
                            Designer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleUpdateInviteRole(i, 'viewer')}>
                            Viewer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromInviteList(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-muted-foreground">
                {inviteMembers.length > 0 ? (
                  <>
                    <span className="font-semibold text-foreground">{inviteMembers.length}</span> member{inviteMembers.length !== 1 ? 's' : ''} to add
                  </>
                ) : (
                  'Type an email and press Enter'
                )}
              </span>
              <Button
                onClick={handleAddAllInvites}
                disabled={inviteMembers.length === 0}
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" />
                Add to Team
              </Button>
            </div>
          </div>
        ) : (
          <Alert className="border-border/60 bg-secondary/80 dark:bg-secondary/40">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Workspace projects only allow adding existing workspace members here. Invite new people to the workspace first, then add them to the project.
            </AlertDescription>
          </Alert>
        )}

        {/* Role Helper */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <div key={role} className="flex items-start gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
              <span><span className="font-medium text-foreground capitalize">{role.replace('_', ' ')}:</span> {description}</span>
            </div>
          ))}
        </div>
      </div>
        </div>
      </div>

      <div className="flex items-center justify-end px-3 pt-1 pb-2">
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue || !onContinue}
          className="rounded-full focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
