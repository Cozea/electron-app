import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { useCreateProjectDialogStore } from '@/stores/useCreateProjectDialogStore'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon as __ArrowRightHugeIcon, FolderLibraryIcon as __FolderLibraryHugeIcon, PlusSignIcon as __PlusHugeIcon, SparklesIcon as __SparklesHugeIcon } from '@hugeicons/core-free-icons'

export function Onboarding() {
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const handleCreateProject = useCallback(() => {
    openCreateProjectDialog({ mode: 'empty' })
  }, [openCreateProjectDialog])
  const handleImportFolder = useCallback(() => {
    openCreateProjectDialog({ mode: 'local' })
  }, [openCreateProjectDialog])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HugeiconsIcon icon={__SparklesHugeIcon} className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Cozea</h1>
          <p className="text-muted-foreground">
            Set up your first project on this device. Collaboration and repository tools can be added later per project.
          </p>
        </div>

        <div className="space-y-4">
          <Button
            onClick={handleCreateProject}
            className="w-full justify-between"
            size="lg"
          >
            <div className="flex items-center gap-3">
              <HugeiconsIcon icon={__PlusHugeIcon} className="size-5" />
              <span>Create your first project</span>
            </div>
            <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-5" />
          </Button>

          <Button
            onClick={handleImportFolder}
            className="w-full justify-between"
            size="lg"
            variant="secondary"
          >
            <div className="flex items-center gap-3">
              <HugeiconsIcon icon={__FolderLibraryHugeIcon} className="size-5" />
              <span>Import a local folder</span>
            </div>
            <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-5" />
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Cozea is local-first. Git stays manual, and collaboration is enabled per project when you need it.
          </p>
        </div>
      </div>
    </div>
  )
}
