import { useEffect } from "react"

import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useCreateProjectDialogStore, type CreateProjectDialogMode } from "@/stores/useCreateProjectDialogStore"

function resolveMode(search: string): CreateProjectDialogMode {
  const params = new URLSearchParams(search)
  const rawMode = params.get("mode")

  if (rawMode === "local" || rawMode === "repo") {
    return rawMode
  }

  return "empty"
}

export default function NewProject() {
  const navigate = useViewTransitionNavigate()
  const openCreateProjectDialog = useCreateProjectDialogStore((state) => state.open)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeProjectId = params.get("resume")

    if (resumeProjectId) {
      navigate(buildProjectPath(resumeProjectId, "workbench"), { replace: true })
      return
    }

    openCreateProjectDialog({ mode: resolveMode(window.location.search) })
    navigate("/projects", { replace: true })
  }, [navigate, openCreateProjectDialog])

  return null
}
