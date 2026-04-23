import { lazy, Suspense } from "react"

const LazyProjectWorkbenchSurface = lazy(() =>
  import("@/features/projects/pages/ProjectWorkbenchSurface").then((module) => ({
    default: module.ProjectWorkbenchSurface,
  })),
)

function ProjectWorkbenchLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <div className="loader" />
        <span>Loading workbench…</span>
      </div>
    </div>
  )
}

export function ProjectWorkbenchPage() {
  return (
    <Suspense fallback={<ProjectWorkbenchLoading />}>
      <LazyProjectWorkbenchSurface />
    </Suspense>
  )
}
