import { useEffect, useRef } from "react"

import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"
import { useTranslation } from "@/lib/i18n"

function resolveMode(search: string): CreateProjectDialogMode {
  const params = new URLSearchParams(search)
  const rawMode = params.get("mode")

  if (rawMode === "local") {
    return rawMode
  }

  return "empty"
}

export default function NewProject() {
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const { importPickedLocalFolder } = useLocalProjectImport()
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
      navigate(buildProjectPath(resumeProjectId, "workbench"), { replace: true })
      return
    }

    const nextMode = resolveMode(window.location.search)

    if (nextMode === "local") {
      // Local import needs the Convex profile; wait for auth before the
      // one-shot picker so the import doesn't run with a stale null user.
      if (!convexUserId) return
      hasStartedRef.current = true
      void browseForDirectory("Select local project folder").then((selectedPath) => {
        if (!selectedPath?.trim()) {
          navigate("/projects", { replace: true })
          return
        }

        void importPickedLocalFolder(selectedPath).then(({ outcome }) => {
          if (outcome !== "imported") {
            navigate("/projects", { replace: true })
          }
        })
      })
      return
    }

    hasStartedRef.current = true
    openCreateProjectDialog({ mode: nextMode })
    navigate("/projects", { replace: true })
  }, [convexUserId, importPickedLocalFolder, navigate, openCreateProjectDialog])

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="loader mr-2" />
      {t("newProject.openingSetup")}
    </div>
  )
}
