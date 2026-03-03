import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { Building2, Loader2, UserPlus, X } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import { useOrganization } from '@/contexts/OrganizationContext'
import { useViewTransitionNavigate } from '@/lib/navigation'
import type { OrganizationMembership } from '@/types/electron'

type InviteRole = 'admin' | 'member' | 'viewer'

interface InviteCandidate {
  email: string
  role: InviteRole
}

function getDefaultWorkspaceName(email: string | undefined, firstName: string | null | undefined): string {
  if (firstName && firstName.trim().length > 0) {
    return `${firstName.trim()}'s Workspace`
  }

  const emailPrefix = email?.split('@')[0]?.trim()
  if (emailPrefix) {
    return `${emailPrefix}'s Workspace`
  }

  return 'My Workspace'
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function WorkspaceCreate() {
  const navigate = useViewTransitionNavigate()
  const { user, organizations, convexUserId, createOrganizationWorkspace } = useAuth()
  const { inviteMember } = useOrganization()
  const createInvitation = useMutation(api.invitations.create)

  const [step, setStep] = useState<'create' | 'invite'>('create')
  const [createdWorkspace, setCreatedWorkspace] = useState<OrganizationMembership | null>(null)

  const [orgName, setOrgName] = useState(() =>
    getDefaultWorkspaceName(user?.email, user?.firstName)
  )
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [emailInput, setEmailInput] = useState('')
  const [inviteMembers, setInviteMembers] = useState<InviteCandidate[]>([])
  const [isSubmittingInvites, setIsSubmittingInvites] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const canTrackInvites = Boolean(createdWorkspace?.convexOrgId && convexUserId)

  const inviteCountLabel = useMemo(() => {
    if (inviteMembers.length === 1) return '1 invite'
    return `${inviteMembers.length} invites`
  }, [inviteMembers.length])

  const handleCreateWorkspace = async () => {
    if (!orgName.trim()) return

    setIsCreating(true)
    setCreateError(null)

    try {
      const workspace = await createOrganizationWorkspace(orgName)
      setCreatedWorkspace(workspace)
      setStep('invite')
    } catch (err) {
      console.error('Failed to create workspace:', err)
      setCreateError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsCreating(false)
    }
  }

  const handleBack = () => {
    if (organizations.length > 1) {
      navigate('/workspaces/select')
      return
    }
    navigate('/projects')
  }

  const handleAddInviteEmail = (rawEmail: string) => {
    const email = normalizeEmail(rawEmail.replace(',', ''))
    if (!email || !isValidEmail(email)) return
    if (inviteMembers.some((member) => normalizeEmail(member.email) === email)) return

    setInviteMembers((current) => [...current, { email, role: 'member' }])
  }

  const handleEmailInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',') && emailInput.trim()) {
      event.preventDefault()
      handleAddInviteEmail(emailInput)
      setEmailInput('')
    }
  }

  const handleUpdateInviteRole = (index: number, role: InviteRole) => {
    setInviteMembers((current) => current.map((member, i) => (i === index ? { ...member, role } : member)))
  }

  const handleRemoveInvite = (index: number) => {
    setInviteMembers((current) => current.filter((_, i) => i !== index))
  }

  const handleSkipInvites = () => {
    navigate('/projects')
  }

  const handleSendInvites = async () => {
    if (!createdWorkspace?.organizationId) {
      navigate('/projects')
      return
    }

    if (inviteMembers.length === 0) {
      navigate('/projects')
      return
    }

    setIsSubmittingInvites(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const results = await Promise.all(
        inviteMembers.map(async (member) => {
          try {
            const workosResult = await inviteMember(createdWorkspace.organizationId, member.email, member.role)

            if (!workosResult || workosResult.error) {
              const rawError = workosResult?.error || 'Unknown error'
              const alreadyInvited = rawError.toLowerCase().includes('already invited')
              return {
                success: false,
                email: member.email,
                error: alreadyInvited ? 'already_invited' : rawError,
              }
            }

            if (canTrackInvites) {
              try {
                await createInvitation({
                  orgId: createdWorkspace.convexOrgId as Id<'organizations'>,
                  invitedBy: convexUserId as Id<'users'>,
                  email: member.email,
                  role: member.role,
                  workosInvitationId: workosResult.invitationId || undefined,
                })
              } catch (convexError) {
                console.warn(`Convex invitation tracking failed for ${member.email}:`, convexError)
              }
            }

            return { success: true, email: member.email }
          } catch (error) {
            console.error(`Failed to invite ${member.email}:`, error)
            return { success: false, email: member.email, error: 'unknown' }
          }
        })
      )

      const failed = results.filter((result) => !result.success)
      const successfulCount = results.length - failed.length

      if (successfulCount > 0) {
        setInviteSuccess(
          `Sent ${successfulCount} invitation${successfulCount === 1 ? '' : 's'} successfully.`
        )
      }

      if (failed.length > 0) {
        const alreadyInvitedEmails = failed
          .filter((result) => result.error === 'already_invited')
          .map((result) => result.email)
        const otherFailedCount = failed.length - alreadyInvitedEmails.length

        const errorMessages: string[] = []
        if (alreadyInvitedEmails.length > 0) {
          errorMessages.push(`Already invited: ${alreadyInvitedEmails.join(', ')}`)
        }
        if (otherFailedCount > 0) {
          errorMessages.push(`Failed to send ${otherFailedCount} invitation(s)`)
        }

        setInviteError(errorMessages.join('. '))
        const failedEmails = new Set(failed.map((result) => normalizeEmail(result.email)))
        setInviteMembers((current) =>
          current.filter((member) => failedEmails.has(normalizeEmail(member.email)))
        )
        return
      }

      navigate('/projects')
    } finally {
      setIsSubmittingInvites(false)
    }
  }

  if (step === 'invite') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="mx-auto w-full max-w-xl space-y-8">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <UserPlus className="size-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Invite teammates</h1>
            <p className="text-muted-foreground">
              Optional: invite people to <span className="font-medium text-foreground">{createdWorkspace?.organizationName || 'your workspace'}</span>.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email addresses</Label>
              <Input
                id="invite-email"
                placeholder="name@company.com"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                onKeyDown={handleEmailInputKeyDown}
                disabled={isSubmittingInvites}
              />
              <p className="text-xs text-muted-foreground">
                Press Enter or comma to add each email. Works for both existing Cozea users and new users.
              </p>
            </div>

            {inviteMembers.length > 0 ? (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl bg-secondary/80 p-3 dark:bg-secondary/40">
                {inviteMembers.map((member, index) => (
                  <div key={`${member.email}-${index}`} className="flex items-center gap-2 rounded-xl bg-background/80 p-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{member.email}</div>
                    <Select
                      value={member.role}
                      onValueChange={(value) => handleUpdateInviteRole(index, value as InviteRole)}
                      disabled={isSubmittingInvites}
                    >
                      <SelectTrigger className="w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                        <SelectItem value="viewer">viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveInvite(index)}
                      disabled={isSubmittingInvites}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {!canTrackInvites ? (
              <p className="text-xs text-muted-foreground">
                Invites still send via WorkOS email even while local invite tracking is unavailable.
              </p>
            ) : null}

            {inviteError ? <p className="text-sm text-destructive">{inviteError}</p> : null}
            {inviteSuccess ? <p className="text-sm text-emerald-600">{inviteSuccess}</p> : null}

            <Button
              onClick={() => void handleSendInvites()}
              className="w-full"
              size="lg"
              disabled={isSubmittingInvites}
            >
              {isSubmittingInvites ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Sending invites...
                </>
              ) : inviteMembers.length > 0 ? (
                `Send ${inviteCountLabel} and continue`
              ) : (
                'Continue to projects'
              )}
            </Button>

            <Button
              variant="ghost"
              className="w-full"
              onClick={handleSkipInvites}
              disabled={isSubmittingInvites}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create workspace</h1>
          <p className="text-muted-foreground">
            Create a shared workspace for organization collaboration.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              placeholder="My Workspace"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && orgName.trim()) {
                  void handleCreateWorkspace()
                }
              }}
              disabled={isCreating}
            />
          </div>

          {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

          <Button
            onClick={() => void handleCreateWorkspace()}
            className="w-full"
            size="lg"
            disabled={!orgName.trim() || isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create workspace'
            )}
          </Button>

          <Button
            variant="ghost"
            className="w-full"
            onClick={handleBack}
            disabled={isCreating}
          >
            Back
          </Button>
        </div>
      </div>
    </div>
  )
}
