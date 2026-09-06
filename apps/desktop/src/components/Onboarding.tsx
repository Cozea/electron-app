import { useRef, useState } from 'react'
import { useAction, useMutation } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/Logo'
import { useAuth } from '@/contexts/AuthContext'
import { optimizeProjectDevAppLogo } from '@/features/devapps/projectDevAppLogo'

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'D'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'D'
}

export function Onboarding() {
  const { isConvexAuthReady, refreshToken } = useAuth()
  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation)
  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [deviceName, setDeviceName] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [processingAvatar, setProcessingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedDeviceName = deviceName.trim()

  const chooseAvatar = async (file: File | null) => {
    if (!file || processingAvatar) return
    setProcessingAvatar(true)
    setError(null)
    try {
      setAvatarPreview(await optimizeProjectDevAppLogo(file))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare this image.')
    } finally {
      setProcessingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const save = async () => {
    if (!isConvexAuthReady || !normalizedDeviceName || saving || processingAvatar) return
    setSaving(true)
    setError(null)
    try {
      await updateDevicePresentation({ displayName: normalizedDeviceName })
      if (avatarPreview) {
        const bytes = await fetch(avatarPreview).then((response) => response.arrayBuffer())
        await uploadAvatar({ bytes })
      }

      const status = await refreshToken()
      if (status !== 'refreshed') {
        throw new Error('The device was configured, but Cozea could not refresh its local session.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not configure this device.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={44} />
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Name this device</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This name and avatar identify this physical Cozea device when you collaborate. They are not an account and do not affect its cryptographic identity.
            </p>
          </div>
        </div>

        <div className="space-y-5 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-14 shrink-0 rounded-xl">
              {avatarPreview ? <AvatarImage src={avatarPreview} alt={normalizedDeviceName || 'This device'} /> : null}
              <AvatarFallback className="rounded-xl text-sm font-medium">
                {initials(normalizedDeviceName || 'Device')}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="onboarding-device-name" className="text-xs">Device name</Label>
              <Input
                id="onboarding-device-name"
                autoFocus
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={80}
                placeholder="Kelyan's MacBook"
                disabled={saving}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={avatarInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(event) => void chooseAvatar(event.currentTarget.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={saving || processingAvatar}
              onClick={() => avatarInputRef.current?.click()}
            >
              {processingAvatar ? 'Preparing…' : avatarPreview ? 'Change avatar' : 'Add avatar'}
            </Button>
            {avatarPreview ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={saving || processingAvatar}
                onClick={() => setAvatarPreview(null)}
              >
                Remove
              </Button>
            ) : null}
          </div>

          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>

        <Button
          size="lg"
          className="w-full"
          disabled={!isConvexAuthReady || !normalizedDeviceName || saving || processingAvatar}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : isConvexAuthReady ? 'Continue' : 'Preparing device…'}
        </Button>

        <p className="px-4 text-center text-xs leading-relaxed text-muted-foreground">
          You can change the name or avatar later without changing this device's memberships, encryption keys, or public device ID.
        </p>
      </div>
    </div>
  )
}
