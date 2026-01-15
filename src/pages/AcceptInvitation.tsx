import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Building2, Check, X, Loader2, UserCircle, AlertCircle } from 'lucide-react'

type Step = 'loading' | 'profile' | 'confirm' | 'success' | 'error'

export function AcceptInvitation() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()

  const [step, setStep] = useState<Step>('loading')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch invitation details
  const invitation = useQuery(
    api.invitations.getByToken,
    token ? { token } : 'skip'
  )

  // Get current user from Convex
  const convexUser = useQuery(
    api.users.getByEmail,
    user?.email ? { email: user.email } : 'skip'
  )

  // Mutations
  const acceptInvitation = useMutation(api.invitations.accept)
  const updateUserProfile = useMutation(api.users.updateProfile)

  // Determine step based on state
  useEffect(() => {
    if (authLoading || invitation === undefined) {
      setStep('loading')
      return
    }

    if (!invitation) {
      setError('Invitation not found or has expired')
      setStep('error')
      return
    }

    if (invitation.status !== 'pending') {
      setError(
        invitation.status === 'accepted'
          ? 'This invitation has already been accepted'
          : 'This invitation has expired'
      )
      setStep('error')
      return
    }

    if (invitation.expiresAt < Date.now()) {
      setError('This invitation has expired')
      setStep('error')
      return
    }

    if (!isAuthenticated) {
      // User needs to log in first - redirect to login with return URL
      // For now, show error - the Login page should handle invitation context
      setError('Please log in to accept this invitation')
      setStep('error')
      return
    }

    // Check if user email matches invitation email
    if (user?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      setError(`This invitation was sent to ${invitation.email}. Please log in with that email address.`)
      setStep('error')
      return
    }

    // Check if profile needs completion
    if (!user?.firstName || !user?.lastName) {
      setFirstName(user?.firstName || '')
      setLastName(user?.lastName || '')
      setStep('profile')
      return
    }

    setStep('confirm')
  }, [authLoading, invitation, isAuthenticated, user])

  const handleProfileSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) return

    setIsSubmitting(true)
    try {
      if (convexUser?._id) {
        await updateUserProfile({
          userId: convexUser._id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        })
      }
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAccept = async () => {
    if (!token || !convexUser?._id) return

    setIsSubmitting(true)
    setError(null)

    try {
      await acceptInvitation({
        token,
        userId: convexUser._id,
      })
      setStep('success')

      // Redirect to dashboard after a short delay
      setTimeout(() => {
        navigate('/')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
      setStep('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDecline = () => {
    // Just navigate away - invitation remains pending
    navigate('/')
  }

  // Loading state
  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Unable to Accept Invitation</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')} className="w-full">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Profile completion step
  if (step === 'profile') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <UserCircle className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Complete Your Profile</CardTitle>
            <CardDescription>
              Please provide your name before joining {invitation?.organization?.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              onClick={handleProfileSubmit}
              className="w-full"
              disabled={!firstName.trim() || !lastName.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Confirmation step
  if (step === 'confirm') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>You've been invited!</CardTitle>
            <CardDescription>
              You've been invited to join a workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Workspace info */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {invitation?.organization?.name?.charAt(0).toUpperCase() || 'W'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">{invitation?.organization?.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    You'll join as <span className="font-medium capitalize">{invitation?.role}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* User info */}
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={user?.profileImageUrl || undefined} />
                <AvatarFallback>
                  {user?.firstName?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-sm">
                <p className="font-medium">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-muted-foreground">{user?.email}</p>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleDecline}
                className="flex-1"
                disabled={isSubmitting}
              >
                <X className="mr-2 h-4 w-4" />
                Decline
              </Button>
              <Button
                onClick={handleAccept}
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Accept & Join
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Success step
  if (step === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Welcome to {invitation?.organization?.name}!</CardTitle>
            <CardDescription>
              You've successfully joined the workspace. Redirecting you to the dashboard...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}
