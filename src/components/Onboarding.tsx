import { ArrowRight, Building2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'

export function Onboarding() {
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore(
    (state) => state.open
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Cozea</h1>
          <p className="text-muted-foreground">
            Let&apos;s get you set up with your first workspace.
          </p>
        </div>

        <div className="space-y-4">
          <Button
            onClick={openCreateWorkspaceDialog}
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
            A workspace groups members, permissions, billing, and shared project
            settings.
          </p>
        </div>
      </div>
    </div>
  )
}
