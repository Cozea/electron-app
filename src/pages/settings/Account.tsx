import { useEffect, useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { SettingsRouteShell } from '@/components/settings/SettingsRouteShell'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { Badge } from '../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import {
  Monitor,
  Mail,
  Bell,
  AlertTriangle,
  Trash2,
  Upload,
} from 'lucide-react'

interface UserPrefs {
  emailNotifications: boolean
  pushNotifications: boolean
}

interface AccountProps {
  surface?: 'page' | 'drawer'
  route?: string
}

export function Account({ surface = 'page', route }: AccountProps) {
  const { user, convexUserId } = useAuth()

  // Fetch extended profile from Convex
  const profile = useQuery(
    api.users.getById,
    convexUserId ? { userId: convexUserId } : 'skip'
  )

  // Mutations
  const updatePreferencesMutation = useMutation(api.users.updatePreferences)

  // User preferences state
  const [userPrefs, setUserPrefs] = useState<UserPrefs>({
    emailNotifications: true,
    pushNotifications: true,
  })

  useEffect(() => {
    if (!profile) return

    setUserPrefs({
      emailNotifications: profile.preferences?.emailNotifications ?? true,
      pushNotifications: profile.preferences?.pushNotifications ?? true,
    })
  }, [profile])

  // Derived state
  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ''}`.trim()
    : user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : user?.email?.split('@')[0] || 'User'
  const avatarImageUrl = profile?.profileImageUrl || user?.profileImageUrl || undefined

  // Handlers
  const handlePrefChange = async (key: keyof UserPrefs, value: boolean | string) => {
    if (!convexUserId) return

    const newPrefs = { ...userPrefs, [key]: value }
    setUserPrefs(newPrefs)

    try {
      await updatePreferencesMutation({
        userId: convexUserId,
        preferences: { [key]: value },
      })
    } catch (error) {
      // Revert on error
      setUserPrefs(userPrefs)
      console.error(`Failed to update preference ${key}:`, error)
    }
  }

  const isProfileLoading = profile === undefined

  const content = (
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-4xl space-y-8 px-6 py-6'
          : 'max-w-2xl space-y-8 px-6 pt-6'
      }
    >
        {/* Profile Summary */}
        <div>
          <div className="flex items-center gap-4 p-4 rounded-lg">
            <div className="group relative h-16 w-16 cursor-pointer shrink-0">
              <Avatar className="h-16 w-16">
                <AvatarImage src={avatarImageUrl} alt={displayName} />
                <AvatarFallback delayMs={150} className="text-xl">
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-x-0 bottom-0 h-6 bg-black/60 rounded-b-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload className="h-3 w-3 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-lg truncate">{displayName}</p>
              {profile?.jobTitle && (
                <p className="text-sm text-muted-foreground truncate">{profile.jobTitle}</p>
              )}
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Active Sessions - Placeholder */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-medium">Active Sessions</h3>
            <Button variant="outline" size="sm" disabled>
              Sign out all other devices
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Devices currently signed in to your account
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg">
              <div className="flex items-center gap-3">
                <Monitor className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">Current Device</p>
                    <Badge variant="secondary" className="text-xs">
                      Current
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Active now
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div>
          <h3 className="text-base font-medium mb-1 flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </h3>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Email Notifications</p>
                  <p className="text-sm text-muted-foreground">
                    Receive updates via email
                  </p>
                </div>
              </div>
              <Switch
                checked={userPrefs.emailNotifications}
                onCheckedChange={(checked) => handlePrefChange('emailNotifications', checked)}
                disabled={isProfileLoading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Push Notifications</p>
                  <p className="text-sm text-muted-foreground">
                    Receive in-app notifications
                  </p>
                </div>
              </div>
              <Switch
                checked={userPrefs.pushNotifications}
                onCheckedChange={(checked) => handlePrefChange('pushNotifications', checked)}
                disabled={isProfileLoading}
              />
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div>
          <h3 className="text-base font-medium mb-1 flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone
          </h3>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between p-5 rounded-2xl bg-destructive/5">
              <div>
                <h4 className="font-medium">Delete Account</h4>
                <p className="text-sm text-muted-foreground">
                  Permanently delete your account and all data
                </p>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="gap-2" disabled>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Account</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. All your data will be permanently deleted.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Type "delete my account" to confirm</Label>
                      <Input placeholder="delete my account" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Delete Account</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>
  )

  if (surface === 'drawer') {
    return content
  }

  return (
    <SettingsRouteShell surfaceId="account" route={route}>
      {content}
    </SettingsRouteShell>
  )
}
