import { useEffect, useMemo } from "react"
import { useLocation, useParams } from "react-router-dom"
import { Loader2 } from "lucide-react"

import { useViewTransitionNavigate } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject"

export function LegacyProjectRedirectPage() {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const params = useParams<{ slug?: string; "*": string }>()
  const tail = params["*"] ?? ""
  const { project, slugResolution } = useAccessibleProject()

  const nextSegment = useMemo(() => tail.replace(/^\/+/, ""), [tail])

  useEffect(() => {
    if (!project?._id) return
    const targetPath = buildProjectPath(String(project._id), nextSegment)
    const target = `${targetPath}${location.search || ""}${location.hash || ""}`
    navigate(target, { replace: true })
  }, [location.hash, location.search, navigate, nextSegment, project?._id])

  if (project?._id) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Redirecting...
      </div>
    )
  }

  if (slugResolution === undefined || slugResolution === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (slugResolution.status === "ambiguous") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold">Select a project</h2>
          <p className="text-xs text-muted-foreground">
            Multiple projects match this legacy slug. Open one to continue with the canonical route.
          </p>
          <div className="space-y-2">
            {(slugResolution.candidates ?? []).map((candidate) => (
              <Button
                key={String(candidate.projectId)}
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  navigate(buildProjectPath(String(candidate.projectId), nextSegment), {
                    replace: true,
                  })
                }}
              >
                {candidate.name}
              </Button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Project not found.
    </div>
  )
}
