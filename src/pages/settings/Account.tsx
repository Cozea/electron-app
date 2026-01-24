import { useState, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
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
  Shield,
  Key,
  Smartphone,
  Monitor,
  Mail,
  Bell,
  AlertTriangle,
  Trash2,
  Loader2,
  Upload,
} from 'lucide-react'

interface NotificationPrefs {
  emailNotifications: boolean
  pushNotifications: boolean
}

export function Account() {
  const { user, convexUserId, logout } = useAuth()

  // Fetch extended profile from Convex
  const profile = useQuery(
    api.users.getById,
    convexUserId ? { userId: convexUserId } : 'skip'
  )

  // Mutations
  const updatePreferencesMutation = useMutation(api.users.updatePreferences)

  // Notification preferences state
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>({
    emailNotifications: true,
    pushNotifications: true,
  })

  // Initialize notification prefs from Convex profile
  useEffect(() => {
    if (profile) {
      setNotificationPrefs({
        emailNotifications: profile.preferences?.emailNotifications ?? true,
        pushNotifications: profile.preferences?.pushNotifications ?? true,
      })
    }
  }, [profile])

  // Derived state
  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ''}`.trim()
    : user?.email?.split('@')[0] || 'User'

  // Handlers
  const handleNotificationToggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!convexUserId) return

    const newPrefs = { ...notificationPrefs, [key]: value }
    setNotificationPrefs(newPrefs)

    try {
      await updatePreferencesMutation({
        userId: convexUserId,
        preferences: { [key]: value },
      })
    } catch (error) {
      // Revert on error
      setNotificationPrefs(notificationPrefs)
      console.error('Failed to update notification preference:', error)
    }
  }

  // Loading state
  if (profile === undefined) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Account' }]}
      >
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Account' }]}
    >
      <div className="max-w-2xl space-y-8 px-6 pt-6">
        {/* Profile Summary */}
        <div>
          <h3 className="text-base font-medium mb-1">Profile</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Manage your profile on the web dashboard
          </p>
          <div className="flex items-center gap-4 p-4 border rounded-lg">
            <div className="group relative h-16 w-16 cursor-pointer shrink-0">
              <Avatar className="h-16 w-16">
                <AvatarImage src={profile?.profileImageUrl || ''} />
                <AvatarFallback className="text-xl">
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

        {/* Security */}
        <div>
          <h3 className="text-base font-medium mb-1 flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </h3>
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Key className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Password</p>
                  <p className="text-sm text-muted-foreground">
                    Managed via your identity provider
                  </p>
                </div>
              </div>
              <Button variant="outline" disabled>Change Password</Button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Two-Factor Authentication</p>
                  <p className="text-sm text-muted-foreground">
                    Add an extra layer of security
                  </p>
                </div>
              </div>
              <Button variant="outline" disabled>Enable</Button>
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
            <div className="flex items-center justify-between p-3 border rounded-lg">
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
                checked={notificationPrefs.emailNotifications}
                onCheckedChange={(checked) => handleNotificationToggle('emailNotifications', checked)}
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
                checked={notificationPrefs.pushNotifications}
                onCheckedChange={(checked) => handleNotificationToggle('pushNotifications', checked)}
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
            <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
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
    </DashboardLayout>
  )
}
