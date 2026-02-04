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
import { Users, X, AlertCircle, UserPlus, ChevronDown, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WizardTeamMember, ProjectRole } from '@/hooks/useWizardState'
import { motion } from 'framer-motion'

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
}: TeamStepProps) {
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('developer')

  // Invite flow state (like Members page)
  const [inviteMembers, setInviteMembers] = useState<{ email: string; role: ProjectRole }[]>([])
  const [emailInput, setEmailInput] = useState('')

  const hasPM = team.some((m) => m.role === 'project_manager')

  // Filter out members already in the team
  const availableOrgMembers = organizationMembers.filter(
    (orgMember) => !team.some((t) => t.email.toLowerCase() === orgMember.email.toLowerCase())
  )

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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >


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
            <div className="rounded-xl divide-y bg-card overflow-hidden">
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
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 py-0 font-normal">You</Badge>
                        )}
                      </p>
                      {member.name && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="font-normal capitalize">
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
        {availableOrgMembers.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
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
            <div className="rounded-xl divide-y bg-card overflow-hidden max-h-48 overflow-y-auto">
              {availableOrgMembers.map((orgMember) => {
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
          </div>
        )}

        {/* Invite by Email Form */}
        <div className="bg-muted/30 p-6 rounded-xl space-y-4">
          <Label className="text-base font-medium">
            {availableOrgMembers.length > 0 ? 'Or Invite by Email' : 'Invite New Member'}
          </Label>

          {/* Email input */}
          <Input
            type="email"
            placeholder="Enter email addresses (press Enter to add)"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={handleAddEmail}
          />

          {/* Pending invites list */}
          {inviteMembers.length > 0 && (
            <div className="border rounded-lg divide-y bg-card overflow-hidden">
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

          {/* Footer with count and add button */}
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
    </motion.div>
  )
}
