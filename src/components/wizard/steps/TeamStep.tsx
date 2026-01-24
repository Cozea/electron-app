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
import { Users, X, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { WizardTeamMember, ProjectRole } from '@/hooks/useWizardState'

interface TeamStepProps {
  team: WizardTeamMember[]
  currentUserEmail: string
  onAddMember: (member: WizardTeamMember) => void
  onRemoveMember: (email: string) => void
}

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  project_manager: 'Full access, can manage team',
  developer: 'Can edit code, create branches',
  designer: 'Can edit assets, view code',
  viewer: 'Read-only access',
}

export function TeamStep({ team, currentUserEmail, onAddMember, onRemoveMember }: TeamStepProps) {
  const [newMember, setNewMember] = useState({
    name: '',
    email: '',
    role: 'developer' as ProjectRole,
  })

  const hasPM = team.some((m) => m.role === 'project_manager')

  const handleAdd = () => {
    if (!newMember.email) return
    if (team.some((m) => m.email.toLowerCase() === newMember.email.toLowerCase())) {
      return // Already exists
    }
    onAddMember({
      email: newMember.email,
      name: newMember.name,
      role: newMember.role,
    })
    setNewMember({ name: '', email: '', role: 'developer' })
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Team & Roles</h2>
        <p className="text-muted-foreground">
          Invite team members to collaborate on this project
        </p>
      </div>

      <div className="space-y-6 max-w-xl mx-auto">
        {/* Warning if no PM */}
        {!hasPM && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              At least one Project Manager is required
            </AlertDescription>
          </Alert>
        )}

        {/* Current team members */}
        {team.length > 0 ? (
          <div className="space-y-2">
            <Label>Team Members</Label>
            <div className="border rounded-lg divide-y">
              {team.map((member) => (
                <div key={member.email} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-medium text-primary">
                        {(member.name || member.email).slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {member.name || member.email}
                        {member.isCurrentUser && (
                          <span className="text-muted-foreground ml-1">(you)</span>
                        )}
                      </p>
                      {member.name && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {member.role.replace('_', ' ')}
                    </Badge>
                    {!member.isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onRemoveMember(member.email)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No team members added yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              You&apos;ll be added as Project Manager
            </p>
          </div>
        )}

        {/* Add member form */}
        <div className="space-y-3">
          <Label>Invite by email</Label>
          <div className="flex gap-2">
            <Input
              placeholder="colleague@example.com"
              value={newMember.email}
              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              className="flex-1"
              type="email"
            />
            <Select
              value={newMember.role}
              onValueChange={(value) => setNewMember({ ...newMember, role: value as ProjectRole })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project_manager">Project Manager</SelectItem>
                <SelectItem value="developer">Developer</SelectItem>
                <SelectItem value="designer">Designer</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleAdd} disabled={!newMember.email}>
              Add
            </Button>
          </div>
        </div>

        {/* Role descriptions */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Available Roles:</p>
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <p key={role} className="text-xs text-muted-foreground">
              <span className="font-medium capitalize">{role.replace('_', ' ')}</span> — {description}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
