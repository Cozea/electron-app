import { useCallback, useMemo, useState } from "react"
import { useParams } from '@/lib/router'
import { useMutation, useQuery } from "convex/react"
import { AlertCircle, Link2, Loader2, LogIn } from "lucide-react"

import { api } from "../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

export function ProjectJoinPage() {
  const navigate = useViewTransitionNavigate()
  const { token } = useParams()
  const { convexUserId, isAuthenticated, isLoading, login } = useAuth()
  const joinByToken = useMutation(api.projectJoinLinks.joinByToken)
  const preview = useQuery(
    api.projectJoinLinks.previewByToken,
    token
      ? convexUserId
        ? {
            token,
            viewerUserId: convexUserId,
          }
        : {
            token,
          }
      : "skip"
  )

  const [isJoining, setIsJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const shortToken = useMemo(() => {
    if (!token) return null
    if (token.length <= 12) return token
    return `${token.slice(0, 6)}...${token.slice(-4)}`
  }, [token])

  const runJoin = useCallback(async () => {
    if (!token || !convexUserId) return
    setIsJoining(true)
    setJoinError(null)

    try {
      const result = await joinByToken({
        token,
        userId: convexUserId,
      })
      navigate(buildProjectPath(String(result.projectId), 'pages'), { replace: true })
    } catch (error) {
      setJoinError(cleanConvexError(error, "Unable to join this project."))
    } finally {
      setIsJoining(false)
    }
  }, [convexUserId, joinByToken, navigate, token])

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
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

  if (preview === undefined || (isLoading && !isAuthenticated)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
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
              <AlertCircle className="h-7 w-7 text-destructive" />
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
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => navigate("/projects", { replace: true })}
              >
                Go to Projects
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Link2 className="h-7 w-7 text-primary" />
            </div>
            <CardTitle>{preview.project.name}</CardTitle>
            <CardDescription>
              {preview.inviter?.firstName || preview.inviter?.lastName || preview.inviter?.email
                ? "A collaborator shared a direct project link with you."
                : "This project link gives access to a shared Cozea project."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Sign in to preview and accept this project link.
            </div>
            <Button
              className="w-full"
              onClick={() => {
                void login()
              }}
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign in to continue
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!convexUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <CardTitle>Finishing Sign-in...</CardTitle>
            <CardDescription>Preparing your account for project access.</CardDescription>
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
              <AlertCircle className="h-7 w-7 text-destructive" />
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
            <Link2 className="h-7 w-7 text-primary" />
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
              : "Access will be granted as soon as you accept this link."}
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
                onClick={() => {
                  void runJoin()
                }}
                disabled={isJoining}
              >
                {isJoining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Join project
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
