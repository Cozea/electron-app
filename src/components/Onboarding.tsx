import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Sparkles, Building2, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import type { OrganizationMembership } from '@/types/electron'

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL || 'https://crosscode-auth-gateway-production.up.railway.app'

export function Onboarding() {
  const { user, accessToken, setOrganizations, setCurrentOrganization } = useAuth()
  const syncOrgToConvex = useMutation(api.organizations.syncFromWorkOS)
  const syncMembershipToConvex = useMutation(api.organizations.syncMembershipFromWorkOS)
  const [step, setStep] = useState<'welcome' | 'create-org'>('welcome')
  const [orgName, setOrgName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateOrg = async () => {
    if (!orgName.trim() || !accessToken) return

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/organizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: orgName.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create organization')
      }

      const data = await response.json()

      // Create membership object from response
      const newMembership: OrganizationMembership = {
        id: data.membership.id,
        organizationId: data.organization.id,
        organizationName: data.organization.name,
        role: data.membership.role,
        status: data.membership.status,
      }

      // Sync to Convex
      try {
        await syncOrgToConvex({
          workosId: data.organization.id,
          name: data.organization.name,
        })
        await syncMembershipToConvex({
          workosId: data.membership.id,
          workosOrgId: data.organization.id,
          workosUserId: user!.id,
          role: data.membership.role,
          status: data.membership.status,
        })
      } catch (syncErr) {
        console.warn('Failed to sync org to Convex:', syncErr)
        // Continue anyway - org exists in WorkOS
      }

      // Persist to local session file so it survives app restart
      await window.electronAPI.auth.updateOrganizations([newMembership])

      // Update auth context with new org
      setOrganizations([newMembership])
      setCurrentOrganization(newMembership)
    } catch (err) {
      console.error('Failed to create organization:', err)
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCreatePersonalOrg = () => {
    // Pre-fill with user's name or email
    const defaultName = user?.firstName
      ? `${user.firstName}'s Workspace`
      : `${user?.email?.split('@')[0]}'s Workspace`
    setOrgName(defaultName)
    setStep('create-org')
  }

  if (step === 'welcome') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-md space-y-8 p-8">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Sparkles className="size-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome to Cozea</h1>
            <p className="text-muted-foreground">
              Let's get you set up with your first workspace.
            </p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={handleCreatePersonalOrg}
              className="w-full justify-between"
              size="lg"
            >
              <div className="flex items-center gap-3">
                <Building2 className="size-5" />
                <span>Create a workspace</span>
              </div>
              <ArrowRight className="size-5" />
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              A workspace is where you and your team collaborate on projects.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your workspace</h1>
          <p className="text-muted-foreground">
            Give your workspace a name. You can always change this later.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Workspace name</Label>
            <Input
              id="org-name"
              placeholder="My Workspace"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && orgName.trim()) {
                  handleCreateOrg()
                }
              }}
              disabled={isCreating}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            onClick={handleCreateOrg}
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
            onClick={() => setStep('welcome')}
            disabled={isCreating}
          >
            Back
          </Button>
        </div>
      </div>
    </div>
  )
}
