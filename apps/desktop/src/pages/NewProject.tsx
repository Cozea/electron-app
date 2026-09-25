import { useEffect, useRef } from "react"
import { Spinner } from "@/components/ui/spinner"

import { useAuth } from "@/contexts/AuthContext"
import { useNavigateTo, useViewTransitionNavigate } from "@/lib/navigation"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/lib/createProjectDialogStore"
import { browseForDirectory } from "@/lib/browseForDirectory"
import { useTranslation } from "@/lib/i18n"

function resolveMode(search: string): CreateProjectDialogMode {
  const params = new URLSearchParams(search)
  const rawMode = params.get("mode")

  if (rawMode === "local" || rawMode === "devapp" || rawMode === "devapp-local") {
    return rawMode
  }

  return "empty"
}

export default function NewProject() {
  const navigate = useViewTransitionNavigate()
  const navigateTo = useNavigateTo()
  const { principalId } = useAuth()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const { t } = useTranslation()
  // The effect's callback deps change identity when auth finishes resolving;
  // without the guard that re-run opened the directory picker a second time.
  const hasStartedRef = useRef(false)

  useEffect(() => {
    if (hasStartedRef.current) return

    const params = new URLSearchParams(window.location.search)
    const resumeProjectId = params.get("resume")

    if (resumeProjectId) {
      hasStartedRef.current = true
      navigateTo({ to: "workbench", projectId: resumeProjectId }, { replace: true })
      return
    }

    const nextMode = resolveMode(window.location.search)

    if (nextMode === "local" || nextMode === "devapp-local") {
      // Local import needs the Convex profile; wait for auth before the
      // one-shot picker so the import doesn't run with a stale null user.
      if (!principalId) return
      hasStartedRef.current = true
      void browseForDirectory(
        nextMode === "devapp-local" ? "Select existing DevApp project" : "Select local project folder",
      ).then((selectedPath) => {
        if (!selectedPath?.trim()) {
          navigateTo({ to: "projects" }, { replace: true })
          return
        }

        openCreateProjectDialog({
          mode: nextMode,
          localFolderPath: selectedPath,
        })
        navigateTo({ to: "projects" }, { replace: true })
      })
      return
    }

    hasStartedRef.current = true
    openCreateProjectDialog({ mode: nextMode })
    navigateTo({ to: "projects" }, { replace: true })
  }, [principalId, navigate, openCreateProjectDialog])

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Spinner size="xs" className="mr-2" />
      {t("newProject.openingSetup")}
    </div>
  )
}
