import { useCallback, useMemo, useState } from "react"
import { AlertCircle, Loader2, LogOut, Mail, UserPlus } from "lucide-react"
import { useMutation, useQuery } from "convex/react"
import { useParams } from "react-router-dom"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
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

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ""
}

function formatName(input: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
} | null | undefined): string {
  const first = input?.firstName?.trim() ?? ""
  const last = input?.lastName?.trim() ?? ""
  const fullName = `${first} ${last}`.trim()
  return fullName || input?.email?.trim() || "A Cozea collaborator"
}

function isLikelyConvexId(value: string): boolean {
  return /^[a-z0-9]+$/i.test(value)
}

export function ProjectInvitePage() {
  const navigate = useViewTransitionNavigate()
  const { inviteId: inviteIdParam } = useParams<{ inviteId: string }>()
  const { user, convexUserId, isAuthenticated, isLoading, login, logout } = useAuth()
  const acceptInvite = useMutation(api.projectInvites.acceptInvite)
  const declineInvite = useMutation(api.projectInvites.declineInvite)

  const inviteId = useMemo(() => {
    const candidate = inviteIdParam?.trim() ?? ""
    return candidate && isLikelyConvexId(candidate)
      ? (candidate as Id<"projectInvites">)
      : null
  }, [inviteIdParam])

  const invite = useQuery(api.projectInvites.get, inviteId ? { inviteId } : "skip")

  const [isSubmitting, setIsSubmitting] = useState<"accept" | "decline" | "switch" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const isEmailMismatch = Boolean(
    invite?.email &&
      user?.email &&
      normalizeEmail(invite.email) !== normalizeEmail(user.email)
  )
  const projectHref = invite?.project ? buildProjectPath(String(invite.project.id)) : "/projects"

  const handleAccept = useCallback(async () => {
    if (!inviteId || !convexUserId || !invite?.project) return
    setIsSubmitting("accept")
    setActionError(null)
    try {
      const result = await acceptInvite({
        inviteId,
        userId: convexUserId,
      })
      navigate(buildProjectPath(String(result.projectId), 'pages'), { replace: true })
    } catch (error) {
      setActionError(cleanConvexError(error, "Unable to accept this invite."))
    } finally {
      setIsSubmitting(null)
    }
  }, [acceptInvite, convexUserId, invite?.project, inviteId, navigate])

  const handleDecline = useCallback(async () => {
    if (!inviteId || !convexUserId) return
    setIsSubmitting("decline")
    setActionError(null)
    try {
      await declineInvite({
        inviteId,
        userId: convexUserId,
      })
      navigate("/projects", { replace: true })
    } catch (error) {
      setActionError(cleanConvexError(error, "Unable to decline this invite."))
    } finally {
      setIsSubmitting(null)
    }
  }, [convexUserId, declineInvite, inviteId, navigate])

  const handleUseDifferentAccount = useCallback(async () => {
    setIsSubmitting("switch")
    setActionError(null)
    try {
      await logout()
      await login()
    } catch (error) {
      setActionError(cleanConvexError(error, "Unable to switch accounts right now."))
      setIsSubmitting(null)
    }
  }, [login, logout])

  if (!inviteId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Invalid Invite</CardTitle>
            <CardDescription>The project invite link is malformed.</CardDescription>
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

  if (invite === undefined || (isLoading && !isAuthenticated)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <CardTitle>Loading Invite...</CardTitle>
            <CardDescription>Checking this project invite now.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!invite || !invite.project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>Invite Not Available</CardTitle>
            <CardDescription>
              This project invite is missing, cancelled, or points to a project that no longer exists.
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

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-7 w-7 text-primary" />
            </div>
            <CardTitle>{invite.project.name}</CardTitle>
            <CardDescription>
              {formatName(invite.inviter)} invited you to join this project as a{" "}
              {invite.role.replace(/_/g, " ")}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Sign in with <span className="font-medium text-foreground">{invite.email}</span> to
              review and accept this invite.
            </div>
            <Button
              className="w-full"
              onClick={() => {
                void login()
              }}
              disabled={isSubmitting === "switch"}
            >
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
            <CardDescription>Preparing your account so this invite can be applied.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (invite.status !== "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
              <UserPlus className="h-7 w-7 text-muted-foreground" />
            </div>
            <CardTitle>Invite No Longer Pending</CardTitle>
            <CardDescription>
              This invite has already been processed. You can open the project if access is already in place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate(projectHref, { replace: true })}>
              Open project
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
            <UserPlus className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>{invite.project.name}</CardTitle>
          <CardDescription>
            {formatName(invite.inviter)} invited you to join this project as a{" "}
            {invite.role.replace(/_/g, " ")}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEmailMismatch ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Signed in as <span className="font-medium">{user?.email}</span>, but this invite was
              sent to <span className="font-medium">{invite.email}</span>.
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Invite email: <span className="font-medium text-foreground">{invite.email}</span>
            </div>
          )}

          {actionError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          ) : null}

          <div className="flex gap-2">
            {isEmailMismatch ? (
              <>
                <Button
                  className="flex-1"
                  onClick={() => {
                    void handleUseDifferentAccount()
                  }}
                  disabled={isSubmitting !== null}
                >
                  {isSubmitting === "switch" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  Use different account
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate("/projects", { replace: true })}
                >
                  Go to Projects
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    void handleDecline()
                  }}
                  disabled={isSubmitting !== null}
                >
                  {isSubmitting === "decline" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Decline
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    void handleAccept()
                  }}
                  disabled={isSubmitting !== null}
                >
                  {isSubmitting === "accept" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Accept invite
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
