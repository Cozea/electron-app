import { useEffect } from "react"

import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"
import { useLocalProjectImport } from "@/features/projects/hooks/useLocalProjectImport"
import { browseForDirectory } from "@/features/projects/lib/localProjectImport"

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
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)
  const { importPickedLocalFolder } = useLocalProjectImport()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeProjectId = params.get("resume")

    if (resumeProjectId) {
      navigate(buildProjectPath(resumeProjectId, "workbench"), { replace: true })
      return
    }

    const nextMode = resolveMode(window.location.search)

    if (nextMode === "local") {
      void browseForDirectory("Select local project folder").then((selectedPath) => {
        if (!selectedPath?.trim()) {
          navigate("/projects", { replace: true })
          return
        }

        void importPickedLocalFolder(selectedPath).then((outcome) => {
          if (outcome !== "imported") {
            navigate("/projects", { replace: true })
          }
        })
      })
      return
    }

    openCreateProjectDialog({ mode: nextMode })
    navigate("/projects", { replace: true })
  }, [importPickedLocalFolder, navigate, openCreateProjectDialog])

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="loader mr-2" />
      Opening project setup…
    </div>
  )
}
