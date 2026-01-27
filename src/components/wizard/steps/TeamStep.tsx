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
import { Users, X, AlertCircle, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { WizardTeamMember, ProjectRole } from '@/hooks/useWizardState'
import { motion } from 'framer-motion'

interface TeamStepProps {
  team: WizardTeamMember[]
  onAddMember: (member: WizardTeamMember) => void
  onRemoveMember: (email: string) => void
}

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  project_manager: 'Full access, can manage team',
  developer: 'Can edit code, create branches',
  designer: 'Can edit assets, view code',
  viewer: 'Read-only access',
}

export function TeamStep({ team, onAddMember, onRemoveMember }: TeamStepProps) {
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
            <div className="border rounded-xl divide-y bg-card overflow-hidden">
              {team.map((member) => (
                <div key={member.email} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {(member.name || member.email).slice(0, 2).toUpperCase()}
                      </span>
                    </div>
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
              ))}
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

        {/* Add Member Form */}
        <div className="bg-muted/30 p-6 rounded-xl space-y-4">
          <Label className="text-base font-medium">Invite New Member</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Name (Optional)"
              value={newMember.name}
              onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
            />
            <Input
              placeholder="colleague@example.com"
              value={newMember.email}
              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              type="email"
            />
          </div>
          <div className="flex gap-3 justify-end">
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
            <Button onClick={handleAdd} disabled={!newMember.email} className="gap-2">
              <Plus className="h-4 w-4" />
              Add
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
