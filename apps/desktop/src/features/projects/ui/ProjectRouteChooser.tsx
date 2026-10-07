import { Button } from "@/components/ui/button"
import { useNavigateTo } from "@/lib/navigation"

interface ProjectRouteChooserProps {
  candidates: ReadonlyArray<{ projectId: string; name: string; folderPath?: string | null }>
}

export function ProjectRouteChooser({ candidates }: ProjectRouteChooserProps) {
  const navigateTo = useNavigateTo()
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 p-6" data-project-route-chooser>
      <h1 className="text-page-title">Choose a project</h1>
      <p className="text-sm text-muted-foreground">This link matches more than one project.</p>
      {candidates.map((candidate) => (
        <Button key={candidate.projectId} variant="outline" className="h-auto flex-col items-start gap-1 py-3"
          onClick={() => navigateTo({ to: "workbench", projectId: candidate.projectId }, { replace: true })}>
          <span>{candidate.name}</span>
          {candidate.folderPath ? <span className="max-w-full truncate text-caption font-normal text-muted-foreground">{candidate.folderPath}</span> : null}
        </Button>
      ))}
    </div>
  )
}
