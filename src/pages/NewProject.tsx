import { useEffect } from "react"
import { ArrowPathIcon as Loader2 } from "@heroicons/react/24/outline"

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

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Opening project setup…
    </div>
  )
}
