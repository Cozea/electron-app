import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { useMutation } from "convex/react"
import { AlertCircle, Loader2 } from "lucide-react"

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
  const { token } = useParams<{ token: string }>()
  const { convexUserId } = useAuth()
  const joinByToken = useMutation(api.projectJoinLinks.joinByToken)

  const [attempt, setAttempt] = useState(0)
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
      navigate(buildProjectPath(String(result.projectId)), { replace: true })
    } catch (error) {
      setJoinError(cleanConvexError(error, "Unable to join this project."))
    } finally {
      setIsJoining(false)
    }
  }, [convexUserId, joinByToken, navigate, token])

  useEffect(() => {
    if (!token) {
      setJoinError("Invalid project join link.")
      return
    }
    if (!convexUserId) return
    void runJoin()
  }, [attempt, convexUserId, runJoin, token])

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

  if (!convexUserId || isJoining) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <CardTitle>Joining Project...</CardTitle>
            <CardDescription>
              {!convexUserId ? "Finishing sign-in..." : "Applying your project access now."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (joinError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Unable to Join Project</CardTitle>
            <CardDescription>{joinError}</CardDescription>
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
                onClick={() => {
                  setAttempt((value) => value + 1)
                }}
              >
                Retry
              </Button>
              <Button
                variant="outline"
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

  return null
}
