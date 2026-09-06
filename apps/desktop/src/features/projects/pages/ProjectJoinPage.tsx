import { useCallback, useMemo, useState } from "react"
import { useParams } from "@/lib/router"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertCircleIcon as __AlertCircleHugeIcon,
  Link01Icon as __Link2HugeIcon,
} from "@hugeicons/core-free-icons"

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

export function ProjectJoinPage() {
  const navigate = useViewTransitionNavigate()
  const { token } = useParams()
  const { principalId, isLoading } = useAuth()
  const joinByToken = useMutation(api.projectJoinLinks.joinByToken)
  const preview = useQuery(
    api.projectJoinLinks.previewByToken,
    token ? { token } : "skip"
  )

  const [isJoining, setIsJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const shortToken = useMemo(() => {
    if (!token) return null
    if (token.length <= 12) return token
    return `${token.slice(0, 6)}...${token.slice(-4)}`
  }, [token])

  const runJoin = useCallback(async () => {
    if (!token || !principalId) return
    setIsJoining(true)
    setJoinError(null)

    try {
      // The backend derives the joining device principal from authenticated
      // device authority. The renderer deliberately sends no user/device ID,
      // hostname, platform, or fingerprint as identity claims.
      const result = await joinByToken({ token })
      navigate(buildProjectPath(String(result.projectId), "workbench"), { replace: true })
    } catch (error) {
      setJoinError(cleanConvexError(error, "Unable to join this project."))
    } finally {
      setIsJoining(false)
    }
  }, [principalId, joinByToken, navigate, token])

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Invalid Join Link</CardTitle>
            <CardDescription>The project join token is missing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/projects", { replace: true })}>
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (preview === undefined || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <div className="loader text-primary" />
            </div>
            <CardTitle>Loading Invite Link...</CardTitle>
            <CardDescription>Checking the project access attached to this link.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Unable to Join Project</CardTitle>
            <CardDescription>This invite link is invalid or no longer points to a project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shortToken ? (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Link token: {shortToken}
              </div>
            ) : null}
            <Button className="w-full" onClick={() => navigate("/projects", { replace: true })}>
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!principalId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <div className="loader text-primary" />
            </div>
            <CardTitle>Preparing This Device...</CardTitle>
            <CardDescription>Finishing the local device setup for project access.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (preview.status !== "active") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Link No Longer Active</CardTitle>
            <CardDescription>
              This share link has been revoked. Ask the project owner to generate a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/projects", { replace: true })}>
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={__Link2HugeIcon} className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>{preview.project.name}</CardTitle>
          <CardDescription>
            Join this project as a {preview.role.replace(/_/g, " ")}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {preview.alreadyMember
              ? `You already have access${preview.existingRole ? ` as ${preview.existingRole.replace(/_/g, " ")}` : ""}.`
              : "Accepting this link will authorize the current device for this project."}
          </div>

          {joinError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {joinError}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate("/projects", { replace: true })}
            >
              Back to Projects
            </Button>
            {preview.alreadyMember ? (
              <Button
                className="flex-1"
                onClick={() => navigate(buildProjectPath(String(preview.project.id)), { replace: true })}
              >
                Open project
              </Button>
            ) : (
              <Button
                className="flex-1"
                onClick={() => void runJoin()}
                disabled={isJoining}
              >
                {isJoining ? <div className="loader mr-2" /> : null}
                Join project
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
