import { useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Camera01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'

import { api } from '../../../../convex/_generated/api'
import { Avatar } from '@/components/ui/avatar'
import { AvatarUploader } from '@/components/ui/avatar-uploader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { optimizeProjectDevAppLogo } from '@/features/devapps/projectDevAppLogo'
import { cn } from '@/lib/utils'

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'D'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'D'
}

const GRADIENT_PALETTE: Array<'blue' | 'purple' | 'coral'> = ['blue', 'purple', 'coral']

function getAvatarGradient(name: string): 'blue' | 'purple' | 'coral' {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return GRADIENT_PALETTE[Math.abs(hash) % GRADIENT_PALETTE.length] ?? 'purple'
}

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 32 : -32,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -32 : 32,
    opacity: 0,
  }),
}

export function Onboarding() {
  const { isConvexAuthReady, refreshToken } = useAuth()
  const updateDevicePresentation = useMutation(api.devicePrincipals.updateDevicePresentation)
  const uploadAvatar = useAction(api.devicePrincipals.uploadAvatar)

  const [step, setStep] = useState<'name' | 'avatar'>('name')
  const [direction, setDirection] = useState<1 | -1>(1)
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
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (step === 'avatar' && !saving && !processingAvatar) {
                setError(null)
                setDirection(-1)
                setStep('name')
              }
            }}
            className={cn(
              'flex items-center gap-2 text-xs transition-colors',
              step === 'name' ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground cursor-pointer'
            )}
            disabled={step === 'name' || saving || processingAvatar}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                step === 'name'
                  ? 'border-2 border-foreground text-foreground'
                  : 'border border-muted-foreground/50 text-muted-foreground'
              )}
            >
              1
            </span>
            <span>Device</span>
          </button>

          <div className="h-px w-8 bg-border" />

          <div
            className={cn(
              'flex items-center gap-2 text-xs transition-colors',
              step === 'avatar' ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground/60'
            )}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                step === 'avatar'
                  ? 'border-2 border-foreground text-foreground'
                  : 'border border-muted-foreground/40 text-muted-foreground/60'
              )}
            >
              2
            </span>
            <span>Avatar</span>
          </div>
        </div>

        <div className="relative h-[280px] w-full overflow-hidden">
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            {step === 'name' ? (
              <motion.form
                key="name"
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (normalizedDeviceName) {
                    setError(null)
                    setDirection(1)
                    setStep('avatar')
                  }
                }}
                className="flex h-full w-full flex-col justify-between"
              >
                <div className="space-y-1 text-left">
                  <h1 className="text-xl font-semibold tracking-tight">Name this device</h1>
                  <p className="text-sm text-muted-foreground">
                    Choose how this device appears when collaborating.
                  </p>
                </div>

                <div className="my-auto">
                  <Input
                    id="onboarding-device-name"
                    autoFocus
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                    maxLength={80}
                    placeholder="Device name"
                    aria-label="Device name"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  {error ? <p className="text-xs text-destructive text-center" role="alert">{error}</p> : null}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full h-10 font-medium cursor-pointer"
                    disabled={!normalizedDeviceName}
                  >
                    Continue
                  </Button>
                </div>
              </motion.form>
            ) : (
            <motion.form
              key="avatar"
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
              className="flex h-full w-full flex-col justify-between"
            >
              <div className="space-y-1 text-left">
                <div className="flex items-center gap-1.5 -ml-1">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setDirection(-1)
                      setStep('name')
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted cursor-pointer"
                    disabled={saving || processingAvatar}
                    aria-label="Back to device name"
                    title="Back"
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                  </button>
                  <h1 className="text-xl font-semibold tracking-tight">Add an avatar</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  Personalize this device, or skip to use your initials.
                </p>
              </div>

              <div className="my-auto flex flex-col items-center gap-2.5">
                <div className="relative group">
                  <AvatarUploader onUpload={chooseAvatar}>
                    <button
                      type="button"
                      className="relative size-24 rounded-3xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all active:scale-95 cursor-pointer shadow-xs"
                      disabled={saving || processingAvatar}
                      aria-label={avatarPreview ? 'Change photo' : 'Upload photo'}
                      title={avatarPreview ? 'Change photo' : 'Upload photo'}
                    >
                      <Avatar
                        variant="gradient"
                        color={getAvatarGradient(normalizedDeviceName || 'Device')}
                        className="size-full rounded-3xl"
                      >
                        {avatarPreview ? (
                          <Avatar.Image
                            src={avatarPreview}
                            alt={normalizedDeviceName || 'This device'}
                          />
                        ) : null}
                        <Avatar.Fallback className="text-2xl font-bold text-white drop-shadow-sm">
                          {initials(normalizedDeviceName || 'Device')}
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white rounded-3xl">
                        <HugeiconsIcon icon={Camera01Icon} className="size-6" />
                      </div>
                    </button>
                  </AvatarUploader>
                  {avatarPreview ? (
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground shadow-xs transition-colors cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation()
                        setAvatarPreview(null)
                      }}
                      title="Remove photo"
                      aria-label="Remove photo"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
                    </button>
                  ) : (
                    <div className="pointer-events-none absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border border-background bg-secondary text-secondary-foreground shadow-xs group-hover:scale-105 transition-transform">
                      <HugeiconsIcon icon={Camera01Icon} className="size-3.5" />
                    </div>
                  )}
                </div>

                <AvatarUploader onUpload={chooseAvatar}>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    disabled={saving || processingAvatar}
                  >
                    {processingAvatar ? 'Preparing…' : avatarPreview ? 'Change photo' : 'Upload photo'}
                  </button>
                </AvatarUploader>
              </div>

                <div className="space-y-2">
                  {error ? <p className="text-xs text-destructive text-center" role="alert">{error}</p> : null}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full h-10 font-medium cursor-pointer"
                    disabled={!isConvexAuthReady || saving || processingAvatar}
                  >
                    {saving ? 'Saving…' : isConvexAuthReady ? (avatarPreview ? 'Continue' : 'Skip for now') : 'Preparing device…'}
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          You can change this anytime in Settings.
        </p>
      </div>
    </div>
  )
}
