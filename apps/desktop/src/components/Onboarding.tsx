import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { useProjectCreationMenu } from '@/features/projects/hooks/useProjectCreationMenu'
import { useTranslation } from '@/lib/i18n'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon as __ArrowRightHugeIcon, FolderLibraryIcon as __FolderLibraryHugeIcon, PlusSignIcon as __PlusHugeIcon, SparklesIcon as __SparklesHugeIcon } from '@hugeicons/core-free-icons'

export function Onboarding() {
  const { openCreateProjectDialog } = useProjectCreationMenu()
  const { t } = useTranslation()
  const handleCreateProject = useCallback(() => {
    openCreateProjectDialog('empty')
  }, [openCreateProjectDialog])
  const handleImportFolder = useCallback(() => {
    openCreateProjectDialog('local')
  }, [openCreateProjectDialog])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HugeiconsIcon icon={__SparklesHugeIcon} className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("onboarding.welcome")}</h1>
          <p className="text-muted-foreground">
            {t("onboarding.setupDescription")}
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
              <span>{t("onboarding.createFirstProject")}</span>
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
              <span>{t("onboarding.importLocalFolder")}</span>
            </div>
            <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-5" />
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {t("onboarding.localFirstNote")}
          </p>
        </div>
      </div>
    </div>
  )
}
