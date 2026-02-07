import { AlertTriangle, FolderOpen, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface ProjectPathRecoveryScreenProps {
  projectName?: string
  previousPath: string
  targetPath: string
  targetPathExists: boolean
  onUsePreviousPath: () => void
  onUseTargetPath: () => void
  onRetry?: () => void
  isBusy?: boolean
  error?: string | null
}

export function ProjectPathRecoveryScreen({
  projectName,
  previousPath,
  targetPath,
  targetPathExists,
  onUsePreviousPath,
  onUseTargetPath,
  onRetry,
  isBusy = false,
  error = null,
}: ProjectPathRecoveryScreenProps) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Project directory changed
          </CardTitle>
          <CardDescription>
            {projectName
              ? `Choose which local directory to use for "${projectName}".`
              : "Choose which local directory to use for this project."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-sm font-medium">Use previous directory</div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{previousPath}</div>
            <Button
              variant="outline"
              className="mt-3"
              onClick={onUsePreviousPath}
              disabled={isBusy}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Keep using previous directory
            </Button>
          </div>

          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-sm font-medium">
              {targetPathExists ? "Use current projects directory copy" : "Create new copy in current projects directory"}
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{targetPath}</div>
            <Button className="mt-3" onClick={onUseTargetPath} disabled={isBusy}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {targetPathExists ? "Switch to current directory copy" : "Create and sync here"}
            </Button>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {onRetry && error ? (
            <Button variant="ghost" size="sm" onClick={onRetry} disabled={isBusy}>
              Retry detection
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
