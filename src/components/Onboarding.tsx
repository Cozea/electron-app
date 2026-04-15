
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'
import {

  readSourceControlProviderPreferences,
  writeSourceControlProviderPreferences,
  type SourceControlProviderPreference,
} from '@/lib/sourceControlPreferences'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon as __ArrowRightHugeIcon, Building02Icon as __Building2HugeIcon, SparklesIcon as __SparklesHugeIcon } from '@hugeicons/core-free-icons'

export function Onboarding() {
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore(
    (state) => state.open
  )
  const [preferredProviders, setPreferredProviders] = useState<
    SourceControlProviderPreference[]
  >(() => readSourceControlProviderPreferences())

  const providerOptions = useMemo(
    () => [{ id: 'github' as const, label: 'GitHub' }],
    []
  )

  const togglePreferredProvider = (provider: SourceControlProviderPreference) => {
    setPreferredProviders((current) => {
      const next = current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider]
      writeSourceControlProviderPreferences(next)
      return next
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HugeiconsIcon icon={__SparklesHugeIcon} className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Cozea</h1>
          <p className="text-muted-foreground">
            Let&apos;s create your first workspace. You can connect GitHub here now, or later when you open a project that needs it.

          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Project source control</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick the GitHub setup you use for project repositories. This helps Cozea prioritize the right setup later. It only applies to project source control, not agent CLI or MCP integrations.
                </p>
              </div>
              <Badge variant={preferredProviders.length > 0 ? 'secondary' : 'outline'}>
                {preferredProviders.length > 0 ? 'Saved' : 'Optional'}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {providerOptions.map((provider) => {
                const active = preferredProviders.includes(provider.id)
                return (
                  <Button
                    key={provider.id}
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => {
                      togglePreferredProvider(provider.id)
                    }}
                  >
                    {provider.label}
                  </Button>
                )
              })}
            </div>
          </div>

          <Button
            onClick={() => {
              openCreateWorkspaceDialog()
            }}
            className="w-full justify-between"
            size="lg"
          >
            <div className="flex items-center gap-3">
              <HugeiconsIcon icon={__Building2HugeIcon} className="size-5" />
              <span>Create a workspace</span>
            </div>
            <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-5" />
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            A workspace groups members, roles, billing, and project settings. Source control is configured when a project needs it.
          </p>
        </div>
      </div>
    </div>
  )
}
